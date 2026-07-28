use std::path::{Path, PathBuf};

use lcdiff_core::{
    Archive, ArchiveDiff, ComparePair, Error as CoreError, PairStatus, compare,
    validate_path as validate_archive_path,
};
use tauri::State;

use crate::{
    Side,
    state::{
        ArchiveSummary, SharedState, SideSnapshot, ViewSourceSnapshot, ViewSourceSummary,
        side_snapshot,
    },
};

#[tauri::command]
pub(crate) async fn open_archive(
    path: String,
    side: Side,
    state: State<'_, SharedState>,
) -> Result<ArchiveSummary, String> {
    {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        // Fast-path: avoid the blocking open if staging is already in progress;
        // install_archive re-checks after the lock is re-acquired (TOCTOU guard).
        if state.any_pending() {
            return Err("save staged copies before changing an archive".to_owned());
        }
    }
    let archive = tauri::async_runtime::spawn_blocking(move || {
        Archive::open(path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.install_archive(archive, side)
}

#[tauri::command]
pub(crate) async fn compute_diff(state: State<'_, SharedState>) -> Result<ArchiveDiff, String> {
    let (left, right) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        (
            state.left.clone().ok_or("left archive is not loaded")?,
            state.right.clone().ok_or("right archive is not loaded")?,
        )
    };
    tauri::async_runtime::spawn_blocking(move || Ok(compare(&left, &right)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn compute_nested_diff(
    nested_path: String,
    state: State<'_, SharedState>,
) -> Result<ArchiveDiff, String> {
    let (left, right) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        (
            side_snapshot(&state, Side::Left),
            side_snapshot(&state, Side::Right),
        )
    };
    let left = resolve_optional_side_nested_archive(left, nested_path.clone()).await?;
    let right = resolve_optional_side_nested_archive(right, nested_path).await?;
    tauri::async_runtime::spawn_blocking(move || compute_nested_diff_from_archives(left, right))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn compute_nested_diff_from_archives(
    left: Option<Archive>,
    right: Option<Archive>,
) -> Result<ArchiveDiff, String> {
    match (left, right) {
        (None, None) => Err("nested archive is not present on either side".to_owned()),
        (Some(left), Some(right)) => Ok(compare(&left, &right)),
        (Some(only), None) => Ok(one_sided_diff(&only, Side::Left)),
        (None, Some(only)) => Ok(one_sided_diff(&only, Side::Right)),
    }
}

#[tauri::command]
pub(crate) async fn open_view_source(
    path: String,
    state: State<'_, SharedState>,
) -> Result<ViewSourceSummary, String> {
    let archive = tauri::async_runtime::spawn_blocking(move || open_view_archive(path))
        .await
        .map_err(|error| error.to_string())??;
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .insert_view_source(archive)
}

fn open_view_archive(path: String) -> Result<Archive, String> {
    let validated = validate_archive_path(&path).map_err(|error| error.to_string())?;
    let canonical = canonical_view_source_path(&validated)?;
    Archive::open_validated(canonical).map_err(|error| error.to_string())
}

fn canonical_view_source_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|error| {
        format!(
            "failed to canonicalize view source path {}: {error}",
            path.display()
        )
    })
}

#[tauri::command]
pub(crate) fn list_view_sources(
    state: State<'_, SharedState>,
) -> Result<Vec<ViewSourceSummary>, String> {
    let state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    Ok(state.list_view_sources())
}

pub(crate) fn one_sided_diff(archive: &Archive, side: Side) -> ArchiveDiff {
    let pairs = archive
        .entries()
        .map(|entry| {
            let entry = entry.clone();
            match side {
                Side::Left => ComparePair {
                    path: entry.path.clone(),
                    left: Some(entry),
                    right: None,
                    status: PairStatus::OnlyLeft,
                },
                Side::Right => ComparePair {
                    path: entry.path.clone(),
                    left: None,
                    right: Some(entry),
                    status: PairStatus::OnlyRight,
                },
            }
        })
        .collect();
    ArchiveDiff { pairs }
}

#[tauri::command]
pub(crate) async fn compute_view_nested_entries(
    source_id: String,
    nested_path: String,
    state: State<'_, SharedState>,
) -> Result<ArchiveDiff, String> {
    let source = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.view_source_snapshot(&source_id)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let archive = resolve_view_nested_archive(&source, &nested_path)?;
        Ok(one_sided_diff(&archive, Side::Left))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn close_view_source(
    source_id: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .close_view_source(&source_id)
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
