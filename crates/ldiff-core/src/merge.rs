use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;
use zip::{ZIP64_BYTES_THR, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::nested::ARCHIVE_SEPARATOR;
use crate::{
    Archive, ArchiveSourceKind, EntryKind, Error, NestedArchiveCache, Result, is_nested,
    normalize_archive_entry_path,
};

#[derive(Clone, Debug)]
pub enum StagedOp {
    Copy {
        source_archive: PathBuf,
        source_entry_path: String,
        target_entry_path: String,
        source_snapshot: Archive,
    },
    Write {
        target_entry_path: String,
        new_bytes: Vec<u8>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StagedKind {
    Copy,
    Write,
}

impl StagedOp {
    pub fn target_entry_path(&self) -> &str {
        match self {
            StagedOp::Copy {
                target_entry_path, ..
            } => target_entry_path,
            StagedOp::Write {
                target_entry_path, ..
            } => target_entry_path,
        }
    }

    pub fn kind(&self) -> StagedKind {
        match self {
            StagedOp::Copy { .. } => StagedKind::Copy,
            StagedOp::Write { .. } => StagedKind::Write,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct CommitOptions {
    pub backup: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub rewritten_path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub signature_invalidated: bool,
    pub copied_entries: usize,
}

#[derive(Debug, Default)]
pub struct MergePlan {
    ops: Vec<StagedOp>,
}

impl MergePlan {
    pub fn new() -> Self {
        Self::default()
    }

    fn replace_or_push(&mut self, target_entry_path: &str, op: StagedOp) {
        if let Some(existing) = self
            .ops
            .iter_mut()
            .find(|existing| existing.target_entry_path() == target_entry_path)
        {
            *existing = op;
        } else {
            self.ops.push(op);
        }
    }

    pub fn stage_copy(
        &mut self,
        source: &Archive,
        source_entry_path: &str,
        target_entry_path: &str,
    ) -> Result<()> {
        let source_entry_path = normalize_archive_entry_path(source_entry_path)?;
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        if !is_nested(&source_entry_path) {
            let source_entry = source
                .entry(&source_entry_path)
                .ok_or_else(|| Error::EntryNotFound(source_entry_path.clone()))?;
            if source_entry.kind == EntryKind::Directory {
                return Err(Error::CannotCopyDirectory(source_entry_path));
            }
        }
        let op = StagedOp::Copy {
            source_archive: source.path().to_path_buf(),
            source_entry_path,
            target_entry_path: target_entry_path.clone(),
            source_snapshot: source.clone(),
        };
        self.replace_or_push(&target_entry_path, op);
        Ok(())
    }

    pub fn stage_write(&mut self, target_entry_path: &str, new_bytes: Vec<u8>) -> Result<()> {
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        let op = StagedOp::Write {
            target_entry_path: target_entry_path.clone(),
            new_bytes,
        };
        self.replace_or_push(&target_entry_path, op);
        Ok(())
    }

    pub fn staged(&self) -> &[StagedOp] {
        &self.ops
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    pub fn unstage(&mut self, target_entry_path: &str) -> Result<bool> {
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        let previous_len = self.ops.len();
        self.ops
            .retain(|op| op.target_entry_path() != target_entry_path);
        Ok(self.ops.len() != previous_len)
    }

    pub fn clear(&mut self) {
        self.ops.clear();
    }

    pub fn commit(&mut self, target: &Archive, options: CommitOptions) -> Result<CommitResult> {
        if self.ops.is_empty() {
            return Err(Error::EmptyMergePlan);
        }
        if target.changed_on_disk()? {
            return Err(Error::ArchiveChanged(target.path().to_path_buf()));
        }
        ensure_target_writable(target.path())?;
        let raw = self.read_replacements()?;
        let copied_entries = raw.len();
        let nested_rewrite = raw.keys().any(|key| crate::is_nested(key));
        let replacements = flatten_nested_replacements(target, raw)?;
        let target_path = target.path();
        let backup_path = options.backup.then(|| backup_path_for(target_path));
        let result = if target.metadata().source_kind == ArchiveSourceKind::Directory {
            rewrite_directory(target_path, &replacements, backup_path.as_deref()).map(|_| {
                CommitResult {
                    rewritten_path: target_path.to_path_buf(),
                    backup_path,
                    signature_invalidated: nested_rewrite,
                    copied_entries,
                }
            })
        } else if target.metadata().source_kind == ArchiveSourceKind::File {
            // File source is a single backing file: exactly one replacement, written
            // whole-file. The entry key is irrelevant — the bytes go to `target_path`.
            debug_assert_eq!(
                replacements.len(),
                1,
                "File source must have exactly one replacement"
            );
            // Single backing file: write the one replacement's bytes atomically.
            let bytes = replacements.values().next().ok_or(Error::EmptyMergePlan)?;
            let temp_path = temp_path_for(target_path);
            let write = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp_path)
                .and_then(|mut f| {
                    f.write_all(bytes)?;
                    f.sync_all()
                })
                .map_err(Error::from)
                .and_then(|_| {
                    if let Some(backup_path) = &backup_path {
                        fs::copy(target_path, backup_path)?;
                    }
                    atomic_replace(&temp_path, target_path)
                })
                .inspect_err(|_| {
                    fs::remove_file(&temp_path).ok();
                });
            write.map(|_| CommitResult {
                rewritten_path: target_path.to_path_buf(),
                backup_path,
                signature_invalidated: false,
                copied_entries,
            })
        } else {
            let temp_path = temp_path_for(target_path);
            rewrite_archive(target_path, &temp_path, &replacements)
                .and_then(|_| {
                    if let Some(backup_path) = &backup_path {
                        fs::copy(target_path, backup_path)?;
                    }
                    atomic_replace(&temp_path, target_path)
                })
                .map(|_| CommitResult {
                    rewritten_path: target_path.to_path_buf(),
                    backup_path,
                    signature_invalidated: target.metadata().signed || nested_rewrite,
                    copied_entries,
                })
                .inspect_err(|_| {
                    fs::remove_file(&temp_path).ok();
                })
        };
        if result.is_ok() {
            self.clear();
        }
        result
    }

    fn read_replacements(&self) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut replacements = BTreeMap::new();
        let mut cache = NestedArchiveCache::new()?;
        for op in &self.ops {
            match op {
                StagedOp::Copy {
                    source_archive,
                    source_entry_path,
                    target_entry_path,
                    source_snapshot,
                } => {
                    if source_snapshot.changed_on_disk()? {
                        return Err(Error::ArchiveChanged(source_archive.clone()));
                    }
                    let (archive, leaf) = cache.resolve(source_snapshot, source_entry_path)?;
                    replacements.insert(target_entry_path.clone(), archive.read_entry(&leaf)?);
                }
                StagedOp::Write {
                    target_entry_path,
                    new_bytes,
                } => {
                    replacements.insert(target_entry_path.clone(), new_bytes.clone());
                }
            }
        }
        Ok(replacements)
    }
}

fn ensure_target_writable(target_path: &Path) -> Result<()> {
    let metadata = fs::metadata(target_path)?;
    if metadata.permissions().readonly() {
        return Err(Error::Io(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("target is read-only: {}", target_path.display()),
        )));
    }
    if metadata.is_file() {
        OpenOptions::new().write(true).open(target_path)?;
    }
    Ok(())
}

fn rewrite_directory(
    target_root: &Path,
    replacements: &BTreeMap<String, Vec<u8>>,
    backup_path: Option<&Path>,
) -> Result<()> {
    if let Some(backup_path) = backup_path {
        copy_directory_backup(target_root, backup_path)?;
    }
    for (entry_path, bytes) in replacements {
        let normalized = normalize_archive_entry_path(entry_path)?;
        let output_path = target_root.join(&normalized);
        if output_path.is_dir() {
            return Err(Error::CannotCopyDirectory(normalized));
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp_path = temp_path_for(&output_path);
        let write_result = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .and_then(|mut file| {
                file.write_all(bytes)?;
                file.sync_all()
            })
            .map_err(Error::from)
            .and_then(|_| atomic_replace(&temp_path, &output_path));
        if write_result.is_err() {
            fs::remove_file(&temp_path).ok();
        }
        write_result?;
    }
    sync_parent(target_root)?;
    Ok(())
}

fn copy_directory_backup(source: &Path, backup_path: &Path) -> Result<()> {
    if backup_path.exists() {
        if backup_path.is_dir() {
            fs::remove_dir_all(backup_path)?;
        } else {
            fs::remove_file(backup_path)?;
        }
    }
    copy_dir_all(source, backup_path)?;
    Ok(())
}

fn copy_dir_all(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let destination_path = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), destination_path)?;
        }
    }
    Ok(())
}

/// Read a single entry's bytes from an in-memory zip.
pub fn read_zip_entry_from_bytes(zip_bytes: &[u8], name: &str) -> Result<Vec<u8>> {
    let name = normalize_archive_entry_path(name)?;
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;
    let mut entry = archive
        .by_name(&name)
        .map_err(|_| Error::EntryNotFound(name.clone()))?;
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut out)?;
    Ok(out)
}

