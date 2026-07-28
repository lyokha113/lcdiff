use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicU64},
};

#[cfg(test)]
use lcdiff_core::validate_path as validate_archive_path;
use lcdiff_core::{
    Archive, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitOptions, CommitResult,
    DEFAULT_DECOMPILE_ENGINE, DecompileEngine, MergePlan, NestedArchiveCache, edit,
};
use serde::Serialize;

use crate::{Side, sidecar_process::SidecarClient};

pub(crate) type SharedState = Arc<Mutex<AppState>>;

pub(crate) struct AppState {
    pub(crate) left: Option<Archive>,
    pub(crate) right: Option<Archive>,
    pub(crate) left_nested: Arc<Mutex<NestedArchiveCache>>,
    pub(crate) right_nested: Arc<Mutex<NestedArchiveCache>>,
    pub(crate) view_sources: BTreeMap<String, ViewSourceState>,
    pub(crate) left_plan: MergePlan,
    pub(crate) right_plan: MergePlan,
    pub(crate) engine: DecompileEngine,
    pub(crate) sidecar: Arc<Mutex<SidecarClient>>,
    pub(crate) prefetch_sidecar: Arc<Mutex<SidecarClient>>,
    pub(crate) deep_search_sidecar: Arc<Mutex<SidecarClient>>,
    pub(crate) prefetch_generation: [Arc<AtomicU64>; 2],
    pub(crate) deep_search_generation: Arc<AtomicU64>,
    pending_open_paths: Vec<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(None)
    }
}

impl AppState {
    pub(crate) fn new(resource_dir: Option<PathBuf>) -> Self {
        let sidecar = SidecarClient::new(resource_dir);
        let prefetch_sidecar = sidecar.prefetch_worker();
        let deep_search_sidecar = sidecar.prefetch_worker();
        Self {
            left: None,
            right: None,
            left_nested: Arc::new(Mutex::new(
                NestedArchiveCache::new().expect("temp dir for nested cache"),
            )),
            right_nested: Arc::new(Mutex::new(
                NestedArchiveCache::new().expect("temp dir for nested cache"),
            )),
            view_sources: BTreeMap::new(),
            left_plan: MergePlan::new(),
            right_plan: MergePlan::new(),
            engine: DEFAULT_DECOMPILE_ENGINE,
            sidecar: Arc::new(Mutex::new(sidecar)),
            prefetch_sidecar: Arc::new(Mutex::new(prefetch_sidecar)),
            deep_search_sidecar: Arc::new(Mutex::new(deep_search_sidecar)),
            prefetch_generation: [Arc::new(AtomicU64::new(0)), Arc::new(AtomicU64::new(0))],
            deep_search_generation: Arc::new(AtomicU64::new(0)),
            pending_open_paths: Vec::new(),
        }
    }

    pub(crate) fn push_pending_open_paths(&mut self, paths: Vec<String>) {
        self.pending_open_paths.extend(paths);
    }

