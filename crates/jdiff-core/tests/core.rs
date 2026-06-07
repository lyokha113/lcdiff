use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

use jdiff_core::{
    Archive, ArchiveSourceKind, CommitOptions, DecompileEngine, DecompileOptions, EntryKind,
    MergePlan, PairStatus, SidecarAction, SidecarRequest, compare, read_frame,
    search_constant_pool, validate_path, write_frame,
};
use tempfile::tempdir;
use zip::{DateTime, ZipArchive, ZipWriter, write::SimpleFileOptions};

#[test]
fn validates_quotes_and_opens_archive() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("sample.jar");
    create_zip(&archive_path, &[("a.txt", b"hello")]);
    let path = validate_path(&format!("  \"{}\"  ", archive_path.display())).unwrap();
    let archive = Archive::open(path.to_string_lossy()).unwrap();
    assert_eq!(archive.entries().count(), 1);
    assert_eq!(archive.entry("a.txt").unwrap().kind, EntryKind::Text);
    assert_eq!(archive.read_entry("a.txt").unwrap(), b"hello");
}

#[test]
fn validates_shell_escaped_space_path_and_opens_archive() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("sample archive.jar");
    create_zip(&archive_path, &[("a.txt", b"hello")]);
    let pasted = archive_path.display().to_string().replace(' ', "\\ ");

    let path = validate_path(&pasted).unwrap();

    assert_eq!(path, archive_path);
    assert_eq!(
        Archive::open(path.to_string_lossy())
            .unwrap()
            .read_entry("a.txt")
            .unwrap(),
        b"hello"
    );
}

#[test]
fn opens_directory_as_entry_source() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("classes");
    fs::create_dir_all(source.join("pkg")).unwrap();
    fs::write(source.join("pkg/A.class"), b"class-bytes").unwrap();
    fs::write(source.join("readme.txt"), b"hello folder").unwrap();

    let path = validate_path(&source.to_string_lossy()).unwrap();
    let archive = Archive::open(path.to_string_lossy()).unwrap();

    assert_eq!(archive.metadata().source_kind, ArchiveSourceKind::Directory);
    assert_eq!(archive.entry("pkg/").unwrap().kind, EntryKind::Directory);
    assert_eq!(archive.entry("pkg/A.class").unwrap().kind, EntryKind::Class);
    assert_eq!(archive.entry("readme.txt").unwrap().kind, EntryKind::Text);
    assert_eq!(archive.read_entry("pkg/A.class").unwrap(), b"class-bytes");
}

#[test]
fn compares_by_path_crc_and_size() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(
        &left_path,
        &[
            ("same.txt", b"same"),
            ("left.txt", b"left"),
            ("diff.txt", b"a"),
        ],
    );
    create_zip(
        &right_path,
        &[
            ("same.txt", b"same"),
            ("right.txt", b"right"),
            ("diff.txt", b"b"),
        ],
    );
    let diff = compare(
        &Archive::open(left_path.to_string_lossy()).unwrap(),
        &Archive::open(right_path.to_string_lossy()).unwrap(),
    );
    let statuses = diff
        .pairs
        .into_iter()
        .map(|pair| (pair.path, pair.status))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(statuses["same.txt"], PairStatus::Identical);
    assert_eq!(statuses["left.txt"], PairStatus::OnlyLeft);
    assert_eq!(statuses["right.txt"], PairStatus::OnlyRight);
    assert_eq!(statuses["diff.txt"], PairStatus::Different);
}