/// Rewrite an in-memory zip, substituting any entry present in `replacements`
/// (keyed by normalized entry path). Entries only present in `replacements`
/// are appended.
pub fn rewrite_zip_bytes(
    zip_bytes: &[u8],
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let mut source = ZipArchive::new(Cursor::new(zip_bytes))?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let mut pending = replacements.clone();
    for index in 0..source.len() {
        let mut entry = source.by_index(index)?;
        let path = normalize_archive_entry_path(entry.name())?;
        let options = entry
            .options()
            .large_file(entry.size().max(entry.compressed_size()) >= ZIP64_BYTES_THR)
            .unix_permissions(entry.unix_mode().unwrap_or(0o644));
        if entry.is_dir() {
            writer.add_directory(path, options)?;
            continue;
        }
        writer.start_file(path.clone(), options)?;
        if let Some(replacement) = pending.remove(&path) {
            writer.write_all(&replacement)?;
        } else {
            io::copy(&mut entry, &mut writer)?;
        }
    }
    for (path, bytes) in pending {
        writer.start_file(
            path,
            SimpleFileOptions::default()
                .large_file(bytes.len() as u64 >= ZIP64_BYTES_THR)
                .compression_method(zip::CompressionMethod::Deflated),
        )?;
        writer.write_all(&bytes)?;
    }
    Ok(writer.finish()?.into_inner())
}

