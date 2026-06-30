use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use lcdiff_core::Archive;
use tempfile::tempdir;
use zip::{ZipWriter, write::SimpleFileOptions};

#[test]
fn cli_smoke_list_diff_read_search_and_copy_backup() {
    let dir = tempdir().unwrap();
    let left = dir.path().join("left.jar");
    let right = dir.path().join("right.jar");
    create_zip(&left, &[("same.txt", b"same"), ("pkg/A.class", b"new")]);
    create_zip(&right, &[("same.txt", b"same"), ("pkg/A.class", b"old")]);

    assert_stdout_contains(&["list".to_owned(), path(&left)], "pkg/A.class");
    assert_stdout_contains(
        &["diff".to_owned(), path(&left), path(&right)],
        "\"status\": \"different\"",
    );
    assert_stdout_contains(
        &["read".to_owned(), path(&left), "same.txt".to_owned()],
        "same",
    );
    assert_stdout_contains(
        &["search".to_owned(), path(&left), "pkg/A".to_owned()],
        "pkg/A.class",
    );
    assert_stdout_contains(
        &[
            "copy".to_owned(),
            path(&left),
            path(&right),
            "pkg/A.class".to_owned(),
            "--backup".to_owned(),
        ],
        "\"copiedEntries\": 1",
    );

    assert_eq!(
        Archive::open(right.to_string_lossy())
            .unwrap()
            .read_entry("pkg/A.class")
            .unwrap(),
        b"new"
    );
    assert_eq!(
        Archive::open(backup_path_for(&right).to_string_lossy())
            .unwrap()
            .read_entry("pkg/A.class")
            .unwrap(),
        b"old"
    );
}

#[test]
fn cli_search_rejects_empty_query() {
    let dir = tempdir().unwrap();
    let archive = dir.path().join("archive.jar");
    create_zip(&archive, &[("same.txt", b"same")]);

    assert_stderr_contains(
        &["search".to_owned(), path(&archive), "  ".to_owned()],
        "search query must not be empty",
    );
}

#[test]
fn cli_search_finds_text_content_and_class_constant_pool() {
    let dir = tempdir().unwrap();
    let archive = dir.path().join("search.jar");
    create_zip(
        &archive,
        &[
            ("config/app.properties", b"first\ntext-needle=value\n"),
            ("pkg/A.class", &class_with_utf8("runtime-needle")),
            ("blob.bin", b"binary-needle"),
        ],
    );

    assert_stdout_contains(
        &[
            "search".to_owned(),
            path(&archive),
            "text-needle".to_owned(),
        ],
        "config/app.properties",
    );
    assert_stdout_contains(
        &[
            "search".to_owned(),
            path(&archive),
            "runtime-needle".to_owned(),
        ],
        "pkg/A.class",
    );
    assert_stdout_excludes(
        &[
            "search".to_owned(),
            path(&archive),
            "binary-needle".to_owned(),
        ],
        "blob.bin",
    );
}

fn assert_stdout_contains(args: &[String], expected: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_lcdiff-cli"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "command failed: stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(expected),
        "stdout did not contain {expected}: {stdout}"
    );
}

fn assert_stdout_excludes(args: &[String], unexpected: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_lcdiff-cli"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "command failed: stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        !stdout.contains(unexpected),
        "stdout unexpectedly contained {unexpected}: {stdout}"
    );
}

fn assert_stderr_contains(args: &[String], expected: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_lcdiff-cli"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        !output.status.success(),
        "command unexpectedly succeeded: stdout={}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains(expected),
        "stderr did not contain {expected}: {stderr}"
    );
}

fn path(path: &Path) -> String {
    path.display().to_string()
}

fn backup_path_for(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_owned();
    backup.push(".bak");
    PathBuf::from(backup)
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

fn class_with_utf8(value: &str) -> Vec<u8> {
    let mut bytes = vec![0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 61, 0, 2, 1];
    bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
    bytes
}
