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
pub struct StagedCopy {
    pub source_archive: PathBuf,
    pub source_entry_path: String,
    pub target_entry_path: String,
    source_snapshot: Archive,
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
    copies: Vec<StagedCopy>,
}

impl MergePlan {
    pub fn new() -> Self {
        Self::default()
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
        let staged = StagedCopy {
            source_archive: source.path().to_path_buf(),
            source_entry_path,
            target_entry_path: target_entry_path.clone(),
            source_snapshot: source.clone(),
        };
        if let Some(copy) = self
            .copies
            .iter_mut()
            .find(|copy| copy.target_entry_path == target_entry_path)
        {
            *copy = staged;
        } else {
            self.copies.push(staged);
        }
        Ok(())
    }

    pub fn staged(&self) -> &[StagedCopy] {
        &self.copies
    }

    pub fn unstage(&mut self, target_entry_path: &str) -> Result<bool> {
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        let previous_len = self.copies.len();
        self.copies
            .retain(|copy| copy.target_entry_path != target_entry_path);
        Ok(self.copies.len() != previous_len)
    }

    pub fn clear(&mut self) {
        self.copies.clear();
    }

    pub fn commit(&mut self, target: &Archive, options: CommitOptions) -> Result<CommitResult> {
        if self.copies.is_empty() {
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
        for copy in &self.copies {
            if copy.source_snapshot.changed_on_disk()? {
                return Err(Error::ArchiveChanged(copy.source_archive.clone()));
            }
            let (archive, leaf) = cache.resolve(&copy.source_snapshot, &copy.source_entry_path)?;
            replacements.insert(copy.target_entry_path.clone(), archive.read_entry(&leaf)?);
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