/// Apply replacements (keys relative to `archive_bytes`, possibly nested via
/// `!/`) to an in-memory archive, recursively repacking inner archives.
fn apply_nested_replacements(
    archive_bytes: &[u8],
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let mut direct: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut nested: BTreeMap<String, BTreeMap<String, Vec<u8>>> = BTreeMap::new();
    for (key, bytes) in replacements {
        match key.split_once(ARCHIVE_SEPARATOR) {
            Some((head, rest)) => {
                nested
                    .entry(head.to_owned())
                    .or_default()
                    .insert(rest.to_owned(), bytes.clone());
            }
            None => {
                direct.insert(key.clone(), bytes.clone());
            }
        }
    }
    for (child_entry, child_repls) in nested {
        let original = read_zip_entry_from_bytes(archive_bytes, &child_entry)?;
        let rewritten = apply_nested_replacements(&original, &child_repls)?;
        direct.insert(child_entry, rewritten);
    }
    rewrite_zip_bytes(archive_bytes, &direct)
}

/// Collapse nested replacements into top-level-only replacements by reading the
/// affected top-level archive entries from `target` and repacking them.
fn flatten_nested_replacements(
    target: &Archive,
    replacements: BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut direct: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut nested: BTreeMap<String, BTreeMap<String, Vec<u8>>> = BTreeMap::new();
    for (key, bytes) in replacements {
        match key.split_once(ARCHIVE_SEPARATOR) {
            Some((head, rest)) => {
                nested
                    .entry(head.to_owned())
                    .or_default()
                    .insert(rest.to_owned(), bytes);
            }
            None => {
                direct.insert(key, bytes);
            }
        }
    }
    for (archive_entry, child_repls) in nested {
        let original = target.read_entry(&archive_entry)?;
        let rewritten = apply_nested_replacements(&original, &child_repls)?;
        direct.insert(archive_entry, rewritten);
    }
    Ok(direct)
}

