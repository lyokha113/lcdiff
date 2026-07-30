use std::sync::Arc;

use lcdiff_core::CommitResult;
use tauri::State;

use crate::{Side, state::SharedState};

#[tauri::command]
pub(crate) fn stage_copy(
    from: Side,
    to: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.stage_copy(from, to, &entry_path)
}

#[tauri::command]
pub(crate) fn stage_write(
    side: Side,
    entry_path: String,
    content: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.stage_write(side, &entry_path, &content)
}

#[tauri::command]
pub(crate) fn stage_view_write(
    source_id: String,
    entry_path: String,
    content: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .stage_view_write(&source_id, &entry_path, &content)
}

#[tauri::command]
pub(crate) fn unstage_view_write(
    source_id: String,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .unstage_view_write(&source_id, &entry_path)
}

#[tauri::command]
pub(crate) async fn commit_view(
    source_id: String,
    backup: bool,
    state: State<'_, SharedState>,
) -> Result<CommitResult, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?
            .commit_view(&source_id, backup)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn commit_merge(
    target_side: Side,
    backup: bool,
    confirm_signed: bool,
    state: State<'_, SharedState>,
) -> Result<CommitResult, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?
            .commit_merge(target_side, backup, confirm_signed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn clear_staged(state: State<'_, SharedState>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.clear_staged()
}

#[tauri::command]
pub(crate) fn unstage(
    entry_path: String,
    side: Option<Side>,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .unstage(&entry_path, side)
}
