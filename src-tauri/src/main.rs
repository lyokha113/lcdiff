use std::{
    env,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use ldiff_core::{
    Archive, ArchiveDiff, ArchiveEntry, ArchiveMetadata, CommitOptions, CommitResult,
    DecompileEngine, EntryKind, MergePlan, NestedArchiveCache, compare, search_constant_pool,
    validate_path as validate_archive_path,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State, Window};

mod sidecar_process;

use sidecar_process::SidecarClient;

type SharedState = Arc<Mutex<AppState>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Side {
    Left,
    Right,
}

impl Side {
    fn index(self) -> usize {
        match self {
            Self::Left => 0,
            Self::Right => 1,
        }
    }
}

struct AppState {
    left: Option<Archive>,
    right: Option<Archive>,
    left_nested: NestedArchiveCache,
    right_nested: NestedArchiveCache,
    merge_plan: MergePlan,
    staged_target: Option<Side>,
    engine: DecompileEngine,
    sidecar: Arc<Mutex<SidecarClient>>,
    prefetch_sidecar: Arc<Mutex<SidecarClient>>,
    deep_search_sidecar: Arc<Mutex<SidecarClient>>,
    prefetch_generation: [Arc<AtomicU64>; 2],
    deep_search_generation: Arc<AtomicU64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(None)
    }
}

