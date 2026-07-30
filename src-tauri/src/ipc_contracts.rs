use std::path::PathBuf;

use lcdiff_core::{
    ArchiveDiff, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, CommitResult, EntryKind,
    PairStatus,
};
use serde_json::{from_value, json, to_value};

use super::{
    EntryPreview, PlatformHints, SearchHit, SearchHitKind, Side,
    events::{
        APP_ACTION, AppActionPayload, DeepSearchMatch, OS_OPEN_PATHS, OsOpenPathsPayload,
        SEARCH_PROGRESS, SEARCH_RESULT, SearchProgress,
    },
    state::{
        ArchiveSummary, CompareSourcesResult, TempMergeConflictAction, TempMergeConflictPreview,
        TempMergeDecision, TempMergeSessionSummary, TempTargetCreation, TempTargetDiscardOutcome,
        TextFileContent, ViewSourceSummary,
    },
    system_fonts::SystemFont,
};

const COMMAND_NAMES: [&str; 38] = [
    "validate_path",
    "platform_hints",
    "list_system_fonts",
    "open_archive",
    "open_compare_sources",
    "compute_diff",
    "compute_nested_diff",
    "open_view_source",
    "list_view_sources",
    "read_entry",
    "read_text_file",
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
    "create_temp_target",
    "preview_merge_all_conflicts",
    "stage_temp_merge_all",
    "apply_temp_merge",
    "save_temp_target_as",
    "discard_temp_target",
];

const EVENT_NAMES: [&str; 4] = [
    "search-result",
    "search-progress",
    "os-open-paths",
    "app-action",
];

const LIB_SOURCE: &str = include_str!("lib.rs");
const APP_COMMANDS_SOURCE: &str = include_str!("commands/app.rs");
const ARCHIVE_COMMANDS_SOURCE: &str = include_str!("commands/archive.rs");
const PREVIEW_COMMANDS_SOURCE: &str = include_str!("commands/preview.rs");
const MERGE_COMMANDS_SOURCE: &str = include_str!("commands/merge.rs");
const SEARCH_COMMANDS_SOURCE: &str = include_str!("commands/search.rs");
const TEMP_MERGE_COMMANDS_SOURCE: &str = include_str!("commands/temp_merge.rs");
const COMMAND_SOURCES: [&str; 6] = [
    APP_COMMANDS_SOURCE,
    ARCHIVE_COMMANDS_SOURCE,
    PREVIEW_COMMANDS_SOURCE,
    MERGE_COMMANDS_SOURCE,
    SEARCH_COMMANDS_SOURCE,
    TEMP_MERGE_COMMANDS_SOURCE,
];
const EVENTS_SOURCE: &str = include_str!("events.rs");
const MENU_SOURCE: &str = include_str!("menu.rs");

const COMMAND_SIGNATURE_NAMES: [&str; 38] = [
    "validate_path",
    "platform_hints",
    "pending_open_paths",
    "open_archive",
    "open_compare_sources",
    "compute_diff",
    "compute_nested_diff",
    "open_view_source",
    "list_view_sources",
    "read_entry",
    "read_text_file",
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
    "list_system_fonts",
    "create_temp_target",
    "preview_merge_all_conflicts",
    "stage_temp_merge_all",
    "apply_temp_merge",
    "save_temp_target_as",
    "discard_temp_target",
];

