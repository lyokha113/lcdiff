use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

use crc32fast::Hasher;
use serde::Serialize;
use zip::{ZipArchive, result::ZipError};

use crate::{
    EntryKind, Error, Result, detect::detect_entry_kind, normalize_archive_entry_path,
    validate_path,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub kind: EntryKind,
    pub uncompressed_size: u64,
    pub compressed_size: u64,
    pub crc32: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMetadata {
    pub source_kind: ArchiveSourceKind,
    pub signed: bool,
    pub multi_release: bool,
    pub zip64: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveSourceKind {
    Archive,
    Directory,
    File,
}

#[derive(Clone, Debug)]
pub struct Archive {
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    entries: BTreeMap<String, ArchiveEntry>,
    source_paths: BTreeMap<String, String>,
    metadata: ArchiveMetadata,
}

impl Archive {
    pub fn open(raw_path: impl AsRef<str>) -> Result<Self> {
        let path = validate_path(raw_path.as_ref())?;
        Self::open_validated(path)
    }

    pub fn open_validated(path: PathBuf) -> Result<Self> {
        if path.is_dir() {
            return Self::open_directory(path);
        }
        if path_is_zip(&path)? {
            return Self::open_zip(path);
        }
        Self::open_single_file(path)
    }

    fn open_zip(path: PathBuf) -> Result<Self> {
        let file_metadata = fs::metadata(&path)?;
        let file = File::open(&path)?;
        let mut zip = ZipArchive::new(file).map_err(|_| Error::InvalidArchive(path.clone()))?;
        let mut local_headers = File::open(&path)?;
        let mut entries = BTreeMap::new();
        let mut source_paths = BTreeMap::new();
        let mut has_signature_file = false;
        let mut has_signature_block = false;
        let mut has_manifest_digest = false;
        let mut multi_release = false;
        let mut zip64 = zip.zip64_comment().is_some();
        for index in 0..zip.len() {
            let mut item = zip
                .by_index(index)
                .map_err(|error| map_zip_entry_error(error, format!("entry #{index}")))?;
            let source_path = item.name().to_owned();
            let normalized = normalize_archive_entry_path(&source_path)?;
            if source_paths
                .insert(normalized.clone(), source_path)
                .is_some()
            {
                return Err(Error::DuplicateEntryPath(normalized));
            }
            if item.encrypted() {
                return Err(Error::EncryptedEntry(normalized));
            }
            let upper = normalized.to_ascii_uppercase();
            has_signature_file |= upper.starts_with("META-INF/") && upper.ends_with(".SF");
            has_signature_block |= upper.starts_with("META-INF/")
                && (upper.ends_with(".RSA") || upper.ends_with(".DSA") || upper.ends_with(".EC"));
            multi_release |= upper.starts_with("META-INF/VERSIONS/");
            zip64 |= item.size() > u32::MAX.into()
                || item.compressed_size() > u32::MAX.into()
                || local_header_uses_zip64(&mut local_headers, item.header_start())?;
            if upper == "META-INF/MANIFEST.MF" {
                let mut manifest = String::new();
                item.read_to_string(&mut manifest).ok();
                has_manifest_digest |= manifest
                    .lines()
                    .any(|line| line.to_ascii_lowercase().contains("-digest:"));
            }
            let entry = ArchiveEntry {
                path: normalized.clone(),
                kind: detect_entry_kind(&normalized, item.is_dir()),
                uncompressed_size: item.size(),
                compressed_size: item.compressed_size(),
                crc32: item.crc32(),
            };
            entries.insert(normalized, entry);
        }
        Ok(Self {
            path,
            size: file_metadata.len(),
            modified: file_metadata.modified().ok(),
            entries,
            source_paths,
            metadata: ArchiveMetadata {
                source_kind: ArchiveSourceKind::Archive,
                signed: has_signature_file && has_signature_block && has_manifest_digest,
                multi_release,
                zip64,
            },
        })
    }

    fn open_single_file(path: PathBuf) -> Result<Self> {
        let file_metadata = fs::metadata(&path)?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_owned());
        let normalized = normalize_archive_entry_path(&name)?;
        let crc32 = crc32_for_file(&path)?;
        let size = file_metadata.len();
        let entry = ArchiveEntry {
            path: normalized.clone(),
            kind: detect_entry_kind(&normalized, false),
            uncompressed_size: size,
            compressed_size: size,
            crc32,
        };
        let mut entries = BTreeMap::new();
        entries.insert(normalized.clone(), entry);
        let mut source_paths = BTreeMap::new();
        source_paths.insert(normalized.clone(), name);
        Ok(Self {
            path,
            size: file_metadata.len(),
            modified: file_metadata.modified().ok(),
            entries,
            source_paths,
            metadata: ArchiveMetadata {
                source_kind: ArchiveSourceKind::File,
                signed: false,
                multi_release: false,
                zip64: false,
            },
        })
    }

    fn open_directory(path: PathBuf) -> Result<Self> {
        let fingerprint = directory_fingerprint(&path)?;
        let mut entries = BTreeMap::new();
        let mut source_paths = BTreeMap::new();
        index_directory(&path, &path, &mut entries, &mut source_paths)?;
        Ok(Self {
            path,
            size: fingerprint.size,
            modified: fingerprint.modified,
            entries,
            source_paths,
            metadata: ArchiveMetadata {
                source_kind: ArchiveSourceKind::Directory,
                signed: false,
                multi_release: false,
                zip64: false,
            },
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn entries(&self) -> impl Iterator<Item = &ArchiveEntry> {
        self.entries.values()
    }

    pub fn entry(&self, path: &str) -> Option<&ArchiveEntry> {
        self.entries.get(path)
    }

    pub fn source_path(&self, path: &str) -> Option<&str> {
        self.source_paths.get(path).map(String::as_str)
    }

    pub fn metadata(&self) -> &ArchiveMetadata {
        &self.metadata
    }

    pub fn read_entry(&self, path: &str) -> Result<Vec<u8>> {
        let normalized = normalize_archive_entry_path(path)?;
        let entry = self
            .entries
            .get(&normalized)
            .ok_or_else(|| Error::EntryNotFound(normalized.clone()))?;
        if entry.kind == EntryKind::Directory {
            return Err(Error::CannotCopyDirectory(normalized));
        }
        if self.metadata.source_kind == ArchiveSourceKind::Directory {
            let source_path = self
                .source_paths
                .get(&normalized)
                .ok_or_else(|| Error::EntryNotFound(normalized.clone()))?;
            return fs::read(self.path.join(source_path)).map_err(Error::from);
        }
        if self.metadata.source_kind == ArchiveSourceKind::File {
            return fs::read(&self.path).map_err(Error::from);
        }
        let source_path = self
            .source_paths
            .get(&normalized)
            .ok_or_else(|| Error::EntryNotFound(normalized.clone()))?;
        let file = File::open(&self.path)?;
        let mut zip = ZipArchive::new(file)?;
        let mut entry = zip.by_name(source_path).map_err(|error| match error {
            ZipError::FileNotFound => Error::EntryNotFound(normalized.clone()),
            other => map_zip_entry_error(other, normalized.clone()),
        })?;
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    pub fn changed_on_disk(&self) -> Result<bool> {
        if self.metadata.source_kind == ArchiveSourceKind::Directory {
            let fingerprint = directory_fingerprint(&self.path)?;
            return Ok(fingerprint.size != self.size || fingerprint.modified != self.modified);
        }
        let metadata = fs::metadata(&self.path)?;
        Ok(metadata.len() != self.size || metadata.modified().ok() != self.modified)
    }
}

#[derive(Clone, Copy, Debug)]
struct DirectoryFingerprint {
    size: u64,
    modified: Option<SystemTime>,
}

fn index_directory(
    root: &Path,
    directory: &Path,
    entries: &mut BTreeMap<String, ArchiveEntry>,
    source_paths: &mut BTreeMap<String, String>,
) -> Result<()> {
    let mut children = fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let metadata = child.metadata()?;
        let file_type = child.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let child_path = child.path();
        let relative = child_path
            .strip_prefix(root)
            .map_err(|error| Error::Io(io::Error::other(error)))?;
        let raw = relative.to_string_lossy().replace('\\', "/");
        if file_type.is_dir() {
            let normalized = normalize_archive_entry_path(&format!("{raw}/"))?;
            entries.insert(
                normalized.clone(),
                ArchiveEntry {
                    path: normalized.clone(),
                    kind: EntryKind::Directory,
                    uncompressed_size: 0,
                    compressed_size: 0,
                    crc32: 0,
                },
            );
            source_paths.insert(normalized, raw);
            index_directory(root, &child_path, entries, source_paths)?;
        } else if file_type.is_file() {
            let normalized = normalize_archive_entry_path(&raw)?;
            if source_paths.insert(normalized.clone(), raw).is_some() {
                return Err(Error::DuplicateEntryPath(normalized));
            }
            let crc32 = crc32_for_file(&child_path)?;
            let size = metadata.len();
            entries.insert(
                normalized.clone(),
                ArchiveEntry {
                    path: normalized.clone(),
                    kind: detect_entry_kind(&normalized, false),
                    uncompressed_size: size,
                    compressed_size: size,
                    crc32,
                },
            );
        }
    }
    Ok(())
}

fn directory_fingerprint(root: &Path) -> Result<DirectoryFingerprint> {
    let mut fingerprint = DirectoryFingerprint {
        size: 0,
        modified: fs::metadata(root)?.modified().ok(),
    };
    accumulate_directory_fingerprint(root, &mut fingerprint)?;
    Ok(fingerprint)
}

fn accumulate_directory_fingerprint(
    directory: &Path,
    fingerprint: &mut DirectoryFingerprint,
) -> Result<()> {
    let mut children = fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let file_type = child.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let metadata = child.metadata()?;
        if let Ok(modified) = metadata.modified() {
            fingerprint.modified = Some(
                fingerprint
                    .modified
                    .map_or(modified, |current| current.max(modified)),
            );
        }
        if file_type.is_dir() {
            fingerprint.size = fingerprint.size.saturating_add(1);
            accumulate_directory_fingerprint(&child.path(), fingerprint)?;
        } else if file_type.is_file() {
            fingerprint.size = fingerprint.size.saturating_add(metadata.len());
        }
    }
    Ok(())
}

fn crc32_for_file(path: &Path) -> Result<u32> {
    let mut file = File::open(path)?;
    let mut hasher = Hasher::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize())
}

fn map_zip_entry_error(error: ZipError, entry: String) -> Error {
    match error {
        ZipError::UnsupportedArchive(ZipError::PASSWORD_REQUIRED) => Error::EncryptedEntry(entry),
        other => Error::Zip(other),
    }
}

/// True when the file begins with a ZIP signature (local header, EOCD, or
/// spanned marker). Used to route archive vs single-file open.
fn path_is_zip(path: &Path) -> Result<bool> {
    let mut header = [0u8; 4];
    let mut file = File::open(path)?;
    let read = file.read(&mut header)?;
    if read < 4 {
        return Ok(false);
    }
    Ok(matches!(&header, b"PK\x03\x04" | b"PK\x05\x06" | b"PK\x07\x08"))
}

#[cfg(test)]
mod source_kind_tests {
    use super::*;

    #[test]
    fn file_source_kind_serializes_camel_case() {
        let json = serde_json::to_string(&ArchiveSourceKind::File).unwrap();
        assert_eq!(json, "\"file\"");
    }
}

#[cfg(test)]
mod open_tests {
    use super::*;

    #[test]
    fn opens_single_text_file_as_one_entry() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.json");
        std::fs::write(&file, b"{\"a\":1}\n").unwrap();

        let archive = Archive::open(file.to_string_lossy()).unwrap();
        assert_eq!(archive.metadata().source_kind, ArchiveSourceKind::File);
        let entries: Vec<_> = archive.entries().collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "config.json");
        assert_eq!(entries[0].kind, EntryKind::Text);
        assert_eq!(archive.read_entry("config.json").unwrap(), b"{\"a\":1}\n");
    }

    #[test]
    fn zip_path_still_opens_as_archive() {
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("lib.jar");
        let file = std::fs::File::create(&jar).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("a.txt", zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write as _;
        zip.write_all(b"hi").unwrap();
        zip.finish().unwrap();

        let archive = Archive::open(jar.to_string_lossy()).unwrap();
        assert_eq!(archive.metadata().source_kind, ArchiveSourceKind::Archive);
    }
}

fn local_header_uses_zip64(file: &mut File, header_start: u64) -> Result<bool> {
    file.seek(SeekFrom::Start(header_start))?;
    let mut header = [0_u8; 30];
    file.read_exact(&mut header)?;
    if header[..4] != [b'P', b'K', 3, 4] {
        return Ok(false);
    }
    let name_length = u16::from_le_bytes([header[26], header[27]]) as u64;
    let extra_length = u16::from_le_bytes([header[28], header[29]]) as usize;
    file.seek(SeekFrom::Current(name_length as i64))?;
    let mut extra = vec![0_u8; extra_length];
    file.read_exact(&mut extra)?;
    let mut offset = 0;
    while offset + 4 <= extra.len() {
        let tag = u16::from_le_bytes([extra[offset], extra[offset + 1]]);
        let length = u16::from_le_bytes([extra[offset + 2], extra[offset + 3]]) as usize;
        if tag == 0x0001 {
            return Ok(true);
        }
        offset += 4 + length;
    }
    Ok(false)
}