fn rewrite_archive(
    target_path: &Path,
    temp_path: &Path,
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    let source_file = File::open(target_path)?;
    let mut source = ZipArchive::new(source_file)?;
    let temp_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(temp_path)?;
    let mut writer = ZipWriter::new(temp_file);
    let mut pending = replacements.clone();
    for index in 0..source.len() {
        let mut entry = source.by_index(index)?;
        let path = normalize_archive_entry_path(entry.name())?;
        let options = entry
            .options()
            .large_file(entry.size().max(entry.compressed_size()) >= ZIP64_BYTES_THR)
            .unix_permissions(entry.unix_mode().unwrap_or(0o644));
        if entry.is_dir() {
            writer.add_directory(path, options)?;
            continue;
        }
        writer.start_file(path.clone(), options)?;
        if let Some(replacement) = pending.remove(&path) {
            writer.write_all(&replacement)?;
        } else {
            io::copy(&mut entry, &mut writer)?;
        }
    }
    for (path, bytes) in pending {
        writer.start_file(
            path,
            SimpleFileOptions::default()
                .large_file(bytes.len() as u64 >= ZIP64_BYTES_THR)
                .compression_method(zip::CompressionMethod::Deflated),
        )?;
        writer.write_all(&bytes)?;
    }
    let file = writer.finish()?;
    file.sync_all()?;
    Ok(())
}

fn atomic_replace(temp_path: &Path, target_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        fs::rename(temp_path, target_path)?;
        sync_parent(target_path)?;
        Ok(())
    }
    #[cfg(windows)]
    {
        atomic_replace_windows(temp_path, target_path)
    }
    #[cfg(all(not(unix), not(windows)))]
    {
        let _ = (temp_path, target_path);
        Err(Error::Io(io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic replacement is not implemented for this platform",
        )))
    }
}

#[cfg(windows)]
fn atomic_replace_windows(temp_path: &Path, target_path: &Path) -> Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    fn wide(path: &OsStr) -> Vec<u16> {
        path.encode_wide().chain(std::iter::once(0)).collect()
    }

    let from = wide(temp_path.as_os_str());
    let to = wide(target_path.as_os_str());
    let replaced = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(Error::Io(io::Error::last_os_error()));
    }
    Ok(())
}

fn sync_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn temp_path_for(path: &Path) -> PathBuf {
    let mut candidate = path.as_os_str().to_owned();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    candidate.push(format!(".ldiff-{}-{nonce}.tmp", std::process::id()));
    PathBuf::from(candidate)
}

fn backup_path_for(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_owned();
    backup.push(".bak");
    PathBuf::from(backup)
}

#[cfg(test)]
mod stage_write_tests {
    use super::*;
    use crate::Archive;