#[test]
fn compares_archive_to_directory_by_path_crc_and_size() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("left.jar");
    let folder = dir.path().join("right");
    create_zip(
        &archive_path,
        &[("same.txt", b"same"), ("diff.txt", b"archive")],
    );
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("same.txt"), b"same").unwrap();
    fs::write(folder.join("diff.txt"), b"folder").unwrap();
    fs::write(folder.join("folder-only.txt"), b"folder").unwrap();

    let diff = compare(
        &Archive::open(archive_path.to_string_lossy()).unwrap(),
        &Archive::open(folder.to_string_lossy()).unwrap(),
    );
    let statuses = diff
        .pairs
        .into_iter()
        .map(|pair| (pair.path, pair.status))
        .collect::<std::collections::BTreeMap<_, _>>();

    assert_eq!(statuses["same.txt"], PairStatus::Identical);
    assert_eq!(statuses["diff.txt"], PairStatus::Different);
    assert_eq!(statuses["folder-only.txt"], PairStatus::OnlyRight);
}

#[test]
fn stages_original_bytes_and_commits_with_one_backup() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(
        &left_path,
        &[("pkg/A.class", b"new-bytecode"), ("extra.txt", b"extra")],
    );
    create_zip(
        &right_path,
        &[("pkg/A.class", b"old-bytecode"), ("keep.txt", b"keep")],
    );
    let backup_path = right_path.with_extension("jar.bak");
    std::fs::write(&backup_path, b"stale backup").unwrap();
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "pkg/A.class", "pkg/A.class")
        .unwrap();
    plan.stage_copy(&left, "extra.txt", "extra.txt").unwrap();
    let result = plan.commit(&right, CommitOptions { backup: true }).unwrap();
    assert_eq!(result.copied_entries, 2);
    assert_eq!(result.backup_path.as_deref(), Some(backup_path.as_path()));
    assert_eq!(
        Archive::open(backup_path.to_string_lossy())
            .unwrap()
            .read_entry("pkg/A.class")
            .unwrap(),
        b"old-bytecode"
    );
    assert!(plan.staged().is_empty());
    let rewritten = Archive::open(right_path.to_string_lossy()).unwrap();
    assert_eq!(
        rewritten.read_entry("pkg/A.class").unwrap(),
        b"new-bytecode"
    );
    assert_eq!(rewritten.read_entry("keep.txt").unwrap(), b"keep");
    assert_eq!(rewritten.read_entry("extra.txt").unwrap(), b"extra");
}

#[test]
fn commits_staged_archive_entry_into_directory_target_with_backup() {
    let dir = tempdir().unwrap();
    let source_path = dir.path().join("source.jar");
    let target_dir = dir.path().join("target");
    create_zip(
        &source_path,
        &[("pkg/A.class", b"new-bytecode"), ("extra.txt", b"extra")],
    );
    fs::create_dir_all(target_dir.join("pkg")).unwrap();
    fs::write(target_dir.join("pkg/A.class"), b"old-bytecode").unwrap();
    fs::write(target_dir.join("keep.txt"), b"keep").unwrap();

    let source = Archive::open(source_path.to_string_lossy()).unwrap();
    let target = Archive::open(target_dir.to_string_lossy()).unwrap();
    let backup_path = backup_path_for(&target_dir);
    let mut plan = MergePlan::new();
    plan.stage_copy(&source, "pkg/A.class", "pkg/A.class")
        .unwrap();
    plan.stage_copy(&source, "extra.txt", "extra.txt").unwrap();

    let result = plan
        .commit(&target, CommitOptions { backup: true })
        .unwrap();

    assert_eq!(result.copied_entries, 2);
    assert_eq!(result.backup_path.as_deref(), Some(backup_path.as_path()));
    assert_eq!(
        fs::read(target_dir.join("pkg/A.class")).unwrap(),
        b"new-bytecode"
    );
    assert_eq!(fs::read(target_dir.join("extra.txt")).unwrap(), b"extra");
    assert_eq!(fs::read(target_dir.join("keep.txt")).unwrap(), b"keep");
    assert_eq!(
        fs::read(backup_path.join("pkg/A.class")).unwrap(),
        b"old-bytecode"
    );
    assert!(plan.staged().is_empty());
}

