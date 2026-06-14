use std::{
    env,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use ldiff_core::{
    Archive, ArchiveDiff, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitOptions,
    CommitResult, DEFAULT_DECOMPILE_ENGINE, DecompileEngine, EntryKind, MergePlan,
    NestedArchiveCache, compare, edit, search_constant_pool,
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

    fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
        }
    }
}

struct AppState {
    left: Option<Archive>,
    right: Option<Archive>,
    left_nested: NestedArchiveCache,
    right_nested: NestedArchiveCache,
    left_plan: MergePlan,
    right_plan: MergePlan,
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
            left_plan: MergePlan::new(),
            right_plan: MergePlan::new(),
            engine: DEFAULT_DECOMPILE_ENGINE,
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

    fn plan_mut(&mut self, side: Side) -> &mut MergePlan {
        match side {
            Side::Left => &mut self.left_plan,
            Side::Right => &mut self.right_plan,
        }
    }

    fn plan(&self, side: Side) -> &MergePlan {
        match side {
            Side::Left => &self.left_plan,
            Side::Right => &self.right_plan,
        }
    }

    fn both_sides_are_files(&self) -> bool {
        matches!((&self.left, &self.right), (Some(l), Some(r))
            if l.metadata().source_kind == ArchiveSourceKind::File
                && r.metadata().source_kind == ArchiveSourceKind::File)
    }

    fn any_pending(&self) -> bool {
        !self.plan(Side::Left).is_empty() || !self.plan(Side::Right).is_empty()
    }

    /// Legacy single-target lock: only one side may carry pending ops unless both
    /// sources are standalone files. Returns Err if `side` would violate it.
    fn ensure_can_stage(&self, side: Side) -> Result<(), String> {
        if self.both_sides_are_files() {
            return Ok(());
        }
        let other = side.opposite();
        if !self.plan(other).is_empty() {
            return Err(
                "save or clear unsaved changes before editing the other side".to_owned(),
            );
        }
        Ok(())
    }