    pub(crate) fn take_pending_open_paths(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_open_paths)
    }

    #[cfg(test)]
    fn canonical_view_source_path(path: &std::path::Path) -> Result<PathBuf, String> {
        std::fs::canonicalize(path).map_err(|error| {
            format!(
                "failed to canonicalize view source path {}: {error}",
                path.display()
            )
        })
    }

    fn format_view_source_id(path: &std::path::Path) -> String {
        format!("view:{}", path.display())
    }

    #[cfg(test)]
    fn open_view_archive(path: String) -> Result<Archive, String> {
        let validated = validate_archive_path(&path).map_err(|error| error.to_string())?;
        let canonical = Self::canonical_view_source_path(&validated)?;
        Archive::open_validated(canonical).map_err(|error| error.to_string())
    }

    #[cfg(test)]
    pub(crate) fn open_view_source(&mut self, path: String) -> Result<ViewSourceSummary, String> {
        let archive = Self::open_view_archive(path)?;
        self.insert_view_source(archive)
    }

    pub(crate) fn insert_view_source(
        &mut self,
        archive: Archive,
    ) -> Result<ViewSourceSummary, String> {
        let source_id = Self::format_view_source_id(archive.path());
        let summary = ViewSourceSummary {
            id: source_id.clone(),
            path: archive.path().display().to_string(),
            name: archive
                .path()
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| archive.path().display().to_string()),
            kind: archive.metadata().source_kind,
            signed: archive.metadata().signed,
            entry_count: archive.entries().count(),
        };
        self.view_sources.insert(
            source_id,
            ViewSourceState {
                archive,
                nested: Arc::new(Mutex::new(
                    NestedArchiveCache::new().map_err(|error| error.to_string())?,
                )),
                plan: MergePlan::new(),
            },
        );
        Ok(summary)
    }

    pub(crate) fn list_view_sources(&self) -> Vec<ViewSourceSummary> {
        self.view_sources
            .iter()
            .map(|(id, source)| ViewSourceSummary {
                id: id.clone(),
                path: source.archive.path().display().to_string(),
                name: source
                    .archive
                    .path()
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| source.archive.path().display().to_string()),
                kind: source.archive.metadata().source_kind,
                signed: source.archive.metadata().signed,
                entry_count: source.archive.entries().count(),
            })
            .collect()
    }

    pub(crate) fn view_source_snapshot(
        &self,
        source_id: &str,
    ) -> Result<ViewSourceSnapshot, String> {
        let source = self
            .view_sources
            .get(source_id)
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))?;
        Ok(ViewSourceSnapshot {
            archive: source.archive.clone(),
            nested: Arc::clone(&source.nested),
        })
    }

    #[cfg(test)]
    pub(crate) fn view_source_archive(&self, source_id: &str) -> Result<&Archive, String> {
        self.view_sources
            .get(source_id)
            .map(|source| &source.archive)
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))
    }

    pub(crate) fn close_view_source(&mut self, source_id: &str) -> Result<(), String> {
        if self
            .view_sources
            .get(source_id)
            .is_some_and(|source| !source.plan.is_empty())
        {
            return Err("save or clear unsaved changes before closing this source".to_owned());
        }
        self.view_sources
            .remove(source_id)
            .map(|_| ())
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))
    }

    #[cfg(test)]
    pub(crate) fn load_archive(
        &mut self,
        path: &str,
        side: Side,
    ) -> Result<ArchiveSummary, String> {
        let archive = Archive::open(path).map_err(|error| error.to_string())?;
        self.install_archive(archive, side)
    }

    pub(crate) fn plan_mut(&mut self, side: Side) -> &mut MergePlan {
        match side {
            Side::Left => &mut self.left_plan,
            Side::Right => &mut self.right_plan,
        }
    }

    pub(crate) fn plan(&self, side: Side) -> &MergePlan {
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

    pub(crate) fn any_pending(&self) -> bool {
        !self.plan(Side::Left).is_empty()
            || !self.plan(Side::Right).is_empty()
            || self
                .view_sources
                .values()
                .any(|source| !source.plan.is_empty())
    }

    pub(crate) fn stage_view_write(
        &mut self,
        source_id: &str,
        entry_path: &str,
        content: &str,
    ) -> Result<(), String> {
        if entry_path.contains("!/") {
            return Err("editing entries inside nested archives is not supported".to_owned());
        }
        let source = self
            .view_sources
            .get_mut(source_id)
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))?;
        if source.archive.metadata().signed {
            return Err("signed archives must be edited in Compare mode".to_owned());
        }
        let entry = source
            .archive
            .entry(entry_path)
            .ok_or("entry is not indexed")?
            .clone();
        let original = source
            .archive
            .read_entry(entry_path)
            .map_err(|error| error.to_string())?;
        if !edit::editable_text(&entry, &original) {
            return Err("entry is not an editable text file".to_owned());
        }
        let encoding = edit::detect_encoding(&original);
        source
            .plan
            .stage_write(entry_path, edit::encode_text(content, &encoding))
            .map_err(|error| error.to_string())
    }

    pub(crate) fn unstage_view_write(
        &mut self,
        source_id: &str,
        entry_path: &str,
    ) -> Result<(), String> {
        let source = self
            .view_sources
            .get_mut(source_id)
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))?;
        if source
            .plan
            .unstage(entry_path)
            .map_err(|error| error.to_string())?
        {
            return Ok(());
        }
        Err("staged entry is not found".to_owned())
    }

    pub(crate) fn commit_view(
        &mut self,
        source_id: &str,
        backup: bool,
    ) -> Result<CommitResult, String> {
        let source = self
            .view_sources
            .get_mut(source_id)
            .ok_or_else(|| format!("view source is not loaded: {source_id}"))?;
        if source.archive.metadata().signed {
            return Err("signed archives must be edited in Compare mode".to_owned());
        }
        let result = source
            .plan
            .commit(&source.archive, CommitOptions { backup })
            .map_err(|error| error.to_string())?;
        source.archive = Archive::open(result.rewritten_path.to_string_lossy())
            .map_err(|error| error.to_string())?;
        source.nested = fresh_nested_cache()?;
        Ok(result)
    }

    /// Legacy single-target lock: only one side may carry pending ops unless both
    /// sources are standalone files. Returns Err if `side` would violate it.
    fn ensure_can_stage(&self, side: Side) -> Result<(), String> {
        if self.both_sides_are_files() {
            return Ok(());
        }
        let other = side.opposite();
        if !self.plan(other).is_empty() {
            return Err("save or clear unsaved changes before editing the other side".to_owned());
        }
        Ok(())
    }

    pub(crate) fn install_archive(
        &mut self,
        archive: Archive,
        side: Side,
    ) -> Result<ArchiveSummary, String> {
        if self.any_pending() {
            return Err("save staged copies before changing an archive".to_owned());
        }
        let summary = summarize(&archive);
        *archive_mut(self, side) = Some(archive);
        *nested_cache_mut(self, side) = fresh_nested_cache()?;
        Ok(summary)
    }

    pub(crate) fn stage_copy(
        &mut self,
        from: Side,
        to: Side,
        entry_path: &str,
    ) -> Result<(), String> {
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

    pub(crate) fn stage_write(
        &mut self,
        side: Side,
        entry_path: &str,
        content: &str,
    ) -> Result<(), String> {
        self.ensure_can_stage(side)?;
        let archive = archive(self, side).ok_or("archive is not loaded")?.clone();
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

    pub(crate) fn commit_merge(
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
        *nested_cache_mut(self, target_side) = fresh_nested_cache()?;
        Ok(result)
    }

    pub(crate) fn clear_staged(&mut self) {
        self.plan_mut(Side::Left).clear();
        self.plan_mut(Side::Right).clear();
        for source in self.view_sources.values_mut() {
            source.plan.clear();
        }
    }

    pub(crate) fn unstage(&mut self, entry_path: &str, side: Option<Side>) -> Result<(), String> {
        let sides: &[Side] = match side {
            Some(Side::Left) => &[Side::Left],
            Some(Side::Right) => &[Side::Right],
            None => &[Side::Left, Side::Right],
        };
        for &side in sides {
            if self
                .plan_mut(side)
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
pub(crate) struct ArchiveSummary {
    pub(crate) path: String,
    pub(crate) metadata: ArchiveMetadata,
    pub(crate) entries: Vec<ArchiveEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewSourceSummary {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: ArchiveSourceKind,
    pub(crate) signed: bool,
    pub(crate) entry_count: usize,
}

pub(crate) struct ViewSourceState {
    pub(crate) archive: Archive,
    pub(crate) nested: Arc<Mutex<NestedArchiveCache>>,
    pub(crate) plan: MergePlan,
}

#[derive(Clone)]
pub(crate) struct ViewSourceSnapshot {
    pub(crate) archive: Archive,
    pub(crate) nested: Arc<Mutex<NestedArchiveCache>>,
}

#[derive(Clone)]
pub(crate) struct SideSnapshot {
    pub(crate) archive: Archive,
    pub(crate) nested: Arc<Mutex<NestedArchiveCache>>,
}

pub(crate) fn archive(state: &AppState, side: Side) -> Option<&Archive> {
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

pub(crate) fn nested_cache(state: &AppState, side: Side) -> &Arc<Mutex<NestedArchiveCache>> {
    match side {
        Side::Left => &state.left_nested,
        Side::Right => &state.right_nested,
    }
}

fn nested_cache_mut(state: &mut AppState, side: Side) -> &mut Arc<Mutex<NestedArchiveCache>> {
    match side {
        Side::Left => &mut state.left_nested,
        Side::Right => &mut state.right_nested,
    }
}

pub(crate) fn side_snapshot(state: &AppState, side: Side) -> Option<SideSnapshot> {
    Some(SideSnapshot {
        archive: archive(state, side)?.clone(),
        nested: Arc::clone(nested_cache(state, side)),
    })
}

fn fresh_nested_cache() -> Result<Arc<Mutex<NestedArchiveCache>>, String> {
    NestedArchiveCache::new()
        .map(|cache| Arc::new(Mutex::new(cache)))
        .map_err(|error| error.to_string())
}

fn summarize(archive: &Archive) -> ArchiveSummary {
    ArchiveSummary {
        path: archive.path().display().to_string(),
        metadata: archive.metadata().clone(),
        entries: archive.entries().cloned().collect(),
    }
}