const COMMAND_SIGNATURES: [&str; 38] = [
    "fnvalidate_path(raw:String)->Result<String,String>",
    "fnplatform_hints()->PlatformHints",
    "fnpending_open_paths(state:State<'_,SharedState>)->Result<Vec<String>,String>",
    "asyncfnopen_archive(path:String,side:Side,state:State<'_,SharedState>,)->Result<ArchiveSummary,String>",
    "asyncfnopen_compare_sources(left_path:String,right_path:String,state:State<'_,SharedState>,)->Result<CompareSourcesResult,String>",
    "asyncfncompute_diff(state:State<'_,SharedState>)->Result<ArchiveDiff,String>",
    "asyncfncompute_nested_diff(nested_path:String,state:State<'_,SharedState>,)->Result<ArchiveDiff,String>",
    "asyncfnopen_view_source(path:String,state:State<'_,SharedState>,)->Result<ViewSourceSummary,String>",
    "fnlist_view_sources(state:State<'_,SharedState>,)->Result<Vec<ViewSourceSummary>,String>",
    "asyncfnread_entry(side:Side,entry_path:String,state:State<'_,SharedState>,)->Result<EntryPreview,String>",
    "asyncfnread_text_file(path:String)->Result<TextFileContent,String>",
    "asyncfnread_view_entry(source_id:String,entry_path:String,state:State<'_,SharedState>,)->Result<EntryPreview,String>",
    "asyncfncompute_view_nested_entries(source_id:String,nested_path:String,state:State<'_,SharedState>,)->Result<ArchiveDiff,String>",
    "fnclose_view_source(source_id:String,state:State<'_,SharedState>,)->Result<(),String>",
    "fnset_engine(engine:DecompileEngine,state:State<'_,SharedState>,)->Result<(),String>",
    "asyncfndisassemble(side:Side,entry_path:String,state:State<'_,SharedState>,)->Result<String,String>",
    "asyncfndisassemble_view_entry(source_id:String,entry_path:String,state:State<'_,SharedState>,)->Result<String,String>",
    "fnstage_copy(from:Side,to:Side,entry_path:String,state:State<'_,SharedState>,)->Result<(),String>",
    "fnstage_write(side:Side,entry_path:String,content:String,state:State<'_,SharedState>,)->Result<(),String>",
    "fnstage_view_write(source_id:String,entry_path:String,content:String,state:State<'_,SharedState>,)->Result<(),String>",
    "fnunstage_view_write(source_id:String,entry_path:String,state:State<'_,SharedState>,)->Result<(),String>",
    "asyncfncommit_view(source_id:String,backup:bool,state:State<'_,SharedState>,)->Result<CommitResult,String>",
    "asyncfncommit_merge(target_side:Side,backup:bool,confirm_signed:bool,state:State<'_,SharedState>,)->Result<CommitResult,String>",
    "fnclear_staged(state:State<'_,SharedState>)->Result<(),String>",
    "fnunstage(entry_path:String,side:Option<Side>,state:State<'_,SharedState>,)->Result<(),String>",
    "asyncfnsearch(side:Side,query:String,options:SearchOptions,state:State<'_,SharedState>,)->Result<Vec<SearchHit>,String>",
    "asyncfnsearch_view_source(source_id:String,query:String,options:SearchOptions,state:State<'_,SharedState>,)->Result<Vec<SearchHit>,String>",
    "asyncfndeep_search(side:Side,query:String,search_id:u64,window:Window,state:State<'_,SharedState>,)->Result<Vec<SearchHit>,String>",
    "asyncfndeep_search_view_source(source_id:String,query:String,search_id:u64,window:Window,state:State<'_,SharedState>,)->Result<Vec<SearchHit>,String>",
    "fncancel_deep_search(state:State<'_,SharedState>)->Result<(),String>",
    "fnprefetch_siblings(side:Side,entry_path:String,state:State<'_,SharedState>,)->Result<(),String>",
    "pubasyncfnlist_system_fonts()->Result<Vec<SystemFont>,String>",
    "asyncfncreate_temp_target(source_side:Side,creation:TempTargetCreation,state:State<'_,SharedState>,)->Result<TempMergeSessionSummary,String>",
    "asyncfnpreview_merge_all_conflicts(source_side:Side,state:State<'_,SharedState>,)->Result<TempMergeConflictPreview,String>",
    "asyncfnstage_temp_merge_all(source_side:Side,decisions:Vec<TempMergeDecision>,state:State<'_,SharedState>,)->Result<(),String>",
    "asyncfnapply_temp_merge(state:State<'_,SharedState>,)->Result<TempMergeSessionSummary,String>",
    "asyncfnsave_temp_target_as(path:String,state:State<'_,SharedState>,)->Result<TempMergeSessionSummary,String>",
    "asyncfndiscard_temp_target(state:State<'_,SharedState>,)->Result<TempTargetDiscardOutcome,String>",
];

