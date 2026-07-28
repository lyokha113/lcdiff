use std::sync::{Arc, atomic::Ordering};

use lcdiff_core::{Archive, EntryKind, search_constant_pool};
use tauri::{State, Window};

use crate::{
    SearchHit, SearchHitKind, SearchOptions, Side,
    events::{DeepSearchMatch, SearchProgress, emit_search_progress, emit_search_result},
    state::{SharedState, archive},
};

#[tauri::command]
pub(crate) async fn search(
    side: Side,
    query: String,
    options: SearchOptions,
    state: State<'_, SharedState>,
) -> Result<Vec<SearchHit>, String> {
    let archive = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        archive(&state, side)
            .ok_or("archive is not loaded")?
            .clone()
    };
    tauri::async_runtime::spawn_blocking(move || search_archive(&archive, &query, options))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn search_view_source(
    source_id: String,
    query: String,
    options: SearchOptions,
    state: State<'_, SharedState>,
) -> Result<Vec<SearchHit>, String> {
    let archive = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.view_source_snapshot(&source_id)?.archive
    };
    tauri::async_runtime::spawn_blocking(move || search_archive(&archive, &query, options))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn search_archive(
    archive: &Archive,
    query: &str,
    options: SearchOptions,
) -> Result<Vec<SearchHit>, String> {
    let query = normalize_search_query(query)?;
    let query_lower = query.to_ascii_lowercase();
    let mut matches = Vec::new();
    for entry in archive.entries() {
        if options.include_path && entry.path.to_ascii_lowercase().contains(&query_lower) {
            matches.push(SearchHit::new(entry.path.clone(), SearchHitKind::Path));
        }

        match entry.kind {
            EntryKind::Text if options.include_text => {
                let bytes = archive
                    .read_entry(&entry.path)
                    .map_err(|error| error.to_string())?;
                if let Some((line, preview)) =
                    line_match_for_search(&String::from_utf8_lossy(&bytes), &query_lower)
                {
                    matches.push(
                        SearchHit::new(entry.path.clone(), SearchHitKind::Text)
                            .with_line(line)
                            .with_preview(preview),
                    );
                }
            }
            EntryKind::Class if options.include_constants => {
                let bytes = archive
                    .read_entry(&entry.path)
                    .map_err(|error| error.to_string())?;
                if let Some(preview) = search_constant_pool(&bytes, &query)
                    .ok()
                    .and_then(|values| values.into_iter().next())
                    .map(|value| truncate_search_preview(value.value.trim()))
                {
                    matches.push(
                        SearchHit::new(entry.path.clone(), SearchHitKind::ConstantPool)
                            .with_preview(preview),
                    );
                }
            }
            EntryKind::Directory
            | EntryKind::Binary
            | EntryKind::Archive
            | EntryKind::Text
            | EntryKind::Class => {}
        }
    }
    Ok(matches)
}

fn normalize_search_query(query: &str) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search query is empty".to_owned());
    }
    Ok(query.to_owned())
}

fn line_match_for_search(content: &str, query_lower: &str) -> Option<(usize, String)> {
    content
        .lines()
        .enumerate()
        .find(|(_, line)| line.to_ascii_lowercase().contains(query_lower))
        .map(|(index, line)| (index + 1, truncate_search_preview(line.trim())))
}

fn truncate_search_preview(value: &str) -> String {
    value.chars().take(160).collect()
}

