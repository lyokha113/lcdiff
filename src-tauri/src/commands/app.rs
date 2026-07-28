use std::env;

use lcdiff_core::validate_path as validate_archive_path;
use tauri::State;

use crate::{
    PlatformHints,
    state::SharedState,
    system_fonts::{SystemFont, list_system_fonts_native},
};

#[tauri::command]
pub(crate) fn validate_path(raw: String) -> Result<String, String> {
    validate_archive_path(&raw)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn platform_hints() -> PlatformHints {
    platform_hints_from(
        env::consts::OS,
        env::var("XDG_SESSION_TYPE").ok(),
        env::var("WAYLAND_DISPLAY").ok(),
    )
}

pub(crate) fn platform_hints_from(
    os: &str,
    session_type: Option<String>,
    wayland_display: Option<String>,
) -> PlatformHints {
    let session = session_type.as_deref().map(str::to_ascii_lowercase);
    let wayland = os == "linux"
        && (session.as_deref() == Some("wayland")
            || wayland_display
                .as_deref()
                .is_some_and(|value| !value.is_empty()));
    PlatformHints {
        os: os.to_owned(),
        session_type,
        wayland,
        drop_hint: wayland.then(|| {
            "Linux Wayland file drop can be unreliable here; Browse and path input are the reliable open paths.".to_owned()
        }),
    }
}

#[tauri::command]
pub(crate) fn pending_open_paths(state: State<'_, SharedState>) -> Result<Vec<String>, String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    Ok(state.take_pending_open_paths())
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    tauri::async_runtime::spawn_blocking(list_system_fonts_native)
        .await
        .map_err(|error| error.to_string())?
}