fn compact(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn tauri_command_signatures(source: &str) -> Vec<String> {
    let mut signatures = Vec::new();
    let mut remaining = source;
    while let Some(attribute) = remaining.find("#[tauri::command]") {
        let after_attribute = &remaining[attribute + "#[tauri::command]".len()..];
        let header_end = after_attribute
            .find('{')
            .expect("Tauri command must have a function body");
        signatures.push(compact(&after_attribute[..header_end]).replace("pub(crate)", ""));
        remaining = &after_attribute[header_end + 1..];
    }
    signatures
}

fn tauri_command_signature(function_name: &str) -> String {
    COMMAND_SOURCES
        .iter()
        .flat_map(|source| tauri_command_signatures(source))
        .find(|signature| {
            signature.contains(&format!("fn{function_name}("))
                || signature.contains(&format!("fn{function_name}<"))
        })
        .unwrap_or_else(|| panic!("missing Tauri command signature for {function_name}"))
}

fn registered_handler_names(source: &str) -> Vec<&str> {
    let (_, after_macro) = source
        .split_once("tauri::generate_handler![")
        .expect("desktop entrypoint must register Tauri handlers");
    let (handler_list, _) = after_macro
        .split_once(']')
        .expect("Tauri handler list must close");
    handler_list
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect()
}

fn registered_menu_event_handler(source: &str) -> &str {
    let (_, after_registration) = source
        .split_once(".on_menu_event(")
        .expect("desktop composition must register a menu event handler");
    after_registration
        .split_once(')')
        .expect("menu event handler registration must close")
        .0
        .trim()
}

fn registered_run_event_handler(source: &str) -> &str {
    let (_, after_registration) = source
        .split_once(".run(")
        .expect("desktop composition must register a run event handler");
    after_registration
        .split_once(')')
        .expect("run event handler registration must close")
        .0
        .trim()
}

fn function_body<'source>(source: &'source str, function_name: &str) -> &'source str {
    let (_, after_function) = source
        .split_once(&format!("fn {function_name}"))
        .expect("expected event producer function");
    let body_start = after_function
        .find('{')
        .expect("event producer function must have a body");
    let body = &after_function[body_start + 1..];
    let mut depth = 1;
    for (index, character) in body.char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return &body[..index];
                }
            }
            _ => {}
        }
    }
    panic!("event producer function body must close");
}

fn routing_helper_calls(source: &str) -> Vec<&str> {
    let mut calls = [
        ("emit_search_result(", "emit_search_result"),
        ("emit_search_progress(", "emit_search_progress"),
        ("emit_open_paths(", "emit_open_paths"),
        ("emit_app_action(", "emit_app_action"),
        ("store_and_emit_open_paths(", "store_and_emit_open_paths"),
    ]
    .into_iter()
    .flat_map(|(pattern, helper)| {
        source
            .match_indices(pattern)
            .filter(|(index, _)| {
                source[..*index]
                    .chars()
                    .next_back()
                    .is_none_or(|character| !character.is_alphanumeric() && character != '_')
            })
            .map(move |(index, _)| (index, helper))
    })
    .collect::<Vec<_>>();
    calls.sort_by_key(|(index, _)| *index);
    calls.into_iter().map(|(_, helper)| helper).collect()
}

