use lcdiff_core::{Archive, Error as CoreError, validate_path as validate_archive_path};

use crate::state::{SideSnapshot, ViewSourceSnapshot};

pub(crate) async fn open_archive_from_path(path: String) -> Result<Archive, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Archive::open(path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) async fn open_view_archive_from_path(path: String) -> Result<Archive, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let validated = validate_archive_path(&path).map_err(|error| error.to_string())?;
        let canonical = std::fs::canonicalize(&validated).map_err(|error| {
            format!(
                "failed to canonicalize view source path {}: {error}",
                validated.display()
            )
        })?;
        Archive::open_validated(canonical).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Resolve a (possibly nested) entry path for a compare-side snapshot to its
/// innermost archive plus the leaf entry path.
pub(crate) fn resolve_side_entry(
    source: &SideSnapshot,
    entry_path: &str,
) -> Result<(Archive, String), String> {
    source
        .nested
        .lock()
        .map_err(|_| "nested compare source cache lock is poisoned".to_owned())?
        .resolve(&source.archive, entry_path)
        .map_err(|error| error.to_string())
}

fn resolve_side_nested_archive(
    source: &SideSnapshot,
    nested_path: &str,
) -> Result<Archive, CoreError> {
    source
        .nested
        .lock()
        .map_err(|_| {
            CoreError::Io(std::io::Error::other(
                "nested compare source cache lock is poisoned",
            ))
        })?
        .resolve_archive(&source.archive, nested_path)
}

pub(crate) async fn resolve_optional_side_nested_archive(
    source: Option<SideSnapshot>,
    nested_path: String,
) -> Result<Option<Archive>, String> {
    let Some(source) = source else {
        return Ok(None);
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        resolve_side_nested_archive(&source, &nested_path)
    })
    .await
    .map_err(|error| error.to_string())?;
    match result {
        Ok(archive) => Ok(Some(archive)),
        Err(CoreError::EntryNotFound(_)) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn resolve_view_entry(
    source: &ViewSourceSnapshot,
    entry_path: &str,
) -> Result<(Archive, String), String> {
    if let Some((root, leaf)) = entry_path.rsplit_once("!/") {
        let archive = resolve_view_nested_archive(source, root)?;
        return Ok((archive, leaf.to_owned()));
    }
    Ok((source.archive.clone(), entry_path.to_owned()))
}

pub(crate) fn resolve_view_nested_archive(
    source: &ViewSourceSnapshot,
    nested_path: &str,
) -> Result<Archive, String> {
    if nested_path.is_empty() {
        return Ok(source.archive.clone());
    }
    source
        .nested
        .lock()
        .map_err(|_| "nested view source cache lock is poisoned".to_owned())?
        .resolve_archive(&source.archive, nested_path)
        .map_err(|error| error.to_string())
}