#[test]
fn failed_backup_before_atomic_replace_leaves_target_untouched_and_temp_removed() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(&left_path, &[("a.txt", b"new")]);
    create_zip(&right_path, &[("a.txt", b"old")]);
    let backup_path = right_path.with_extension("jar.bak");
    std::fs::create_dir(&backup_path).unwrap();
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "a.txt", "a.txt").unwrap();

    let error = plan
        .commit(&right, CommitOptions { backup: true })
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("Is a directory") || error.contains("is a directory"),
        "{error}"
    );
    assert_eq!(plan.staged().len(), 1);
    assert_eq!(
        Archive::open(right_path.to_string_lossy())
            .unwrap()
            .read_entry("a.txt")
            .unwrap(),
        b"old"
    );
    assert!(backup_path.is_dir());
    let temp_leftovers = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.contains(".jdiff-") && name.ends_with(".tmp")
        })
        .count();
    assert_eq!(temp_leftovers, 0);
}

#[test]
fn staging_same_target_path_replaces_previous_copy() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(
        &left_path,
        &[("first.txt", b"first"), ("second.txt", b"second")],
    );
    create_zip(&right_path, &[("target.txt", b"old")]);
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();

    plan.stage_copy(&left, "first.txt", "target.txt").unwrap();
    plan.stage_copy(&left, "second.txt", "target.txt").unwrap();

    assert_eq!(plan.staged().len(), 1);
    assert_eq!(plan.staged()[0].source_entry_path, "second.txt");
    let result = plan.commit(&right, CommitOptions::default()).unwrap();
    assert_eq!(result.copied_entries, 1);
    assert_eq!(
        Archive::open(right_path.to_string_lossy())
            .unwrap()
            .read_entry("target.txt")
            .unwrap(),
        b"second"
    );
}

#[test]
fn rejects_staging_directory_entry() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("directories.zip");
    let file = File::create(&archive_path).unwrap();
    let mut zip = ZipWriter::new(file);
    zip.add_directory("folder/", SimpleFileOptions::default())
        .unwrap();
    zip.finish().unwrap();
    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();

    let error = plan
        .stage_copy(&archive, "folder/", "folder/")
        .unwrap_err()
        .to_string();

    assert!(error.contains("cannot copy directory entry"));
}

#[test]
fn searches_java_constant_pool_utf8_values() {
    let bytes = class_with_utf8("needle-value");
    let matches = search_constant_pool(&bytes, "Needle").unwrap();
    assert_eq!(matches[0].value, "needle-value");
}

#[test]
fn round_trips_length_prefixed_sidecar_json() {
    let request = SidecarRequest {
        id: "u1".to_owned(),
        action: SidecarAction::Decompile,
        engine: Some(DecompileEngine::Cfr),
        classpath: vec!["/tmp/app.jar".to_owned()],
        entry: Some("pkg/A.class".to_owned()),
        target: None,
        options: DecompileOptions::default(),
    };
    let mut bytes = Vec::new();
    write_frame(&mut bytes, &request).unwrap();
    assert_eq!(
        u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize,
        bytes.len() - 4
    );
    assert_eq!(
        read_frame::<SidecarRequest>(bytes.as_slice()).unwrap(),
        request
    );
}

#[test]
fn detects_signed_jar_metadata() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("signed.jar");
    create_zip(
        &archive_path,
        &[
            ("META-INF/MANIFEST.MF", b"SHA-256-Digest: abc\n"),
            ("META-INF/APP.SF", b"signature"),
            ("META-INF/APP.RSA", b"signature block"),
            ("pkg/A.class", b"bytecode"),
        ],
    );
    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();
    assert!(archive.metadata().signed);
}

#[test]
fn does_not_treat_incomplete_signature_metadata_as_signed() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("incomplete-signature.jar");
    create_zip(
        &archive_path,
        &[
            ("META-INF/MANIFEST.MF", b"SHA-256-Digest: abc\n"),
            ("META-INF/APP.SF", b"signature"),
            ("pkg/A.class", b"bytecode"),
        ],
    );

    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();

    assert!(!archive.metadata().signed);
}

