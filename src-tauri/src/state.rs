use std::{
    collections::BTreeMap,
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::AtomicU64},
};

use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
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

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum TempTargetDiscardOutcome {
    Discarded,
    RetryDiscardOnly { message: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeConflictPreview {
    pub(crate) new_entries: Vec<String>,
    pub(crate) conflicts: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TempMergeConflictAction {
    Overwrite,
    Skip,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeDecision {
    pub(crate) entry_path: String,
    pub(crate) action: TempMergeConflictAction,
}

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
    applied_source_count: usize,
    exported_path: Option<PathBuf>,
    pending_cleanup_paths: Vec<OwnedTempPath>,
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
    #[cfg(test)]
    drop_probe: Option<PreparedTempTargetDropProbe>,
}

struct DisplacedPreparedTempTarget {
    _nested: Arc<Mutex<NestedArchiveCache>>,
    #[cfg(test)]
    _drop_probe: Option<PreparedTempTargetDropProbe>,
}

#[cfg(test)]
struct PreparedTempTargetDropProbe {
    state: SharedState,
    lock_available: Arc<AtomicBool>,
}

#[cfg(test)]
impl Drop for PreparedTempTargetDropProbe {
    fn drop(&mut self) {
        self.lock_available
            .store(self.state.try_lock().is_ok(), Ordering::SeqCst);
    }
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TempMergeReservation {
    token: u64,
    target_side: Side,
}

struct PreparedTempMergeApply {
    session_id: String,
    reservation: TempMergeReservation,
    target: Archive,
    plan: MergePlan,
    working_path: PathBuf,
}

struct PendingTempMergeApplyRecovery {
    reservation: TempMergeReservation,
    session: TempMergeSession,
    nested: Arc<Mutex<NestedArchiveCache>>,
    plan: MergePlan,
    operation_dir: TempDir,
    backup_path: PathBuf,
}

struct TempMergeApplyRecoveryResources {
    operation_dir: Option<TempDir>,
    replacement_nested: Option<Arc<Mutex<NestedArchiveCache>>>,
}

type TempMergeApplyPublication = (
    TempMergeSessionSummary,
    Option<Archive>,
    Arc<Mutex<NestedArchiveCache>>,
);

struct TempTargetExportSnapshot {
    session_id: String,
    target_side: Side,
    working_path: PathBuf,
    source: Archive,
    target: Archive,
    owned_temp_paths: Vec<PathBuf>,
}

struct PreparedTempTargetExport {
    snapshot: TempTargetExportSnapshot,
    reservation: TempMergeReservation,
    destination: ExportDestinationBinding,
    artifacts: ExportArtifactOwnership,
}

struct ExportDestinationBinding {
    path: PathBuf,
    file_name: PathBuf,
    parent: Dir,
    parent_identity: same_file::Handle,
}

struct OwnedExportArtifact {
    name: PathBuf,
    state: OwnedExportArtifactState,
    durability_handle: Option<cap_std::fs::File>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum OwnedExportArtifactState {
    Reserved,
    Present,
    RemovedNeedsSync,
    RemovedRetained,
}

struct PublishedExportDestination {
    handle: Option<cap_std::fs::File>,
    state: PublishedExportDestinationState,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum PublishedExportDestinationState {
    Present,
    RemovedNeedsSync,
    Removed,
    Restoring,
}

struct ExportArtifactOwnership {
    backup: OwnedExportArtifact,
    write: OwnedExportArtifact,
    published: Option<PublishedExportDestination>,
}

enum ExportDestinationSnapshot {
    Missing,
    Existing {
        expected_identity: same_file::Handle,
        preserves_identity: bool,
    },
}

enum PendingTempTargetExportRecoveryKind {
    ArtifactCleanup,
    Rollback,
    RollbackCleanup,
    ExportCleanup,
}

struct PendingTempTargetExportRecovery {
    prepared: PreparedTempTargetExport,
    snapshot: ExportDestinationSnapshot,
    kind: PendingTempTargetExportRecoveryKind,
}

impl PendingTempTargetExportRecovery {
    fn restore(&mut self) -> Result<(), String> {
        self.snapshot
            .restore(&self.prepared.destination, &mut self.prepared.artifacts)
    }

    fn cleanup(&mut self) -> Result<(), String> {
        self.snapshot
            .cleanup(&self.prepared.destination, &mut self.prepared.artifacts)
    }
}

struct TempMergeArchiveSnapshot {
    session_id: String,
    source_side: Side,
    target_side: Side,
    source: Archive,
    target: Archive,
}

struct TempMergeStageSnapshot {
    session_id: String,
    reservation: TempMergeReservation,
    source: Archive,
    target: Archive,
    review: TempMergeReview,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug)]
pub(crate) enum TempMergeApplyFailurePoint {
    Reopen,
    Cache,
    Publish,
    WorkingExportPostReplace,
    WorkingExportRollbackFailure,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug)]
pub(crate) enum TempMergePlanMutation {
    Clear,
    Unstage,
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
    temp_merge_applying: Option<TempMergeReservation>,
    temp_merge_exporting: Option<TempMergeReservation>,
    temp_merge_staging: Option<TempMergeReservation>,
    next_temp_merge_reservation: u64,
    pending_temp_target_discard: Option<PendingTempTargetDiscard>,
    pending_temp_merge_apply_recovery: Option<PendingTempMergeApplyRecovery>,
    pending_temp_target_export_recovery: Option<PendingTempTargetExportRecovery>,
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

impl Drop for AppState {
    fn drop(&mut self) {
        let Some(mut recovery) = self.pending_temp_target_export_recovery.take() else {
            return;
        };
        match recovery.kind {
            PendingTempTargetExportRecoveryKind::ArtifactCleanup => {
                let _ = recovery.cleanup();
            }
            PendingTempTargetExportRecoveryKind::Rollback => {
                if recovery.restore().is_ok() {
                    let _ = recovery.cleanup();
                } else {
                    recovery
                        .prepared
                        .artifacts
                        .retain_backup_on_disk_after_failed_shutdown_rollback();
                }
            }
            PendingTempTargetExportRecoveryKind::RollbackCleanup => {
                let _ = recovery.cleanup();
            }
            PendingTempTargetExportRecoveryKind::ExportCleanup => {
                let published_path_matches = recovery
                    .prepared
                    .artifacts
                    .published
                    .as_ref()
                    .is_some_and(|published| {
                        recovery
                            .prepared
                            .destination
                            .ambient_path_names_published_file(published)
                            .unwrap_or(false)
                    });
                if published_path_matches || recovery.restore().is_ok() {
                    let _ = recovery.cleanup();
                } else {
                    recovery
                        .prepared
                        .artifacts
                        .retain_backup_on_disk_after_failed_shutdown_rollback();
                }
            }
        }
    }
}

impl AppState {
    #[cfg(test)]
    pub(crate) fn temp_target_exported_path_for_test(&self) -> Option<PathBuf> {
        self.temp_merge_session
            .as_ref()
            .and_then(|session| session.exported_path.clone())
    }

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
            temp_merge_applying: None,
            temp_merge_exporting: None,
            temp_merge_staging: None,
            next_temp_merge_reservation: 1,
            pending_temp_target_discard: None,
            pending_temp_merge_apply_recovery: None,
            pending_temp_target_export_recovery: None,
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
        if self.temp_merge_operation_is_busy() {
            return Err("temporary merge target is busy".to_owned());
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
        if self.temp_merge_operation_is_busy() {
            return Err(
                "temporary merge target or source cannot be replaced while session is busy"
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
        if self.temp_merge_session.is_some()
            || self.temp_merge_discarding.is_some()
            || self.temp_merge_operation_is_busy()
        {
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
    ) -> Result<
        (TempMergeSessionSummary, DisplacedPreparedTempTarget),
        (String, Box<PreparedTempTarget>),
    > {
        let current = match self.temp_target_source_snapshot(prepared.source_snapshot.source_side) {
            Ok(current) => current,
            Err(error) => return Err((error, Box::new(prepared))),
        };
        if !same_archive_snapshot(&current.source, &prepared.source_snapshot.source) {
            return Err((
                "source archive changed while temporary target was being prepared".to_owned(),
                Box::new(prepared),
            ));
        }
        let target_side = prepared.session.target_side;
        let summary = prepared.session.summary(&prepared.working_archive);

        *archive_mut(self, target_side) = Some(prepared.working_archive);
        let displaced_nested =
            std::mem::replace(nested_cache_mut(self, target_side), prepared.target_nested);
        self.temp_merge_session = Some(prepared.session);
        Ok((
            summary,
            DisplacedPreparedTempTarget {
                _nested: displaced_nested,
                #[cfg(test)]
                _drop_probe: prepared.drop_probe,
            },
        ))
    }

    fn reserve_temp_merge_operation(&mut self, target_side: Side) -> TempMergeReservation {
        let reservation = TempMergeReservation {
            token: self.next_temp_merge_reservation,
            target_side,
        };
        self.next_temp_merge_reservation = self.next_temp_merge_reservation.wrapping_add(1).max(1);
        reservation
    }

    fn temp_merge_operation_is_busy(&self) -> bool {
        self.temp_merge_applying.is_some()
            || self.temp_merge_exporting.is_some()
            || self.temp_merge_staging.is_some()
            || self.pending_temp_merge_apply_recovery.is_some()
            || self.pending_temp_target_export_recovery.is_some()
    }

    fn temp_merge_operation_target_side(&self) -> Option<Side> {
        self.temp_merge_applying
            .or(self.temp_merge_exporting)
            .or(self.temp_merge_staging)
            .or_else(|| {
                self.pending_temp_merge_apply_recovery
                    .as_ref()
                    .map(|pending| pending.reservation)
            })
            .or_else(|| {
                self.pending_temp_target_export_recovery
                    .as_ref()
                    .map(|pending| pending.prepared.reservation)
            })
            .map(|reservation| reservation.target_side)
    }

    fn ensure_plan_mutation_allowed(&self, side: Side) -> Result<(), String> {
        if self.temp_merge_operation_target_side() == Some(side) {
            return Err("temporary merge target is busy".to_owned());
        }
        Ok(())
    }

    fn begin_temp_merge_apply(&mut self) -> Result<PreparedTempMergeApply, String> {
        if self.temp_merge_discarding.is_some() || self.pending_temp_target_discard.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        if self.temp_merge_operation_is_busy() {
            return Err("temporary merge target is busy".to_owned());
        }
        let (session_id, target_side, working_path) = {
            let session = self
                .temp_merge_session
                .as_mut()
                .ok_or_else(|| "temporary merge session is not active".to_owned())?;
            session.review = None;
            (
                session.id.clone(),
                session.target_side,
                session.working_path.clone(),
            )
        };
        let target = archive(self, target_side)
            .ok_or("temporary merge target archive is not loaded")?
            .clone();
        let plan = self.plan(target_side).clone();
        let reservation = self.reserve_temp_merge_operation(target_side);
        self.temp_merge_applying = Some(reservation);
        Ok(PreparedTempMergeApply {
            session_id,
            reservation,
            target,
            plan,
            working_path,
        })
    }

    fn temp_merge_apply_reservation_matches(&self, prepared: &PreparedTempMergeApply) -> bool {
        self.temp_merge_applying == Some(prepared.reservation)
            && self
                .temp_merge_session
                .as_ref()
                .is_some_and(|session| session.id == prepared.session_id)
            && archive(self, prepared.reservation.target_side)
                .is_some_and(|target| same_archive_snapshot(target, &prepared.target))
    }

    fn cancel_temp_merge_apply(
        &mut self,
        prepared: &PreparedTempMergeApply,
        restored_target: &mut Option<Archive>,
    ) -> Result<Option<Archive>, String> {
        if !self.temp_merge_apply_reservation_matches(prepared) {
            return Err("temporary merge apply reservation changed".to_owned());
        }
        let displaced = restored_target
            .take()
            .and_then(|target| archive_mut(self, prepared.reservation.target_side).replace(target));
        self.temp_merge_applying = None;
        Ok(displaced)
    }

    fn install_temp_merge_apply_recovery(
        &mut self,
        prepared: &PreparedTempMergeApply,
        backup_path: PathBuf,
        resources: &mut TempMergeApplyRecoveryResources,
    ) -> Result<Option<Archive>, String> {
        if !self.temp_merge_apply_reservation_matches(prepared) {
            return Err("temporary merge apply reservation changed".to_owned());
        }
        if resources.operation_dir.is_none() {
            return Err("temporary merge Apply recovery directory is unavailable".to_owned());
        }
        let Some(replacement_nested) = resources.replacement_nested.take() else {
            return Err("temporary merge Apply recovery cache is unavailable".to_owned());
        };
        let operation_dir = resources
            .operation_dir
            .take()
            .expect("temporary merge Apply recovery directory checked above");
        let target_side = prepared.reservation.target_side;
        let session = self
            .temp_merge_session
            .take()
            .expect("temporary merge session checked by reservation");
        let stale_target = archive_mut(self, target_side).take();
        let nested = std::mem::replace(nested_cache_mut(self, target_side), replacement_nested);
        let plan = std::mem::replace(self.plan_mut(target_side), MergePlan::new());
        self.pending_temp_merge_apply_recovery = Some(PendingTempMergeApplyRecovery {
            reservation: prepared.reservation,
            session,
            nested,
            plan,
            operation_dir,
            backup_path,
        });
        Ok(stale_target)
    }

    #[cfg(test)]
    pub(crate) fn temp_merge_apply_recovery_is_pending(&self) -> bool {
        self.pending_temp_merge_apply_recovery.is_some()
    }

    fn finish_temp_merge_apply(
        &mut self,
        prepared: &PreparedTempMergeApply,
        refreshed_target: &mut Option<Archive>,
        refreshed_nested: &mut Option<Arc<Mutex<NestedArchiveCache>>>,
    ) -> Result<TempMergeApplyPublication, String> {
        if !self.temp_merge_apply_reservation_matches(prepared) {
            return Err("temporary merge apply reservation changed".to_owned());
        }
        let target_side = prepared.reservation.target_side;
        let session = self
            .temp_merge_session
            .as_ref()
            .ok_or_else(|| "temporary merge session changed before publication".to_owned())?;
        let target = refreshed_target
            .as_ref()
            .ok_or_else(|| "refreshed temporary target is unavailable".to_owned())?;
        if refreshed_nested.is_none() {
            return Err("refreshed temporary target cache is unavailable".to_owned());
        }
        let mut summary = session.summary(target);
        summary.applied_source_count += 1;
        let Some(target) = refreshed_target.take() else {
            return Err("refreshed temporary target is unavailable".to_owned());
        };
        let Some(nested) = refreshed_nested.take() else {
            *refreshed_target = Some(target);
            return Err("refreshed temporary target cache is unavailable".to_owned());
        };
        let Some(session) = self.temp_merge_session.as_mut() else {
            *refreshed_target = Some(target);
            *refreshed_nested = Some(nested);
            return Err("temporary merge session changed before publication".to_owned());
        };
        session.applied_source_count += 1;
        self.plan_mut(target_side).clear();
        let displaced_target = archive_mut(self, target_side).replace(target);
        let displaced_nested = std::mem::replace(nested_cache_mut(self, target_side), nested);
        self.temp_merge_applying = None;
        Ok((summary, displaced_target, displaced_nested))
    }

    fn temp_target_export_snapshot(&self) -> Result<TempTargetExportSnapshot, String> {
        if self.temp_merge_discarding.is_some() || self.pending_temp_target_discard.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        if self.temp_merge_operation_is_busy() {
            return Err("temporary merge target is busy".to_owned());
        }
        let session = self
            .temp_merge_session
            .as_ref()
            .ok_or_else(|| "temporary merge session is not active".to_owned())?;
        let target = archive(self, session.target_side)
            .ok_or("temporary merge target archive is not loaded")?
            .clone();
        let source = archive(self, session.target_side.opposite())
            .ok_or("temporary merge source archive is not loaded")?
            .clone();
        let mut owned_temp_paths = vec![session.temp_dir.path().to_owned()];
        owned_temp_paths.extend(
            session
                .pending_cleanup_paths
                .iter()
                .map(|owned| owned.path().to_owned()),
        );
        Ok(TempTargetExportSnapshot {
            session_id: session.id.clone(),
            target_side: session.target_side,
            working_path: session.working_path.clone(),
            source,
            target,
            owned_temp_paths,
        })
    }

    fn reserve_temp_target_export(
        &mut self,
        snapshot: TempTargetExportSnapshot,
        destination: ExportDestinationBinding,
    ) -> Result<PreparedTempTargetExport, String> {
        if self.temp_merge_discarding.is_some() || self.pending_temp_target_discard.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        if self.temp_merge_operation_is_busy() {
            return Err("temporary merge target is busy".to_owned());
        }
        let session_matches = self
            .temp_merge_session
            .as_ref()
            .is_some_and(|session| session.id == snapshot.session_id);
        let source_matches = archive(self, snapshot.target_side.opposite())
            .is_some_and(|source| same_archive_snapshot(source, &snapshot.source));
        let target_matches = archive(self, snapshot.target_side)
            .is_some_and(|target| same_archive_snapshot(target, &snapshot.target));
        if !session_matches || !source_matches || !target_matches {
            return Err("temporary merge session changed while export was prepared".to_owned());
        }
        let reservation = self.reserve_temp_merge_operation(snapshot.target_side);
        self.temp_merge_exporting = Some(reservation);
        Ok(PreparedTempTargetExport {
            snapshot,
            reservation,
            destination,
            artifacts: ExportArtifactOwnership::new(),
        })
    }

    fn cancel_temp_target_export(&mut self, prepared: &PreparedTempTargetExport) {
        if self.temp_merge_exporting != Some(prepared.reservation) {
            return;
        }
        self.temp_merge_exporting = None;
    }

    fn install_temp_target_export_recovery(
        &mut self,
        recovery: PendingTempTargetExportRecovery,
    ) -> Result<(), Box<PendingTempTargetExportRecovery>> {
        if self.pending_temp_target_export_recovery.is_some() {
            return Err(Box::new(recovery));
        }
        self.pending_temp_target_export_recovery = Some(recovery);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn temp_target_export_recovery_is_pending(&self) -> bool {
        self.pending_temp_target_export_recovery.is_some()
    }

    fn temp_target_export_reservation_matches(&self, prepared: &PreparedTempTargetExport) -> bool {
        self.temp_merge_exporting == Some(prepared.reservation)
            && self
                .temp_merge_session
                .as_ref()
                .is_some_and(|session| session.id == prepared.snapshot.session_id)
    }

    fn finish_temp_target_export(
        &mut self,
        prepared: &PreparedTempTargetExport,
    ) -> Result<TempMergeSessionSummary, String> {
        if !self.temp_target_export_reservation_matches(prepared) {
            return Err("temporary merge export reservation changed".to_owned());
        }
        let session = self
            .temp_merge_session
            .as_ref()
            .filter(|session| session.id == prepared.snapshot.session_id)
            .ok_or_else(|| "temporary merge export session changed".to_owned())?;
        let target = archive(self, prepared.snapshot.target_side)
            .ok_or_else(|| "temporary merge target archive changed".to_owned())?;
        let mut summary = session.summary(target);
        summary.exported_path = Some(prepared.destination.path.display().to_string());
        let session = self
            .temp_merge_session
            .as_mut()
            .filter(|session| session.id == prepared.snapshot.session_id)
            .ok_or_else(|| "temporary merge export session changed".to_owned())?;
        session.exported_path = Some(prepared.destination.path.clone());
        self.temp_merge_exporting = None;
        Ok(summary)
    }

    fn detach_temp_target(
        &mut self,
        replacement_nested: Arc<Mutex<NestedArchiveCache>>,
    ) -> Result<DetachedTempTarget, (String, Arc<Mutex<NestedArchiveCache>>)> {
        if self.temp_merge_operation_is_busy() {
            return Err((
                "temporary merge target is busy".to_owned(),
                replacement_nested,
            ));
        }
        let Some(target_side) = self
            .temp_merge_session
            .as_ref()
            .map(|session| session.target_side)
        else {
            return Err((
                "temporary merge session is not active".to_owned(),
                replacement_nested,
            ));
        };
        if archive(self, target_side).is_none() {
            return Err((
                "temporary merge target archive is not loaded".to_owned(),
                replacement_nested,
            ));
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

    fn restore_detached_temp_target(
        &mut self,
        detached: DetachedTempTarget,
    ) -> Arc<Mutex<NestedArchiveCache>> {
        debug_assert_eq!(self.temp_merge_discarding, Some(detached.target_side));
        debug_assert!(archive(self, detached.target_side).is_none());
        debug_assert!(self.plan(detached.target_side).is_empty());
        debug_assert!(self.temp_merge_session.is_none());

        *archive_mut(self, detached.target_side) = Some(detached.archive);
        let displaced = std::mem::replace(
            nested_cache_mut(self, detached.target_side),
            detached.nested,
        );
        *self.plan_mut(detached.target_side) = detached.plan;
        self.temp_merge_session = Some(detached.session);
        self.temp_merge_discarding = None;
        displaced
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

    fn active_temp_merge_archives(
        &self,
        source_side: Side,
    ) -> Result<(Side, Archive, Archive), String> {
        if self.temp_merge_discarding.is_some() || self.pending_temp_target_discard.is_some() {
            return Err("temporary merge target is being discarded".to_owned());
        }
        if self.temp_merge_operation_is_busy() {
            return Err("temporary merge target is busy".to_owned());
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

    fn begin_temp_merge_preview(
        &mut self,
        source_side: Side,
    ) -> Result<TempMergeArchiveSnapshot, String> {
        self.invalidate_temp_merge_review();
        let (target_side, source, target) = self.active_temp_merge_archives(source_side)?;
        let session_id = self
            .temp_merge_session
            .as_ref()
            .expect("active temporary merge session checked above")
            .id
            .clone();
        Ok(TempMergeArchiveSnapshot {
            session_id,
            source_side,
            target_side,
            source,
            target,
        })
    }

    fn finish_temp_merge_preview(
        &mut self,
        snapshot: TempMergeArchiveSnapshot,
        preview: TempMergeConflictPreview,
    ) -> Result<TempMergeConflictPreview, String> {
        let session_id_matches = self
            .temp_merge_session
            .as_ref()
            .is_some_and(|session| session.id == snapshot.session_id);
        let (target_side, source, target) =
            self.active_temp_merge_archives(snapshot.source_side)?;
        if !session_id_matches
            || target_side != snapshot.target_side
            || !same_archive_snapshot(&source, &snapshot.source)
            || !same_archive_snapshot(&target, &snapshot.target)
        {
            self.invalidate_temp_merge_review();
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        self.temp_merge_session
            .as_mut()
            .expect("active temporary merge session checked above")
            .review = Some(TempMergeReview {
            source_side: snapshot.source_side,
            source: snapshot.source,
            target: snapshot.target,
            preview: preview.clone(),
        });
        Ok(preview)
    }

    fn begin_temp_merge_stage(
        &mut self,
        source_side: Side,
    ) -> Result<TempMergeStageSnapshot, String> {
        if self.temp_merge_staging.is_some() {
            return Err("temporary merge staging is already active".to_owned());
        }
        let (target_side, source, target) = self.active_temp_merge_archives(source_side)?;
        let (session_id, review) = {
            let session = self
                .temp_merge_session
                .as_mut()
                .expect("active temporary merge session checked above");
            (
                session.id.clone(),
                session
                    .review
                    .take()
                    .ok_or_else(|| "preview temporary merge conflicts before staging".to_owned())?,
            )
        };
        if review.source_side != source_side
            || !same_archive_snapshot(&review.source, &source)
            || !same_archive_snapshot(&review.target, &target)
        {
            self.invalidate_temp_merge_review();
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        let reservation = self.reserve_temp_merge_operation(target_side);
        self.temp_merge_staging = Some(reservation);
        Ok(TempMergeStageSnapshot {
            session_id,
            reservation,
            source,
            target,
            review,
        })
    }

    fn restore_temp_merge_stage(&mut self, snapshot: &TempMergeStageSnapshot) {
        if self.temp_merge_staging != Some(snapshot.reservation) {
            return;
        }
        if let Some(session) = self
            .temp_merge_session
            .as_mut()
            .filter(|session| session.id == snapshot.session_id)
            && session.review.is_none()
        {
            session.review = Some(snapshot.review.clone());
        }
        self.temp_merge_staging = None;
    }

    fn finish_temp_merge_stage(
        &mut self,
        snapshot: &TempMergeStageSnapshot,
        staged_paths: Vec<String>,
    ) -> Result<(), String> {
        if self.temp_merge_staging != Some(snapshot.reservation) {
            return Err("temporary merge staging reservation changed".to_owned());
        }
        let session_id_matches = self
            .temp_merge_session
            .as_ref()
            .is_some_and(|session| session.id == snapshot.session_id);
        let target_side = snapshot.reservation.target_side;
        let source = archive(self, snapshot.review.source_side)
            .ok_or("source archive is not loaded")?
            .clone();
        let target = archive(self, target_side)
            .ok_or("temporary merge target archive is not loaded")?
            .clone();
        if !session_id_matches
            || !same_archive_snapshot(&source, &snapshot.source)
            || !same_archive_snapshot(&target, &snapshot.target)
        {
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        for entry_path in staged_paths {
            self.plan_mut(target_side)
                .stage_copy(&snapshot.review.source, &entry_path, &entry_path)
                .expect("bulk staging paths were validated before mutating the merge plan");
        }
        self.temp_merge_staging = None;
        Ok(())
    }

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

    #[cfg(test)]
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

    #[cfg(test)]
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

    #[cfg(test)]
    pub(crate) fn stage_temp_merge_all(
        &mut self,
        source_side: Side,
        decisions: Vec<TempMergeDecision>,
    ) -> Result<(), String> {
        self.stage_temp_merge_all_with_pre_final_check(source_side, decisions, || {})
    }

    #[cfg(test)]
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
        let temporary_target_side = self
            .temp_merge_session
            .as_ref()
            .map(|session| session.target_side)
            .or(self.temp_merge_discarding)
            .or_else(|| {
                self.pending_temp_target_discard
                    .as_ref()
                    .map(|pending| pending.target_side)
            });
        if temporary_target_side == Some(target_side) {
            return Err(
                "Apply temporary merge changes instead of committing the temporary target"
                    .to_owned(),
            );
        }
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

    pub(crate) fn clear_staged(&mut self) -> Result<(), String> {
        self.ensure_plan_mutation_allowed(Side::Left)?;
        self.ensure_plan_mutation_allowed(Side::Right)?;
        self.plan_mut(Side::Left).clear();
        self.plan_mut(Side::Right).clear();
        for source in self.view_sources.values_mut() {
            source.plan.clear();
        }
        Ok(())
    }

    pub(crate) fn unstage(&mut self, entry_path: &str, side: Option<Side>) -> Result<(), String> {
        let sides: &[Side] = match side {
            Some(Side::Left) => &[Side::Left],
            Some(Side::Right) => &[Side::Right],
            None => &[Side::Left, Side::Right],
        };
        for &side in sides {
            self.ensure_plan_mutation_allowed(side)?;
        }
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
        #[cfg(test)]
        drop_probe: None,
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

pub(crate) fn install_prepared_temp_target(
    shared_state: &SharedState,
    prepared: PreparedTempTarget,
) -> Result<TempMergeSessionSummary, String> {
    let result = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.install_prepared_temp_target(prepared)
    };
    match result {
        Ok((summary, displaced)) => {
            drop(displaced);
            Ok(summary)
        }
        Err((error, prepared)) => {
            drop(prepared);
            Err(error)
        }
    }
}

#[cfg(test)]
pub(crate) fn set_prepared_temp_target_drop_probe(
    prepared: &mut PreparedTempTarget,
    state: SharedState,
    lock_available: Arc<AtomicBool>,
) {
    prepared.drop_probe = Some(PreparedTempTargetDropProbe {
        state,
        lock_available,
    });
}

pub(crate) fn create_temp_target(
    shared_state: &SharedState,
    source_side: Side,
    creation: TempTargetCreation,
) -> Result<TempMergeSessionSummary, String> {
    let prepared = prepare_temp_target(shared_state, source_side, creation)?;
    install_prepared_temp_target(shared_state, prepared)
}

fn recover_state_lock(shared_state: &SharedState) -> std::sync::MutexGuard<'_, AppState> {
    match shared_state.lock() {
        Ok(state) => state,
        Err(poisoned) => {
            let state = poisoned.into_inner();
            shared_state.clear_poison();
            state
        }
    }
}

fn files_have_same_bytes(left: &Path, right: &Path) -> io::Result<bool> {
    let mut left = File::open(left)?;
    let mut right = File::open(right)?;
    if left.metadata()?.len() != right.metadata()?.len() {
        return Ok(false);
    }
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_read = left.read(&mut left_buffer)?;
        let right_read = right.read(&mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn export_archive_for_transaction(source: &Path, destination: &Path) -> Result<(), String> {
    export_archive_atomic(source, destination).map_err(|error| error.to_string())
}

fn recover_pending_temp_merge_apply(shared_state: &SharedState) -> Result<(), String> {
    let Some(pending) = ({
        let mut state = recover_state_lock(shared_state);
        let pending = state.pending_temp_merge_apply_recovery.take();
        if state.temp_merge_applying.is_none() {
            state.temp_merge_applying = pending.as_ref().map(|pending| pending.reservation);
        }
        pending
    }) else {
        return Ok(());
    };
    let restore_result =
        export_archive_for_transaction(&pending.backup_path, &pending.session.working_path);
    let restored_target =
        match files_have_same_bytes(&pending.backup_path, &pending.session.working_path) {
            Ok(true) => Archive::open(pending.session.working_path.to_string_lossy())
                .map_err(|error| error.to_string()),
            Ok(false) => Err(restore_result
                .err()
                .unwrap_or_else(|| "restored bytes do not match durable backup".to_owned())),
            Err(error) => Err(format!(
                "failed to verify restored temporary target: {error}"
            )),
        };
    let restored_target = match restored_target {
        Ok(target) => target,
        Err(error) => {
            let mut state = recover_state_lock(shared_state);
            if state.pending_temp_merge_apply_recovery.is_none() {
                state.pending_temp_merge_apply_recovery = Some(pending);
            }
            return Err(format!(
                "temporary merge Apply recovery is still pending: {error}; retry Apply"
            ));
        }
    };

    let target_side = pending.reservation.target_side;
    let mut state = recover_state_lock(shared_state);
    if state.temp_merge_applying.is_none() {
        state.temp_merge_applying = Some(pending.reservation);
    }
    if state.temp_merge_applying != Some(pending.reservation)
        || state.temp_merge_session.is_some()
        || archive(&state, target_side).is_some()
    {
        if state.pending_temp_merge_apply_recovery.is_none() {
            state.pending_temp_merge_apply_recovery = Some(pending);
        }
        return Err("temporary merge Apply recovery reservation changed".to_owned());
    }
    *archive_mut(&mut state, target_side) = Some(restored_target);
    let displaced_nested =
        std::mem::replace(nested_cache_mut(&mut state, target_side), pending.nested);
    *state.plan_mut(target_side) = pending.plan;
    state.temp_merge_session = Some(pending.session);
    state.temp_merge_applying = None;
    drop(state);
    drop(displaced_nested);
    drop(pending.operation_dir);
    Ok(())
}

fn fail_temp_merge_apply(
    shared_state: &SharedState,
    prepared: &PreparedTempMergeApply,
    backup_path: &Path,
    restore_working: bool,
    mut error: String,
    export: &mut impl FnMut(&Path, &Path) -> Result<(), String>,
    recovery_resources: &mut TempMergeApplyRecoveryResources,
) -> Result<TempMergeSessionSummary, String> {
    let mut restored_target = None;
    if restore_working {
        let restore_result = export(backup_path, &prepared.working_path);
        match files_have_same_bytes(backup_path, &prepared.working_path) {
            Ok(true) => match Archive::open(prepared.working_path.to_string_lossy()) {
                Ok(target) => restored_target = Some(target),
                Err(restore_error) => {
                    error = format!(
                        "{error}; restored prior bytes but failed to reopen temporary target: \
                         {restore_error}"
                    );
                }
            },
            Ok(false) => {
                let restore_error = restore_result
                    .err()
                    .unwrap_or_else(|| "restored bytes do not match durable backup".to_owned());
                error =
                    format!("{error}; failed to restore prior temporary target: {restore_error}");
            }
            Err(verify_error) => {
                let restore_error = restore_result
                    .err()
                    .map(|restore_error| format!("{restore_error}; "))
                    .unwrap_or_default();
                error = format!(
                    "{error}; failed to verify restored temporary target: \
                     {restore_error}{verify_error}"
                );
            }
        }
    }
    if restore_working && restored_target.is_none() {
        let install_result = {
            let mut state = recover_state_lock(shared_state);
            state.install_temp_merge_apply_recovery(
                prepared,
                backup_path.to_owned(),
                recovery_resources,
            )
        };
        return match install_result {
            Ok(stale_target) => {
                drop(stale_target);
                Err(format!(
                    "{error}; temporary merge Apply recovery is pending; retry Apply"
                ))
            }
            Err(recovery_error) => Err(format!("{error}; {recovery_error}")),
        };
    }
    let cancel_result = {
        let mut state = recover_state_lock(shared_state);
        state.cancel_temp_merge_apply(prepared, &mut restored_target)
    };
    let displaced = match cancel_result {
        Ok(displaced) => displaced,
        Err(cancel_error) => {
            error = format!("{error}; {cancel_error}");
            None
        }
    };
    drop(restored_target);
    drop(displaced);
    Err(error)
}

fn apply_temp_merge_with_operations(
    shared_state: &SharedState,
    mut export: impl FnMut(&Path, &Path) -> Result<(), String>,
    after_reserve: impl FnOnce(&SharedState) -> Result<(), String>,
    reopen_after_commit: impl FnOnce(&Path) -> Result<Archive, String>,
    create_cache: impl FnOnce() -> Result<Arc<Mutex<NestedArchiveCache>>, String>,
    before_publish: impl FnOnce() -> Result<(), String>,
) -> Result<TempMergeSessionSummary, String> {
    recover_pending_temp_merge_apply(shared_state)?;
    let mut prepared = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.begin_temp_merge_apply()?
    };
    let operation_dir = match tempfile::Builder::new()
        .prefix("lcdiff-temp-merge-apply-")
        .tempdir()
        .map_err(|error| error.to_string())
    {
        Ok(operation_dir) => Some(operation_dir),
        Err(error) => {
            let mut no_recovery_resources = TempMergeApplyRecoveryResources {
                operation_dir: None,
                replacement_nested: None,
            };
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &prepared.working_path,
                false,
                error,
                &mut export,
                &mut no_recovery_resources,
            );
        }
    };
    let backup_path = operation_dir
        .as_ref()
        .expect("operation directory created above")
        .path()
        .join("working-before-apply.jar");
    let candidate_path = operation_dir
        .as_ref()
        .expect("operation directory created above")
        .path()
        .join("working-candidate.jar");
    let mut recovery_resources = TempMergeApplyRecoveryResources {
        operation_dir,
        replacement_nested: None,
    };
    if let Err(error) = after_reserve(shared_state) {
        return fail_temp_merge_apply(
            shared_state,
            &prepared,
            &backup_path,
            false,
            error,
            &mut export,
            &mut recovery_resources,
        );
    }
    for destination in [&backup_path, &candidate_path] {
        if let Err(error) = export(&prepared.working_path, destination) {
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                false,
                error,
                &mut export,
                &mut recovery_resources,
            );
        }
    }
    let candidate = match Archive::open(candidate_path.to_string_lossy()) {
        Ok(candidate) => candidate,
        Err(error) => {
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                false,
                error.to_string(),
                &mut export,
                &mut recovery_resources,
            );
        }
    };
    if let Err(error) = prepared
        .plan
        .commit(&candidate, CommitOptions { backup: false })
        .map_err(|error| error.to_string())
    {
        return fail_temp_merge_apply(
            shared_state,
            &prepared,
            &backup_path,
            false,
            error,
            &mut export,
            &mut recovery_resources,
        );
    }
    if let Err(error) = reopen_after_commit(&candidate_path) {
        return fail_temp_merge_apply(
            shared_state,
            &prepared,
            &backup_path,
            false,
            error,
            &mut export,
            &mut recovery_resources,
        );
    }
    let refreshed_nested = match create_cache() {
        Ok(cache) => cache,
        Err(error) => {
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                false,
                error,
                &mut export,
                &mut recovery_resources,
            );
        }
    };
    recovery_resources.replacement_nested = Some(refreshed_nested);
    {
        let state = recover_state_lock(shared_state);
        if !state.temp_merge_apply_reservation_matches(&prepared) {
            drop(state);
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                false,
                "temporary merge apply reservation changed".to_owned(),
                &mut export,
                &mut recovery_resources,
            );
        }
    }
    if let Err(error) = export(&candidate_path, &prepared.working_path) {
        return fail_temp_merge_apply(
            shared_state,
            &prepared,
            &backup_path,
            true,
            error,
            &mut export,
            &mut recovery_resources,
        );
    }
    let refreshed_target = match Archive::open(prepared.working_path.to_string_lossy()) {
        Ok(target) => target,
        Err(error) => {
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                true,
                error.to_string(),
                &mut export,
                &mut recovery_resources,
            );
        }
    };
    if let Err(error) = before_publish() {
        return fail_temp_merge_apply(
            shared_state,
            &prepared,
            &backup_path,
            true,
            error,
            &mut export,
            &mut recovery_resources,
        );
    }
    let mut refreshed_target = Some(refreshed_target);
    let publish_result = {
        let mut state = recover_state_lock(shared_state);
        state.finish_temp_merge_apply(
            &prepared,
            &mut refreshed_target,
            &mut recovery_resources.replacement_nested,
        )
    };
    let (summary, displaced_target, displaced_nested) = match publish_result {
        Ok(published) => published,
        Err(error) => {
            drop(refreshed_target);
            return fail_temp_merge_apply(
                shared_state,
                &prepared,
                &backup_path,
                true,
                error,
                &mut export,
                &mut recovery_resources,
            );
        }
    };
    drop(displaced_target);
    drop(displaced_nested);
    Ok(summary)
}

pub(crate) fn apply_temp_merge(
    shared_state: &SharedState,
) -> Result<TempMergeSessionSummary, String> {
    apply_temp_merge_with_operations(
        shared_state,
        export_archive_for_transaction,
        |_| Ok(()),
        |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
        fresh_nested_cache,
        || Ok(()),
    )
}

#[cfg(test)]
pub(crate) fn apply_temp_merge_with_failure_point(
    shared_state: &SharedState,
    failure_point: TempMergeApplyFailurePoint,
) -> Result<TempMergeSessionSummary, String> {
    match failure_point {
        TempMergeApplyFailurePoint::Reopen => apply_temp_merge_with_operations(
            shared_state,
            export_archive_for_transaction,
            |_| Ok(()),
            |_| Err("injected post-commit reopen failure".to_owned()),
            fresh_nested_cache,
            || Ok(()),
        ),
        TempMergeApplyFailurePoint::Cache => apply_temp_merge_with_operations(
            shared_state,
            export_archive_for_transaction,
            |_| Ok(()),
            |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
            || Err("injected post-commit cache failure".to_owned()),
            || Ok(()),
        ),
        TempMergeApplyFailurePoint::Publish => apply_temp_merge_with_operations(
            shared_state,
            export_archive_for_transaction,
            |_| Ok(()),
            |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
            fresh_nested_cache,
            || Err("injected post-commit publish failure".to_owned()),
        ),
        TempMergeApplyFailurePoint::WorkingExportPostReplace => {
            let working_path = recover_state_lock(shared_state)
                .temp_merge_session
                .as_ref()
                .expect("temporary merge session for failure injection")
                .working_path
                .clone();
            apply_temp_merge_with_operations(
                shared_state,
                move |source, destination| {
                    export_archive_for_transaction(source, destination)?;
                    if destination == working_path {
                        return Err(
                            "injected post-commit working export parent sync failure".to_owned()
                        );
                    }
                    Ok(())
                },
                |_| Ok(()),
                |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
                fresh_nested_cache,
                || Ok(()),
            )
        }
        TempMergeApplyFailurePoint::WorkingExportRollbackFailure => {
            let working_path = recover_state_lock(shared_state)
                .temp_merge_session
                .as_ref()
                .expect("temporary merge session for failure injection")
                .working_path
                .clone();
            let mut working_export_failed = false;
            apply_temp_merge_with_operations(
                shared_state,
                move |source, destination| {
                    if destination != working_path {
                        return export_archive_for_transaction(source, destination);
                    }
                    if working_export_failed {
                        return Err("injected working export rollback failure".to_owned());
                    }
                    working_export_failed = true;
                    export_archive_for_transaction(source, destination)?;
                    Err("injected post-commit working export failure".to_owned())
                },
                |_| Ok(()),
                |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
                fresh_nested_cache,
                || Ok(()),
            )
        }
    }
}

#[cfg(test)]
pub(crate) fn apply_temp_merge_with_plan_mutation(
    shared_state: &SharedState,
    mutation: TempMergePlanMutation,
) -> Result<TempMergeSessionSummary, String> {
    apply_temp_merge_with_operations(
        shared_state,
        export_archive_for_transaction,
        |_| Ok(()),
        |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
        fresh_nested_cache,
        || {
            let mut state = recover_state_lock(shared_state);
            match mutation {
                TempMergePlanMutation::Clear => state.clear_staged(),
                TempMergePlanMutation::Unstage => state.unstage("source.txt", Some(Side::Right)),
            }
        },
    )
}

#[cfg(test)]
pub(crate) fn apply_temp_merge_with_stale_reservation(
    shared_state: &SharedState,
) -> Result<TempMergeSessionSummary, String> {
    apply_temp_merge_with_operations(
        shared_state,
        export_archive_for_transaction,
        |state| {
            let mut state = recover_state_lock(state);
            let target_side = state
                .temp_merge_applying
                .expect("Apply reservation for failure injection")
                .target_side;
            let newer = state.reserve_temp_merge_operation(target_side);
            state.temp_merge_applying = Some(newer);
            Err("injected stale Apply cancellation".to_owned())
        },
        |path| Archive::open(path.to_string_lossy()).map_err(|error| error.to_string()),
        fresh_nested_cache,
        || Ok(()),
    )
}

static NEXT_EXPORT_ARTIFACT: AtomicU64 = AtomicU64::new(1);

fn next_export_artifact_name(prefix: &str) -> PathBuf {
    let token = NEXT_EXPORT_ARTIFACT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    PathBuf::from(format!("{prefix}{}-{token}", std::process::id()))
}

fn sync_capability_change(directory: &Dir, durable_files: &[&cap_std::fs::File]) -> io::Result<()> {
    if durable_files.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "capability durability requires an open file handle",
        ));
    }
    #[cfg(not(windows))]
    for file in durable_files {
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        directory.try_clone()?.into_std_file().sync_all()
    }
    #[cfg(windows)]
    {
        // `copy_into_capability_file` flushes newly-written bytes before the
        // MoveFileExW(MOVEFILE_WRITE_THROUGH) publication. Windows has no
        // documented directory-fsync equivalent, so do not keep an alias
        // handle merely to flush it after a delete/name reuse.
        let _ = (directory, durable_files);
        Ok(())
    }
    #[cfg(all(not(unix), not(windows)))]
    {
        let _ = directory;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "capability-relative durability is not implemented for this platform",
        ))
    }
}

fn sync_artifact_removals(directory: &Dir, durable_files: &[&cap_std::fs::File]) -> io::Result<()> {
    #[cfg(not(windows))]
    for file in durable_files {
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        directory.try_clone()?.into_std_file().sync_all()
    }
    #[cfg(windows)]
    {
        // File removal uses a short-lived DELETE handle. Do not retain an
        // old file handle across possible name reuse on Windows.
        let _ = (directory, durable_files);
        Ok(())
    }
    #[cfg(all(not(unix), not(windows)))]
    {
        let _ = directory;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "capability-relative cleanup durability is not implemented for this platform",
        ))
    }
}

#[cfg(windows)]
fn move_file_write_through(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    fn wide(path: &OsStr) -> Vec<u16> {
        path.encode_wide().chain(std::iter::once(0)).collect()
    }

    let source = wide(source.as_os_str());
    let destination = wide(destination.as_os_str());
    let mut flags = MOVEFILE_WRITE_THROUGH;
    if replace {
        flags |= MOVEFILE_REPLACE_EXISTING;
    }
    let moved = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn remove_file_handle_posix(file: &cap_std::fs::File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO_EX, FileDispositionInfoEx,
        SetFileInformationByHandle,
    };

    let disposition = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
            | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };
    let removed = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle() as _,
            FileDispositionInfoEx,
            std::ptr::from_ref(&disposition).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    };
    if removed == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn remove_capability_file_matching_handle(
    directory: &Dir,
    path: &Path,
    expected: &cap_std::fs::File,
) -> io::Result<()> {
    use cap_std::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::DELETE;

    let mut options = OpenOptions::new();
    options.access_mode(DELETE);
    let delete_handle = directory.open_with(path, &options)?;
    let expected_identity = same_file::Handle::from_file(expected.try_clone()?.into_std())?;
    let delete_identity = same_file::Handle::from_file(delete_handle.try_clone()?.into_std())?;
    if expected_identity != delete_identity {
        return Err(io::Error::other(
            "capability path no longer names the owned file",
        ));
    }
    remove_file_handle_posix(&delete_handle)?;
    drop(delete_handle);
    Ok(())
}

fn sync_renamed_capability_file(
    directory: &Dir,
    renamed_file: &cap_std::fs::File,
) -> io::Result<()> {
    sync_capability_change(directory, &[renamed_file])
}

fn capability_files_have_same_bytes(
    directory: &Dir,
    left: &Path,
    right: &Path,
) -> io::Result<bool> {
    let mut left = directory.open(left)?;
    let mut right = directory.open(right)?;
    if left.metadata()?.len() != right.metadata()?.len() {
        return Ok(false);
    }
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_read = left.read(&mut left_buffer)?;
        let right_read = right.read(&mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn capability_files_have_same_identity(
    directory: &Dir,
    left: &Path,
    right: &Path,
) -> io::Result<bool> {
    let left = same_file::Handle::from_file(directory.open(left)?.into_std())?;
    let right = same_file::Handle::from_file(directory.open(right)?.into_std())?;
    Ok(left == right)
}

fn capability_file_has_same_bytes(
    directory: &Dir,
    left: &cap_std::fs::File,
    right: &Path,
) -> io::Result<bool> {
    let mut left = left.try_clone()?;
    left.seek(SeekFrom::Start(0))?;
    let mut right = directory.open(right)?;
    if left.metadata()?.len() != right.metadata()?.len() {
        return Ok(false);
    }
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_read = left.read(&mut left_buffer)?;
        let right_read = right.read(&mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn copy_into_capability_file(
    source: &mut impl Read,
    directory: &Dir,
    destination: &mut OwnedExportArtifact,
) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use cap_std::fs::OpenOptionsExt;
        use windows_sys::Win32::{Foundation::GENERIC_WRITE, Storage::FileSystem::DELETE};

        options.access_mode(DELETE | GENERIC_WRITE);
    }
    let mut destination_file = directory
        .open_with(&destination.name, &options)
        .map_err(|error| error.to_string())?;
    destination.state = OwnedExportArtifactState::Present;
    destination.durability_handle = Some(
        destination_file
            .try_clone()
            .map_err(|error| error.to_string())?,
    );
    io::copy(source, &mut destination_file).map_err(|error| error.to_string())?;
    destination_file
        .flush()
        .and_then(|()| destination_file.sync_all())
        .map_err(|error| error.to_string())
}

impl OwnedExportArtifact {
    fn new(prefix: &str) -> Self {
        Self {
            name: next_export_artifact_name(prefix),
            state: OwnedExportArtifactState::Reserved,
            durability_handle: None,
        }
    }

    fn is_owned(&self) -> bool {
        self.state != OwnedExportArtifactState::Reserved
    }

    fn ensure_durability_handle(
        &mut self,
        destination: &ExportDestinationBinding,
    ) -> Result<(), String> {
        if self.durability_handle.is_some() {
            return Ok(());
        }
        if self.state != OwnedExportArtifactState::Present {
            return Err("export artifact is not present for durability".to_owned());
        }
        let mut options = OpenOptions::new();
        #[cfg(unix)]
        options.read(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::{Foundation::GENERIC_READ, Storage::FileSystem::DELETE};

            options.access_mode(DELETE | GENERIC_READ);
        }
        #[cfg(all(not(unix), not(windows)))]
        options.read(true).write(true);
        self.durability_handle = Some(
            destination
                .parent
                .open_with(&self.name, &options)
                .map_err(|error| error.to_string())?,
        );
        Ok(())
    }

    fn remove_present(&mut self, destination: &ExportDestinationBinding) -> Result<(), String> {
        if self.state != OwnedExportArtifactState::Present {
            return Ok(());
        }
        self.ensure_durability_handle(destination)?;
        let handle = self
            .durability_handle
            .as_ref()
            .expect("ensured export artifact handle");
        if !destination
            .capability_path_names_file(&self.name, handle)
            .map_err(|error| error.to_string())?
        {
            self.state = OwnedExportArtifactState::Reserved;
            self.durability_handle = None;
            return Ok(());
        }
        #[cfg(unix)]
        destination
            .parent
            .remove_file(&self.name)
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        remove_capability_file_matching_handle(&destination.parent, &self.name, handle)
            .map_err(|error| error.to_string())?;
        #[cfg(all(not(unix), not(windows)))]
        return Err(
            "capability-relative artifact removal is not implemented for this platform".to_owned(),
        );
        self.state = OwnedExportArtifactState::RemovedNeedsSync;
        Ok(())
    }

    fn disarm_removed(&mut self) {
        if self.state == OwnedExportArtifactState::RemovedNeedsSync {
            self.state = OwnedExportArtifactState::Reserved;
            self.durability_handle = None;
        }
    }

    fn retain_removed(&mut self) {
        if self.state == OwnedExportArtifactState::RemovedNeedsSync {
            self.state = OwnedExportArtifactState::RemovedRetained;
        }
    }

    fn is_retained_after_removal(&self) -> bool {
        self.state == OwnedExportArtifactState::RemovedRetained
    }

    fn release_retained(&mut self) {
        if self.is_retained_after_removal() {
            self.state = OwnedExportArtifactState::Reserved;
            self.durability_handle = None;
        }
    }

    fn reader(&self, destination: &ExportDestinationBinding) -> Result<cap_std::fs::File, String> {
        let mut file = match self.state {
            OwnedExportArtifactState::RemovedRetained => self
                .durability_handle
                .as_ref()
                .ok_or_else(|| "retained export artifact handle is unavailable".to_owned())?
                .try_clone()
                .map_err(|error| error.to_string()),
            OwnedExportArtifactState::Present => destination
                .parent
                .open(&self.name)
                .map_err(|error| error.to_string()),
            OwnedExportArtifactState::Reserved | OwnedExportArtifactState::RemovedNeedsSync => {
                Err("export artifact backup is unavailable".to_owned())
            }
        }?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        Ok(file)
    }
}

impl ExportArtifactOwnership {
    fn new() -> Self {
        Self {
            backup: OwnedExportArtifact::new(".lcdiff-save-as-rollback-"),
            write: OwnedExportArtifact::new(".lcdiff-save-as-write-"),
            published: None,
        }
    }

    fn cleanup(&mut self, destination: &ExportDestinationBinding) -> Result<(), String> {
        if !self.backup.is_owned() && !self.write.is_owned() {
            return Ok(());
        }
        let retain_backup = self.published.is_some();
        self.remove_present(destination)?;
        self.sync_removed(destination)?;
        if retain_backup {
            self.backup.retain_removed();
        } else {
            self.backup.disarm_removed();
            self.backup.release_retained();
        }
        self.write.disarm_removed();
        Ok(())
    }

    #[cfg(test)]
    fn cleanup_with(
        &mut self,
        destination: &ExportDestinationBinding,
        sync_directory: impl FnOnce(&Dir) -> io::Result<()>,
    ) -> Result<(), String> {
        if !self.backup.is_owned() && !self.write.is_owned() {
            return Ok(());
        }
        let retain_backup = self.published.is_some();
        self.remove_present(destination)?;
        sync_directory(&destination.parent).map_err(|error| error.to_string())?;
        if retain_backup {
            self.backup.retain_removed();
        } else {
            self.backup.disarm_removed();
            self.backup.release_retained();
        }
        self.write.disarm_removed();
        Ok(())
    }

    fn cleanup_write(&mut self, destination: &ExportDestinationBinding) -> Result<(), String> {
        if !self.write.is_owned() {
            return Ok(());
        }
        self.write.remove_present(destination)?;
        let handles = self
            .write
            .durability_handle
            .as_ref()
            .into_iter()
            .collect::<Vec<_>>();
        sync_artifact_removals(&destination.parent, &handles).map_err(|error| error.to_string())?;
        self.write.disarm_removed();
        Ok(())
    }

    fn remove_present(&mut self, destination: &ExportDestinationBinding) -> Result<(), String> {
        self.backup.remove_present(destination)?;
        self.write.remove_present(destination)
    }

    fn sync_removed(&self, destination: &ExportDestinationBinding) -> Result<(), String> {
        let handles = [&self.backup, &self.write]
            .into_iter()
            .filter(|artifact| artifact.state == OwnedExportArtifactState::RemovedNeedsSync)
            .filter_map(|artifact| artifact.durability_handle.as_ref())
            .collect::<Vec<_>>();
        if self.backup.state != OwnedExportArtifactState::RemovedNeedsSync
            && self.write.state != OwnedExportArtifactState::RemovedNeedsSync
        {
            return Ok(());
        }
        sync_artifact_removals(&destination.parent, &handles).map_err(|error| error.to_string())
    }

    fn disarm_removed(&mut self) {
        self.backup.disarm_removed();
        self.write.disarm_removed();
    }

    fn remove_published_destination(
        &mut self,
        destination: &ExportDestinationBinding,
    ) -> Result<(), String> {
        let published = self
            .published
            .as_mut()
            .ok_or_else(|| "published export destination ownership is unavailable".to_owned())?;
        if published.state == PublishedExportDestinationState::Present {
            if !destination.destination_names_published_file(published)? {
                return Err(
                    "export destination changed outside LCDiff; automatic rollback refused"
                        .to_owned(),
                );
            }
            let _handle = published
                .handle
                .as_ref()
                .ok_or_else(|| "published destination handle is unavailable".to_owned())?;
            #[cfg(unix)]
            destination
                .parent
                .remove_file(&destination.file_name)
                .map_err(|error| error.to_string())?;
            #[cfg(windows)]
            remove_capability_file_matching_handle(
                &destination.parent,
                &destination.file_name,
                _handle,
            )
            .map_err(|error| error.to_string())?;
            #[cfg(all(not(unix), not(windows)))]
            return Err(
                "published destination rollback is not implemented for this platform".to_owned(),
            );
            published.state = PublishedExportDestinationState::RemovedNeedsSync;
        }
        if published.state == PublishedExportDestinationState::RemovedNeedsSync {
            let handle = published
                .handle
                .as_ref()
                .ok_or_else(|| "removed destination durability handle is unavailable".to_owned())?;
            sync_capability_change(&destination.parent, &[handle])
                .map_err(|error| error.to_string())?;
            published.handle = None;
            published.state = PublishedExportDestinationState::Removed;
        }
        Ok(())
    }

    fn finish_destination_restore(&mut self) {
        self.published = None;
    }

    fn finish_destination_publication(&mut self) -> Result<(), String> {
        let published = self
            .published
            .as_ref()
            .ok_or_else(|| "published export destination ownership is unavailable".to_owned())?;
        if published.state != PublishedExportDestinationState::Present {
            return Err("published export destination is not ready".to_owned());
        }
        self.published = None;
        self.backup.release_retained();
        Ok(())
    }

    fn retain_backup_on_disk_after_failed_shutdown_rollback(&mut self) {
        self.backup.state = OwnedExportArtifactState::Reserved;
        self.backup.durability_handle = None;
    }
}

impl Drop for PreparedTempTargetExport {
    fn drop(&mut self) {
        let _ = self.artifacts.cleanup(&self.destination);
    }
}

impl ExportDestinationBinding {
    fn export_from_ambient(
        &self,
        source: &Path,
        artifacts: &mut ExportArtifactOwnership,
    ) -> Result<(), String> {
        let mut source = File::open(source).map_err(|error| error.to_string())?;
        self.export_from_reader(&mut source, artifacts)
    }

    fn export_from_reader(
        &self,
        source: &mut impl Read,
        artifacts: &mut ExportArtifactOwnership,
    ) -> Result<(), String> {
        self.export_from_reader_with_durability(source, artifacts, sync_renamed_capability_file)
    }

    fn export_from_reader_with_durability(
        &self,
        source: &mut impl Read,
        artifacts: &mut ExportArtifactOwnership,
        sync_after_rename: impl FnOnce(&Dir, &cap_std::fs::File) -> io::Result<()>,
    ) -> Result<(), String> {
        if artifacts.published.is_some() {
            return Err("an exported destination is already owned by this transaction".to_owned());
        }
        artifacts.cleanup_write(self)?;
        if let Err(error) = copy_into_capability_file(source, &self.parent, &mut artifacts.write) {
            let cleanup_error = artifacts
                .cleanup_write(self)
                .err()
                .map(|cleanup| format!("; cleanup failed: {cleanup}"))
                .unwrap_or_default();
            return Err(format!("{error}{cleanup_error}"));
        }
        if let Err(error) = self.rename_artifact_to_destination(&artifacts.write.name, true) {
            let cleanup_error = artifacts
                .cleanup_write(self)
                .err()
                .map(|cleanup| format!("; cleanup failed: {cleanup}"))
                .unwrap_or_default();
            return Err(format!("{error}{cleanup_error}"));
        }
        artifacts.write.state = OwnedExportArtifactState::Reserved;
        let renamed_file = artifacts
            .write
            .durability_handle
            .take()
            .ok_or_else(|| "renamed file durability handle is unavailable".to_owned())?;
        artifacts.published = Some(PublishedExportDestination {
            handle: Some(renamed_file),
            state: PublishedExportDestinationState::Present,
        });
        let renamed_file = artifacts
            .published
            .as_ref()
            .and_then(|published| published.handle.as_ref())
            .expect("published destination retains the renamed handle");
        sync_after_rename(&self.parent, renamed_file).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn destination_exists(&self) -> Result<bool, String> {
        match self.parent.symlink_metadata(&self.file_name) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    }

    fn destination_identity(&self) -> Result<Option<same_file::Handle>, String> {
        match self.parent.open(&self.file_name) {
            Ok(file) => same_file::Handle::from_file(file.into_std())
                .map(Some)
                .map_err(|error| error.to_string()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn open_destination_for_durability(&self) -> Result<Option<cap_std::fs::File>, String> {
        let mut options = OpenOptions::new();
        #[cfg(unix)]
        options.read(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::{Foundation::GENERIC_READ, Storage::FileSystem::DELETE};

            options.access_mode(DELETE | GENERIC_READ);
        }
        #[cfg(all(not(unix), not(windows)))]
        options.read(true).write(true);
        match self.parent.open_with(&self.file_name, &options) {
            Ok(file) => Ok(Some(file)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn create_destination_for_restore(&self) -> Result<cap_std::fs::File, String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use cap_std::fs::OpenOptionsExt;
            use windows_sys::Win32::{Foundation::GENERIC_WRITE, Storage::FileSystem::DELETE};

            options.access_mode(DELETE | GENERIC_WRITE);
        }
        self.parent
            .open_with(&self.file_name, &options)
            .map_err(|error| error.to_string())
    }

    #[cfg(windows)]
    fn artifact_path(&self, name: &Path) -> Result<PathBuf, String> {
        self.path
            .parent()
            .map(|parent| parent.join(name))
            .ok_or_else(|| "temporary merge export destination has no parent".to_owned())
    }

    fn ambient_parent_matches(&self) -> Result<bool, String> {
        let parent_path = self
            .path
            .parent()
            .ok_or_else(|| "temporary merge export destination has no parent".to_owned())?;
        let ambient_parent = match same_file::Handle::from_path(parent_path) {
            Ok(parent) => parent,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        Ok(ambient_parent == self.parent_identity)
    }

    fn capability_path_names_file(
        &self,
        name: &Path,
        expected: &cap_std::fs::File,
    ) -> io::Result<bool> {
        let current = match self.parent.open(name) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        let expected = same_file::Handle::from_file(expected.try_clone()?.into_std())
            .map_err(io::Error::other)?;
        let current = same_file::Handle::from_file(current.into_std()).map_err(io::Error::other)?;
        Ok(expected == current)
    }

    fn destination_names_published_file(
        &self,
        published: &PublishedExportDestination,
    ) -> Result<bool, String> {
        if published.state != PublishedExportDestinationState::Present {
            return Ok(false);
        }
        let handle = published
            .handle
            .as_ref()
            .ok_or_else(|| "published destination handle is unavailable".to_owned())?;
        self.capability_path_names_file(&self.file_name, handle)
            .map_err(|error| error.to_string())
    }

    fn ambient_path_names_published_file(
        &self,
        published: &PublishedExportDestination,
    ) -> Result<bool, String> {
        if !self.ambient_parent_matches()? || !self.destination_names_published_file(published)? {
            return Ok(false);
        }
        let handle = published
            .handle
            .as_ref()
            .ok_or_else(|| "published destination handle is unavailable".to_owned())?;
        let expected = same_file::Handle::from_file(
            handle
                .try_clone()
                .map_err(|error| error.to_string())?
                .into_std(),
        )
        .map_err(|error| error.to_string())?;
        let ambient = match same_file::Handle::from_path(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        Ok(expected == ambient)
    }

    fn rename_artifact_to_destination(&self, name: &Path, replace: bool) -> io::Result<()> {
        #[cfg(unix)]
        {
            if !replace && self.destination_exists().map_err(io::Error::other)? {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "export destination already exists",
                ));
            }
            self.parent.rename(name, &self.parent, &self.file_name)
        }
        #[cfg(windows)]
        {
            if !self.ambient_parent_matches().map_err(io::Error::other)? {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "export destination parent binding changed",
                ));
            }
            let source = self.artifact_path(name).map_err(io::Error::other)?;
            move_file_write_through(&source, &self.path, replace)
        }
        #[cfg(all(not(unix), not(windows)))]
        {
            let _ = (name, replace);
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "atomic export replacement is not implemented for this platform",
            ))
        }
    }
}

impl ExportDestinationSnapshot {
    fn prepare(destination: &ExportDestinationBinding) -> Result<Self, String> {
        match destination.destination_identity()? {
            None => Ok(Self::Missing),
            Some(expected_identity) => Ok(Self::Existing {
                expected_identity,
                preserves_identity: false,
            }),
        }
    }

    fn still_matches_prepared_destination(
        &self,
        destination: &ExportDestinationBinding,
    ) -> Result<bool, String> {
        if !destination.ambient_parent_matches()? {
            return Ok(false);
        }
        match self {
            Self::Missing => Ok(destination.destination_identity()?.is_none()),
            Self::Existing {
                expected_identity, ..
            } => Ok(destination
                .destination_identity()?
                .is_some_and(|current| current == *expected_identity)),
        }
    }

    fn capture(
        &mut self,
        destination: &ExportDestinationBinding,
        artifacts: &mut ExportArtifactOwnership,
    ) -> Result<(), String> {
        self.capture_with_durability(destination, artifacts, sync_renamed_capability_file)
    }

    fn capture_with_durability(
        &mut self,
        destination: &ExportDestinationBinding,
        artifacts: &mut ExportArtifactOwnership,
        sync_after_capture: impl FnOnce(&Dir, &cap_std::fs::File) -> io::Result<()>,
    ) -> Result<(), String> {
        if !self.still_matches_prepared_destination(destination)? {
            return Err(
                "temporary merge export destination parent changed or file changed before snapshot capture"
                    .to_owned(),
            );
        }
        let Self::Existing {
            expected_identity,
            preserves_identity,
        } = self
        else {
            return Ok(());
        };
        match destination.parent.hard_link(
            &destination.file_name,
            &destination.parent,
            &artifacts.backup.name,
        ) {
            Ok(()) => {
                artifacts.backup.state = OwnedExportArtifactState::Present;
                let backup_identity = destination
                    .parent
                    .open(&artifacts.backup.name)
                    .map_err(|error| error.to_string())
                    .and_then(|backup| {
                        same_file::Handle::from_file(backup.into_std())
                            .map_err(|error| error.to_string())
                    })?;
                if backup_identity != *expected_identity {
                    return Err(
                        "temporary merge export destination changed while snapshotting".to_owned(),
                    );
                }
                if artifacts
                    .backup
                    .ensure_durability_handle(destination)
                    .is_ok()
                {
                    *preserves_identity = true;
                } else {
                    artifacts.backup.remove_present(destination)?;
                    artifacts.sync_removed(destination)?;
                    artifacts.disarm_removed();
                    let mut original = destination
                        .parent
                        .open(&destination.file_name)
                        .map_err(|error| error.to_string())?;
                    let original_identity = same_file::Handle::from_file(
                        original
                            .try_clone()
                            .map_err(|error| error.to_string())?
                            .into_std(),
                    )
                    .map_err(|error| error.to_string())?;
                    if original_identity != *expected_identity {
                        return Err(
                            "temporary merge export destination changed while snapshotting"
                                .to_owned(),
                        );
                    }
                    copy_into_capability_file(
                        &mut original,
                        &destination.parent,
                        &mut artifacts.backup,
                    )?;
                    *preserves_identity = false;
                }
            }
            Err(_) => {
                let mut original = destination
                    .parent
                    .open(&destination.file_name)
                    .map_err(|error| error.to_string())?;
                let original_identity = same_file::Handle::from_file(
                    original
                        .try_clone()
                        .map_err(|error| error.to_string())?
                        .into_std(),
                )
                .map_err(|error| error.to_string())?;
                if original_identity != *expected_identity {
                    return Err(
                        "temporary merge export destination changed while snapshotting".to_owned(),
                    );
                }
                copy_into_capability_file(
                    &mut original,
                    &destination.parent,
                    &mut artifacts.backup,
                )?;
                *preserves_identity = false;
            }
        }
        artifacts.backup.ensure_durability_handle(destination)?;
        let backup_file = artifacts
            .backup
            .durability_handle
            .as_ref()
            .expect("armed backup has a durability handle");
        sync_after_capture(&destination.parent, backup_file).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn restore(
        &self,
        destination: &ExportDestinationBinding,
        artifacts: &mut ExportArtifactOwnership,
    ) -> Result<(), String> {
        artifacts.remove_published_destination(destination)?;
        match self {
            Self::Missing => {
                if destination.destination_exists()? {
                    return Err(
                        "export destination changed outside LCDiff after rollback removal; \
                         automatic rollback refused"
                            .to_owned(),
                    );
                }
                artifacts.finish_destination_restore();
            }
            Self::Existing {
                preserves_identity, ..
            } => {
                let backup_is_retained = artifacts.backup.is_retained_after_removal();
                let preserves_identity = *preserves_identity && !backup_is_retained;
                let destination_exists = destination.destination_exists()?;
                let published_state = artifacts
                    .published
                    .as_ref()
                    .map(|published| published.state)
                    .ok_or_else(|| {
                        "published export destination ownership is unavailable".to_owned()
                    })?;
                if destination_exists {
                    match published_state {
                        PublishedExportDestinationState::Restoring => {
                            let handle = artifacts
                                .published
                                .as_ref()
                                .and_then(|published| published.handle.as_ref())
                                .ok_or_else(|| {
                                    "restoring destination handle is unavailable".to_owned()
                                })?;
                            if !destination
                                .capability_path_names_file(&destination.file_name, handle)
                                .map_err(|error| error.to_string())?
                            {
                                return Err(
                                    "export destination changed outside LCDiff during rollback; \
                                     automatic rollback refused"
                                        .to_owned(),
                                );
                            }
                        }
                        PublishedExportDestinationState::Removed => {
                            if backup_is_retained
                                || !capability_files_have_same_identity(
                                    &destination.parent,
                                    &artifacts.backup.name,
                                    &destination.file_name,
                                )
                                .map_err(|error| error.to_string())?
                            {
                                return Err(
                                    "export destination was recreated outside LCDiff during \
                                     rollback; automatic rollback refused"
                                        .to_owned(),
                                );
                            }
                            let restored =
                                destination.open_destination_for_durability()?.ok_or_else(
                                    || "restored export destination is unavailable".to_owned(),
                                )?;
                            let published = artifacts
                                .published
                                .as_mut()
                                .expect("removed destination ownership remains present");
                            published.handle = Some(restored);
                            published.state = PublishedExportDestinationState::Restoring;
                        }
                        PublishedExportDestinationState::Present
                        | PublishedExportDestinationState::RemovedNeedsSync => {
                            return Err(
                                "published destination removal did not complete before restore"
                                    .to_owned(),
                            );
                        }
                    }
                } else {
                    #[cfg(windows)]
                    {
                        artifacts.cleanup_write(destination)?;
                        if backup_is_retained {
                            let mut backup = artifacts.backup.reader(destination)?;
                            copy_into_capability_file(
                                &mut backup,
                                &destination.parent,
                                &mut artifacts.write,
                            )?;
                        } else {
                            match destination.parent.hard_link(
                                &artifacts.backup.name,
                                &destination.parent,
                                &artifacts.write.name,
                            ) {
                                Ok(()) => {
                                    artifacts.write.state = OwnedExportArtifactState::Present;
                                    artifacts.write.ensure_durability_handle(destination)?;
                                }
                                Err(_) => {
                                    let mut backup = artifacts.backup.reader(destination)?;
                                    copy_into_capability_file(
                                        &mut backup,
                                        &destination.parent,
                                        &mut artifacts.write,
                                    )?;
                                }
                            }
                        }
                        let restored =
                            artifacts.write.durability_handle.as_ref().ok_or_else(|| {
                                "restoring destination durability handle is unavailable".to_owned()
                            })?;
                        sync_capability_change(&destination.parent, &[restored])
                            .map_err(|error| error.to_string())?;
                        destination
                            .rename_artifact_to_destination(&artifacts.write.name, false)
                            .map_err(|error| error.to_string())?;
                        artifacts.write.state = OwnedExportArtifactState::Reserved;
                        let restored =
                            artifacts.write.durability_handle.take().ok_or_else(|| {
                                "restoring destination durability handle is unavailable".to_owned()
                            })?;
                        let published = artifacts
                            .published
                            .as_mut()
                            .expect("removed destination ownership remains present");
                        published.handle = Some(restored);
                        published.state = PublishedExportDestinationState::Restoring;
                    }
                    #[cfg(not(windows))]
                    {
                        if !backup_is_retained {
                            let _ = destination.parent.hard_link(
                                &artifacts.backup.name,
                                &destination.parent,
                                &destination.file_name,
                            );
                        }
                        let restored = match destination.open_destination_for_durability()? {
                            Some(restored) => restored,
                            None => destination.create_destination_for_restore()?,
                        };
                        let published = artifacts
                            .published
                            .as_mut()
                            .expect("removed destination ownership remains present");
                        published.handle = Some(restored);
                        published.state = PublishedExportDestinationState::Restoring;
                    }
                }
                let already_restored = if backup_is_retained {
                    let backup = artifacts.backup.reader(destination)?;
                    capability_file_has_same_bytes(
                        &destination.parent,
                        &backup,
                        &destination.file_name,
                    )
                } else {
                    capability_files_have_same_bytes(
                        &destination.parent,
                        &artifacts.backup.name,
                        &destination.file_name,
                    )
                }
                .map_err(|error| error.to_string())?;
                if !already_restored {
                    if preserves_identity {
                        return Err("identity-preserving export rollback bytes changed".to_owned());
                    }
                    let mut backup = artifacts.backup.reader(destination)?;
                    let restored = artifacts
                        .published
                        .as_mut()
                        .and_then(|published| published.handle.as_mut())
                        .ok_or_else(|| "restoring destination handle is unavailable".to_owned())?;
                    restored.set_len(0).map_err(|error| error.to_string())?;
                    restored
                        .seek(SeekFrom::Start(0))
                        .map_err(|error| error.to_string())?;
                    io::copy(&mut backup, restored).map_err(|error| error.to_string())?;
                    restored.flush().map_err(|error| error.to_string())?;
                }
                let restored = artifacts
                    .published
                    .as_ref()
                    .and_then(|published| published.handle.as_ref())
                    .ok_or_else(|| "restoring destination handle is unavailable".to_owned())?;
                sync_capability_change(&destination.parent, &[restored])
                    .map_err(|error| error.to_string())?;
                let restored_bytes_match = if backup_is_retained {
                    let backup = artifacts.backup.reader(destination)?;
                    capability_file_has_same_bytes(
                        &destination.parent,
                        &backup,
                        &destination.file_name,
                    )
                } else {
                    capability_files_have_same_bytes(
                        &destination.parent,
                        &artifacts.backup.name,
                        &destination.file_name,
                    )
                }
                .map_err(|error| error.to_string())?;
                if !restored_bytes_match {
                    return Err("restored export destination bytes changed".to_owned());
                }
                if preserves_identity
                    && !capability_files_have_same_identity(
                        &destination.parent,
                        &artifacts.backup.name,
                        &destination.file_name,
                    )
                    .map_err(|error| error.to_string())?
                {
                    return Err("restored export destination identity changed".to_owned());
                }
                artifacts.finish_destination_restore();
            }
        }
        Ok(())
    }

    fn cleanup(
        &self,
        destination: &ExportDestinationBinding,
        artifacts: &mut ExportArtifactOwnership,
    ) -> Result<(), String> {
        artifacts.cleanup(destination)
    }

    #[cfg(test)]
    fn cleanup_with(
        &self,
        destination: &ExportDestinationBinding,
        artifacts: &mut ExportArtifactOwnership,
        sync_directory: impl FnOnce(&Dir) -> io::Result<()>,
    ) -> Result<(), String> {
        artifacts.cleanup_with(destination, sync_directory)
    }
}

fn resolve_temp_target_export_destination(
    destination: &Path,
) -> Result<ExportDestinationBinding, String> {
    let destination = match std::fs::canonicalize(destination) {
        Ok(destination) => destination,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if std::fs::symlink_metadata(destination).is_ok() {
                return Err(error.to_string());
            }
            let file_name = destination
                .file_name()
                .ok_or_else(|| "temporary merge export destination has no file name".to_owned())?;
            let parent = destination.parent().unwrap_or_else(|| Path::new("."));
            std::fs::canonicalize(parent)
                .map_err(|error| error.to_string())?
                .join(file_name)
        }
        Err(error) => return Err(error.to_string()),
    };
    let parent_path = destination
        .parent()
        .ok_or_else(|| "temporary merge export destination has no parent".to_owned())?
        .to_owned();
    let file_name = destination
        .file_name()
        .ok_or_else(|| "temporary merge export destination has no file name".to_owned())?
        .to_owned();
    let parent = Dir::open_ambient_dir(&parent_path, ambient_authority())
        .map_err(|error| error.to_string())?;
    let parent_identity = same_file::Handle::from_file(
        parent
            .try_clone()
            .map_err(|error| error.to_string())?
            .into_std_file(),
    )
    .map_err(|error| error.to_string())?;
    Ok(ExportDestinationBinding {
        path: destination,
        file_name: PathBuf::from(file_name),
        parent,
        parent_identity,
    })
}

fn validate_temp_target_export_destination(
    snapshot: &TempTargetExportSnapshot,
    destination: &Path,
) -> Result<(), String> {
    let protected_files = [snapshot.source.path(), snapshot.working_path.as_path()];
    for protected in protected_files {
        if destination == protected
            || (destination.exists()
                && same_file::is_same_file(destination, protected)
                    .map_err(|error| error.to_string())?)
        {
            return Err(
                "temporary merge export destination aliases a source or working target".to_owned(),
            );
        }
    }
    for owned_path in &snapshot.owned_temp_paths {
        let canonical_owned =
            std::fs::canonicalize(owned_path).unwrap_or_else(|_| owned_path.to_path_buf());
        if destination == canonical_owned || destination.starts_with(&canonical_owned) {
            return Err(
                "temporary merge export destination is app-owned temporary storage".to_owned(),
            );
        }
    }
    Ok(())
}

fn install_pending_temp_target_export_recovery(
    shared_state: &SharedState,
    recovery: PendingTempTargetExportRecovery,
) -> Result<(), Box<PendingTempTargetExportRecovery>> {
    {
        let mut state = recover_state_lock(shared_state);
        state.install_temp_target_export_recovery(recovery)
    }
}

fn restore_or_retain_temp_target_export(
    shared_state: &SharedState,
    mut recovery: PendingTempTargetExportRecovery,
    mut error: String,
    restore: &mut impl FnMut(
        &ExportDestinationSnapshot,
        &mut PreparedTempTargetExport,
    ) -> Result<(), String>,
    cleanup: &mut impl FnMut(
        &ExportDestinationSnapshot,
        &mut PreparedTempTargetExport,
    ) -> Result<(), String>,
) -> Result<TempMergeSessionSummary, String> {
    let restore_result = {
        let PendingTempTargetExportRecovery {
            prepared, snapshot, ..
        } = &mut recovery;
        restore(snapshot, prepared)
    };
    if let Err(restore_error) = restore_result {
        error = format!(
            "{error}; failed to restore export destination: {restore_error}; \
             temporary merge export recovery is pending; retry Save As"
        );
        recovery.kind = PendingTempTargetExportRecoveryKind::Rollback;
        let install_result = install_pending_temp_target_export_recovery(shared_state, recovery);
        if install_result.is_err() {
            error.push_str("; failed to retain export recovery ownership");
        }
        return Err(error);
    }
    recovery.kind = PendingTempTargetExportRecoveryKind::RollbackCleanup;
    let cleanup_result = {
        let PendingTempTargetExportRecovery {
            prepared, snapshot, ..
        } = &mut recovery;
        cleanup(snapshot, prepared)
    };
    if let Err(cleanup_error) = cleanup_result {
        error = format!(
            "{error}; destination restored but rollback cleanup failed: {cleanup_error}; \
             temporary merge export recovery is pending; retry Save As"
        );
        let install_result = install_pending_temp_target_export_recovery(shared_state, recovery);
        if install_result.is_err() {
            error.push_str("; failed to retain export cleanup ownership");
        }
        return Err(error);
    }
    recover_state_lock(shared_state).cancel_temp_target_export(&recovery.prepared);
    Err(error)
}

fn revalidate_temp_target_export_publication(
    shared_state: &SharedState,
    recovery: &PendingTempTargetExportRecovery,
) -> Result<(), String> {
    if !recover_state_lock(shared_state).temp_target_export_reservation_matches(&recovery.prepared)
    {
        return Err("temporary merge export reservation changed".to_owned());
    }
    let published = recovery
        .prepared
        .artifacts
        .published
        .as_ref()
        .ok_or_else(|| "published export destination ownership is unavailable".to_owned())?;
    match recovery
        .prepared
        .destination
        .ambient_path_names_published_file(published)
    {
        Ok(true) => Ok(()),
        Ok(false) => Err(
            "temporary merge export destination parent or file changed before publication"
                .to_owned(),
        ),
        Err(error) => Err(format!(
            "failed to verify temporary merge export destination before publication: {error}"
        )),
    }
}

fn rollback_pending_temp_target_export_recovery(
    recovery: &mut PendingTempTargetExportRecovery,
) -> Result<(), String> {
    recovery.restore()?;
    recovery.kind = PendingTempTargetExportRecoveryKind::RollbackCleanup;
    recovery.cleanup()
}

fn recover_pending_temp_target_export(shared_state: &SharedState) -> Result<(), String> {
    let Some(mut recovery) = ({
        let mut state = recover_state_lock(shared_state);
        let recovery = state.pending_temp_target_export_recovery.take();
        if state.temp_merge_exporting.is_none() {
            state.temp_merge_exporting = recovery
                .as_ref()
                .map(|recovery| recovery.prepared.reservation);
        }
        recovery
    }) else {
        return Ok(());
    };
    let recover_result = match recovery.kind {
        PendingTempTargetExportRecoveryKind::ArtifactCleanup => recovery.cleanup(),
        PendingTempTargetExportRecoveryKind::Rollback => {
            rollback_pending_temp_target_export_recovery(&mut recovery)
        }
        PendingTempTargetExportRecoveryKind::RollbackCleanup => recovery.cleanup(),
        PendingTempTargetExportRecoveryKind::ExportCleanup => {
            if revalidate_temp_target_export_publication(shared_state, &recovery).is_err() {
                rollback_pending_temp_target_export_recovery(&mut recovery)
            } else {
                recovery.cleanup()?;
                if revalidate_temp_target_export_publication(shared_state, &recovery).is_err() {
                    rollback_pending_temp_target_export_recovery(&mut recovery)
                } else {
                    Ok(())
                }
            }
        }
    };
    if let Err(error) = recover_result {
        recover_state_lock(shared_state).pending_temp_target_export_recovery = Some(recovery);
        return Err(format!(
            "temporary merge export recovery is still pending: {error}; retry Save As"
        ));
    }
    match recovery.kind {
        PendingTempTargetExportRecoveryKind::ExportCleanup => {
            let finish_result = {
                let mut state = recover_state_lock(shared_state);
                state.finish_temp_target_export(&recovery.prepared)
            };
            if let Err(error) = finish_result {
                let _ = install_pending_temp_target_export_recovery(shared_state, recovery);
                return Err(error);
            }
            recovery
                .prepared
                .artifacts
                .finish_destination_publication()?;
        }
        PendingTempTargetExportRecoveryKind::ArtifactCleanup
        | PendingTempTargetExportRecoveryKind::Rollback
        | PendingTempTargetExportRecoveryKind::RollbackCleanup => {
            recover_state_lock(shared_state).cancel_temp_target_export(&recovery.prepared);
        }
    }
    Ok(())
}

struct TempTargetExportOperations<
    AfterResolve,
    AfterReserve,
    Capture,
    BeforeExport,
    Export,
    Restore,
    Cleanup,
    AfterExport,
> {
    after_resolve: AfterResolve,
    after_reserve: AfterReserve,
    capture: Capture,
    before_export: BeforeExport,
    export: Export,
    restore: Restore,
    cleanup: Cleanup,
    after_export: AfterExport,
}

fn no_temp_target_export_path_hook(_: &Path) {}

fn no_temp_target_export_hook() {}

fn no_temp_target_export_state_hook(_: &SharedState) {}

fn export_temp_target_to_destination(
    source: &Path,
    prepared: &mut PreparedTempTargetExport,
) -> Result<(), String> {
    prepared
        .destination
        .export_from_ambient(source, &mut prepared.artifacts)
}

fn capture_temp_target_export_snapshot(
    snapshot: &mut ExportDestinationSnapshot,
    prepared: &mut PreparedTempTargetExport,
) -> Result<(), String> {
    snapshot.capture(&prepared.destination, &mut prepared.artifacts)
}

fn restore_temp_target_export_destination(
    snapshot: &ExportDestinationSnapshot,
    prepared: &mut PreparedTempTargetExport,
) -> Result<(), String> {
    snapshot.restore(&prepared.destination, &mut prepared.artifacts)
}

fn cleanup_temp_target_export_snapshot(
    snapshot: &ExportDestinationSnapshot,
    prepared: &mut PreparedTempTargetExport,
) -> Result<(), String> {
    snapshot.cleanup(&prepared.destination, &mut prepared.artifacts)
}

fn save_temp_target_as_with_operations<
    AfterResolve,
    AfterReserve,
    Capture,
    BeforeExport,
    Export,
    Restore,
    Cleanup,
    AfterExport,
>(
    shared_state: &SharedState,
    destination: PathBuf,
    operations: TempTargetExportOperations<
        AfterResolve,
        AfterReserve,
        Capture,
        BeforeExport,
        Export,
        Restore,
        Cleanup,
        AfterExport,
    >,
) -> Result<TempMergeSessionSummary, String>
where
    AfterResolve: for<'a> FnOnce(&'a Path),
    AfterReserve: FnOnce(),
    Capture: for<'a, 'b> FnMut(
        &'a mut ExportDestinationSnapshot,
        &'b mut PreparedTempTargetExport,
    ) -> Result<(), String>,
    BeforeExport: FnOnce(),
    Export: for<'a, 'b> FnMut(&'a Path, &'b mut PreparedTempTargetExport) -> Result<(), String>,
    Restore: for<'a, 'b> FnMut(
        &'a ExportDestinationSnapshot,
        &'b mut PreparedTempTargetExport,
    ) -> Result<(), String>,
    Cleanup: for<'a, 'b> FnMut(
        &'a ExportDestinationSnapshot,
        &'b mut PreparedTempTargetExport,
    ) -> Result<(), String>,
    AfterExport: for<'a> FnOnce(&'a SharedState),
{
    let TempTargetExportOperations {
        after_resolve,
        after_reserve,
        mut capture,
        before_export,
        mut export,
        mut restore,
        mut cleanup,
        after_export,
    } = operations;
    {
        let state = recover_state_lock(shared_state);
        if state.pending_temp_merge_apply_recovery.is_some() {
            return Err(
                "temporary merge Apply recovery is pending; retry Apply before Save As".to_owned(),
            );
        }
    }
    recover_pending_temp_target_export(shared_state)?;
    let snapshot = {
        let state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.temp_target_export_snapshot()?
    };
    let destination = resolve_temp_target_export_destination(&destination)?;
    after_resolve(&destination.path);
    validate_temp_target_export_destination(&snapshot, &destination.path)?;
    let prepared = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.reserve_temp_target_export(snapshot, destination)?
    };
    after_reserve();
    if !recover_state_lock(shared_state).temp_target_export_reservation_matches(&prepared) {
        recover_state_lock(shared_state).cancel_temp_target_export(&prepared);
        return Err("temporary merge export reservation changed".to_owned());
    }
    let destination_snapshot = match ExportDestinationSnapshot::prepare(&prepared.destination) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            recover_state_lock(shared_state).cancel_temp_target_export(&prepared);
            return Err(error);
        }
    };
    let mut recovery = PendingTempTargetExportRecovery {
        prepared,
        snapshot: destination_snapshot,
        kind: PendingTempTargetExportRecoveryKind::ArtifactCleanup,
    };
    let capture_result = {
        let PendingTempTargetExportRecovery {
            prepared, snapshot, ..
        } = &mut recovery;
        capture(snapshot, prepared)
    };
    if let Err(error) = capture_result {
        if !recovery.prepared.artifacts.backup.is_owned()
            && !recovery.prepared.artifacts.write.is_owned()
        {
            recover_state_lock(shared_state).cancel_temp_target_export(&recovery.prepared);
            return Err(format!(
                "temporary merge export snapshot capture failed: {error}"
            ));
        }
        install_pending_temp_target_export_recovery(shared_state, recovery)
            .map_err(|_| "failed to retain snapshot capture cleanup ownership".to_owned())?;
        return Err(format!(
            "temporary merge export snapshot capture failed: {error}; \
             cleanup recovery is pending; retry Save As"
        ));
    }
    recovery.kind = PendingTempTargetExportRecoveryKind::Rollback;
    let pre_export_check = if recover_state_lock(shared_state)
        .temp_target_export_reservation_matches(&recovery.prepared)
    {
        Ok(())
    } else {
        Err("temporary merge export reservation changed".to_owned())
    };
    if let Err(error) = pre_export_check {
        recovery.kind = PendingTempTargetExportRecoveryKind::ArtifactCleanup;
        let cleanup_result = {
            let PendingTempTargetExportRecovery {
                prepared, snapshot, ..
            } = &mut recovery;
            cleanup(snapshot, prepared)
        };
        if let Err(cleanup_error) = cleanup_result {
            install_pending_temp_target_export_recovery(shared_state, recovery)
                .map_err(|_| "failed to retain pre-export cleanup ownership".to_owned())?;
            return Err(format!(
                "{error}; pre-export cleanup failed: {cleanup_error}; retry Save As"
            ));
        }
        recover_state_lock(shared_state).cancel_temp_target_export(&recovery.prepared);
        return Err(error);
    }
    before_export();
    let destination_still_matches = recovery
        .snapshot
        .still_matches_prepared_destination(&recovery.prepared.destination)
        .and_then(|matches| {
            matches.then_some(()).ok_or_else(|| {
                "temporary merge export destination parent changed or file changed before export"
                    .to_owned()
            })
        });
    if let Err(error) = destination_still_matches {
        recovery.kind = PendingTempTargetExportRecoveryKind::ArtifactCleanup;
        let cleanup_result = {
            let PendingTempTargetExportRecovery {
                prepared, snapshot, ..
            } = &mut recovery;
            cleanup(snapshot, prepared)
        };
        if let Err(cleanup_error) = cleanup_result {
            install_pending_temp_target_export_recovery(shared_state, recovery)
                .map_err(|_| "failed to retain pre-export cleanup ownership".to_owned())?;
            return Err(format!(
                "{error}; pre-export cleanup failed: {cleanup_error}; retry Save As"
            ));
        }
        recover_state_lock(shared_state).cancel_temp_target_export(&recovery.prepared);
        return Err(error);
    }
    let working_path = recovery.prepared.snapshot.working_path.clone();
    if let Err(error) = export(&working_path, &mut recovery.prepared) {
        if recovery.prepared.artifacts.published.is_none() {
            recovery.kind = PendingTempTargetExportRecoveryKind::ArtifactCleanup;
            install_pending_temp_target_export_recovery(shared_state, recovery)
                .map_err(|_| "failed to retain temporary write cleanup ownership".to_owned())?;
            return Err(format!(
                "{error}; temporary write cleanup is pending; retry Save As"
            ));
        }
        return restore_or_retain_temp_target_export(
            shared_state,
            recovery,
            error,
            &mut restore,
            &mut cleanup,
        );
    }
    after_export(shared_state);
    if let Err(error) = revalidate_temp_target_export_publication(shared_state, &recovery) {
        return restore_or_retain_temp_target_export(
            shared_state,
            recovery,
            error,
            &mut restore,
            &mut cleanup,
        );
    }
    recovery.kind = PendingTempTargetExportRecoveryKind::ExportCleanup;
    let cleanup_result = {
        let PendingTempTargetExportRecovery {
            prepared, snapshot, ..
        } = &mut recovery;
        cleanup(snapshot, prepared)
    };
    if let Err(error) = cleanup_result {
        install_pending_temp_target_export_recovery(shared_state, recovery)
            .map_err(|_| "failed to retain export cleanup ownership".to_owned())?;
        return Err(format!(
            "temporary merge export cleanup is pending: {error}; retry Save As"
        ));
    }
    if let Err(error) = revalidate_temp_target_export_publication(shared_state, &recovery) {
        return restore_or_retain_temp_target_export(
            shared_state,
            recovery,
            error,
            &mut restore,
            &mut cleanup,
        );
    }
    let summary = recover_state_lock(shared_state).finish_temp_target_export(&recovery.prepared)?;
    recovery
        .prepared
        .artifacts
        .finish_destination_publication()?;
    Ok(summary)
}

pub(crate) fn save_temp_target_as(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_hooks(
    shared_state: &SharedState,
    destination: PathBuf,
    after_resolve: impl FnOnce(&Path),
    after_export: impl FnOnce(&SharedState),
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_post_replace_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: |source: &Path, prepared: &mut PreparedTempTargetExport| {
                prepared
                    .destination
                    .export_from_ambient(source, &mut prepared.artifacts)?;
                Err("injected post-replace parent sync failure".to_owned())
            },
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_after_reserve(
    shared_state: &SharedState,
    destination: PathBuf,
    after_reserve: impl FnOnce(),
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_stale_reservation(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: |state: &SharedState| {
                let mut state = recover_state_lock(state);
                let target_side = state
                    .temp_merge_exporting
                    .expect("Save As reservation for failure injection")
                    .target_side;
                let newer = state.reserve_temp_merge_operation(target_side);
                state.temp_merge_exporting = Some(newer);
            },
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_parent_swap(
    shared_state: &SharedState,
    destination: PathBuf,
    before_export: impl FnOnce(),
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_rollback_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: |source: &Path, prepared: &mut PreparedTempTargetExport| {
                prepared
                    .destination
                    .export_from_ambient(source, &mut prepared.artifacts)?;
                Err("injected post-replace export failure".to_owned())
            },
            restore: |_: &ExportDestinationSnapshot, _: &mut PreparedTempTargetExport| {
                Err("injected export rollback failure".to_owned())
            },
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_cleanup_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: |snapshot: &ExportDestinationSnapshot,
                      prepared: &mut PreparedTempTargetExport| {
                snapshot.cleanup_with(&prepared.destination, &mut prepared.artifacts, |_| {
                    Err(io::Error::other(
                        "injected export backup directory sync failure",
                    ))
                })
            },
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_pre_capture_destination_creation(
    shared_state: &SharedState,
    destination: PathBuf,
    replacement: &[u8],
) -> Result<TempMergeSessionSummary, String> {
    let replacement = replacement.to_vec();
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: move |snapshot: &mut ExportDestinationSnapshot,
                           prepared: &mut PreparedTempTargetExport| {
                std::fs::write(&prepared.destination.path, &replacement)
                    .map_err(|error| error.to_string())?;
                snapshot.capture(&prepared.destination, &mut prepared.artifacts)
            },
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_post_cleanup_replacement(
    shared_state: &SharedState,
    destination: PathBuf,
    replacement: &[u8],
) -> Result<TempMergeSessionSummary, String> {
    let replacement = replacement.to_vec();
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: move |snapshot: &ExportDestinationSnapshot,
                           prepared: &mut PreparedTempTargetExport| {
                snapshot.cleanup(&prepared.destination, &mut prepared.artifacts)?;
                replace_temp_target_export_destination_for_test(
                    &prepared.destination.path,
                    &replacement,
                )
            },
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(all(test, unix))]
pub(crate) fn save_temp_target_as_with_post_cleanup_parent_swap(
    shared_state: &SharedState,
    destination: PathBuf,
    parent: PathBuf,
    moved_parent: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: move |snapshot: &ExportDestinationSnapshot,
                           prepared: &mut PreparedTempTargetExport| {
                snapshot.cleanup(&prepared.destination, &mut prepared.artifacts)?;
                std::fs::rename(&parent, &moved_parent).map_err(|error| error.to_string())?;
                std::fs::create_dir(&parent).map_err(|error| error.to_string())
            },
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_backup_removal_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: |_: &ExportDestinationSnapshot, _: &mut PreparedTempTargetExport| {
                Err("injected export backup removal failure".to_owned())
            },
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
struct FailingExportReader {
    bytes: &'static [u8],
    emitted: bool,
}

#[cfg(test)]
impl Read for FailingExportReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.emitted {
            return Err(io::Error::other("injected partial export read failure"));
        }
        let count = buffer.len().min(self.bytes.len());
        buffer[..count].copy_from_slice(&self.bytes[..count]);
        self.emitted = true;
        Ok(count)
    }
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_partial_snapshot_capture_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: |snapshot: &mut ExportDestinationSnapshot,
                      prepared: &mut PreparedTempTargetExport| {
                if !matches!(snapshot, ExportDestinationSnapshot::Existing { .. }) {
                    return Err("injected snapshot capture requires an existing file".to_owned());
                }
                let mut partial = FailingExportReader {
                    bytes: b"partial-backup",
                    emitted: false,
                };
                copy_into_capability_file(
                    &mut partial,
                    &prepared.destination.parent,
                    &mut prepared.artifacts.backup,
                )
            },
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_partial_write_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: |_: &Path, prepared: &mut PreparedTempTargetExport| {
                let mut partial = FailingExportReader {
                    bytes: b"partial-write",
                    emitted: false,
                };
                copy_into_capability_file(
                    &mut partial,
                    &prepared.destination.parent,
                    &mut prepared.artifacts.write,
                )
            },
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_post_rename_durability_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: capture_temp_target_export_snapshot,
            before_export: no_temp_target_export_hook,
            export: |source: &Path, prepared: &mut PreparedTempTargetExport| {
                let mut source = File::open(source).map_err(|error| error.to_string())?;
                prepared.destination.export_from_reader_with_durability(
                    &mut source,
                    &mut prepared.artifacts,
                    |_, _| Err(io::Error::other("injected renamed file durability failure")),
                )
            },
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn save_temp_target_as_with_snapshot_durability_failure(
    shared_state: &SharedState,
    destination: PathBuf,
) -> Result<TempMergeSessionSummary, String> {
    save_temp_target_as_with_operations(
        shared_state,
        destination,
        TempTargetExportOperations {
            after_resolve: no_temp_target_export_path_hook,
            after_reserve: no_temp_target_export_hook,
            capture: |snapshot: &mut ExportDestinationSnapshot,
                      prepared: &mut PreparedTempTargetExport| {
                snapshot.capture_with_durability(
                    &prepared.destination,
                    &mut prepared.artifacts,
                    |_, _| Err(io::Error::other("injected snapshot durability failure")),
                )
            },
            before_export: no_temp_target_export_hook,
            export: export_temp_target_to_destination,
            restore: restore_temp_target_export_destination,
            cleanup: cleanup_temp_target_export_snapshot,
            after_export: no_temp_target_export_state_hook,
        },
    )
}

#[cfg(test)]
pub(crate) fn replace_temp_target_export_destination_for_test(
    destination: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    let destination = resolve_temp_target_export_destination(destination)?;
    let mut artifacts = ExportArtifactOwnership::new();
    let mut bytes = io::Cursor::new(bytes);
    copy_into_capability_file(&mut bytes, &destination.parent, &mut artifacts.write)?;
    if let Err(error) = destination.rename_artifact_to_destination(&artifacts.write.name, true) {
        let cleanup_error = artifacts
            .cleanup_write(&destination)
            .err()
            .map(|cleanup| format!("; cleanup failed: {cleanup}"))
            .unwrap_or_default();
        return Err(format!("{error}{cleanup_error}"));
    }
    artifacts.write.state = OwnedExportArtifactState::Reserved;
    artifacts.write.durability_handle = None;
    Ok(())
}

fn temp_merge_review_changed_on_disk(snapshot: &TempMergeStageSnapshot) -> Result<bool, String> {
    Ok(snapshot
        .review
        .source
        .changed_on_disk()
        .map_err(|error| error.to_string())?
        || snapshot
            .review
            .target
            .changed_on_disk()
            .map_err(|error| error.to_string())?
        || snapshot
            .source
            .changed_on_disk()
            .map_err(|error| error.to_string())?
        || snapshot
            .target
            .changed_on_disk()
            .map_err(|error| error.to_string())?)
}

fn restore_temp_merge_stage(shared_state: &SharedState, snapshot: &TempMergeStageSnapshot) {
    recover_state_lock(shared_state).restore_temp_merge_stage(snapshot);
}

fn temp_merge_staged_paths(
    review: &TempMergeReview,
    decisions: Vec<TempMergeDecision>,
) -> Result<Vec<String>, String> {
    let conflicts = review
        .preview
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

    let mut staged_paths = review.preview.new_entries.clone();
    staged_paths.extend(
        review
            .preview
            .conflicts
            .iter()
            .filter(|entry_path| {
                actions.get(entry_path.as_str()) == Some(&TempMergeConflictAction::Overwrite)
            })
            .cloned(),
    );
    staged_paths.sort();
    let mut validated_plan = MergePlan::new();
    for entry_path in &staged_paths {
        validated_plan
            .stage_copy(&review.source, entry_path, entry_path)
            .map_err(|error| error.to_string())?;
    }
    Ok(staged_paths)
}

pub(crate) fn preview_merge_all_conflicts(
    shared_state: &SharedState,
    source_side: Side,
) -> Result<TempMergeConflictPreview, String> {
    let snapshot = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.begin_temp_merge_preview(source_side)?
    };
    if snapshot
        .source
        .changed_on_disk()
        .map_err(|error| error.to_string())?
        || snapshot
            .target
            .changed_on_disk()
            .map_err(|error| error.to_string())?
    {
        return Err("temporary merge source or target changed on disk".to_owned());
    }
    let preview = AppState::temp_merge_conflict_preview(&snapshot.source, &snapshot.target);
    shared_state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?
        .finish_temp_merge_preview(snapshot, preview)
}

fn stage_temp_merge_all_with_operations(
    shared_state: &SharedState,
    source_side: Side,
    decisions: Vec<TempMergeDecision>,
    after_reserve: impl FnOnce(),
) -> Result<(), String> {
    let snapshot = {
        let mut state = shared_state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        state.begin_temp_merge_stage(source_side)?
    };
    after_reserve();
    match temp_merge_review_changed_on_disk(&snapshot) {
        Ok(false) => {}
        Ok(true) => {
            restore_temp_merge_stage(shared_state, &snapshot);
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        Err(error) => {
            restore_temp_merge_stage(shared_state, &snapshot);
            return Err(error);
        }
    }
    let staged_paths = match temp_merge_staged_paths(&snapshot.review, decisions) {
        Ok(staged_paths) => staged_paths,
        Err(error) => {
            restore_temp_merge_stage(shared_state, &snapshot);
            return Err(error);
        }
    };
    match temp_merge_review_changed_on_disk(&snapshot) {
        Ok(false) => {}
        Ok(true) => {
            restore_temp_merge_stage(shared_state, &snapshot);
            return Err("temporary merge conflict preview is stale".to_owned());
        }
        Err(error) => {
            restore_temp_merge_stage(shared_state, &snapshot);
            return Err(error);
        }
    }
    let result = recover_state_lock(shared_state).finish_temp_merge_stage(&snapshot, staged_paths);
    if result.is_err() {
        restore_temp_merge_stage(shared_state, &snapshot);
    }
    result
}

pub(crate) fn stage_temp_merge_all_shared(
    shared_state: &SharedState,
    source_side: Side,
    decisions: Vec<TempMergeDecision>,
) -> Result<(), String> {
    stage_temp_merge_all_with_operations(shared_state, source_side, decisions, || {})
}

#[cfg(test)]
pub(crate) fn stage_temp_merge_all_with_after_reserve(
    shared_state: &SharedState,
    source_side: Side,
    decisions: Vec<TempMergeDecision>,
    after_reserve: impl FnOnce(),
) -> Result<(), String> {
    stage_temp_merge_all_with_operations(shared_state, source_side, decisions, after_reserve)
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
) -> Result<TempTargetDiscardOutcome, String> {
    let message = format!("failed to discard temporary merge target: {error}");
    let displaced = {
        let mut state = recover_state_lock(shared_state);
        state.restore_detached_temp_target(detached)
    };
    drop(displaced);
    Err(message)
}

fn retain_pending_discard_failure(
    shared_state: &SharedState,
    pending: PendingTempTargetDiscard,
    error: impl std::fmt::Display,
) -> Result<TempTargetDiscardOutcome, String> {
    let message = format!("failed to discard temporary merge target: {error}");
    {
        let mut state = recover_state_lock(shared_state);
        debug_assert_eq!(state.temp_merge_discarding, Some(pending.target_side));
        debug_assert!(archive(&state, pending.target_side).is_none());
        debug_assert!(state.plan(pending.target_side).is_empty());
        debug_assert!(state.temp_merge_session.is_none());
        debug_assert!(state.pending_temp_target_discard.is_none());
        state.pending_temp_target_discard = Some(pending);
    }
    Ok(TempTargetDiscardOutcome::RetryDiscardOnly { message })
}

fn discard_temp_target_with_operations(
    shared_state: &SharedState,
    mut cleanup: impl FnMut(&Path) -> io::Result<()>,
    mut write_snapshot: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<TempTargetDiscardOutcome, String> {
    let pending = {
        let mut state = recover_state_lock(shared_state);
        state.pending_temp_target_discard.take()
    };
    if let Some(mut pending) = pending {
        if let Err(error) = pending.session.retry_pending_cleanup(&mut cleanup) {
            return retain_pending_discard_failure(shared_state, pending, error);
        }
        {
            let mut state = recover_state_lock(shared_state);
            state.finish_temp_target_discard(pending.target_side);
        }
        drop(pending);
        return Ok(TempTargetDiscardOutcome::Discarded);
    }

    let replacement_nested = fresh_nested_cache()?;
    let mut detached = {
        let mut state = recover_state_lock(shared_state);
        match state.detach_temp_target(replacement_nested) {
            Ok(detached) => detached,
            Err((error, replacement_nested)) => {
                drop(state);
                drop(replacement_nested);
                return Err(error);
            }
        }
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
        let mut state = recover_state_lock(shared_state);
        state.finish_temp_target_discard(detached.target_side);
    }
    drop(detached);
    Ok(TempTargetDiscardOutcome::Discarded)
}

fn discard_temp_target_outcome(
    shared_state: &SharedState,
) -> Result<TempTargetDiscardOutcome, String> {
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
fn discard_outcome_as_legacy_result(
    result: Result<TempTargetDiscardOutcome, String>,
) -> Result<(), String> {
    match result? {
        TempTargetDiscardOutcome::Discarded => Ok(()),
        TempTargetDiscardOutcome::RetryDiscardOnly { message } => Err(message),
    }
}

#[cfg(test)]
pub(crate) fn discard_temp_target(shared_state: &SharedState) -> Result<(), String> {
    discard_outcome_as_legacy_result(discard_temp_target_outcome(shared_state))
}

pub(crate) fn discard_temp_target_with_outcome(
    shared_state: &SharedState,
) -> Result<TempTargetDiscardOutcome, String> {
    discard_temp_target_outcome(shared_state)
}

#[cfg(test)]
pub(crate) fn discard_temp_target_with_cleanup(
    shared_state: &SharedState,
    cleanup: impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), String> {
    discard_outcome_as_legacy_result(discard_temp_target_with_operations(
        shared_state,
        cleanup,
        |path, bytes| std::fs::write(path, bytes),
    ))
}

#[cfg(test)]
pub(crate) fn discard_temp_target_with_cleanup_and_write(
    shared_state: &SharedState,
    cleanup: impl FnMut(&Path) -> io::Result<()>,
    write_snapshot: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<(), String> {
    discard_outcome_as_legacy_result(discard_temp_target_with_operations(
        shared_state,
        cleanup,
        write_snapshot,
    ))
}

#[cfg(test)]
pub(crate) fn discard_temp_target_with_cleanup_and_write_outcome(
    shared_state: &SharedState,
    cleanup: impl FnMut(&Path) -> io::Result<()>,
    write_snapshot: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<TempTargetDiscardOutcome, String> {
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