#[tauri::command]
pub(crate) async fn deep_search(
    side: Side,
    query: String,
    search_id: u64,
    window: Window,
    state: State<'_, SharedState>,
) -> Result<Vec<SearchHit>, String> {
    let query = normalize_search_query(&query)?;
    let (archive, engine, sidecar, generation, generation_id) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let archive = archive(&state, side)
            .ok_or("archive is not loaded")?
            .clone();
        let engine = state.engine;
        let sidecar = Arc::clone(&state.deep_search_sidecar);
        let generation = Arc::clone(&state.deep_search_generation);
        let generation_id = generation.fetch_add(1, Ordering::SeqCst) + 1;
        (archive, engine, sidecar, generation, generation_id)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let class_paths = archive
            .entries()
            .filter(|entry| entry.kind == EntryKind::Class)
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        let total = class_paths.len();
        let query = query.to_ascii_lowercase();
        let archive_path = archive.path().display().to_string();
        let mut matches = Vec::new();
        for (completed, entry_path) in class_paths.into_iter().enumerate() {
            if generation.load(Ordering::SeqCst) != generation_id {
                return Err("deep search cancelled".to_owned());
            }
            if let Some(source_path) = archive.source_path(&entry_path) {
                let source = sidecar
                    .lock()
                    .map_err(|_| "sidecar lock is poisoned".to_owned())?
                    .decompile(engine, archive_path.clone(), source_path.to_owned());
                if let Some(hit) = deep_search_hit(&entry_path, source, &query) {
                    matches.push(hit.clone());
                    emit_search_result(
                        &window,
                        DeepSearchMatch {
                            search_id,
                            side,
                            hit,
                        },
                    )?;
                }
            }
            emit_search_progress(
                &window,
                SearchProgress {
                    search_id,
                    completed: completed + 1,
                    total,
                    entry_path,
                },
            )?;
        }
        Ok(matches)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn deep_search_view_source(
    source_id: String,
    query: String,
    search_id: u64,
    window: Window,
    state: State<'_, SharedState>,
) -> Result<Vec<SearchHit>, String> {
    let query = normalize_search_query(&query)?;
    let (archive, engine, sidecar, generation, generation_id) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let archive = state.view_source_snapshot(&source_id)?.archive;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.deep_search_sidecar);
        let generation = Arc::clone(&state.deep_search_generation);
        let generation_id = generation.fetch_add(1, Ordering::SeqCst) + 1;
        (archive, engine, sidecar, generation, generation_id)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let class_paths = archive
            .entries()
            .filter(|entry| entry.kind == EntryKind::Class)
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        let total = class_paths.len();
        let query = query.to_ascii_lowercase();
        let archive_path = archive.path().display().to_string();
        let mut matches = Vec::new();
        for (completed, entry_path) in class_paths.into_iter().enumerate() {
            if generation.load(Ordering::SeqCst) != generation_id {
                return Err("deep search cancelled".to_owned());
            }
            if let Some(source_path) = archive.source_path(&entry_path) {
                let source = sidecar
                    .lock()
                    .map_err(|_| "sidecar lock is poisoned".to_owned())?
                    .decompile(engine, archive_path.clone(), source_path.to_owned());
                if let Some(hit) = deep_search_hit(&entry_path, source, &query) {
                    matches.push(hit.clone());
                    emit_search_result(
                        &window,
                        DeepSearchMatch {
                            search_id,
                            side: Side::Left,
                            hit,
                        },
                    )?;
                }
            }
            emit_search_progress(
                &window,
                SearchProgress {
                    search_id,
                    completed: completed + 1,
                    total,
                    entry_path,
                },
            )?;
        }
        Ok(matches)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn deep_search_hit(
    entry_path: &str,
    source: Result<String, String>,
    query_lower: &str,
) -> Option<SearchHit> {
    let source = source.ok()?;
    line_match_for_search(&source, query_lower).map(|(line, preview)| {
        SearchHit::new(entry_path.to_owned(), SearchHitKind::Source)
            .with_line(line)
            .with_preview(preview)
    })
}

#[tauri::command]
pub(crate) fn cancel_deep_search(state: State<'_, SharedState>) -> Result<(), String> {
    let sidecar = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.deep_search_generation.fetch_add(1, Ordering::SeqCst);
        Arc::clone(&state.deep_search_sidecar)
    };
    std::thread::spawn(move || {
        if let Ok(mut sidecar) = sidecar.lock() {
            sidecar.cancel_current_request();
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn prefetch_siblings(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let (archive, engine, sidecar, generation, prefetch_id) = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let archive = archive(&state, side)
            .ok_or("archive is not loaded")?
            .clone();
        let sidecar = Arc::clone(&state.prefetch_sidecar);
        let generation = Arc::clone(&state.prefetch_generation[side.index()]);
        let prefetch_id = generation.fetch_add(1, Ordering::SeqCst) + 1;
        (archive, state.engine, sidecar, generation, prefetch_id)
    };
    std::thread::spawn(move || {
        let archive_path = archive.path().display().to_string();
        for sibling in archive
            .entries()
            .filter(|entry| {
                entry.kind == EntryKind::Class && is_prefetch_sibling(&entry_path, &entry.path)
            })
            .take(4)
        {
            if generation.load(Ordering::SeqCst) != prefetch_id {
                return;
            }
            let Ok(mut sidecar) = sidecar.lock() else {
                return;
            };
            let Some(source_path) = archive.source_path(&sibling.path) else {
                return;
            };
            sidecar
                .decompile(engine, archive_path.clone(), source_path.to_owned())
                .ok();
        }
    });
    Ok(())
}

pub(crate) fn is_prefetch_sibling(entry_path: &str, candidate_path: &str) -> bool {
    if entry_path == candidate_path {
        return false;
    }
    entry_directory(entry_path) == entry_directory(candidate_path)
}

fn entry_directory(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(directory, _)| directory)
}