#[test]
fn detects_zip64_metadata_for_small_forced_entry() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("zip64.jar");
    let file = File::create(&archive_path).unwrap();
    let mut zip = ZipWriter::new(file);
    zip.start_file("small.txt", SimpleFileOptions::default().large_file(true))
        .unwrap();
    zip.write_all(b"small").unwrap();
    zip.finish().unwrap();

    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();

    assert!(archive.metadata().zip64);
    assert_eq!(archive.read_entry("small.txt").unwrap(), b"small");
}

#[test]
fn rejects_commit_when_target_changed_on_disk() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(&left_path, &[("a.txt", b"new")]);
    create_zip(&right_path, &[("a.txt", b"old")]);
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "a.txt", "a.txt").unwrap();
    OpenOptions::new()
        .append(true)
        .open(&right_path)
        .unwrap()
        .write_all(b"external change")
        .unwrap();
    assert!(
        plan.commit(&right, CommitOptions::default())
            .unwrap_err()
            .to_string()
            .contains("changed since it was opened")
    );
}

#[test]
fn rejects_commit_when_staged_source_changed_on_disk() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(&left_path, &[("a.txt", b"new")]);
    create_zip(&right_path, &[("a.txt", b"old")]);
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "a.txt", "a.txt").unwrap();
    OpenOptions::new()
        .append(true)
        .open(&left_path)
        .unwrap()
        .write_all(b"external change")
        .unwrap();

    let error = plan
        .commit(&right, CommitOptions::default())
        .unwrap_err()
        .to_string();

    assert!(error.contains("changed since it was opened"));
    assert_eq!(
        Archive::open(right_path.to_string_lossy())
            .unwrap()
            .read_entry("a.txt")
            .unwrap(),
        b"old"
    );
}

#[test]
fn rejects_commit_before_rewrite_when_target_is_read_only() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(&left_path, &[("a.txt", b"new")]);
    create_zip(&right_path, &[("a.txt", b"old")]);
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "a.txt", "a.txt").unwrap();
    let original_permissions = std::fs::metadata(&right_path).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    std::fs::set_permissions(&right_path, permissions).unwrap();

    let error = plan
        .commit(&right, CommitOptions::default())
        .unwrap_err()
        .to_string();

    std::fs::set_permissions(&right_path, original_permissions).unwrap();
    assert!(error.contains("read-only"));
    assert_eq!(
        Archive::open(right_path.to_string_lossy())
            .unwrap()
            .read_entry("a.txt")
            .unwrap(),
        b"old"
    );
}

#[test]
fn rewrite_preserves_directory_entries_and_timestamps() {
    let dir = tempdir().unwrap();
    let left_path = dir.path().join("left.jar");
    let right_path = dir.path().join("right.jar");
    create_zip(&left_path, &[("new.txt", b"new")]);
    let timestamp = DateTime::from_date_and_time(2025, 5, 4, 3, 2, 30).unwrap();
    let file = File::create(&right_path).unwrap();
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().last_modified_time(timestamp);
    zip.add_directory("folder/", options).unwrap();
    zip.start_file("folder/keep.txt", options).unwrap();
    zip.write_all(b"keep").unwrap();
    zip.finish().unwrap();
    let left = Archive::open(left_path.to_string_lossy()).unwrap();
    let right = Archive::open(right_path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_copy(&left, "new.txt", "new.txt").unwrap();

    plan.commit(&right, CommitOptions::default()).unwrap();

    let rewritten = Archive::open(right_path.to_string_lossy()).unwrap();
    assert_eq!(
        rewritten.entry("folder/").unwrap().kind,
        EntryKind::Directory
    );
    let mut zip = ZipArchive::new(File::open(&right_path).unwrap()).unwrap();
    assert_eq!(
        zip.by_name("folder/keep.txt").unwrap().last_modified(),
        Some(timestamp)
    );
}

#[test]
fn reads_normalized_backslash_entry_path() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("backslash.zip");
    create_zip(&archive_path, &[("folder\\a.txt", b"content")]);

    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();

    assert!(archive.entry("folder/a.txt").is_some());
    assert_eq!(archive.read_entry("folder/a.txt").unwrap(), b"content");
}