impl AppState {
    fn new(resource_dir: Option<std::path::PathBuf>) -> Self {
        let sidecar = SidecarClient::new(resource_dir);
        let prefetch_sidecar = sidecar.prefetch_worker();
        let deep_search_sidecar = sidecar.prefetch_worker();
        Self {
            left: None,
            right: None,
            left_nested: NestedArchiveCache::new().expect("temp dir for nested cache"),
            right_nested: NestedArchiveCache::new().expect("temp dir for nested cache"),
            merge_plan: MergePlan::new(),
            staged_target: None,
            engine: DecompileEngine::Cfr,
            sidecar: Arc::new(Mutex::new(sidecar)),
            prefetch_sidecar: Arc::new(Mutex::new(prefetch_sidecar)),
            deep_search_sidecar: Arc::new(Mutex::new(deep_search_sidecar)),
            prefetch_generation: [Arc::new(AtomicU64::new(0)), Arc::new(AtomicU64::new(0))],
            deep_search_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    #[cfg(test)]
    fn load_archive(&mut self, path: &str, side: Side) -> Result<ArchiveSummary, String> {
        let archive = Archive::open(path).map_err(|error| error.to_string())?;
        self.install_archive(archive, side)
    }

    fn install_archive(&mut self, archive: Archive, side: Side) -> Result<ArchiveSummary, String> {
        if !self.merge_plan.staged().is_empty() {
            return Err("save staged copies before changing an archive".to_owned());
        }
        let summary = summarize(&archive);
        *archive_mut(self, side) = Some(archive);
        match side {
            Side::Left => {
                self.left_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
            }
            Side::Right => {
                self.right_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
            }
        }
        Ok(summary)
    }

    fn stage_copy(&mut self, from: Side, to: Side, entry_path: &str) -> Result<(), String> {
        if from == to {
            return Err("source and target sides must differ".to_owned());
        }
        if self.staged_target.is_some_and(|target| target != to) {
            return Err(
                "save staged copies before staging changes for the other target".to_owned(),
            );
        }
        let source = archive(self, from)
            .ok_or("source archive is not loaded")?
            .clone();
        self.merge_plan
            .stage_copy(&source, entry_path, entry_path)
            .map_err(|error| error.to_string())?;
        self.staged_target = Some(to);
        Ok(())
    }

    fn commit_merge(
        &mut self,
        target_side: Side,
        backup: bool,
        confirm_signed: bool,
    ) -> Result<CommitResult, String> {
        if self
            .staged_target
            .is_some_and(|target| target != target_side)
        {
            return Err("staged copies belong to the other target archive".to_owned());
        }
        let target = archive(self, target_side)
            .ok_or("target archive is not loaded")?
            .clone();
        if target.metadata().signed && !confirm_signed {
            return Err("signed archive confirmation is required before save".to_owned());
        }
        let result = self
            .merge_plan
            .commit(&target, CommitOptions { backup })
            .map_err(|error| error.to_string())?;
        self.staged_target = None;
        *archive_mut(self, target_side) = Some(
            Archive::open(result.rewritten_path.to_string_lossy())
                .map_err(|error| error.to_string())?,
        );
        // The target (and any nested archives inside it) changed on disk; drop
        // the stale extractions so a re-expand reflects the committed contents.
        match target_side {
            Side::Left => {
                self.left_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
            }
            Side::Right => {
                self.right_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
            }
        }
        Ok(result)
    }

    fn clear_staged(&mut self) {
        self.merge_plan.clear();
        self.staged_target = None;
    }

    fn unstage(&mut self, entry_path: &str) -> Result<(), String> {
        if !self
            .merge_plan
            .unstage(entry_path)
            .map_err(|error| error.to_string())?
        {
            return Err("staged copy is not found".to_owned());
        }
        if self.merge_plan.staged().is_empty() {
            self.staged_target = None;
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSummary {
    path: String,
    metadata: ArchiveMetadata,
    entries: Vec<ArchiveEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryPreview {
    path: String,
    kind: EntryKind,
    language: String,
    details: Option<String>,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformHints {
    os: String,
    session_type: Option<String>,
    wayland: bool,
    drop_hint: Option<String>,
}

#[tauri::command]
fn validate_path(raw: String) -> Result<String, String> {
    validate_archive_path(&raw)
        .map(|path| path.display().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn platform_hints() -> PlatformHints {
    platform_hints_from(
        env::consts::OS,
        env::var("XDG_SESSION_TYPE").ok(),
        env::var("WAYLAND_DISPLAY").ok(),
    )
}

fn platform_hints_from(
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
async fn open_archive(
    path: String,
    side: Side,
    state: State<'_, SharedState>,
) -> Result<ArchiveSummary, String> {
    {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        if !state.merge_plan.staged().is_empty() {
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
async fn compute_diff(state: State<'_, SharedState>) -> Result<ArchiveDiff, String> {
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
async fn compute_nested_diff(
    nested_path: String,
    state: State<'_, SharedState>,
) -> Result<ArchiveDiff, String> {
    let left = nested_side_archive(&state, Side::Left, &nested_path);
    let right = nested_side_archive(&state, Side::Right, &nested_path);
    match (left, right) {
        (None, None) => Err("nested archive is not present on either side".to_owned()),
        (Some(left), Some(right)) => {
            tauri::async_runtime::spawn_blocking(move || Ok(compare(&left, &right)))
                .await
                .map_err(|error| error.to_string())?
        }
        (Some(only), None) => Ok(one_sided_diff(&only, Side::Left)),
        (None, Some(only)) => Ok(one_sided_diff(&only, Side::Right)),
    }
}

fn nested_side_archive(state: &SharedState, side: Side, nested_path: &str) -> Option<Archive> {
    let mut state = state.lock().ok()?;
    let root = archive(&state, side)?.clone();
    nested_cache_mut(&mut state, side)
        .resolve_archive(&root, nested_path)
        .ok()
}

fn one_sided_diff(archive: &Archive, side: Side) -> ArchiveDiff {
    use ldiff_core::{ComparePair, PairStatus};
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
async fn read_entry(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<EntryPreview, String> {
    let (archive, leaf, engine, sidecar) = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.sidecar);
        let (archive, leaf) = resolve_side_entry(&mut state, side, &entry_path)?;
        (archive, leaf, engine, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_entry_preview(&archive, engine, &sidecar, leaf)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_entry_preview(
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
fn set_engine(engine: DecompileEngine, state: State<'_, SharedState>) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .engine = engine;
    Ok(())
}

#[tauri::command]
async fn disassemble(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let (archive_path, source_path, sidecar) = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let sidecar = Arc::clone(&state.sidecar);
        let (archive, leaf) = resolve_side_entry(&mut state, side, &entry_path)?;
        let source_path = class_source_path(&archive, &leaf)?;
        (archive.path().display().to_string(), source_path, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        sidecar
            .lock()
            .map_err(|_| "sidecar lock is poisoned".to_owned())?
            .disassemble(archive_path, source_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn class_source_path(archive: &Archive, entry_path: &str) -> Result<String, String> {
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

#[tauri::command]
fn stage_copy(
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
async fn commit_merge(
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
fn clear_staged(state: State<'_, SharedState>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.clear_staged();
    Ok(())
}

#[tauri::command]
fn unstage(entry_path: String, state: State<'_, SharedState>) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .unstage(&entry_path)
}

#[tauri::command]
async fn search(
    side: Side,
    query: String,
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
    tauri::async_runtime::spawn_blocking(move || search_archive(&archive, &query))
        .await
        .map_err(|error| error.to_string())?
}

fn search_archive(archive: &Archive, query: &str) -> Result<Vec<SearchHit>, String> {
    let query = normalize_search_query(query)?;
    let query_lower = query.to_ascii_lowercase();
    let mut matches = Vec::new();
    for entry in archive.entries() {
        let mut hit = entry
            .path
            .to_ascii_lowercase()
            .contains(&query_lower)
            .then(|| SearchHit::new(entry.path.clone(), "path"));
        if hit.is_none() {
            hit = match entry.kind {
                EntryKind::Class => {
                    let bytes = archive
                        .read_entry(&entry.path)
                        .map_err(|error| error.to_string())?;
                    search_constant_pool(&bytes, &query)
                        .ok()
                        .and_then(|values| {
                            (!values.is_empty())
                                .then(|| SearchHit::new(entry.path.clone(), "constantPool"))
                        })
                }
                EntryKind::Text => {
                    let bytes = archive
                        .read_entry(&entry.path)
                        .map_err(|error| error.to_string())?;
                    line_number_for_match(&String::from_utf8_lossy(&bytes), &query_lower)
                        .map(|line| SearchHit::new(entry.path.clone(), "text").with_line(line))
                }
                EntryKind::Directory | EntryKind::Binary | EntryKind::Archive => None,
            };
        }
        if let Some(hit) = hit {
            matches.push(hit);
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    path: String,
    match_kind: String,
    line: Option<usize>,
}

impl SearchHit {
    fn new(path: String, match_kind: impl Into<String>) -> Self {
        Self {
            path,
            match_kind: match_kind.into(),
            line: None,
        }
    }

    fn with_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }
}

fn line_number_for_match(content: &str, query_lower: &str) -> Option<usize> {
    content
        .lines()
        .position(|line| line.to_ascii_lowercase().contains(query_lower))
        .map(|index| index + 1)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchProgress {
    search_id: u64,
    completed: usize,
    total: usize,
    entry_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepSearchMatch {
    search_id: u64,
    side: Side,
    hit: SearchHit,
}

#[tauri::command]
async fn deep_search(
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
                    window
                        .emit(
                            "search-result",
                            DeepSearchMatch {
                                search_id,
                                side,
                                hit,
                            },
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            window
                .emit(
                    "search-progress",
                    SearchProgress {
                        search_id,
                        completed: completed + 1,
                        total,
                        entry_path,
                    },
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(matches)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn deep_search_hit(
    entry_path: &str,
    source: Result<String, String>,
    query_lower: &str,
) -> Option<SearchHit> {
    let source = source.ok()?;
    source.to_ascii_lowercase().contains(query_lower).then(|| {
        SearchHit::new(entry_path.to_owned(), "source")
            .with_line(line_number_for_match(&source, query_lower).unwrap_or(1))
    })
}

#[tauri::command]
fn cancel_deep_search(state: State<'_, SharedState>) -> Result<(), String> {
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
fn prefetch_siblings(
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

fn is_prefetch_sibling(entry_path: &str, candidate_path: &str) -> bool {
    if entry_path == candidate_path {
        return false;
    }
    entry_directory(entry_path) == entry_directory(candidate_path)
}

fn entry_directory(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(directory, _)| directory)
}

fn archive(state: &AppState, side: Side) -> Option<&Archive> {
    match side {
        Side::Left => state.left.as_ref(),
        Side::Right => state.right.as_ref(),
    }
}

fn archive_mut(state: &mut AppState, side: Side) -> &mut Option<Archive> {
    match side {
        Side::Left => &mut state.left,
        Side::Right => &mut state.right,
    }
}

fn nested_cache_mut(state: &mut AppState, side: Side) -> &mut NestedArchiveCache {
    match side {
        Side::Left => &mut state.left_nested,
        Side::Right => &mut state.right_nested,
    }
}

/// Resolve a (possibly nested) entry path for `side` to its innermost archive
/// (a clone) plus the leaf entry path. Clones the root first so the cache
/// borrow does not conflict with the archive borrow.
fn resolve_side_entry(
    state: &mut AppState,
    side: Side,
    entry_path: &str,
) -> Result<(Archive, String), String> {
    let root = archive(state, side).ok_or("archive is not loaded")?.clone();
    nested_cache_mut(state, side)
        .resolve(&root, entry_path)
        .map_err(|error| error.to_string())
}

fn summarize(archive: &Archive) -> ArchiveSummary {
    ArchiveSummary {
        path: archive.path().display().to_string(),
        metadata: archive.metadata().clone(),
        entries: archive.entries().cloned().collect(),
    }
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

fn language_for_path(path: &str) -> &'static str {
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(app.path().resource_dir().ok());
            let sidecar = Arc::clone(&state.sidecar);
            std::thread::spawn(move || {
                if let Ok(mut sidecar) = sidecar.lock() {
                    sidecar.warm_start().ok();
                }
            });
            app.manage(Arc::new(Mutex::new(state)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            validate_path,
            platform_hints,
            open_archive,
            compute_diff,
            compute_nested_diff,
            read_entry,
            set_engine,
            disassemble,
            stage_copy,
            commit_merge,
            clear_staged,
            unstage,
            search,
            deep_search,
            cancel_deep_search,
            prefetch_siblings
        ])
        .run(tauri::generate_context!())
        .expect("error while running LDiff");
}

#[cfg(test)]
mod tests {
    use std::{fs::File, io::Write, path::Path};

    use tempfile::tempdir;
    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::{
        AppState, Side, SidecarClient, class_source_path, deep_search_hit, is_prefetch_sibling,
        language_for_path, platform_hints_from, read_entry_preview, search_archive, validate_path,
    };
    use ldiff_core::{Archive, DecompileEngine};

    #[test]
    fn staged_target_lock_blocks_switching_target_and_archive() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("right.jar");
        create_zip(&left, &[("pkg/A.class", b"left")]);
        create_zip(&right, &[("pkg/A.class", b"right")]);
        let mut state = AppState::default();
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
        state
            .load_archive(right.to_str().unwrap(), Side::Right)
            .unwrap();

        state
            .stage_copy(Side::Left, Side::Right, "pkg/A.class")
            .unwrap();

        assert_eq!(state.staged_target, Some(Side::Right));
        assert!(
            state
                .stage_copy(Side::Right, Side::Left, "pkg/A.class")
                .unwrap_err()
                .contains("other target")
        );
        assert!(
            state
                .load_archive(left.to_str().unwrap(), Side::Left)
                .unwrap_err()
                .contains("save staged copies")
        );
    }

    #[test]
    fn clear_staged_unlocks_archive_switch() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("right.jar");
        create_zip(&left, &[("a.txt", b"left")]);
        create_zip(&right, &[("a.txt", b"right")]);
        let mut state = AppState::default();
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
        state
            .load_archive(right.to_str().unwrap(), Side::Right)
            .unwrap();
        state.stage_copy(Side::Left, Side::Right, "a.txt").unwrap();

        state.clear_staged();

        assert!(state.merge_plan.staged().is_empty());
        assert_eq!(state.staged_target, None);
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
    }

    #[test]
    fn unstage_last_copy_unlocks_archive_switch() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("right.jar");
        create_zip(&left, &[("a.txt", b"left")]);
        create_zip(&right, &[("a.txt", b"right")]);
        let mut state = AppState::default();
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
        state
            .load_archive(right.to_str().unwrap(), Side::Right)
            .unwrap();
        state.stage_copy(Side::Left, Side::Right, "a.txt").unwrap();

        state.unstage("a.txt").unwrap();

        assert!(state.merge_plan.staged().is_empty());
        assert_eq!(state.staged_target, None);
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
    }

    #[test]
    fn signed_target_requires_confirmation_before_commit() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("signed.jar");
        create_zip(&left, &[("pkg/A.class", b"left")]);
        create_zip(
            &right,
            &[
                ("META-INF/MANIFEST.MF", b"SHA-256-Digest: abc\n"),
                ("META-INF/APP.SF", b"signature"),
                ("META-INF/APP.RSA", b"signature block"),
                ("pkg/A.class", b"right"),
            ],
        );
        let mut state = AppState::default();
        state
            .load_archive(left.to_str().unwrap(), Side::Left)
            .unwrap();
        state
            .load_archive(right.to_str().unwrap(), Side::Right)
            .unwrap();
        state
            .stage_copy(Side::Left, Side::Right, "pkg/A.class")
            .unwrap();

        assert!(
            state
                .commit_merge(Side::Right, false, false)
                .unwrap_err()
                .contains("confirmation")
        );
        assert_eq!(state.staged_target, Some(Side::Right));

        let result = state.commit_merge(Side::Right, false, true).unwrap();
        assert!(result.signature_invalidated);
        assert_eq!(state.staged_target, None);
    }

    #[test]
    fn t2_path_search_skips_binary_payload_reads() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("binary.zip");
        create_zip(&archive_path, &[("blob.bin", b"unique-binary-payload")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let payload = b"unique-binary-payload";
        let offset = bytes
            .windows(payload.len())
            .position(|window| window == payload)
            .unwrap();
        bytes[offset] ^= 0xff;
        std::fs::write(&archive_path, bytes).unwrap();
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        assert!(archive.read_entry("blob.bin").is_err());
        let hits = search_archive(&archive, "blob").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "blob.bin");
        assert_eq!(hits[0].match_kind, "path");
        assert_eq!(hits[0].line, None);
    }

    #[test]
    fn t2_text_search_reports_match_kind_and_line() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("app.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(&archive, "needle").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "app.properties");
        assert_eq!(hits[0].match_kind, "text");
        assert_eq!(hits[0].line, Some(2));
    }

    #[test]
    fn t2_class_search_reports_constant_pool_match_kind() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("classes.jar");
        create_zip(
            &archive_path,
            &[("pkg/NeedleHolder.class", &class_with_utf8("runtime-needle"))],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(&archive, "runtime-needle").unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "pkg/NeedleHolder.class");
        assert_eq!(hits[0].match_kind, "constantPool");
        assert_eq!(hits[0].line, None);
    }

    #[test]
    fn search_rejects_empty_query() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("app.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let error = search_archive(&archive, "  ").unwrap_err();

        assert_eq!(error, "search query is empty");
    }

    #[test]
    fn binary_preview_reports_sha256_and_size() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("binary.zip");
        create_zip(&archive_path, &[("blob.bin", b"abc")]);
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let preview = read_entry_preview(
            &archive,
            DecompileEngine::Cfr,
            &std::sync::Mutex::new(SidecarClient::default()),
            "blob.bin".to_owned(),
        )
        .unwrap();

        let details = preview.details.unwrap();
        assert!(details.contains("3 bytes"));
        assert!(
            details.contains(
                "SHA-256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            )
        );
        assert!(preview.content.contains("61 62 63"));
    }

    #[test]
    fn bytecode_view_rejects_non_class_entries_before_sidecar() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(&archive_path, &[("notes.txt", b"hello")]);
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let error = class_source_path(&archive, "notes.txt").unwrap_err();

        assert!(error.contains("only available for class entries"));
    }

    #[test]
    fn directory_preview_is_empty_without_binary_details() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("directories.zip");
        let file = File::create(&archive_path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.add_directory("folder/", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let preview = read_entry_preview(
            &archive,
            DecompileEngine::Cfr,
            &std::sync::Mutex::new(SidecarClient::default()),
            "folder/".to_owned(),
        )
        .unwrap();

        assert_eq!(preview.kind, ldiff_core::EntryKind::Directory);
        assert_eq!(preview.language, "plaintext");
        assert_eq!(preview.details, None);
        assert_eq!(preview.content, "");
    }

    #[test]
    fn prefetch_siblings_are_limited_to_same_immediate_directory() {
        assert!(is_prefetch_sibling("A.class", "B.class"));
        assert!(!is_prefetch_sibling("A.class", "pkg/B.class"));
        assert!(!is_prefetch_sibling("pkg/A.class", "pkg/A.class"));
        assert!(is_prefetch_sibling("pkg/A.class", "pkg/B.class"));
        assert!(!is_prefetch_sibling("pkg/A.class", "pkg/sub/C.class"));
        assert!(!is_prefetch_sibling("pkg/sub/A.class", "pkg/B.class"));
    }

    #[test]
    fn deep_search_skips_decompile_errors_per_entry() {
        let hit = deep_search_hit(
            "pkg/A.class",
            Ok("class A {\n  void needle() {}\n}".to_owned()),
            "needle",
        )
        .unwrap();
        assert_eq!(hit.path, "pkg/A.class");
        assert_eq!(hit.match_kind, "source");
        assert_eq!(hit.line, Some(2));

        assert!(deep_search_hit("pkg/B.class", Ok("class B {}".to_owned()), "needle").is_none());
        assert!(
            deep_search_hit("pkg/C.class", Err("decompile failed".to_owned()), "needle").is_none()
        );
    }

    #[test]
    fn validate_path_command_returns_resolved_archive_path() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("quoted.jar");
        create_zip(&archive_path, &[("a.txt", b"content")]);

        assert_eq!(
            validate_path(format!(" \"{}\" ", archive_path.display())).unwrap(),
            archive_path.display().to_string()
        );
    }

    #[test]
    fn platform_hints_warn_only_for_linux_wayland() {
        let linux_wayland = platform_hints_from(
            "linux",
            Some("wayland".to_owned()),
            Some("wayland-0".to_owned()),
        );
        assert!(linux_wayland.wayland);
        assert!(
            linux_wayland
                .drop_hint
                .unwrap()
                .contains("Browse and path input")
        );

        let linux_x11 = platform_hints_from("linux", Some("x11".to_owned()), None);
        assert!(!linux_x11.wayland);
        assert_eq!(linux_x11.drop_hint, None);

        let mac_wayland_env = platform_hints_from(
            "macos",
            Some("wayland".to_owned()),
            Some("wayland-0".to_owned()),
        );
        assert!(!mac_wayland_env.wayland);
        assert_eq!(mac_wayland_env.drop_hint, None);
    }

    #[test]
    fn maps_text_extensions_to_monaco_languages() {
        assert_eq!(language_for_path("config/application.yaml"), "yaml");
        assert_eq!(language_for_path("META-INF/app.properties"), "ini");
        assert_eq!(language_for_path("notes.txt"), "plaintext");
    }

    fn create_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        for (path, bytes) in entries {
            zip.start_file(
                *path,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn class_with_utf8(value: &str) -> Vec<u8> {
        let mut bytes = vec![0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 61, 0, 2, 1];
        bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
        bytes.extend_from_slice(value.as_bytes());
        bytes
    }
}
