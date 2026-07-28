use std::sync::{Arc, Mutex};

use lcdiff_core::{Archive, DecompileEngine, EntryKind};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{
    EntryPreview, Side,
    commands::archive::{resolve_side_entry, resolve_view_entry},
    sidecar_process::SidecarClient,
    state::{SharedState, side_snapshot},
};

#[tauri::command]
pub(crate) async fn read_entry(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<EntryPreview, String> {
    let (source, engine, sidecar) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.sidecar);
        let source = side_snapshot(&state, side).ok_or("archive is not loaded")?;
        (source, engine, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (archive, leaf) = resolve_side_entry(&source, &entry_path)?;
        read_entry_preview(&archive, engine, &sidecar, leaf)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn read_view_entry(
    source_id: String,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<EntryPreview, String> {
    let (source, engine, sidecar) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.sidecar);
        let source = state.view_source_snapshot(&source_id)?;
        (source, engine, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (archive, leaf) = resolve_view_entry(&source, &entry_path)?;
        read_entry_preview(&archive, engine, &sidecar, leaf)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn read_entry_preview(
    archive: &Archive,
    engine: DecompileEngine,
    sidecar: &Mutex<SidecarClient>,
    entry_path: String,
) -> Result<EntryPreview, String> {
    let archive_path = archive.path().display().to_string();
    let entry = archive
        .entry(&entry_path)
        .ok_or("entry is not indexed")?
        .clone();
    if entry.kind == EntryKind::Directory {
        return Ok(EntryPreview {
            path: entry_path,
            kind: entry.kind,
            language: "plaintext".to_owned(),
            details: None,
            content: String::new(),
        });
    }
    let source_path = archive
        .source_path(&entry_path)
        .ok_or("entry source path is not indexed")?
        .to_owned();
    let bytes = archive
        .read_entry(&entry_path)
        .map_err(|error| error.to_string())?;
    let (language, details, content) = match entry.kind {
        EntryKind::Text => (
            language_for_path(&entry.path),
            None,
            String::from_utf8_lossy(&bytes).into_owned(),
        ),
        EntryKind::Class => (
            "java",
            None,
            sidecar
                .lock()
                .map_err(|_| "sidecar lock is poisoned".to_owned())?
                .decompile(engine, archive_path, source_path)
                .unwrap_or_else(|error| format!("Decompiler unavailable: {error}")),
        ),
        EntryKind::Binary | EntryKind::Archive => (
            "plaintext",
            Some(format!(
                "Binary · {} bytes · SHA-256 {} · CRC32 {:08x}",
                entry.uncompressed_size,
                sha256_hex(&bytes),
                entry.crc32
            )),
            hex_preview(&bytes),
        ),
        EntryKind::Directory => unreachable!("directory preview returns before reading bytes"),
    };
    Ok(EntryPreview {
        path: entry_path,
        kind: entry.kind,
        language: language.to_owned(),
        details,
        content,
    })
}

#[tauri::command]
pub(crate) fn set_engine(
    engine: DecompileEngine,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .engine = engine;
    Ok(())
}

#[tauri::command]
pub(crate) async fn disassemble(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let (source, sidecar) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let sidecar = Arc::clone(&state.sidecar);
        let source = side_snapshot(&state, side).ok_or("archive is not loaded")?;
        (source, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (archive, leaf) = resolve_side_entry(&source, &entry_path)?;
        let source_path = class_source_path(&archive, &leaf)?;
        sidecar
            .lock()
            .map_err(|_| "sidecar lock is poisoned".to_owned())?
            .disassemble(archive.path().display().to_string(), source_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn disassemble_view_entry(
    source_id: String,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let (source, sidecar) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let sidecar = Arc::clone(&state.sidecar);
        let source = state.view_source_snapshot(&source_id)?;
        (source, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (archive, leaf) = resolve_view_entry(&source, &entry_path)?;
        let source_path = class_source_path(&archive, &leaf)?;
        sidecar
            .lock()
            .map_err(|_| "sidecar lock is poisoned".to_owned())?
            .disassemble(archive.path().display().to_string(), source_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn class_source_path(archive: &Archive, entry_path: &str) -> Result<String, String> {
    let entry = archive.entry(entry_path).ok_or("entry is not indexed")?;
    if entry.kind != EntryKind::Class {
        return Err(format!(
            "bytecode view is only available for class entries: {entry_path}"
        ));
    }
    archive
        .source_path(entry_path)
        .ok_or_else(|| "entry source path is not indexed".to_owned())
        .map(str::to_owned)
}

fn hex_preview(bytes: &[u8]) -> String {
    bytes
        .chunks(16)
        .enumerate()
        .map(|(offset, chunk)| {
            format!(
                "{:08x}  {}\n",
                offset * 16,
                chunk
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn language_for_path(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("json") => "json",
        Some("xml") => "xml",
        Some("yaml" | "yml") => "yaml",
        Some("properties" | "ini" | "cfg" | "conf") => "ini",
        Some("md") => "markdown",
        Some("html" | "htm") => "html",
        Some("css") => "css",
        Some("js") => "javascript",
        Some("ts") => "typescript",
        Some("sh" | "bash") => "shell",
        _ => "plaintext",
    }
}