#[test]
fn rejects_duplicate_normalized_entry_paths() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("duplicate.zip");
    create_zip(
        &archive_path,
        &[("folder\\a.txt", b"first"), ("folder/a.txt", b"second")],
    );

    let error = Archive::open(archive_path.to_string_lossy())
        .unwrap_err()
        .to_string();

    assert!(error.contains("duplicate normalized archive entry path"));
}

#[test]
fn rejects_encrypted_entry_metadata() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("encrypted.zip");
    create_zip(&archive_path, &[("secret.txt", b"secret")]);
    mark_first_entry_encrypted(&archive_path);

    let error = Archive::open(archive_path.to_string_lossy())
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("encrypted archive entry is not supported"),
        "{error}"
    );
}

#[test]
fn detects_multi_release_metadata() {
    let dir = tempdir().unwrap();
    let archive_path = dir.path().join("multi-release.jar");
    create_zip(
        &archive_path,
        &[("META-INF/versions/17/pkg/A.class", b"bytecode")],
    );

    let archive = Archive::open(archive_path.to_string_lossy()).unwrap();

    assert!(archive.metadata().multi_release);
}

fn mark_first_entry_encrypted(path: &Path) {
    let mut bytes = std::fs::read(path).unwrap();
    set_zip_flag(&mut bytes, &[b'P', b'K', 3, 4], 6, 1);
    set_zip_flag(&mut bytes, &[b'P', b'K', 1, 2], 8, 1);
    std::fs::write(path, bytes).unwrap();
}

fn set_zip_flag(bytes: &mut [u8], signature: &[u8; 4], flags_offset: usize, mask: u16) {
    let offset = bytes
        .windows(signature.len())
        .position(|window| window == signature)
        .unwrap()
        + flags_offset;
    let mut flags = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
    flags |= mask;
    let encoded = flags.to_le_bytes();
    bytes[offset] = encoded[0];
    bytes[offset + 1] = encoded[1];
}

fn create_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    for (path, bytes) in entries {
        zip.start_file(*path, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}

fn backup_path_for(path: &Path) -> std::path::PathBuf {
    let mut backup = path.as_os_str().to_owned();
    backup.push(".bak");
    std::path::PathBuf::from(backup)
}

fn class_with_utf8(value: &str) -> Vec<u8> {
    let mut bytes = vec![0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 61, 0, 2, 1];
    bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
    bytes
}

#[test]
fn resolves_one_and_two_level_nested_entries() {
    use jdiff_core::NestedArchiveCache;

    let dir = tempdir().unwrap();

    // innermost jar
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("com/A.txt", b"hello-inner")]);
    let inner_bytes = fs::read(&inner_path).unwrap();

    // middle jar contains inner.jar
    let middle_path = dir.path().join("middle.jar");
    create_zip(&middle_path, &[("nested/inner.jar", &inner_bytes)]);
    let middle_bytes = fs::read(&middle_path).unwrap();

    // outer jar contains middle.jar
    let outer_path = dir.path().join("outer.jar");
    create_zip(&outer_path, &[("lib/middle.jar", &middle_bytes)]);

    let root = Archive::open(outer_path.to_string_lossy()).unwrap();
    let mut cache = NestedArchiveCache::new().unwrap();

    // one level
    let (arc1, leaf1) = cache.resolve(&root, "lib/middle.jar!/nested/inner.jar").unwrap();
    assert_eq!(leaf1, "nested/inner.jar");
    assert_eq!(arc1.read_entry("nested/inner.jar").unwrap(), inner_bytes);

    // two levels
    let (arc2, leaf2) = cache
        .resolve(&root, "lib/middle.jar!/nested/inner.jar!/com/A.txt")
        .unwrap();
    assert_eq!(leaf2, "com/A.txt");
    assert_eq!(arc2.read_entry("com/A.txt").unwrap(), b"hello-inner");

    // top-level (no separator) returns root + whole path
    let (arc0, leaf0) = cache.resolve(&root, "lib/middle.jar").unwrap();
    assert_eq!(leaf0, "lib/middle.jar");
    assert!(arc0.entry("lib/middle.jar").is_some());
}

