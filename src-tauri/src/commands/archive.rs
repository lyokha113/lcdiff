use lcdiff_core::{Archive, ArchiveDiff, ComparePair, PairStatus, compare};
use tauri::State;

use crate::{
    Side,
    archive_access::{
        open_archive_from_path, open_view_archive_from_path, resolve_optional_side_nested_archive,
        resolve_view_nested_archive,
    },
    state::{ArchiveSummary, SharedState, ViewSourceSummary, side_snapshot},
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
    let archive = open_archive_from_path(path).await?;
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
    let archive = open_view_archive_from_path(path).await?;
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .insert_view_source(archive)
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
