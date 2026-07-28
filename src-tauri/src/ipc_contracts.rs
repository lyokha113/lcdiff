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

const MAIN_SOURCE: &str = include_str!("main.rs");
const SYSTEM_FONTS_SOURCE: &str = include_str!("system_fonts.rs");

const COMMAND_SIGNATURES: [&str; 30] = [
    "fnvalidate_path(raw:String)->Result<String,String>",
    "fnplatform_hints()->PlatformHints",
    "fnpending_open_paths(state:State<'_,SharedState>)->Result<Vec<String>,String>",
    "asyncfnopen_archive(path:String,side:Side,state:State<'_,SharedState>,)->Result<ArchiveSummary,String>",
    "asyncfncompute_diff(state:State<'_,SharedState>)->Result<ArchiveDiff,String>",
    "asyncfncompute_nested_diff(nested_path:String,state:State<'_,SharedState>,)->Result<ArchiveDiff,String>",
    "asyncfnopen_view_source(path:String,state:State<'_,SharedState>,)->Result<ViewSourceSummary,String>",
    "fnlist_view_sources(state:State<'_,SharedState>)->Result<Vec<ViewSourceSummary>,String>",
    "asyncfnread_entry(side:Side,entry_path:String,state:State<'_,SharedState>,)->Result<EntryPreview,String>",
    "asyncfnread_view_entry(source_id:String,entry_path:String,state:State<'_,SharedState>,)->Result<EntryPreview,String>",
    "asyncfncompute_view_nested_entries(source_id:String,nested_path:String,state:State<'_,SharedState>,)->Result<ArchiveDiff,String>",
    "fnclose_view_source(source_id:String,state:State<'_,SharedState>)->Result<(),String>",
    "fnset_engine(engine:DecompileEngine,state:State<'_,SharedState>)->Result<(),String>",
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
        signatures.push(compact(&after_attribute[..header_end]));
        remaining = &after_attribute[header_end + 1..];
    }
    signatures
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

fn function_body<'source>(source: &'source str, function_name: &str) -> &'source str {
    let (_, after_function) = source
        .split_once(&format!("fn {function_name}"))
        .expect("expected IPC event call-site function");
    let body_start = after_function
        .find('{')
        .expect("IPC event call-site function must have a body");
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
    panic!("IPC event call-site function body must close");
}

fn emitted_event_names(source: &str) -> Vec<&str> {
    source
        .split(".emit(")
        .skip(1)
        .map(|after_emit| {
            let (_, after_open_quote) = after_emit
                .split_once('"')
                .expect("event name must be a string literal");
            let (event_name, _) = after_open_quote
                .split_once('"')
                .expect("event name literal must close");
            event_name
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
    assert_eq!(registered_handler_names(MAIN_SOURCE), COMMAND_NAMES);
    assert_eq!(
        tauri_command_signatures(MAIN_SOURCE)
            .into_iter()
            .chain(tauri_command_signatures(SYSTEM_FONTS_SOURCE))
            .collect::<Vec<_>>(),
        COMMAND_SIGNATURES,
    );

    assert_eq!(
        emitted_event_names(function_body(MAIN_SOURCE, "deep_search")),
        ["search-result", "search-progress"],
    );
    assert_eq!(
        emitted_event_names(function_body(MAIN_SOURCE, "deep_search_view_source")),
        ["search-result", "search-progress"],
    );
    assert_eq!(
        emitted_event_names(function_body(MAIN_SOURCE, "store_and_emit_open_paths")),
        ["os-open-paths"],
    );
    let (_, menu_callback) = MAIN_SOURCE
        .split_once(".on_menu_event")
        .expect("desktop entrypoint must define the menu callback");
    let (menu_callback, _) = menu_callback
        .split_once(".invoke_handler")
        .expect("menu callback must precede handler registration");
    assert_eq!(emitted_event_names(menu_callback), ["app-action"]);
    assert_eq!(
        emitted_event_names(MAIN_SOURCE)
            .into_iter()
            .fold(Vec::new(), |mut names, event| {
                if !names.contains(&event) {
                    names.push(event);
                }
                names
            }),
        EVENT_NAMES,
    );
}
