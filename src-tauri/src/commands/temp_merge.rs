use std::{path::PathBuf, sync::Arc};

use tauri::State;

use crate::{
    Side,
    state::{
        self, SharedState, TempMergeConflictPreview, TempMergeDecision, TempMergeSessionSummary,
        TempTargetCreation, TempTargetDiscardOutcome,
    },
};

#[tauri::command]
pub(crate) async fn create_temp_target(
    source_side: Side,
    creation: TempTargetCreation,
    state: State<'_, SharedState>,
) -> Result<TempMergeSessionSummary, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state::create_temp_target(&state, source_side, creation)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn preview_merge_all_conflicts(
    source_side: Side,
    state: State<'_, SharedState>,
) -> Result<TempMergeConflictPreview, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state::preview_merge_all_conflicts(&state, source_side)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn stage_temp_merge_all(
    source_side: Side,
    decisions: Vec<TempMergeDecision>,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state::stage_temp_merge_all_shared(&state, source_side, decisions)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn apply_temp_merge(
    state: State<'_, SharedState>,
) -> Result<TempMergeSessionSummary, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state::apply_temp_merge(&state))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_temp_target_as(
    path: String,
    state: State<'_, SharedState>,
) -> Result<TempMergeSessionSummary, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state::save_temp_target_as(&state, PathBuf::from(path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn discard_temp_target(
    state: State<'_, SharedState>,
) -> Result<TempTargetDiscardOutcome, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state::discard_temp_target_with_outcome(&state))
        .await
        .map_err(|error| error.to_string())?
}