fn emitted_event_constants(source: &str) -> Vec<&str> {
    source
        .split(".emit(")
        .skip(1)
        .map(|after_emit| {
            after_emit
                .split_once(',')
                .expect("event emission must separate name and payload")
                .0
                .trim()
        })
        .collect()
}

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
    assert_eq!(to_value(EntryKind::Directory).unwrap(), json!("directory"));
    assert_eq!(to_value(EntryKind::Class).unwrap(), json!("class"));
    assert_eq!(to_value(EntryKind::Text).unwrap(), json!("text"));
    assert_eq!(to_value(EntryKind::Archive).unwrap(), json!("archive"));
    assert_eq!(to_value(EntryKind::Binary).unwrap(), json!("binary"));
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
fn serializes_text_file_and_compare_source_dtos_with_exact_keys() {
    assert_eq!(
        to_value(TextFileContent {
            path: "/tmp/notes.txt".to_owned(),
            content: "hello".to_owned(),
        })
        .unwrap(),
        json!({
            "path": "/tmp/notes.txt",
            "content": "hello",
        }),
    );
    assert_eq!(
        to_value(CompareSourcesResult {
            left: ArchiveSummary {
                path: "left.jar".to_owned(),
                metadata: metadata(),
                entries: Vec::new(),
            },
            right: ArchiveSummary {
                path: "right.jar".to_owned(),
                metadata: metadata(),
                entries: Vec::new(),
            },
            diff: ArchiveDiff { pairs: Vec::new() },
        })
        .unwrap(),
        json!({
            "left": {
                "path": "left.jar",
                "metadata": {
                    "sourceKind": "archive",
                    "signed": true,
                    "multiRelease": false,
                    "zip64": true,
                },
                "entries": [],
            },
            "right": {
                "path": "right.jar",
                "metadata": {
                    "sourceKind": "archive",
                    "signed": true,
                    "multiRelease": false,
                    "zip64": true,
                },
                "entries": [],
            },
            "diff": {
                "pairs": [],
            },
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
fn locks_temporary_merge_dto_keys_variants_and_required_nulls() {
    assert_eq!(
        to_value(TempMergeSessionSummary {
            id: "temp-merge-1".to_owned(),
            target_side: Side::Right,
            working_name: "working.jar".to_owned(),
            entry_count: 4,
            applied_source_count: 2,
            exported_path: None,
        })
        .unwrap(),
        json!({
            "id": "temp-merge-1",
            "targetSide": "right",
            "workingName": "working.jar",
            "entryCount": 4,
            "appliedSourceCount": 2,
            "exportedPath": null,
        }),
    );
    assert_eq!(
        to_value(TempMergeConflictPreview {
            new_entries: vec!["new.txt".to_owned()],
            conflicts: vec!["same.txt".to_owned()],
        })
        .unwrap(),
        json!({
            "newEntries": ["new.txt"],
            "conflicts": ["same.txt"],
        }),
    );
    assert!(matches!(
        from_value::<TempTargetCreation>(json!({
            "kind": "empty",
            "extension": "jar",
        }))
        .unwrap(),
        TempTargetCreation::Empty { extension } if extension == "jar"
    ));
    assert!(matches!(
        from_value::<TempTargetCreation>(json!({ "kind": "copyCurrent" })).unwrap(),
        TempTargetCreation::CopyCurrent
    ));
    let decision =
        from_value::<TempMergeDecision>(json!({ "entryPath": "same.txt", "action": "skip" }))
            .unwrap();
    assert_eq!(decision.entry_path, "same.txt");
    assert_eq!(decision.action, TempMergeConflictAction::Skip);
    assert_eq!(
        to_value(TempTargetDiscardOutcome::Discarded).unwrap(),
        json!({ "kind": "discarded" }),
    );
    assert_eq!(
        to_value(TempTargetDiscardOutcome::RetryDiscardOnly {
            message: "cleanup failed".to_owned(),
        })
        .unwrap(),
        json!({
            "kind": "retryDiscardOnly",
            "message": "cleanup failed",
        }),
    );
}

#[test]
fn serializes_search_payloads_and_omits_absent_hit_details() {
    assert_eq!(to_value(SearchHitKind::Path).unwrap(), json!("path"));
    assert_eq!(to_value(SearchHitKind::Text).unwrap(), json!("text"));
    assert_eq!(
        to_value(SearchHitKind::ConstantPool).unwrap(),
        json!("constantPool"),
    );
    assert_eq!(to_value(SearchHitKind::Source).unwrap(), json!("source"));

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
    assert_eq!(registered_handler_names(LIB_SOURCE), COMMAND_NAMES);
    assert_eq!(
        COMMAND_SIGNATURE_NAMES
            .iter()
            .map(|name| tauri_command_signature(name))
            .collect::<Vec<_>>(),
        COMMAND_SIGNATURES,
    );
    assert_eq!(
        [SEARCH_RESULT, SEARCH_PROGRESS, OS_OPEN_PATHS, APP_ACTION],
        EVENT_NAMES,
    );
    assert_eq!(
        emitted_event_constants(EVENTS_SOURCE),
        [
            "SEARCH_RESULT",
            "SEARCH_PROGRESS",
            "OS_OPEN_PATHS",
            "APP_ACTION"
        ],
    );
}

#[test]
fn locks_each_deep_search_producer_to_result_then_progress_events() {
    assert_eq!(
        routing_helper_calls(function_body(SEARCH_COMMANDS_SOURCE, "deep_search")),
        ["emit_search_result", "emit_search_progress"],
    );
    assert_eq!(
        routing_helper_calls(function_body(
            SEARCH_COMMANDS_SOURCE,
            "deep_search_view_source"
        )),
        ["emit_search_result", "emit_search_progress"],
    );
}

#[test]
fn locks_native_open_and_menu_producers_to_their_event_helpers() {
    let open_paths = function_body(MENU_SOURCE, "store_and_emit_open_paths");
    assert_eq!(routing_helper_calls(open_paths), ["emit_open_paths"]);
    assert!(
        open_paths.find("push_pending_open_paths").unwrap()
            < open_paths.find("emit_open_paths").unwrap(),
        "native open paths must be stored before their event is emitted",
    );
    assert_eq!(registered_run_event_handler(LIB_SOURCE), "handle_run_event");
    assert_eq!(
        routing_helper_calls(function_body(LIB_SOURCE, "run")),
        ["store_and_emit_open_paths"],
    );
    assert_eq!(
        routing_helper_calls(function_body(MENU_SOURCE, "handle_run_event")),
        ["store_and_emit_open_paths"],
    );

    assert_eq!(
        registered_menu_event_handler(LIB_SOURCE),
        "handle_menu_event"
    );
    assert_eq!(
        routing_helper_calls(function_body(MENU_SOURCE, "handle_menu_event")),
        ["emit_app_action"],
    );
}
