use std::{
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::AtomicU64},
};

use lcdiff_core::{
    Archive, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitOptions, CommitResult,
    DEFAULT_DECOMPILE_ENGINE, DecompileEngine, EntryKind, MergePlan, NestedArchiveCache,
    create_empty_archive, edit, export_archive_atomic,
};
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use crate::{Side, sidecar_process::SidecarClient};

pub(crate) type SharedState = Arc<Mutex<AppState>>;

// Command registration follows in a later task; these lifecycle contracts are
// exercised directly by stored-state tests until then.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum TempTargetCreation {
    Empty { extension: String },
    CopyCurrent,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeSessionSummary {
    pub(crate) id: String,
    pub(crate) target_side: Side,
    pub(crate) working_name: String,
    pub(crate) entry_count: usize,
    pub(crate) applied_source_count: usize,
    pub(crate) exported_path: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeConflictPreview {
    pub(crate) new_entries: Vec<String>,
    pub(crate) conflicts: Vec<String>,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TempMergeConflictAction {
    Overwrite,
    Skip,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeDecision {
    pub(crate) entry_path: String,
    pub(crate) action: TempMergeConflictAction,
}

#[allow(dead_code)]
#[derive(Clone)]
struct TempMergeReview {
    source_side: Side,
    source: Archive,
    target: Archive,
    preview: TempMergeConflictPreview,
}

pub(crate) struct TempMergeSession {
    id: String,
    target_side: Side,
    temp_dir: TempDir,
    working_path: PathBuf,
    #[allow(dead_code)]
    creation: TempTargetCreation,
    applied_source_count: usize,
    exported_path: Option<PathBuf>,
    pending_cleanup_paths: Vec<OwnedTempPath>,
    #[allow(dead_code)]
    review: Option<TempMergeReview>,
}

struct OwnedTempPath {
    path: Option<PathBuf>,
}

impl OwnedTempPath {
    fn from_temp_dir(temp_dir: TempDir) -> Self {
        Self {
            path: Some(temp_dir.keep()),
        }
    }

    fn from_disarmed_temp_dir(temp_dir: &TempDir) -> Self {
        Self {
            path: Some(temp_dir.path().to_owned()),
        }
    }

    fn path(&self) -> &Path {
        self.path
            .as_deref()
            .expect("owned cleanup path is still armed")
    }

    fn disarm(&mut self) {
        self.path = None;
    }

    fn take(&mut self) -> Self {
        Self {
            path: self.path.take(),
        }
    }
}

impl Drop for OwnedTempPath {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

struct TempTargetSourceSnapshot {
    source_side: Side,
    source: Archive,
}

pub(crate) struct PreparedTempTarget {
    source_snapshot: TempTargetSourceSnapshot,
    working_archive: Archive,
    target_nested: Arc<Mutex<NestedArchiveCache>>,
    session: TempMergeSession,
}

struct DetachedTempTarget {
    target_side: Side,
    archive: Archive,
    nested: Arc<Mutex<NestedArchiveCache>>,
    plan: MergePlan,
    session: TempMergeSession,
}

struct TempTargetRecoverySnapshot {
    working_name: PathBuf,
    archive_bytes: Vec<u8>,
}

struct PendingTempTargetDiscard {
    target_side: Side,
    _nested: Arc<Mutex<NestedArchiveCache>>,
    _plan: MergePlan,
    session: TempMergeSession,
    _recovery: TempTargetRecoverySnapshot,
}

impl TempMergeSession {
    fn summary(&self, archive: &Archive) -> TempMergeSessionSummary {
        TempMergeSessionSummary {
            id: self.id.clone(),
            target_side: self.target_side,
            working_name: self
                .working_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| self.working_path.display().to_string()),
            entry_count: archive.entries().count(),
            applied_source_count: self.applied_source_count,
            exported_path: self
                .exported_path
                .as_ref()
                .map(|path| path.display().to_string()),
        }
    }

    fn retry_pending_cleanup(
        &mut self,
        cleanup: &mut impl FnMut(&Path) -> io::Result<()>,
    ) -> io::Result<()> {
        let mut pending_cleanup_paths = std::mem::take(&mut self.pending_cleanup_paths);
        for (index, owned_path) in pending_cleanup_paths.iter_mut().enumerate() {
            match cleanup(owned_path.path()) {
                Ok(()) => owned_path.disarm(),
                Err(error) => {
                    self.pending_cleanup_paths = pending_cleanup_paths.split_off(index);
                    return Err(error);
                }
            }
        }
        Ok(())
    }
}

pub(crate) struct AppState {
    pub(crate) left: Option<Archive>,
    pub(crate) right: Option<Archive>,
    pub(crate) left_nested: Arc<Mutex<NestedArchiveCache>>,
    pub(crate) right_nested: Arc<Mutex<NestedArchiveCache>>,
    pub(crate) view_sources: BTreeMap<String, ViewSourceState>,
    pub(crate) left_plan: MergePlan,
    pub(crate) right_plan: MergePlan,
    pub(crate) temp_merge_session: Option<TempMergeSession>,
    temp_merge_discarding: Option<Side>,
    pending_temp_target_discard: Option<PendingTempTargetDiscard>,
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
            temp_merge_session: None,
            temp_merge_discarding: None,
            pending_temp_target_discard: None,
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

    fn format_view_source_id(path: &std::path::Path) -> String {
        format!("view:{}", path.display())
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

    #[cfg(test)]
    pub(crate) fn pending_temp_target_recovery_bytes(&self) -> Option<&[u8]> {
        self.pending_temp_target_discard
            .as_ref()
            .map(|pending| pending._recovery.archive_bytes.as_slice())
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
        if self.temp_merge_discarding.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        if self
            .temp_merge_session
            .as_ref()
            .is_some_and(|session| session.target_side.opposite() == side)
        {
            return Err("temporary merge source cannot be modified".to_owned());
        }
        if self.both_sides_are_files() {
            return Ok(());
        }
        let other = side.opposite();
        if !self.plan(other).is_empty() {
            return Err("save or clear unsaved changes before editing the other side".to_owned());
        }
        Ok(())
    }

    fn ensure_replaceable_side(&self, side: Side) -> Result<(), String> {
        if self.temp_merge_discarding.is_some() {
            return Err(
                "temporary merge target or source cannot be replaced while session is being discarded"
                    .to_owned(),
            );
        }
        let fixed_target = self
            .temp_merge_session
            .as_ref()
            .map(|session| session.target_side);
        if fixed_target == Some(side) {
            return Err("temporary merge target cannot be replaced".to_owned());
        }
        Ok(())
    }

    pub(crate) fn install_archive(
        &mut self,
        archive: Archive,
        side: Side,
    ) -> Result<ArchiveSummary, String> {
        self.ensure_replaceable_side(side)?;
        if self.any_pending() {
            return Err("save staged copies before changing an archive".to_owned());
        }
        let summary = summarize(&archive);
        *archive_mut(self, side) = Some(archive);
        self.invalidate_temp_merge_review();
        *nested_cache_mut(self, side) = fresh_nested_cache()?;
        Ok(summary)
    }

    fn temp_target_source_snapshot(
        &self,
        source_side: Side,
    ) -> Result<TempTargetSourceSnapshot, String> {
        if self.temp_merge_session.is_some() || self.temp_merge_discarding.is_some() {
            return Err("a temporary merge session is already active".to_owned());
        }
        let source = archive(self, source_side)
            .ok_or("source archive is not loaded")?
            .clone();
        if source.metadata().source_kind != ArchiveSourceKind::Archive {
            return Err("temporary merge source must be an archive source".to_owned());
        }
        let target_side = source_side.opposite();
        if archive(self, target_side).is_some() {
            return Err("temporary merge target side must be empty".to_owned());
        }
        if self.any_pending() {
            return Err(
                "clear pending changes before creating a temporary merge target".to_owned(),
            );
        }
        Ok(TempTargetSourceSnapshot {
            source_side,
            source,
        })
    }

    fn install_prepared_temp_target(
        &mut self,
        prepared: PreparedTempTarget,
    ) -> Result<TempMergeSessionSummary, String> {
        let current = self.temp_target_source_snapshot(prepared.source_snapshot.source_side)?;
        if !same_archive_snapshot(&current.source, &prepared.source_snapshot.source) {
            return Err(
                "source archive changed while temporary target was being prepared".to_owned(),
            );
        }
        let target_side = prepared.session.target_side;
        let summary = prepared.session.summary(&prepared.working_archive);

        *archive_mut(self, target_side) = Some(prepared.working_archive);
        *nested_cache_mut(self, target_side) = prepared.target_nested;
        self.temp_merge_session = Some(prepared.session);
        Ok(summary)
    }

    fn detach_temp_target(
        &mut self,
        replacement_nested: Arc<Mutex<NestedArchiveCache>>,
    ) -> Result<DetachedTempTarget, String> {
        let target_side = self
            .temp_merge_session
            .as_ref()
            .map(|session| session.target_side)
            .ok_or_else(|| "temporary merge session is not active".to_owned())?;
        if archive(self, target_side).is_none() {
            return Err("temporary merge target archive is not loaded".to_owned());
        }

        let mut session = self
            .temp_merge_session
            .take()
            .expect("temporary merge session checked above");
        session.review = None;
        let archive = archive_mut(self, target_side)
            .take()
            .expect("temporary merge target archive checked above");
        let nested = std::mem::replace(nested_cache_mut(self, target_side), replacement_nested);
        let plan = std::mem::replace(self.plan_mut(target_side), MergePlan::new());
        self.temp_merge_discarding = Some(target_side);
        Ok(DetachedTempTarget {
            target_side,
            archive,
            nested,
            plan,
            session,
        })
    }

    fn restore_detached_temp_target(&mut self, detached: DetachedTempTarget) {
        debug_assert_eq!(self.temp_merge_discarding, Some(detached.target_side));
        debug_assert!(archive(self, detached.target_side).is_none());
        debug_assert!(self.plan(detached.target_side).is_empty());
        debug_assert!(self.temp_merge_session.is_none());

        *archive_mut(self, detached.target_side) = Some(detached.archive);
        *nested_cache_mut(self, detached.target_side) = detached.nested;
        *self.plan_mut(detached.target_side) = detached.plan;
        self.temp_merge_session = Some(detached.session);
        self.temp_merge_discarding = None;
    }

    fn finish_temp_target_discard(&mut self, target_side: Side) {
        debug_assert_eq!(self.temp_merge_discarding, Some(target_side));
        self.temp_merge_discarding = None;
    }

    fn invalidate_temp_merge_review(&mut self) {
        if let Some(session) = self.temp_merge_session.as_mut() {
            session.review = None;
        }
    }

    #[allow(dead_code)]
    fn active_temp_merge_archives(
        &self,
        source_side: Side,
    ) -> Result<(Side, Archive, Archive), String> {
        if self.temp_merge_discarding.is_some() || self.pending_temp_target_discard.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        let target_side = self
            .temp_merge_session
            .as_ref()
            .map(|session| session.target_side)
            .ok_or_else(|| "temporary merge session is not active".to_owned())?;
        if source_side == target_side {
            return Err("source and target sides must differ".to_owned());
        }
        let source = archive(self, source_side)
            .ok_or("source archive is not loaded")?
            .clone();
        let target = archive(self, target_side)
            .ok_or("temporary merge target archive is not loaded")?
            .clone();
        Ok((target_side, source, target))
    }

    #[allow(dead_code)]
    fn temp_merge_conflict_preview(source: &Archive, target: &Archive) -> TempMergeConflictPreview {
        let mut new_entries = Vec::new();
        let mut conflicts = Vec::new();
        for entry in source
            .entries()
            .filter(|entry| entry.kind != EntryKind::Directory)
        {
            if target.entry(&entry.path).is_some() {
                conflicts.push(entry.path.clone());
            } else {
                new_entries.push(entry.path.clone());
            }
        }
        new_entries.sort();
        conflicts.sort();
        TempMergeConflictPreview {
            new_entries,
            conflicts,
        }
    }

    fn ensure_temp_merge_review_fresh(
        &mut self,
        review: &TempMergeReview,
        source: &Archive,
        target: &Archive,
    ) -> Result<(), String> {
        let changed_on_disk = (|| {
            Ok::<_, String>(
                review
                    .source
                    .changed_on_disk()
                    .map_err(|error| error.to_string())?
                    || review
                        .target
                        .changed_on_disk()
                        .map_err(|error| error.to_string())?
                    || source
                        .changed_on_disk()
                        .map_err(|error| error.to_string())?
                    || target
                        .changed_on_disk()
                        .map_err(|error| error.to_string())?,
            )
        })();
        match changed_on_disk {
            Ok(false) => Ok(()),
            Ok(true) => {
                self.invalidate_temp_merge_review();
                Err("temporary merge conflict preview is stale".to_owned())
            }
            Err(error) => {
                self.invalidate_temp_merge_review();
                Err(error)
            }
        }
    }

    #[allow(dead_code)]
    pub(crate) fn preview_temp_merge_all(
        &mut self,
        source_side: Side,
    ) -> Result<TempMergeConflictPreview, String> {
        self.invalidate_temp_merge_review();
        let (_, source, target) = self.active_temp_merge_archives(source_side)?;
        if source
            .changed_on_disk()
            .map_err(|error| error.to_string())?
            || target
                .changed_on_disk()
                .map_err(|error| error.to_string())?
        {
            return Err("temporary merge source or target changed on disk".to_owned());
        }
        let preview = Self::temp_merge_conflict_preview(&source, &target);
        self.temp_merge_session
            .as_mut()
            .expect("active temporary merge session checked above")
            .review = Some(TempMergeReview {
            source_side,
            source,
            target,
            preview: preview.clone(),
        });
        Ok(preview)
    }

    #[allow(dead_code)]
    pub(crate) fn stage_temp_merge_all(
        &mut self,
        source_side: Side,
        decisions: Vec<TempMergeDecision>,
    ) -> Result<(), String> {
        self.stage_temp_merge_all_with_pre_final_check(source_side, decisions, || {})
    }

    fn stage_temp_merge_all_with_pre_final_check(
        &mut self,
        source_side: Side,
        decisions: Vec<TempMergeDecision>,
        before_final_check: impl FnOnce(),
    ) -> Result<(), String> {
        let (target_side, source, target) = self.active_temp_merge_archives(source_side)?;
        let review = self
            .temp_merge_session
            .as_ref()
            .and_then(|session| session.review.clone())
            .ok_or_else(|| "preview temporary merge conflicts before staging".to_owned())?;
        let identities_match = review.source_side == source_side
            && same_archive_snapshot(&review.source, &source)
            && same_archive_snapshot(&review.target, &target);
        if !identities_match {
            self.invalidate_temp_merge_review();
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        self.ensure_temp_merge_review_fresh(&review, &source, &target)?;
        let preview = review.preview.clone();
        let conflicts = preview
            .conflicts
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let mut actions = BTreeMap::new();
        for decision in decisions {
            if !conflicts.contains(decision.entry_path.as_str()) {
                return Err(format!(
                    "temporary merge decision is not for a conflict: {}",
                    decision.entry_path
                ));
            }
            if actions
                .insert(decision.entry_path.clone(), decision.action)
                .is_some()
            {
                return Err(format!(
                    "duplicate temporary merge conflict decision: {}",
                    decision.entry_path
                ));
            }
        }
        if actions.len() != conflicts.len() {
            return Err("every temporary merge conflict requires exactly one decision".to_owned());
        }

        let mut staged_paths = preview.new_entries;
        staged_paths.extend(preview.conflicts.into_iter().filter(|entry_path| {
            actions.get(entry_path) == Some(&TempMergeConflictAction::Overwrite)
        }));
        staged_paths.sort();

        let mut validated_plan = MergePlan::new();
        for entry_path in &staged_paths {
            validated_plan
                .stage_copy(&review.source, entry_path, entry_path)
                .map_err(|error| error.to_string())?;
        }
        before_final_check();
        self.ensure_temp_merge_review_fresh(&review, &source, &target)?;
        self.invalidate_temp_merge_review();
        for entry_path in staged_paths {
            self.plan_mut(target_side)
                .stage_copy(&review.source, &entry_path, &entry_path)
                .expect("bulk staging paths were validated before mutating the merge plan");
        }
        Ok(())
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
        self.invalidate_temp_merge_review();
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

#[cfg(test)]
pub(crate) fn stage_temp_merge_all_with_pre_final_check(
    state: &mut AppState,
    source_side: Side,
    decisions: Vec<TempMergeDecision>,
    before_final_check: impl FnOnce(),
) -> Result<(), String> {
    state.stage_temp_merge_all_with_pre_final_check(source_side, decisions, before_final_check)
}

fn same_archive_snapshot(left: &Archive, right: &Archive) -> bool {
    left.path() == right.path()
        && left.metadata() == right.metadata()
        && left.entries().eq(right.entries())
}

fn build_prepared_temp_target(
    source_snapshot: TempTargetSourceSnapshot,
    creation: TempTargetCreation,
) -> Result<PreparedTempTarget, String> {
    let target_side = source_snapshot.source_side.opposite();
    let temp_dir = tempfile::Builder::new()
        .prefix("lcdiff-temp-merge-")
        .tempdir()
        .map_err(|error| error.to_string())?;
    let working_name = match &creation {
        TempTargetCreation::Empty { extension } => {
            format!("temporary-target.{extension}")
        }
        TempTargetCreation::CopyCurrent => source_snapshot
            .source
            .path()
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| "source archive has no file name".to_owned())?,
    };
    let working_path = temp_dir.path().join(&working_name);
    match &creation {
        TempTargetCreation::Empty { .. } => {
            create_empty_archive(&working_path).map_err(|error| error.to_string())?;
        }
        TempTargetCreation::CopyCurrent => {
            export_archive_atomic(source_snapshot.source.path(), &working_path)
                .map_err(|error| error.to_string())?;
        }
    }
    let working_archive =
        Archive::open(working_path.to_string_lossy()).map_err(|error| error.to_string())?;
    let target_nested = fresh_nested_cache()?;
    let id = temp_dir
        .path()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "temporary merge session has no identifier".to_owned())?;
    let session = TempMergeSession {
        id,
        target_side,
        temp_dir,
        working_path: working_archive.path().to_owned(),
        creation,
        applied_source_count: 0,
        exported_path: None,
        pending_cleanup_paths: Vec::new(),
        review: None,
    };
    Ok(PreparedTempTarget {
        source_snapshot,
        working_archive,
        target_nested,
        session,
    })
}

fn prepare_temp_target_with_probe(
    shared_state: &SharedState,
    source_side: Side,
    creation: TempTargetCreation,
    probe: impl FnOnce(),
) -> Result<PreparedTempTarget, String> {
    let source_snapshot = {
        let state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.temp_target_source_snapshot(source_side)?
    };
    probe();
    build_prepared_temp_target(source_snapshot, creation)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn prepare_temp_target(
    shared_state: &SharedState,
    source_side: Side,
    creation: TempTargetCreation,
) -> Result<PreparedTempTarget, String> {
    prepare_temp_target_with_probe(shared_state, source_side, creation, || {})
}

#[cfg(test)]
pub(crate) fn prepare_temp_target_with_lock_probe(
    shared_state: &SharedState,
    source_side: Side,
    creation: TempTargetCreation,
    probe: impl FnOnce(),
) -> Result<PreparedTempTarget, String> {
    prepare_temp_target_with_probe(shared_state, source_side, creation, probe)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn install_prepared_temp_target(
    shared_state: &SharedState,
    prepared: PreparedTempTarget,
) -> Result<TempMergeSessionSummary, String> {
    let mut state = shared_state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.install_prepared_temp_target(prepared)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn create_temp_target(
    shared_state: &SharedState,
    source_side: Side,
    creation: TempTargetCreation,
) -> Result<TempMergeSessionSummary, String> {
    let prepared = prepare_temp_target(shared_state, source_side, creation)?;
    install_prepared_temp_target(shared_state, prepared)
}

impl DetachedTempTarget {
    fn clear_nested_handles(&self) -> Result<(), String> {
        self.nested
            .lock()
            .map_err(|_| "temporary target cache lock is poisoned".to_owned())?
            .clear();
        Ok(())
    }

    fn capture_recovery_snapshot(&self) -> Result<TempTargetRecoverySnapshot, String> {
        let working_name = self
            .session
            .working_path
            .file_name()
            .ok_or_else(|| "temporary merge target has no working file name".to_owned())?
            .into();
        let archive_bytes =
            std::fs::read(&self.session.working_path).map_err(|error| error.to_string())?;
        Ok(TempTargetRecoverySnapshot {
            working_name,
            archive_bytes,
        })
    }

    fn rearm_current_if_unchanged(
        &mut self,
        recovery: &TempTargetRecoverySnapshot,
        current_path: &mut OwnedTempPath,
    ) -> bool {
        let Ok(current_bytes) = std::fs::read(&self.session.working_path) else {
            return false;
        };
        if current_bytes != recovery.archive_bytes {
            return false;
        }
        let Ok(archive) = Archive::open(self.session.working_path.to_string_lossy()) else {
            return false;
        };
        self.archive = archive;
        self.session.temp_dir.disable_cleanup(false);
        current_path.disarm();
        true
    }

    fn activate_recovery(
        &mut self,
        recovery: &TempTargetRecoverySnapshot,
        failed_path: &mut OwnedTempPath,
        cleanup: &mut impl FnMut(&Path) -> io::Result<()>,
        write_snapshot: &mut impl FnMut(&Path, &[u8]) -> io::Result<()>,
    ) -> Result<(), String> {
        let temp_dir = tempfile::Builder::new()
            .prefix("lcdiff-temp-merge-recovery-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let working_path = temp_dir.path().join(&recovery.working_name);
        let archive = match write_snapshot(&working_path, &recovery.archive_bytes)
            .map_err(|error| error.to_string())
            .and_then(|()| {
                Archive::open(working_path.to_string_lossy()).map_err(|error| error.to_string())
            }) {
            Ok(archive) => archive,
            Err(error) => {
                let mut incomplete_path = OwnedTempPath::from_temp_dir(temp_dir);
                return match cleanup(incomplete_path.path()) {
                    Ok(()) => {
                        incomplete_path.disarm();
                        Err(error)
                    }
                    Err(cleanup_error) => {
                        self.session
                            .pending_cleanup_paths
                            .push(incomplete_path.take());
                        Err(format!(
                            "{error}; failed to clean incomplete recovery: {cleanup_error}"
                        ))
                    }
                };
            }
        };
        let disabled_temp_dir = std::mem::replace(&mut self.session.temp_dir, temp_dir);
        drop(disabled_temp_dir);
        self.archive = archive;
        self.session.working_path = working_path;
        self.session.pending_cleanup_paths.push(failed_path.take());
        Ok(())
    }

    fn restore_current_from_snapshot(
        &mut self,
        recovery: &TempTargetRecoverySnapshot,
        write_snapshot: &mut impl FnMut(&Path, &[u8]) -> io::Result<()>,
    ) -> Result<(), String> {
        std::fs::create_dir_all(self.session.temp_dir.path()).map_err(|error| error.to_string())?;
        let working_path = self.session.temp_dir.path().join(&recovery.working_name);
        write_snapshot(&working_path, &recovery.archive_bytes)
            .map_err(|error| error.to_string())?;
        let archive =
            Archive::open(working_path.to_string_lossy()).map_err(|error| error.to_string())?;
        self.archive = archive;
        self.session.working_path = working_path;
        self.session.temp_dir.disable_cleanup(false);
        Ok(())
    }

    fn into_pending_discard(
        mut self,
        recovery: TempTargetRecoverySnapshot,
        current_path: &mut OwnedTempPath,
    ) -> PendingTempTargetDiscard {
        self.session.pending_cleanup_paths.push(current_path.take());
        PendingTempTargetDiscard {
            target_side: self.target_side,
            _nested: self.nested,
            _plan: self.plan,
            session: self.session,
            _recovery: recovery,
        }
    }
}

fn restore_discard_failure(
    shared_state: &SharedState,
    detached: DetachedTempTarget,
    error: impl std::fmt::Display,
) -> Result<(), String> {
    let mut state = match shared_state.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };
    state.restore_detached_temp_target(detached);
    Err(format!("failed to discard temporary merge target: {error}"))
}

fn retain_pending_discard_failure(
    shared_state: &SharedState,
    pending: PendingTempTargetDiscard,
    error: impl std::fmt::Display,
) -> Result<(), String> {
    let mut state = match shared_state.lock() {
        Ok(state) => state,
        Err(poisoned) => poisoned.into_inner(),
    };
    debug_assert_eq!(state.temp_merge_discarding, Some(pending.target_side));
    debug_assert!(archive(&state, pending.target_side).is_none());
    debug_assert!(state.plan(pending.target_side).is_empty());
    debug_assert!(state.temp_merge_session.is_none());
    debug_assert!(state.pending_temp_target_discard.is_none());
    state.pending_temp_target_discard = Some(pending);
    Err(format!("failed to discard temporary merge target: {error}"))
}

fn discard_temp_target_with_operations(
    shared_state: &SharedState,
    mut cleanup: impl FnMut(&Path) -> io::Result<()>,
    mut write_snapshot: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<(), String> {
    let pending = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.pending_temp_target_discard.take()
    };
    if let Some(mut pending) = pending {
        if let Err(error) = pending.session.retry_pending_cleanup(&mut cleanup) {
            return retain_pending_discard_failure(shared_state, pending, error);
        }
        {
            let mut state = match shared_state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            state.finish_temp_target_discard(pending.target_side);
        }
        drop(pending);
        return Ok(());
    }

    let replacement_nested = fresh_nested_cache()?;
    let mut detached = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.detach_temp_target(replacement_nested)?
    };
    if let Err(error) = detached.clear_nested_handles() {
        return restore_discard_failure(shared_state, detached, error);
    }
    if let Err(error) = detached.session.retry_pending_cleanup(&mut cleanup) {
        return restore_discard_failure(shared_state, detached, error);
    }
    let recovery = match detached.capture_recovery_snapshot() {
        Ok(recovery) => recovery,
        Err(error) => return restore_discard_failure(shared_state, detached, error),
    };
    detached.session.temp_dir.disable_cleanup(true);
    let mut current_path = OwnedTempPath::from_disarmed_temp_dir(&detached.session.temp_dir);
    if let Err(cleanup_error) = cleanup(current_path.path()) {
        if detached.rearm_current_if_unchanged(&recovery, &mut current_path) {
            return restore_discard_failure(shared_state, detached, cleanup_error);
        }
        if let Err(recovery_error) = detached.activate_recovery(
            &recovery,
            &mut current_path,
            &mut cleanup,
            &mut write_snapshot,
        ) {
            match detached.restore_current_from_snapshot(&recovery, &mut write_snapshot) {
                Ok(()) => {
                    current_path.disarm();
                    return restore_discard_failure(
                        shared_state,
                        detached,
                        format!("{cleanup_error}; recovery failed: {recovery_error}"),
                    );
                }
                Err(restore_error) => {
                    let pending = detached.into_pending_discard(recovery, &mut current_path);
                    return retain_pending_discard_failure(
                        shared_state,
                        pending,
                        format!(
                            "{cleanup_error}; recovery failed: {recovery_error}; \
                             original session restore failed: {restore_error}"
                        ),
                    );
                }
            }
        }
        return restore_discard_failure(shared_state, detached, cleanup_error);
    }
    current_path.disarm();
    {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.finish_temp_target_discard(detached.target_side);
    }
    drop(detached);
    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn discard_temp_target(shared_state: &SharedState) -> Result<(), String> {
    discard_temp_target_with_operations(
        shared_state,
        |path| match std::fs::remove_dir_all(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
        |path, bytes| std::fs::write(path, bytes),
    )
}

#[cfg(test)]
pub(crate) fn discard_temp_target_with_cleanup(
    shared_state: &SharedState,
    cleanup: impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), String> {
    discard_temp_target_with_operations(shared_state, cleanup, |path, bytes| {
        std::fs::write(path, bytes)
    })
}

#[cfg(test)]
pub(crate) fn discard_temp_target_with_cleanup_and_write(
    shared_state: &SharedState,
    cleanup: impl FnMut(&Path) -> io::Result<()>,
    write_snapshot: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<(), String> {
    discard_temp_target_with_operations(shared_state, cleanup, write_snapshot)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveSummary {
    pub(crate) path: String,
    pub(crate) metadata: ArchiveMetadata,
    pub(crate) entries: Vec<ArchiveEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFileContent {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareSourcesResult {
    pub(crate) left: ArchiveSummary,
    pub(crate) right: ArchiveSummary,
    pub(crate) diff: lcdiff_core::ArchiveDiff,
}

pub(crate) struct PreparedCompareArchives {
    left: Archive,
    right: Archive,
    left_summary: ArchiveSummary,
    right_summary: ArchiveSummary,
    left_nested: Arc<Mutex<NestedArchiveCache>>,
    right_nested: Arc<Mutex<NestedArchiveCache>>,
}

type DisplacedCompareArchives = (
    Option<Archive>,
    Option<Archive>,
    Arc<Mutex<NestedArchiveCache>>,
    Arc<Mutex<NestedArchiveCache>>,
);

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

pub(crate) fn prepare_compare_archives(
    left: Archive,
    right: Archive,
) -> Result<PreparedCompareArchives, String> {
    let left_summary = summarize(&left);
    let right_summary = summarize(&right);
    let left_nested = fresh_nested_cache()?;
    let right_nested = fresh_nested_cache()?;
    Ok(PreparedCompareArchives {
        left,
        right,
        left_summary,
        right_summary,
        left_nested,
        right_nested,
    })
}

pub(crate) fn install_prepared_compare_archives(
    shared_state: &SharedState,
    prepared: PreparedCompareArchives,
) -> Result<(ArchiveSummary, ArchiveSummary, DisplacedCompareArchives), String> {
    let mut state = shared_state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.ensure_replaceable_side(Side::Left)?;
    state.ensure_replaceable_side(Side::Right)?;
    if state.any_pending() {
        drop(state);
        drop(prepared);
        return Err("save staged copies before changing an archive".to_owned());
    }
    let displaced = (
        state.left.replace(prepared.left),
        state.right.replace(prepared.right),
        std::mem::replace(&mut state.left_nested, prepared.left_nested),
        std::mem::replace(&mut state.right_nested, prepared.right_nested),
    );
    let installed = (prepared.left_summary, prepared.right_summary, displaced);
    drop(state);
    Ok(installed)
}

fn summarize(archive: &Archive) -> ArchiveSummary {
    ArchiveSummary {
        path: archive.path().display().to_string(),
        metadata: archive.metadata().clone(),
        entries: archive.entries().cloned().collect(),
    }
}