#[test]
fn resolve_archive_opens_nested_archive_directly() {
    use jdiff_core::NestedArchiveCache;

    let dir = tempdir().unwrap();
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("x.txt", b"xx")]);
    let inner_bytes = fs::read(&inner_path).unwrap();
    let outer_path = dir.path().join("outer.jar");
    create_zip(&outer_path, &[("lib/inner.jar", &inner_bytes)]);

    let root = Archive::open(outer_path.to_string_lossy()).unwrap();
    let mut cache = NestedArchiveCache::new().unwrap();
    let arc = cache.resolve_archive(&root, "lib/inner.jar").unwrap();
    assert_eq!(arc.read_entry("x.txt").unwrap(), b"xx");
}

#[test]
fn rewrite_zip_bytes_replaces_entry() {
    use jdiff_core::{read_zip_entry_from_bytes, rewrite_zip_bytes};
    use std::collections::BTreeMap;

    let dir = tempdir().unwrap();
    let jar = dir.path().join("a.jar");
    create_zip(&jar, &[("keep.txt", b"keep"), ("swap.txt", b"old")]);
    let bytes = fs::read(&jar).unwrap();

    let mut repl = BTreeMap::new();
    repl.insert("swap.txt".to_owned(), b"new".to_vec());
    let out = rewrite_zip_bytes(&bytes, &repl).unwrap();

    assert_eq!(read_zip_entry_from_bytes(&out, "keep.txt").unwrap(), b"keep");
    assert_eq!(read_zip_entry_from_bytes(&out, "swap.txt").unwrap(), b"new");
}

#[test]
fn commit_copies_entry_into_nested_jar() {
    use jdiff_core::read_zip_entry_from_bytes;

    let dir = tempdir().unwrap();

    // SOURCE side: top-level file payload.txt to copy into target's nested jar.
    let source_path = dir.path().join("source.jar");
    create_zip(&source_path, &[("payload.txt", b"NEW-PAYLOAD")]);
    let source = Archive::open(source_path.to_string_lossy()).unwrap();

    // TARGET side: contains lib/inner.jar which contains docs/old.txt.
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("docs/old.txt", b"OLD")]);
    let inner_bytes = fs::read(&inner_path).unwrap();
    let target_path = dir.path().join("target.jar");
    create_zip(&target_path, &[("lib/inner.jar", &inner_bytes)]);
    let target = Archive::open(target_path.to_string_lossy()).unwrap();

    // Stage: copy source payload.txt -> target lib/inner.jar!/docs/new.txt
    let mut plan = MergePlan::new();
    plan.stage_copy(&source, "payload.txt", "lib/inner.jar!/docs/new.txt")
        .unwrap();
    let result = plan.commit(&target, CommitOptions::default()).unwrap();
    assert_eq!(result.copied_entries, 1);

    // Reopen target, extract lib/inner.jar, assert it now holds docs/new.txt.
    let rewritten = Archive::open(target_path.to_string_lossy()).unwrap();
    let inner_after = rewritten.read_entry("lib/inner.jar").unwrap();
    assert_eq!(
        read_zip_entry_from_bytes(&inner_after, "docs/new.txt").unwrap(),
        b"NEW-PAYLOAD"
    );
    assert_eq!(
        read_zip_entry_from_bytes(&inner_after, "docs/old.txt").unwrap(),
        b"OLD"
    );
}
