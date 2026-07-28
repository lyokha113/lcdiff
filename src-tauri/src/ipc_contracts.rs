use std::collections::BTreeSet;
use std::path::PathBuf;

use lcdiff_core::{
    ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitResult, EntryKind, PairStatus,
};
use serde_json::{json, to_value};

use super::{
    AppActionPayload, ArchiveSummary, DeepSearchMatch, EntryPreview, OsOpenPathsPayload,
    PlatformHints, SearchHit, SearchHitKind, SearchProgress, Side, ViewSourceSummary,
    system_fonts::SystemFont,
};

const COMMAND_NAMES: [&str; 30] = [
    "validate_path",
    "platform_hints",
    "list_system_fonts",
    "open_archive",
    "compute_diff",
    "compute_nested_diff",
    "open_view_source",
    "list_view_sources",
    "read_entry",
    "read_view_entry",
    "compute_view_nested_entries",
    "close_view_source",
    "set_engine",
    "disassemble",
    "disassemble_view_entry",
    "stage_copy",
    "stage_write",
    "stage_view_write",
    "unstage_view_write",
    "commit_view",
    "commit_merge",
    "clear_staged",
    "unstage",
    "search",
    "search_view_source",
    "deep_search",
    "deep_search_view_source",
    "cancel_deep_search",
    "prefetch_siblings",
    "pending_open_paths",
];

const EVENT_NAMES: [&str; 4] = [
    "search-result",
    "search-progress",
    "os-open-paths",
    "app-action",
];

fn entry() -> ArchiveEntry {
    ArchiveEntry {
        path: "pkg/Main.java".to_owned(),
        kind: EntryKind::Text,
        uncompressed_size: 42,
        compressed_size: 21,
        crc32: 305_419_896,
    }
}

fn metadata() -> ArchiveMetadata {
    ArchiveMetadata {
        source_kind: ArchiveSourceKind::Archive,
        signed: true,
        multi_release: false,
        zip64: true,
    }
}

#[test]
fn serializes_side_and_core_archive_types_with_exact_keys_and_enum_spelling() {
    assert_eq!(to_value(Side::Left).unwrap(), json!("left"));
    assert_eq!(to_value(Side::Right).unwrap(), json!("right"));
    assert_eq!(
        to_value(entry()).unwrap(),
        json!({
            "path": "pkg/Main.java",
            "kind": "text",
            "uncompressedSize": 42,
            "compressedSize": 21,
            "crc32": 305419896,
        }),
    );
    assert_eq!(
        to_value(metadata()).unwrap(),
        json!({
            "sourceKind": "archive",
            "signed": true,
            "multiRelease": false,
            "zip64": true,
        }),
    );
    assert_eq!(
        to_value(ArchiveSourceKind::Directory).unwrap(),
        json!("directory"),
    );
    assert_eq!(to_value(PairStatus::OnlyLeft).unwrap(), json!("onlyLeft"));
    assert_eq!(to_value(PairStatus::OnlyRight).unwrap(), json!("onlyRight"));
    assert_eq!(to_value(PairStatus::Identical).unwrap(), json!("identical"));
    assert_eq!(to_value(PairStatus::Different).unwrap(), json!("different"));
}

#[test]
fn serializes_summary_and_preview_dtos_with_required_nulls() {
    assert_eq!(
        to_value(ArchiveSummary {
            path: "source.jar".to_owned(),
            metadata: metadata(),
            entries: vec![entry()],
        })
        .unwrap(),
        json!({
            "path": "source.jar",
            "metadata": {
                "sourceKind": "archive",
                "signed": true,
                "multiRelease": false,
                "zip64": true,
            },
            "entries": [{
                "path": "pkg/Main.java",
                "kind": "text",
                "uncompressedSize": 42,
                "compressedSize": 21,
                "crc32": 305419896,
            }],
        }),
    );
    assert_eq!(
        to_value(ViewSourceSummary {
            id: "view-1".to_owned(),
            path: "notes.txt".to_owned(),
            name: "notes.txt".to_owned(),
            kind: ArchiveSourceKind::File,
            signed: false,
            entry_count: 1,
        })
        .unwrap(),
        json!({
            "id": "view-1",
            "path": "notes.txt",
            "name": "notes.txt",
            "kind": "file",
            "signed": false,
            "entryCount": 1,
        }),
    );
    assert_eq!(
        to_value(EntryPreview {
            path: "pkg/Main.java".to_owned(),
            kind: EntryKind::Text,
            language: "java".to_owned(),
            details: None,
            content: "class Main {}".to_owned(),
        })
        .unwrap(),
        json!({
            "path": "pkg/Main.java",
            "kind": "text",
            "language": "java",
            "details": null,
            "content": "class Main {}",
        }),
    );
}

