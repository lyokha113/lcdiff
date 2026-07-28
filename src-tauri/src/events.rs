use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, Window};

use crate::{SearchHit, Side};

pub(crate) const SEARCH_PROGRESS: &str = "search-progress";
pub(crate) const SEARCH_RESULT: &str = "search-result";
pub(crate) const OS_OPEN_PATHS: &str = "os-open-paths";
pub(crate) const APP_ACTION: &str = "app-action";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppActionPayload {
    pub(crate) action_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OsOpenPathsPayload {
    pub(crate) paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProgress {
    pub(crate) search_id: u64,
    pub(crate) completed: usize,
    pub(crate) total: usize,
    pub(crate) entry_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeepSearchMatch {
    pub(crate) search_id: u64,
    pub(crate) side: Side,
    pub(crate) hit: SearchHit,
}

pub(crate) fn emit_search_result(window: &Window, payload: DeepSearchMatch) -> Result<(), String> {
    window
        .emit(SEARCH_RESULT, payload)
        .map_err(|error| error.to_string())
}

pub(crate) fn emit_search_progress(window: &Window, payload: SearchProgress) -> Result<(), String> {
    window
        .emit(SEARCH_PROGRESS, payload)
        .map_err(|error| error.to_string())
}

pub(crate) fn emit_open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if let Err(error) = app.emit(OS_OPEN_PATHS, OsOpenPathsPayload { paths }) {
        eprintln!("failed to emit {OS_OPEN_PATHS}: {error}");
    }
}

pub(crate) fn emit_app_action<R: Runtime>(app: &AppHandle<R>, action_id: String) {
    if let Err(error) = app.emit(APP_ACTION, AppActionPayload { action_id }) {
        eprintln!("failed to emit {APP_ACTION}: {error}");
    }
}