    fn write_zip(
        dir: &std::path::Path,
        name: &str,
        entries: &[(&str, &[u8])],
    ) -> std::path::PathBuf {
        let path = dir.join(name);
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (entry, bytes) in entries {
            zip.start_file(*entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn stage_write_replaces_entry_bytes_on_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_zip(dir.path(), "t.jar", &[("config.xml", b"<old/>")]);
        let target = Archive::open(path.to_str().unwrap()).unwrap();

        let mut plan = MergePlan::new();
        plan.stage_write("config.xml", b"<new/>".to_vec()).unwrap();
        let result = plan.commit(&target, CommitOptions::default()).unwrap();
        assert_eq!(result.copied_entries, 1);

        let reopened = Archive::open(path.to_str().unwrap()).unwrap();
        assert_eq!(reopened.read_entry("config.xml").unwrap(), b"<new/>");
    }

    #[test]
    fn mixed_copy_and_write_commit() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_zip(dir.path(), "src.jar", &[("Main.class", b"CLASSBYTES")]);
        let tgt = write_zip(
            dir.path(),
            "tgt.jar",
            &[("Main.class", b"OLD"), ("a.txt", b"x")],
        );
        let source = Archive::open(src.to_str().unwrap()).unwrap();
        let target = Archive::open(tgt.to_str().unwrap()).unwrap();

        let mut plan = MergePlan::new();
        plan.stage_copy(&source, "Main.class", "Main.class")
            .unwrap();
        plan.stage_write("a.txt", b"y".to_vec()).unwrap();
        assert_eq!(plan.staged().len(), 2);
        plan.commit(&target, CommitOptions::default()).unwrap();

        let reopened = Archive::open(tgt.to_str().unwrap()).unwrap();
        assert_eq!(reopened.read_entry("Main.class").unwrap(), b"CLASSBYTES");
        assert_eq!(reopened.read_entry("a.txt").unwrap(), b"y");
    }

    #[test]
    fn unstage_removes_a_write_and_kind_is_reported() {
        let mut plan = MergePlan::new();
        plan.stage_write("a.txt", b"y".to_vec()).unwrap();
        assert_eq!(plan.staged()[0].kind(), StagedKind::Write);
        assert_eq!(plan.staged()[0].target_entry_path(), "a.txt");
        assert!(plan.unstage("a.txt").unwrap());
        assert!(plan.staged().is_empty());
    }

    #[test]
    fn commit_writes_file_source_in_place_with_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, b"old\n").unwrap();

        let target = Archive::open(path.to_string_lossy()).unwrap();
        let mut plan = MergePlan::new();
        plan.stage_write("notes.txt", b"new\n".to_vec()).unwrap();
        let result = plan
            .commit(&target, CommitOptions { backup: true })
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new\n");
        assert!(result.backup_path.is_some());
        assert_eq!(
            std::fs::read(result.backup_path.unwrap()).unwrap(),
            b"old\n"
        );
        assert_eq!(result.copied_entries, 1);
        assert!(!result.signature_invalidated);
    }

    #[test]
    fn commit_file_source_without_backup_writes_no_bak() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, b"old\n").unwrap();

        let target = Archive::open(path.to_string_lossy()).unwrap();
        let mut plan = MergePlan::new();
        plan.stage_write("notes.txt", b"new\n".to_vec()).unwrap();
        let result = plan
            .commit(&target, CommitOptions { backup: false })
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new\n");
        assert!(result.backup_path.is_none());
    }

    #[test]
    fn restaging_same_target_replaces_regardless_of_kind() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_zip(dir.path(), "src.jar", &[("a.txt", b"FROM_SOURCE")]);
        let source = Archive::open(src.to_str().unwrap()).unwrap();

        let mut plan = MergePlan::new();
        plan.stage_write("a.txt", b"edited".to_vec()).unwrap();
        plan.stage_copy(&source, "a.txt", "a.txt").unwrap();
        assert_eq!(plan.staged().len(), 1);
        assert_eq!(plan.staged()[0].kind(), StagedKind::Copy);

        // re-stage the other way: copy then write -> Write wins
        plan.stage_write("a.txt", b"edited2".to_vec()).unwrap();
        assert_eq!(plan.staged().len(), 1);
        assert_eq!(plan.staged()[0].kind(), StagedKind::Write);
    }
}