#[test]
fn serializes_platform_commit_and_font_dtos_with_exact_null_behavior() {
    assert_eq!(
        to_value(PlatformHints {
            os: "linux".to_owned(),
            session_type: None,
            wayland: false,
            drop_hint: None,
        })
        .unwrap(),
        json!({
            "os": "linux",
            "sessionType": null,
            "wayland": false,
            "dropHint": null,
        }),
    );
    assert_eq!(
        to_value(CommitResult {
            rewritten_path: PathBuf::from("merged.jar"),
            backup_path: None,
            signature_invalidated: true,
            copied_entries: 3,
        })
        .unwrap(),
        json!({
            "rewrittenPath": "merged.jar",
            "backupPath": null,
            "signatureInvalidated": true,
            "copiedEntries": 3,
        }),
    );
    assert_eq!(
        to_value(SystemFont {
            family: "JetBrains Mono".to_owned(),
            monospace_likely: true,
            local_names: vec!["JetBrainsMono-Regular".to_owned()],
            font_file: None,
        })
        .unwrap(),
        json!({
            "family": "JetBrains Mono",
            "monospaceLikely": true,
            "localNames": ["JetBrainsMono-Regular"],
            "fontFile": null,
        }),
    );
}

#[test]
fn serializes_search_payloads_and_omits_absent_hit_details() {
    let omitted = SearchHit::new("pkg/Main.class".to_owned(), SearchHitKind::Path);
    assert_eq!(
        to_value(omitted).unwrap(),
        json!({ "entryPath": "pkg/Main.class", "kind": "path" }),
    );

    let hit = SearchHit::new("pkg/Main.java".to_owned(), SearchHitKind::Source)
        .with_line(7)
        .with_preview("needle".to_owned());
    assert_eq!(
        to_value(hit.clone()).unwrap(),
        json!({
            "entryPath": "pkg/Main.java",
            "kind": "source",
            "line": 7,
            "preview": "needle",
        }),
    );
    assert_eq!(
        to_value(SearchProgress {
            search_id: 9,
            completed: 2,
            total: 8,
            entry_path: "pkg/Main.java".to_owned(),
        })
        .unwrap(),
        json!({ "searchId": 9, "completed": 2, "total": 8, "entryPath": "pkg/Main.java" }),
    );
    assert_eq!(
        to_value(DeepSearchMatch {
            search_id: 9,
            side: Side::Right,
            hit,
        })
        .unwrap(),
        json!({
            "searchId": 9,
            "side": "right",
            "hit": {
                "entryPath": "pkg/Main.java",
                "kind": "source",
                "line": 7,
                "preview": "needle",
            },
        }),
    );
}

#[test]
fn serializes_os_open_and_app_action_event_payloads() {
    assert_eq!(
        to_value(OsOpenPathsPayload {
            paths: vec!["left.jar".to_owned(), "right.jar".to_owned()],
        })
        .unwrap(),
        json!({ "paths": ["left.jar", "right.jar"] }),
    );
    assert_eq!(
        to_value(AppActionPayload {
            action_id: "file.openLeftFile".to_owned(),
        })
        .unwrap(),
        json!({ "actionId": "file.openLeftFile" }),
    );
}

#[test]
fn locks_the_exact_command_and_event_name_allowlists() {
    assert_eq!(COMMAND_NAMES.len(), 30);
    assert_eq!(COMMAND_NAMES.iter().collect::<BTreeSet<_>>().len(), 30);
    assert_eq!(EVENT_NAMES.len(), 4);
    assert_eq!(EVENT_NAMES.iter().collect::<BTreeSet<_>>().len(), 4);
}