    fn install_archive(&mut self, archive: Archive, side: Side) -> Result<ArchiveSummary, String> {
        if self.any_pending() {
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
        self.ensure_can_stage(to)?;
        let source = archive(self, from)
            .ok_or("source archive is not loaded")?
            .clone();
        self.plan_mut(to)
            .stage_copy(&source, entry_path, entry_path)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn stage_write(&mut self, side: Side, entry_path: &str, content: &str) -> Result<(), String> {
        self.ensure_can_stage(side)?;
        let archive = archive(self, side)
            .ok_or("archive is not loaded")?
            .clone();
        let entry = archive
            .entry(entry_path)
            .ok_or("entry is not indexed")?
            .clone();
        let original = archive
            .read_entry(entry_path)
            .map_err(|error| error.to_string())?;
        if !edit::editable_text(&entry, &original) {
            return Err("entry is not an editable text file".to_owned());
        }
        let encoding = edit::detect_encoding(&original);
        let new_bytes = edit::encode_text(content, &encoding);
        self.plan_mut(side)
            .stage_write(entry_path, new_bytes)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn commit_merge(
        &mut self,
        target_side: Side,
        backup: bool,
        confirm_signed: bool,
    ) -> Result<CommitResult, String> {
        let target = archive(self, target_side)
            .ok_or("target archive is not loaded")?
            .clone();
        if target.metadata().signed && !confirm_signed {
            return Err("signed archive confirmation is required before save".to_owned());
        }
        let result = self
            .plan_mut(target_side)
            .commit(&target, CommitOptions { backup })
            .map_err(|error| error.to_string())?;
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
        self.plan_mut(Side::Left).clear();
        self.plan_mut(Side::Right).clear();
    }

    fn unstage(&mut self, entry_path: &str, side: Option<Side>) -> Result<(), String> {
        let sides: &[Side] = match side {
            Some(Side::Left) => &[Side::Left],
            Some(Side::Right) => &[Side::Right],
            None => &[Side::Left, Side::Right],
        };
        for &s in sides {
            if self
                .plan_mut(s)
                .unstage(entry_path)
                .map_err(|error| error.to_string())?
            {
                return Ok(());
            }
        }
        Err("staged entry is not found".to_owned())
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
fn stage_write(
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
fn unstage(
    entry_path: String,
    side: Option<Side>,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .unstage(&entry_path, side)
}

#[tauri::command]
async fn search(
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

fn search_archive(
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

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchOptions {
    include_path: bool,
    include_text: bool,
    include_constants: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum SearchHitKind {
    Path,
    Text,
    ConstantPool,
    Source,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    entry_path: String,
    kind: SearchHitKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

impl SearchHit {
    fn new(entry_path: String, kind: SearchHitKind) -> Self {
        Self {
            entry_path,
            kind,
            line: None,
            preview: None,
        }
    }

    fn with_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }

    fn with_preview(mut self, preview: String) -> Self {
        self.preview = Some(preview);
        self
    }
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
    line_match_for_search(&source, query_lower).map(|(line, preview)| {
        SearchHit::new(entry_path.to_owned(), SearchHitKind::Source)
            .with_line(line)
            .with_preview(preview)
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
            stage_write,
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
        AppState, SearchHit, SearchHitKind, SearchOptions, Side, SidecarClient, class_source_path,
        deep_search_hit, is_prefetch_sibling, language_for_path, platform_hints_from,
        read_entry_preview, search_archive, validate_path,
    };
    use ldiff_core::{Archive, DecompileEngine};

    #[test]
    fn app_state_defaults_to_vineflower() {
        let state = AppState::default();

        assert_eq!(state.engine, DecompileEngine::Vineflower);
    }

    #[test]
    fn search_hit_serializes_camel_case_and_omits_none() {
        let constant_pool_hit = SearchHit::new(
            "pkg/A.class".to_owned(),
            SearchHitKind::ConstantPool,
        )
        .with_preview("Needle".to_owned());
        let constant_pool_json = serde_json::to_value(&constant_pool_hit).unwrap();
        assert_eq!(constant_pool_json["entryPath"], "pkg/A.class");
        assert_eq!(constant_pool_json["kind"], "constantPool");
        assert_eq!(constant_pool_json["preview"], "Needle");
        assert!(!constant_pool_json.as_object().unwrap().contains_key("line"));

        let path_hit = SearchHit::new("pkg/A.class".to_owned(), SearchHitKind::Path);
        let path_json = serde_json::to_value(&path_hit).unwrap();
        assert_eq!(path_json["entryPath"], "pkg/A.class");
        assert_eq!(path_json["kind"], "path");
        assert!(!path_json.as_object().unwrap().contains_key("line"));
        assert!(!path_json.as_object().unwrap().contains_key("preview"));
    }

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

        assert!(!state.plan(Side::Right).is_empty());
        assert!(state.plan(Side::Left).is_empty());
        assert!(
            state
                .stage_copy(Side::Right, Side::Left, "pkg/A.class")
                .unwrap_err()
                .contains("other side")
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

        assert!(!state.any_pending());
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

        state.unstage("a.txt", None).unwrap();

        assert!(!state.any_pending());
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
        assert!(!state.plan(Side::Right).is_empty());

        let result = state.commit_merge(Side::Right, false, true).unwrap();
        assert!(result.signature_invalidated);
        assert!(state.plan(Side::Right).is_empty());
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
        let hits = search_archive(
            &archive,
            "blob",
            SearchOptions {
                include_path: true,
                include_text: false,
                include_constants: false,
            },
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry_path, "blob.bin");
        assert_eq!(hits[0].kind, SearchHitKind::Path);
        assert_eq!(hits[0].line, None);
    }

    #[test]
    fn t2_search_can_return_path_and_text_for_same_entry() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("needle.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(
            &archive,
            "needle",
            SearchOptions {
                include_path: true,
                include_text: true,
                include_constants: false,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].entry_path, "needle.properties");
        assert_eq!(hits[0].kind, SearchHitKind::Path);
        assert_eq!(hits[0].line, None);
        assert_eq!(hits[0].preview, None);
        assert_eq!(hits[1].entry_path, "needle.properties");
        assert_eq!(hits[1].kind, SearchHitKind::Text);
        assert_eq!(hits[1].line, Some(2));
        assert_eq!(hits[1].preview, Some("needle=value".to_owned()));
    }

    #[test]
    fn t2_search_options_exclude_unrequested_categories() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("needle.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(
            &archive,
            "needle",
            SearchOptions {
                include_path: false,
                include_text: true,
                include_constants: false,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry_path, "needle.properties");
        assert_eq!(hits[0].kind, SearchHitKind::Text);
        assert_eq!(hits[0].line, Some(2));
        assert_eq!(hits[0].preview, Some("needle=value".to_owned()));
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

        let hits = search_archive(
            &archive,
            "needle",
            SearchOptions {
                include_path: true,
                include_text: true,
                include_constants: true,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry_path, "app.properties");
        assert_eq!(hits[0].kind, SearchHitKind::Text);
        assert_eq!(hits[0].line, Some(2));
        assert_eq!(hits[0].preview, Some("needle=value".to_owned()));
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

        let hits = search_archive(
            &archive,
            "runtime-needle",
            SearchOptions {
                include_path: true,
                include_text: true,
                include_constants: true,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry_path, "pkg/NeedleHolder.class");
        assert_eq!(hits[0].kind, SearchHitKind::ConstantPool);
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

        let error = search_archive(
            &archive,
            "  ",
            SearchOptions {
                include_path: true,
                include_text: true,
                include_constants: true,
            },
        )
        .unwrap_err();

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
        assert_eq!(hit.entry_path, "pkg/A.class");
        assert_eq!(hit.kind, SearchHitKind::Source);
        assert_eq!(hit.line, Some(2));
        assert_eq!(hit.preview, Some("void needle() {}".to_owned()));

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

    #[test]
    fn stage_write_locks_target_and_rejects_other_side() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        create_zip(&left, &[("config.xml", b"<old/>")]);
        let mut state = AppState::default();
        state.load_archive(left.to_str().unwrap(), Side::Left).unwrap();
        let right = dir.path().join("right.jar");
        create_zip(&right, &[("config.xml", b"<r/>")]);
        state.load_archive(right.to_str().unwrap(), Side::Right).unwrap();

        state.stage_write(Side::Left, "config.xml", "<new/>").unwrap();
        assert!(!state.plan(Side::Left).is_empty());

        let err = state.stage_write(Side::Right, "config.xml", "<x/>").unwrap_err();
        assert!(err.contains("other side"));
    }

    #[test]
    fn file_sources_allow_staging_both_sides() {
        let dir = tempfile::tempdir().unwrap();
        let left = dir.path().join("a.txt");
        let right = dir.path().join("b.txt");
        std::fs::write(&left, b"a\n").unwrap();
        std::fs::write(&right, b"b\n").unwrap();

        let mut state = AppState::default();
        state
            .install_archive(Archive::open(left.to_string_lossy()).unwrap(), Side::Left)
            .unwrap();
        state
            .install_archive(Archive::open(right.to_string_lossy()).unwrap(), Side::Right)
            .unwrap();

        state.stage_write(Side::Left, "a.txt", "a2\n").unwrap();
        state.stage_write(Side::Right, "b.txt", "b2\n").unwrap();
        assert!(!state.plan(Side::Left).is_empty());
        assert!(!state.plan(Side::Right).is_empty());
    }

    #[test]
    fn file_merge_commits_both_sides_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let left = dir.path().join("config.json"); // same basename on purpose
        let right = dir.path().join("other").join("config.json");
        std::fs::create_dir_all(dir.path().join("other")).unwrap();
        std::fs::write(&left, b"{\"v\":1}\n").unwrap();
        std::fs::write(&right, b"{\"v\":2}\n").unwrap();

        let mut state = AppState::default();
        state
            .install_archive(Archive::open(left.to_string_lossy()).unwrap(), Side::Left)
            .unwrap();
        state
            .install_archive(Archive::open(right.to_string_lossy()).unwrap(), Side::Right)
            .unwrap();

        // Edit both sides (mirrors stageFileSide on each pane). A File source
        // indexes its single entry by basename, so both sides use "config.json".
        state.stage_write(Side::Left, "config.json", "{\"v\":9}\n").unwrap();
        state.stage_write(Side::Right, "config.json", "{\"v\":9}\n").unwrap();

        // Save commits every dirty side (order: left then right) — must NOT error.
        state.commit_merge(Side::Left, true, false).unwrap();
        state.commit_merge(Side::Right, true, false).unwrap();

        assert_eq!(std::fs::read(&left).unwrap(), b"{\"v\":9}\n");
        assert_eq!(std::fs::read(&right).unwrap(), b"{\"v\":9}\n");
        // Commit clears each plan, so nothing remains to unstage on either side.
        assert!(state.plan(Side::Left).is_empty());
        assert!(state.plan(Side::Right).is_empty());
        assert!(state.unstage("config.json", None).is_err());
    }

    #[test]
    fn side_aware_unstage_removes_only_that_side() {
        let dir = tempfile::tempdir().unwrap();
        let left = dir.path().join("config.json"); // same basename on purpose
        let right = dir.path().join("other").join("config.json");
        std::fs::create_dir_all(dir.path().join("other")).unwrap();
        std::fs::write(&left, b"{\"v\":1}\n").unwrap();
        std::fs::write(&right, b"{\"v\":2}\n").unwrap();

        let mut state = AppState::default();
        state
            .install_archive(Archive::open(left.to_string_lossy()).unwrap(), Side::Left)
            .unwrap();
        state
            .install_archive(Archive::open(right.to_string_lossy()).unwrap(), Side::Right)
            .unwrap();

        // Both sides stage the same basename.
        state.stage_write(Side::Left, "config.json", "{\"v\":9}\n").unwrap();
        state.stage_write(Side::Right, "config.json", "{\"v\":9}\n").unwrap();
        assert!(!state.plan(Side::Left).is_empty());
        assert!(!state.plan(Side::Right).is_empty());

        // Side-aware unstage targets ONLY the named side.
        state.unstage("config.json", Some(Side::Left)).unwrap();

        // Left plan is now empty; right still carries its op.
        assert!(state.plan(Side::Left).is_empty());
        assert!(!state.plan(Side::Right).is_empty());

        // Right still commits; left has nothing to commit (EmptyMergePlan).
        state.commit_merge(Side::Right, false, false).unwrap();
        let left_err = state.commit_merge(Side::Left, false, false).unwrap_err();
        assert!(
            left_err.to_lowercase().contains("empty"),
            "expected empty-plan error, got: {left_err}"
        );
    }

    #[test]
    fn stage_write_rejects_binary_entry() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("b.jar");
        create_zip(&left, &[("blob.bin", &[0u8, 1, 2, 3])]);
        let mut state = AppState::default();
        state.load_archive(left.to_str().unwrap(), Side::Left).unwrap();
        let err = state.stage_write(Side::Left, "blob.bin", "text").unwrap_err();
        assert!(err.contains("editable"));
    }

    #[test]
    fn unstage_last_write_unlocks_archive_switch() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        create_zip(&left, &[("a.txt", b"old")]);
        let mut state = AppState::default();
        state.load_archive(left.to_str().unwrap(), Side::Left).unwrap();
        state.stage_write(Side::Left, "a.txt", "new").unwrap();

        state.unstage("a.txt", None).unwrap();

        assert!(!state.any_pending());
    }
}
