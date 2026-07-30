use std::sync::{Arc, Mutex};

use lcdiff_core::EntryKind;
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod archive_access;
mod commands;
mod events;
#[cfg(test)]
mod ipc_contracts;
mod menu;
mod sidecar_process;
mod state;
mod system_fonts;

#[cfg(test)]
use archive_access::{
    resolve_optional_side_nested_archive, resolve_view_entry, resolve_view_nested_archive,
};
use commands::{
    cancel_deep_search, clear_staged, close_view_source, commit_merge, commit_view, compute_diff,
    compute_nested_diff, compute_view_nested_entries, deep_search, deep_search_view_source,
    disassemble, disassemble_view_entry, list_system_fonts, list_view_sources, open_archive,
    open_compare_sources, open_view_source, pending_open_paths, platform_hints, prefetch_siblings,
    read_entry, read_text_file, read_view_entry, search, search_view_source, set_engine,
    stage_copy, stage_view_write, stage_write, unstage, unstage_view_write, validate_path,
};
#[cfg(test)]
use commands::{
    class_source_path, compute_nested_diff_from_archives, deep_search_hit, is_prefetch_sibling,
    language_for_path, one_sided_diff, platform_hints_from, read_entry_preview,
    read_text_file_from_path, search_archive,
};
use menu::{
    handle_menu_event, handle_run_event, install_app_menu, open_paths_from_args, path_strings,
    startup_open_paths, store_and_emit_open_paths,
};
#[cfg(test)]
use sidecar_process::SidecarClient;
use state::AppState;
#[cfg(test)]
use state::{ViewSourceSummary, side_snapshot};

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            store_and_emit_open_paths(app, open_paths_from_args(args));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            install_app_menu(app)?;
            let mut state = AppState::new(app.path().resource_dir().ok());
            state.push_pending_open_paths(path_strings(startup_open_paths()));
            let sidecar = Arc::clone(&state.sidecar);
            std::thread::spawn(move || {
                if let Ok(mut sidecar) = sidecar.lock() {
                    sidecar.warm_start().ok();
                }
            });
            app.manage(Arc::new(Mutex::new(state)));
            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            validate_path,
            platform_hints,
            list_system_fonts,
            open_archive,
            open_compare_sources,
            compute_diff,
            compute_nested_diff,
            open_view_source,
            list_view_sources,
            read_entry,
            read_text_file,
            read_view_entry,
            compute_view_nested_entries,
            close_view_source,
            set_engine,
            disassemble,
            disassemble_view_entry,
            stage_copy,
            stage_write,
            stage_view_write,
            unstage_view_write,
            commit_view,
            commit_merge,
            clear_staged,
            unstage,
            search,
            search_view_source,
            deep_search,
            deep_search_view_source,
            cancel_deep_search,
            prefetch_siblings,
            pending_open_paths
        ])
        .build(tauri::generate_context!())
        .expect("error while building LCDiff")
        .run(handle_run_event);
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        fs::File,
        io::Write,
        path::{Path, PathBuf},
        sync::{Arc, Mutex, mpsc},
    };

    use tempfile::{TempDir, tempdir};
    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::archive_access::{
        open_archive_from_path, open_compare_archives_from_paths, open_view_archive_from_path,
    };
    use super::events::AppActionPayload;
    use super::menu::{MENU_ACTIONS, close_window_placement, store_and_emit_open_paths};
    #[cfg(not(target_os = "macos"))]
    use super::menu::{build_app_menu, install_app_menu};
    use super::sidecar_process::sidecar_clients_share_cache;
    use super::state::{
        TempMergeConflictAction, TempMergeDecision, TempTargetCreation, create_temp_target,
        discard_temp_target, discard_temp_target_with_cleanup,
        discard_temp_target_with_cleanup_and_write, install_prepared_compare_archives,
        install_prepared_temp_target, prepare_compare_archives, prepare_temp_target,
        prepare_temp_target_with_lock_probe,
    };
    use super::{
        AppState, SearchHit, SearchHitKind, SearchOptions, Side, SidecarClient, ViewSourceSummary,
        class_source_path, compute_nested_diff_from_archives, deep_search_hit, is_prefetch_sibling,
        language_for_path, one_sided_diff, platform_hints_from, read_entry_preview,
        read_text_file_from_path, resolve_optional_side_nested_archive, resolve_view_entry,
        resolve_view_nested_archive, search_archive, side_snapshot, validate_path,
    };
    use lcdiff_core::{Archive, ArchiveSourceKind, DecompileEngine};
    #[cfg(not(target_os = "macos"))]
    use tauri::Manager;
    use tauri::{Listener, Manager as _};

    #[test]
    fn menu_action_ids_are_unique() {
        let ids = MENU_ACTIONS
            .iter()
            .map(|(_, action_id, _, _)| *action_id)
            .collect::<HashSet<_>>();

        assert_eq!(ids.len(), MENU_ACTIONS.len());
    }

    #[test]
    fn menu_action_accelerators_are_unique() {
        let accelerators = MENU_ACTIONS
            .iter()
            .map(|(_, _, _, accelerator)| *accelerator)
            .collect::<HashSet<_>>();

        assert_eq!(accelerators.len(), MENU_ACTIONS.len());
    }

    #[test]
    fn menu_action_accelerators_are_accepted_by_tauri_builder() {
        let app = tauri::test::mock_app();

        for (_, action_id, label, accelerator) in MENU_ACTIONS {
            tauri::menu::MenuItemBuilder::with_id(*action_id, *label)
                .accelerator(*accelerator)
                .build(&app)
                .unwrap_or_else(|error| {
                    panic!("invalid accelerator {accelerator} for {action_id}: {error}")
                });
        }
    }

    #[test]
    fn menu_actions_include_expected_file_and_help_entries() {
        assert_eq!(
            &MENU_ACTIONS[..4],
            [
                ("File", "file.openLeftFile", "Open Left File", "CmdOrCtrl+O"),
                (
                    "File",
                    "file.openLeftDirectory",
                    "Open Left Directory",
                    "CmdOrCtrl+Alt+O",
                ),
                (
                    "File",
                    "file.openRightFile",
                    "Open Right File",
                    "CmdOrCtrl+Shift+O",
                ),
                (
                    "File",
                    "file.openRightDirectory",
                    "Open Right Directory",
                    "CmdOrCtrl+Alt+Shift+O",
                ),
            ]
        );
        assert_eq!(
            MENU_ACTIONS.last().copied(),
            Some((
                "Help",
                "help.showShortcuts",
                "Keyboard Shortcuts",
                "CmdOrCtrl+/",
            ))
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn constructed_non_macos_menu_owns_close_window_only_in_window() {
        let app = tauri::test::mock_app();
        let menu = build_app_menu(&app).unwrap();

        assert_eq!(close_window_count(&menu, "File"), 0);
        assert_eq!(close_window_count(&menu, "Window"), 1);
    }

    #[test]
    fn macos_menu_policy_omits_predefined_close_window() {
        let placement = close_window_placement("macos");

        assert!(!placement.file);
        assert!(!placement.window);
    }

    #[cfg(not(target_os = "macos"))]
    fn close_window_count<R: tauri::Runtime>(menu: &tauri::menu::Menu<R>, group: &str) -> usize {
        let items = menu.items().expect("top-level menu items");
        let submenu = items
            .iter()
            .filter_map(|item| item.as_submenu())
            .find(|submenu| submenu.text().is_ok_and(|text| text == group))
            .unwrap_or_else(|| panic!("missing {group} submenu"));

        submenu
            .items()
            .expect("submenu items")
            .into_iter()
            .filter_map(|item| item.as_predefined_menuitem().cloned())
            .filter(|item| {
                item.text().is_ok_and(|text| {
                    matches!(text.replace('&', "").as_str(), "Close" | "Close Window")
                })
            })
            .count()
    }

    #[test]
    fn menu_actions_follow_expected_group_order() {
        let groups = MENU_ACTIONS.iter().map(|(group, _, _, _)| *group).fold(
            Vec::new(),
            |mut groups, group| {
                if groups.last() != Some(&group) {
                    groups.push(group);
                }
                groups
            },
        );

        assert_eq!(
            groups,
            [
                "File",
                "Edit",
                "Search",
                "View",
                "Workspace",
                "Merge",
                "Help"
            ]
        );
        for (group, expected_count) in [
            ("File", 6),
            ("Edit", 1),
            ("Search", 2),
            ("View", 1),
            ("Workspace", 4),
            ("Merge", 6),
            ("Help", 1),
        ] {
            let actual_count = MENU_ACTIONS
                .iter()
                .filter(|(action_group, _, _, _)| *action_group == group)
                .count();
            assert_eq!(
                actual_count, expected_count,
                "unexpected {group} action count"
            );
        }
    }

    #[test]
    fn menu_actions_match_frontend_action_definitions() {
        let frontend = include_str!("../../src/lib/actions.ts");
        let normalized_frontend = frontend
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        let action_count = frontend.matches("group: \"").count();

        assert_eq!(action_count, MENU_ACTIONS.len());
        for (group, action_id, label, shortcut) in MENU_ACTIONS {
            let signature = format!(
                "{{id:\"{action_id}\",label:\"{label}\",group:\"{group}\",shortcut:\"{shortcut}\""
            );
            let normalized_signature = signature
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>();
            assert!(
                normalized_frontend.contains(&normalized_signature),
                "frontend action definition does not match: {signature}"
            );
        }
    }

    #[test]
    fn app_action_payload_serializes_camel_case() {
        let payload = AppActionPayload {
            action_id: "search.toggle".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({ "actionId": "search.toggle" })
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn full_app_menu_builds_with_standard_and_custom_groups() {
        let app = tauri::test::mock_app();

        install_app_menu(&app).unwrap();
        let labels = app
            .menu()
            .unwrap()
            .items()
            .unwrap()
            .into_iter()
            .map(|item| item.as_submenu_unchecked().text().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            labels,
            [
                "File",
                "Edit",
                "Search",
                "View",
                "Workspace",
                "Merge",
                "Window",
                "Help",
            ]
        );

        let help_texts = menu_texts_for_group(&app.menu().unwrap(), "Help");
        assert_eq!(help_texts.len(), 3);
        assert_eq!(help_texts[0], "Keyboard Shortcuts");
        assert_eq!(help_texts[1], "");
        assert!(help_texts[2].contains("About"));
    }

    #[cfg(not(target_os = "macos"))]
    fn menu_texts_for_group<R: tauri::Runtime>(
        menu: &tauri::menu::Menu<R>,
        group: &str,
    ) -> Vec<String> {
        let items = menu.items().expect("top-level menu items");
        let submenu = items
            .iter()
            .filter_map(|item| item.as_submenu())
            .find(|submenu| submenu.text().is_ok_and(|text| text == group))
            .unwrap_or_else(|| panic!("missing {group} submenu"));

        submenu
            .items()
            .expect("submenu items")
            .into_iter()
            .map(|item| {
                if let Some(menu_item) = item.as_menuitem() {
                    menu_item.text().expect("menu item text")
                } else if let Some(predefined) = item.as_predefined_menuitem() {
                    predefined.text().expect("predefined menu item text")
                } else if let Some(submenu) = item.as_submenu() {
                    submenu.text().expect("submenu text")
                } else {
                    panic!("unsupported menu item type")
                }
            })
            .collect()
    }

    #[test]
    fn app_state_defaults_to_vineflower() {
        let state = AppState::default();

        assert_eq!(state.engine, DecompileEngine::Vineflower);
    }

    #[test]
    fn app_state_new_creates_distinct_sidecar_workers_with_one_shared_cache() {
        let state = AppState::new(None);

        assert!(!Arc::ptr_eq(&state.sidecar, &state.prefetch_sidecar));
        assert!(!Arc::ptr_eq(&state.sidecar, &state.deep_search_sidecar));
        assert!(!Arc::ptr_eq(
            &state.prefetch_sidecar,
            &state.deep_search_sidecar
        ));

        let sidecar = state.sidecar.lock().expect("interactive sidecar lock");
        let prefetch = state
            .prefetch_sidecar
            .lock()
            .expect("prefetch sidecar lock");
        let deep_search = state
            .deep_search_sidecar
            .lock()
            .expect("deep-search sidecar lock");
        assert!(sidecar_clients_share_cache(&sidecar, &prefetch));
        assert!(sidecar_clients_share_cache(&sidecar, &deep_search));
    }

    #[test]
    fn app_state_drains_pending_open_paths_before_accepting_more() {
        let mut state = AppState::new(None);
        state.push_pending_open_paths(vec!["left.jar".to_owned(), "right.jar".to_owned()]);

        assert_eq!(
            state.take_pending_open_paths(),
            ["left.jar".to_owned(), "right.jar".to_owned()]
        );
        assert!(state.take_pending_open_paths().is_empty());

        state.push_pending_open_paths(vec!["later.jar".to_owned()]);
        assert_eq!(state.take_pending_open_paths(), ["later.jar".to_owned()]);
    }

    #[test]
    fn app_state_replaces_left_and_right_nested_caches_with_each_source() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first_left = dir.path().join("first-left.jar");
        let second_left = dir.path().join("second-left.jar");
        let first_right = dir.path().join("first-right.jar");
        let second_right = dir.path().join("second-right.jar");
        for path in [&first_left, &second_left, &first_right, &second_right] {
            write_zip(path, &[("entry.txt", b"content")]);
        }

        let mut state = AppState::new(None);
        state
            .install_archive(
                Archive::open(first_left.to_string_lossy()).expect("open first left"),
                Side::Left,
            )
            .expect("install first left");
        state
            .install_archive(
                Archive::open(first_right.to_string_lossy()).expect("open first right"),
                Side::Right,
            )
            .expect("install first right");
        let left_cache = Arc::clone(&state.left_nested);
        let right_cache = Arc::clone(&state.right_nested);

        state
            .install_archive(
                Archive::open(second_left.to_string_lossy()).expect("open second left"),
                Side::Left,
            )
            .expect("replace left");
        state
            .install_archive(
                Archive::open(second_right.to_string_lossy()).expect("open second right"),
                Side::Right,
            )
            .expect("replace right");

        assert!(!Arc::ptr_eq(&left_cache, &state.left_nested));
        assert!(!Arc::ptr_eq(&right_cache, &state.right_nested));
    }

    #[test]
    fn app_state_resets_side_nested_cache_after_successful_commit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let archive_path = dir.path().join("left.jar");
        write_zip(&archive_path, &[("entry.txt", b"before")]);

        let mut state = AppState::new(None);
        state
            .install_archive(
                Archive::open(archive_path.to_string_lossy()).expect("open archive"),
                Side::Left,
            )
            .expect("install archive");
        state
            .stage_write(Side::Left, "entry.txt", "after")
            .expect("stage write");
        let nested_cache = Arc::clone(&state.left_nested);

        state
            .commit_merge(Side::Left, false, false)
            .expect("commit merge");

        assert!(!Arc::ptr_eq(&nested_cache, &state.left_nested));
    }

    #[test]
    fn app_state_resets_view_nested_cache_on_replacement_and_commit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let archive_path = dir.path().join("view.jar");
        write_zip(&archive_path, &[("entry.txt", b"before")]);

        let mut state = AppState::new(None);
        let first =
            open_view_source_through_production(&mut state, archive_path.display().to_string())
                .expect("open first view source");
        let first_cache = state
            .view_source_snapshot(&first.id)
            .expect("first snapshot")
            .nested;

        let replacement =
            open_view_source_through_production(&mut state, archive_path.display().to_string())
                .expect("replace view source");
        let replacement_cache = state
            .view_source_snapshot(&replacement.id)
            .expect("replacement snapshot")
            .nested;
        assert!(!Arc::ptr_eq(&first_cache, &replacement_cache));

        state
            .stage_view_write(&replacement.id, "entry.txt", "after")
            .expect("stage view write");
        state
            .commit_view(&replacement.id, false)
            .expect("commit view source");
        let committed_cache = state
            .view_source_snapshot(&replacement.id)
            .expect("committed snapshot")
            .nested;
        assert!(!Arc::ptr_eq(&replacement_cache, &committed_cache));
    }

    #[test]
    fn app_state_open_paths_are_stored_before_the_os_open_event() {
        let app = tauri::test::mock_app();
        let state = Arc::new(std::sync::Mutex::new(AppState::new(None)));
        app.manage(Arc::clone(&state));
        let observed_state = Arc::clone(&state);
        let (sender, receiver) = mpsc::channel();
        app.listen("os-open-paths", move |_| {
            let paths = observed_state
                .lock()
                .expect("state lock at event delivery")
                .take_pending_open_paths();
            sender.send(paths).expect("send observed paths");
        });
        let left = PathBuf::from("left.jar");
        let right = PathBuf::from("right.jar");

        store_and_emit_open_paths(app.handle(), vec![left, right]);

        assert_eq!(
            receiver.recv().expect("os-open-paths event"),
            ["left.jar".to_owned(), "right.jar".to_owned()]
        );
    }

    #[test]
    fn view_sources_open_read_and_close_independently() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first_path = dir.path().join("first.jar");
        let second_path = dir.path().join("second.jar");
        write_zip(&first_path, &[("a.txt", b"first")]);
        write_zip(&second_path, &[("a.txt", b"second")]);

        let mut state = AppState::new(None);
        let first =
            open_view_source_through_production(&mut state, first_path.display().to_string())
                .expect("open first view source");
        let second =
            open_view_source_through_production(&mut state, second_path.display().to_string())
                .expect("open second view source");

        assert_ne!(first.id, second.id);
        assert_eq!(first.name, "first.jar");
        assert_eq!(first.kind, ArchiveSourceKind::Archive);
        assert_eq!(first.entry_count, 1);
        assert_eq!(state.view_sources.len(), 2);

        let first_entry = state
            .view_source_archive(&first.id)
            .expect("first source")
            .read_entry("a.txt")
            .expect("read first");
        let second_entry = state
            .view_source_archive(&second.id)
            .expect("second source")
            .read_entry("a.txt")
            .expect("read second");

        assert_eq!(first_entry, b"first");
        assert_eq!(second_entry, b"second");

        state.close_view_source(&first.id).expect("close first");
        assert!(state.view_source_archive(&first.id).is_err());
        assert!(state.view_source_archive(&second.id).is_ok());
    }

    #[test]
    fn view_source_ids_are_stable_for_canonical_paths() {
        let dir = tempfile::tempdir().expect("temp dir");
        let archive_path = dir.path().join("app.jar");
        write_zip(&archive_path, &[("a.txt", b"content")]);
        let alias_path = archive_alias_path(&archive_path);

        let mut state = AppState::new(None);
        let first =
            open_view_source_through_production(&mut state, archive_path.display().to_string())
                .expect("first open");
        let second =
            open_view_source_through_production(&mut state, alias_path.display().to_string())
                .expect("second open");

        assert_ne!(
            archive_path.display().to_string(),
            alias_path.display().to_string()
        );
        assert_eq!(first.id, second.id);
        assert_eq!(state.view_sources.len(), 1);
    }

    #[test]
    fn list_view_sources_returns_current_summaries_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first_path = dir.path().join("first.jar");
        let second_path = dir.path().join("second.jar");
        write_zip(&first_path, &[("a.txt", b"first")]);
        write_zip(&second_path, &[("b.txt", b"second")]);

        let mut state = AppState::new(None);
        let first =
            open_view_source_through_production(&mut state, first_path.display().to_string())
                .expect("open first");
        let second =
            open_view_source_through_production(&mut state, second_path.display().to_string())
                .expect("open second");

        let listed = state.list_view_sources();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, first.id);
        assert_eq!(listed[0].name, "first.jar");
        assert_eq!(listed[0].kind, ArchiveSourceKind::Archive);
        assert_eq!(listed[0].entry_count, 1);
        assert_eq!(listed[1].id, second.id);
        assert_eq!(listed[1].name, "second.jar");

        state.close_view_source(&first.id).expect("close first");

        let listed = state.list_view_sources();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, second.id);
    }

    #[test]
    fn view_source_summary_serializes_final_contract() {
        let summary = ViewSourceSummary {
            id: "view:/tmp/app.jar".to_owned(),
            path: "/tmp/app.jar".to_owned(),
            name: "app.jar".to_owned(),
            kind: ArchiveSourceKind::Archive,
            signed: false,
            entry_count: 7,
        };

        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            serde_json::json!({
                "id": "view:/tmp/app.jar",
                "path": "/tmp/app.jar",
                "name": "app.jar",
                "kind": "archive",
                "signed": false,
                "entryCount": 7
            })
        );
    }

    #[test]
    fn view_source_nested_entry_reads_from_inner_archive() {
        let dir = tempfile::tempdir().expect("temp dir");
        let outer_path = create_nested_view_archive(dir.path());

        let mut state = AppState::new(None);
        let source =
            open_view_source_through_production(&mut state, outer_path.display().to_string())
                .expect("open nested view source");
        let snapshot = state
            .view_source_snapshot(&source.id)
            .expect("nested source snapshot");

        let (archive, leaf) = resolve_view_entry(&snapshot, "lib/inner.jar!/docs/file.txt")
            .expect("resolve view entry");
        let preview = read_entry_preview(
            &archive,
            DecompileEngine::Cfr,
            &std::sync::Mutex::new(SidecarClient::default()),
            leaf,
        )
        .expect("read nested preview");

        assert_eq!(preview.path, "docs/file.txt");
        assert_eq!(preview.content, "nested-content");
    }

    #[test]
    fn view_source_nested_diff_lists_inner_entries() {
        let dir = tempfile::tempdir().expect("temp dir");
        let outer_path = create_nested_view_archive(dir.path());

        let mut state = AppState::new(None);
        let source =
            open_view_source_through_production(&mut state, outer_path.display().to_string())
                .expect("open nested view source");
        let snapshot = state
            .view_source_snapshot(&source.id)
            .expect("nested source snapshot");

        let archive = resolve_view_nested_archive(&snapshot, "lib/inner.jar")
            .expect("resolve nested archive");
        let diff = one_sided_diff(&archive, Side::Left);

        assert_eq!(diff.pairs.len(), 1);
        assert_eq!(diff.pairs[0].path, "docs/file.txt");
        assert!(diff.pairs[0].left.is_some());
        assert!(diff.pairs[0].right.is_none());
    }

    #[test]
    fn view_source_root_diff_lists_root_entries() {
        let dir = tempfile::tempdir().expect("temp dir");
        let archive_path = dir.path().join("root.jar");
        write_zip(&archive_path, &[("root.txt", b"root-content")]);

        let mut state = AppState::new(None);
        let source =
            open_view_source_through_production(&mut state, archive_path.display().to_string())
                .expect("open view source");
        let snapshot = state
            .view_source_snapshot(&source.id)
            .expect("view source snapshot");

        let archive = resolve_view_nested_archive(&snapshot, "").expect("resolve root archive");
        let diff = one_sided_diff(&archive, Side::Left);

        assert_eq!(diff.pairs.len(), 1);
        assert_eq!(diff.pairs[0].path, "root.txt");
        assert!(diff.pairs[0].left.is_some());
        assert!(diff.pairs[0].right.is_none());
    }

    #[test]
    fn view_source_stages_and_commits_editable_text() {
        let dir = tempfile::tempdir().expect("temp dir");
        let archive_path = dir.path().join("editable.jar");
        write_zip(&archive_path, &[("config.json", b"{\"v\":1}\n")]);

        let mut state = AppState::new(None);
        let source =
            open_view_source_through_production(&mut state, archive_path.display().to_string())
                .expect("open view source");
        state
            .stage_view_write(&source.id, "config.json", "{\"v\":2}\n")
            .expect("stage view edit");
        assert!(state.close_view_source(&source.id).is_err());

        state
            .commit_view(&source.id, false)
            .expect("commit view edit");
        let bytes = state
            .view_source_archive(&source.id)
            .expect("view source archive")
            .read_entry("config.json")
            .expect("read committed entry");
        assert_eq!(bytes, b"{\"v\":2}\n");
    }

    #[test]
    fn view_source_close_and_reopen_rebuilds_nested_cache() {
        let dir = tempfile::tempdir().expect("temp dir");
        let outer_path = create_nested_view_archive(dir.path());

        let mut state = AppState::new(None);
        let first =
            open_view_source_through_production(&mut state, outer_path.display().to_string())
                .expect("first open");
        let first_snapshot = state
            .view_source_snapshot(&first.id)
            .expect("first snapshot");
        let (_, first_leaf) = resolve_view_entry(&first_snapshot, "lib/inner.jar!/docs/file.txt")
            .expect("resolve first nested entry");
        assert_eq!(first_leaf, "docs/file.txt");

        state
            .close_view_source(&first.id)
            .expect("close first source");
        assert!(state.view_sources.is_empty());

        let second =
            open_view_source_through_production(&mut state, outer_path.display().to_string())
                .expect("reopen source");
        let second_snapshot = state
            .view_source_snapshot(&second.id)
            .expect("second snapshot");
        let (archive, leaf) = resolve_view_entry(&second_snapshot, "lib/inner.jar!/docs/file.txt")
            .expect("resolve second nested entry");
        let preview = read_entry_preview(
            &archive,
            DecompileEngine::Cfr,
            &std::sync::Mutex::new(SidecarClient::default()),
            leaf,
        )
        .expect("read nested preview after reopen");

        assert_eq!(first.id, second.id);
        assert_eq!(state.view_sources.len(), 1);
        assert_eq!(preview.content, "nested-content");
    }

    #[test]
    fn compute_nested_diff_returns_one_sided_when_nested_archive_missing_on_other_side() {
        let dir = tempfile::tempdir().expect("temp dir");
        let left_path = create_nested_view_archive(dir.path());
        let right_path = dir.path().join("right.jar");
        create_zip(&right_path, &[("plain.txt", b"right-only")]);

        let mut state = AppState::default();
        load_archive_through_production(&mut state, left_path.to_str().unwrap(), Side::Left)
            .expect("load left");
        load_archive_through_production(&mut state, right_path.to_str().unwrap(), Side::Right)
            .expect("load right");

        let left = side_snapshot(&state, Side::Left).expect("left snapshot");
        let right = side_snapshot(&state, Side::Right).expect("right snapshot");

        let left_archive = tauri::async_runtime::block_on(resolve_optional_side_nested_archive(
            Some(left),
            "lib/inner.jar".to_owned(),
        ))
        .expect("left nested archive");
        let right_archive = tauri::async_runtime::block_on(resolve_optional_side_nested_archive(
            Some(right),
            "lib/inner.jar".to_owned(),
        ))
        .expect("right nested archive should be optional");

        let diff = compute_nested_diff_from_archives(left_archive, right_archive)
            .expect("one-sided nested diff");

        assert_eq!(diff.pairs.len(), 1);
        assert_eq!(diff.pairs[0].path, "docs/file.txt");
        assert!(diff.pairs[0].left.is_some());
        assert!(diff.pairs[0].right.is_none());
    }

    #[test]
    fn search_hit_serializes_camel_case_and_omits_none() {
        let constant_pool_hit =
            SearchHit::new("pkg/A.class".to_owned(), SearchHitKind::ConstantPool)
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
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        load_archive_through_production(&mut state, right.to_str().unwrap(), Side::Right).unwrap();

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
            load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left)
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
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        load_archive_through_production(&mut state, right.to_str().unwrap(), Side::Right).unwrap();
        state.stage_copy(Side::Left, Side::Right, "a.txt").unwrap();

        state.clear_staged();

        assert!(!state.any_pending());
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
    }

    #[test]
    fn unstage_last_copy_unlocks_archive_switch() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("right.jar");
        create_zip(&left, &[("a.txt", b"left")]);
        create_zip(&right, &[("a.txt", b"right")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        load_archive_through_production(&mut state, right.to_str().unwrap(), Side::Right).unwrap();
        state.stage_copy(Side::Left, Side::Right, "a.txt").unwrap();

        state.unstage("a.txt", None).unwrap();

        assert!(!state.any_pending());
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
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
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        load_archive_through_production(&mut state, right.to_str().unwrap(), Side::Right).unwrap();
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

        assert_eq!(preview.kind, lcdiff_core::EntryKind::Directory);
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

    fn temp_session_with_source_and_target(
        source_entries: &[(&str, &[u8])],
        target_entries: &[(&str, &[u8])],
    ) -> (TempDir, AppState) {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let target_seed = dir.path().join("target-seed.jar");
        create_zip(&source, source_entries);
        create_zip(&target_seed, target_entries);

        let mut state = AppState::default();
        load_archive_through_production(&mut state, target_seed.to_str().unwrap(), Side::Left)
            .unwrap();
        create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
            .unwrap();
        state
            .install_archive(Archive::open(source.to_string_lossy()).unwrap(), Side::Left)
            .unwrap();

        (dir, state)
    }

    #[test]
    fn temp_merge_all_previews_and_stages_files_in_deterministic_order() {
        let (_dir, mut state) = temp_session_with_source_and_target(
            &[
                ("z-new.txt", b"z-source"),
                ("c-conflict.txt", b"c-source"),
                ("folder/", b""),
                ("a-new.txt", b"a-source"),
                ("b-conflict.txt", b"b-source"),
            ],
            &[
                ("c-conflict.txt", b"c-target"),
                ("b-conflict.txt", b"b-target"),
            ],
        );

        let preview = state.preview_temp_merge_all(Side::Left).unwrap();
        assert_eq!(preview.new_entries, ["a-new.txt", "z-new.txt"]);
        assert_eq!(preview.conflicts, ["b-conflict.txt", "c-conflict.txt"]);

        state
            .stage_temp_merge_all(
                Side::Left,
                vec![
                    TempMergeDecision {
                        entry_path: "c-conflict.txt".to_owned(),
                        action: TempMergeConflictAction::Skip,
                    },
                    TempMergeDecision {
                        entry_path: "b-conflict.txt".to_owned(),
                        action: TempMergeConflictAction::Overwrite,
                    },
                ],
            )
            .unwrap();

        let staged_paths = state
            .right_plan
            .staged()
            .iter()
            .map(|op| op.target_entry_path())
            .collect::<Vec<_>>();
        assert_eq!(staged_paths, ["a-new.txt", "b-conflict.txt", "z-new.txt"]);

        state.commit_merge(Side::Right, false, true).unwrap();
        let target = state.right.as_ref().unwrap();
        assert_eq!(target.read_entry("a-new.txt").unwrap(), b"a-source");
        assert_eq!(target.read_entry("z-new.txt").unwrap(), b"z-source");
        assert_eq!(target.read_entry("b-conflict.txt").unwrap(), b"b-source");
        assert_eq!(target.read_entry("c-conflict.txt").unwrap(), b"c-target");
        assert!(target.entry("folder/").is_none());
    }

    #[test]
    fn temp_merge_all_requires_exactly_one_known_decision_per_conflict() {
        let (_dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"new"), ("same.txt", b"source")],
            &[("same.txt", b"target")],
        );
        state
            .right_plan
            .stage_write("preserved.txt", b"preserved".to_vec())
            .unwrap();

        let invalid_decisions = [
            vec![],
            vec![
                TempMergeDecision {
                    entry_path: "same.txt".to_owned(),
                    action: TempMergeConflictAction::Overwrite,
                },
                TempMergeDecision {
                    entry_path: "same.txt".to_owned(),
                    action: TempMergeConflictAction::Skip,
                },
            ],
            vec![
                TempMergeDecision {
                    entry_path: "same.txt".to_owned(),
                    action: TempMergeConflictAction::Skip,
                },
                TempMergeDecision {
                    entry_path: "unknown.txt".to_owned(),
                    action: TempMergeConflictAction::Overwrite,
                },
            ],
            vec![
                TempMergeDecision {
                    entry_path: "same.txt".to_owned(),
                    action: TempMergeConflictAction::Skip,
                },
                TempMergeDecision {
                    entry_path: "new.txt".to_owned(),
                    action: TempMergeConflictAction::Overwrite,
                },
            ],
        ];

        for decisions in invalid_decisions {
            assert!(state.stage_temp_merge_all(Side::Left, decisions).is_err());
            assert_eq!(
                state
                    .right_plan
                    .staged()
                    .iter()
                    .map(|op| op.target_entry_path())
                    .collect::<Vec<_>>(),
                ["preserved.txt"]
            );
        }
    }

    #[test]
    fn temp_merge_all_rejects_stale_conflict_decisions_without_mutating_the_plan() {
        let (dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"new"), ("same.txt", b"source")],
            &[("same.txt", b"target")],
        );
        let preview = state.preview_temp_merge_all(Side::Left).unwrap();
        assert_eq!(preview.conflicts, ["same.txt"]);
        state
            .right_plan
            .stage_write("preserved.txt", b"preserved".to_vec())
            .unwrap();

        let changed_source = dir.path().join("changed-source.jar");
        create_zip(&changed_source, &[("new.txt", b"changed")]);
        state.left = Some(Archive::open(changed_source.to_string_lossy()).unwrap());

        assert!(
            state
                .stage_temp_merge_all(
                    Side::Left,
                    vec![TempMergeDecision {
                        entry_path: "same.txt".to_owned(),
                        action: TempMergeConflictAction::Overwrite,
                    }],
                )
                .is_err()
        );
        assert_eq!(
            state
                .right_plan
                .staged()
                .iter()
                .map(|op| op.target_entry_path())
                .collect::<Vec<_>>(),
            ["preserved.txt"]
        );
    }

    #[test]
    fn temp_merge_all_recomputes_conflicts_after_the_target_changes() {
        let (dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"new"), ("same.txt", b"source")],
            &[("same.txt", b"target")],
        );
        let preview = state.preview_temp_merge_all(Side::Left).unwrap();
        assert_eq!(preview.conflicts, ["same.txt"]);
        state
            .right_plan
            .stage_write("preserved.txt", b"preserved".to_vec())
            .unwrap();

        let changed_target = dir.path().join("changed-target.jar");
        create_zip(&changed_target, &[("target-only.txt", b"target")]);
        state.right = Some(Archive::open(changed_target.to_string_lossy()).unwrap());

        assert!(
            state
                .stage_temp_merge_all(
                    Side::Left,
                    vec![TempMergeDecision {
                        entry_path: "same.txt".to_owned(),
                        action: TempMergeConflictAction::Overwrite,
                    }],
                )
                .is_err()
        );
        assert_eq!(
            state
                .right_plan
                .staged()
                .iter()
                .map(|op| op.target_entry_path())
                .collect::<Vec<_>>(),
            ["preserved.txt"]
        );
    }

    #[test]
    fn temp_merge_all_rejects_a_replacement_source_with_the_same_partition() {
        let (dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"source-a-new"), ("same.txt", b"source-a")],
            &[("same.txt", b"target")],
        );
        let preview = state.preview_temp_merge_all(Side::Left).unwrap();
        assert_eq!(preview.new_entries, ["new.txt"]);
        assert_eq!(preview.conflicts, ["same.txt"]);

        let source_b = dir.path().join("source-b.jar");
        create_zip(
            &source_b,
            &[("new.txt", b"source-b-new"), ("same.txt", b"source-b")],
        );
        state
            .install_archive(
                Archive::open(source_b.to_string_lossy()).unwrap(),
                Side::Left,
            )
            .unwrap();
        state
            .right_plan
            .stage_write("preserved.txt", b"preserved".to_vec())
            .unwrap();

        assert!(
            state
                .stage_temp_merge_all(
                    Side::Left,
                    vec![TempMergeDecision {
                        entry_path: "same.txt".to_owned(),
                        action: TempMergeConflictAction::Overwrite,
                    }],
                )
                .is_err()
        );
        assert_eq!(
            state
                .right_plan
                .staged()
                .iter()
                .map(|op| op.target_entry_path())
                .collect::<Vec<_>>(),
            ["preserved.txt"]
        );
    }

    #[test]
    fn temp_merge_all_rejects_same_path_source_or_target_disk_changes() {
        for changed_side in [Side::Left, Side::Right] {
            let (_dir, mut state) = temp_session_with_source_and_target(
                &[("new.txt", b"new"), ("same.txt", b"source")],
                &[("same.txt", b"target")],
            );
            state.preview_temp_merge_all(Side::Left).unwrap();
            state
                .right_plan
                .stage_write("preserved.txt", b"preserved".to_vec())
                .unwrap();

            let changed_path = match changed_side {
                Side::Left => state.left.as_ref().unwrap().path(),
                Side::Right => state.right.as_ref().unwrap().path(),
            }
            .to_owned();
            let changed_entries: &[(&str, &[u8])] = match changed_side {
                Side::Left => &[
                    ("new.txt", b"new bytes changed on disk"),
                    ("same.txt", b"source bytes changed on disk"),
                ],
                Side::Right => &[("same.txt", b"target bytes changed on disk")],
            };
            create_zip(&changed_path, changed_entries);

            assert!(
                state
                    .stage_temp_merge_all(
                        Side::Left,
                        vec![TempMergeDecision {
                            entry_path: "same.txt".to_owned(),
                            action: TempMergeConflictAction::Overwrite,
                        }],
                    )
                    .is_err()
            );
            assert_eq!(
                state
                    .right_plan
                    .staged()
                    .iter()
                    .map(|op| op.target_entry_path())
                    .collect::<Vec<_>>(),
                ["preserved.txt"]
            );
        }
    }

    #[test]
    fn temp_merge_all_requires_preview_before_staging() {
        let (_dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"new"), ("same.txt", b"source")],
            &[("same.txt", b"target")],
        );

        assert!(
            state
                .stage_temp_merge_all(
                    Side::Left,
                    vec![TempMergeDecision {
                        entry_path: "same.txt".to_owned(),
                        action: TempMergeConflictAction::Overwrite,
                    }],
                )
                .is_err()
        );
        assert!(state.right_plan.is_empty());
    }

    #[test]
    fn temp_merge_all_success_consumes_the_preview() {
        let (_dir, mut state) = temp_session_with_source_and_target(
            &[("new.txt", b"new"), ("same.txt", b"source")],
            &[("same.txt", b"target")],
        );
        state.preview_temp_merge_all(Side::Left).unwrap();
        let decisions = || {
            vec![TempMergeDecision {
                entry_path: "same.txt".to_owned(),
                action: TempMergeConflictAction::Overwrite,
            }]
        };

        state.stage_temp_merge_all(Side::Left, decisions()).unwrap();
        let staged_paths = state
            .right_plan
            .staged()
            .iter()
            .map(|op| op.target_entry_path().to_owned())
            .collect::<Vec<_>>();
        assert!(state.stage_temp_merge_all(Side::Left, decisions()).is_err());
        assert_eq!(
            state
                .right_plan
                .staged()
                .iter()
                .map(|op| op.target_entry_path().to_owned())
                .collect::<Vec<_>>(),
            staged_paths
        );
    }

    #[test]
    fn temp_merge_all_dtos_use_camel_case_wire_values() {
        let preview = super::state::TempMergeConflictPreview {
            new_entries: vec!["new.txt".to_owned()],
            conflicts: vec!["same.txt".to_owned()],
        };
        assert_eq!(
            serde_json::to_value(preview).unwrap(),
            serde_json::json!({
                "newEntries": ["new.txt"],
                "conflicts": ["same.txt"],
            })
        );

        let decision: TempMergeDecision = serde_json::from_value(serde_json::json!({
            "entryPath": "same.txt",
            "action": "overwrite",
        }))
        .unwrap();
        assert_eq!(decision.entry_path, "same.txt");
        assert_eq!(decision.action, TempMergeConflictAction::Overwrite);
    }

    #[test]
    fn temp_merge_all_rejects_using_the_target_as_the_source() {
        let (_dir, mut state) =
            temp_session_with_source_and_target(&[("source.txt", b"source")], &[]);

        assert!(state.preview_temp_merge_all(Side::Right).is_err());
        assert!(state.stage_temp_merge_all(Side::Right, Vec::new()).is_err());
        assert!(state.right_plan.is_empty());
    }

    #[test]
    fn temp_merge_all_requires_an_active_session_with_both_archives() {
        let mut inactive = AppState::default();
        assert!(inactive.preview_temp_merge_all(Side::Left).is_err());
        assert!(
            inactive
                .stage_temp_merge_all(Side::Left, Vec::new())
                .is_err()
        );

        let (_source_dir, mut missing_source) =
            temp_session_with_source_and_target(&[("source.txt", b"source")], &[]);
        missing_source.left = None;
        assert!(missing_source.preview_temp_merge_all(Side::Left).is_err());

        let (_target_dir, mut missing_target) =
            temp_session_with_source_and_target(&[("source.txt", b"source")], &[]);
        missing_target.right = None;
        assert!(
            missing_target
                .stage_temp_merge_all(Side::Left, Vec::new())
                .is_err()
        );
    }

    #[test]
    fn temp_merge_all_rejects_the_reserved_discard_state() {
        let (_dir, mut state) =
            temp_session_with_source_and_target(&[("source.txt", b"source")], &[]);
        state.preview_temp_merge_all(Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));

        let error = discard_temp_target_with_cleanup(&shared_state, |_| {
            let mut state = shared_state.lock().unwrap();
            assert!(state.preview_temp_merge_all(Side::Left).is_err());
            assert!(state.stage_temp_merge_all(Side::Left, Vec::new()).is_err());
            Err(std::io::Error::other("injected cleanup failure"))
        })
        .unwrap_err();

        assert!(error.contains("injected cleanup failure"));
        let mut state = shared_state.lock().unwrap();
        assert!(state.temp_merge_session.is_some());
        assert!(state.stage_temp_merge_all(Side::Left, Vec::new()).is_err());
        assert!(state.right_plan.is_empty());
    }

    #[test]
    fn temp_merge_all_rejects_the_retry_only_pending_discard_state() {
        let (_dir, state) = temp_session_with_source_and_target(&[("source.txt", b"source")], &[]);
        let shared_state = Arc::new(Mutex::new(state));
        let target_dir = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_owned();

        discard_temp_target_with_cleanup_and_write(
            &shared_state,
            |owned_dir| {
                if owned_dir == target_dir {
                    std::fs::remove_dir_all(owned_dir).unwrap();
                    Err(std::io::Error::other("destructive cleanup failure"))
                } else {
                    Err(std::io::Error::other("recovery cleanup failure"))
                }
            },
            |_, _| Err(std::io::Error::other("snapshot write failure")),
        )
        .unwrap_err();

        let mut state = shared_state.lock().unwrap();
        assert!(state.pending_temp_target_recovery_bytes().is_some());
        assert!(state.preview_temp_merge_all(Side::Left).is_err());
        assert!(state.stage_temp_merge_all(Side::Left, Vec::new()).is_err());
    }

    #[test]
    fn empty_temp_target_creates_opposite_archive_and_session_summary() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();

        let summary = create_temp_target_in_state(
            &mut state,
            Side::Left,
            TempTargetCreation::Empty {
                extension: "jar".to_owned(),
            },
        )
        .unwrap();

        assert_eq!(summary.target_side, Side::Right);
        assert!(summary.working_name.ends_with(".jar"));
        assert_eq!(summary.entry_count, 0);
        assert_eq!(summary.applied_source_count, 0);
        assert_eq!(summary.exported_path, None);
        assert!(state.right.as_ref().unwrap().path().is_file());
        assert!(state.temp_merge_session.is_some());
    }

    #[test]
    fn copy_current_temp_target_creates_opposite_copy_without_mutating_source() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let source_before = std::fs::read(state.left.as_ref().unwrap().path()).unwrap();

        let summary =
            create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
                .unwrap();

        assert_eq!(summary.target_side, Side::Right);
        assert_eq!(summary.entry_count, 1);
        assert_eq!(
            std::fs::read(state.left.as_ref().unwrap().path()).unwrap(),
            source_before
        );
        assert_ne!(
            state.right.as_ref().unwrap().path(),
            state.left.as_ref().unwrap().path()
        );
        assert_eq!(
            std::fs::read(state.right.as_ref().unwrap().path()).unwrap(),
            source_before
        );
        assert!(state.temp_merge_session.is_some());
    }

    #[test]
    fn temp_target_uses_left_when_declared_source_is_right() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();

        let summary =
            create_temp_target_in_state(&mut state, Side::Right, TempTargetCreation::CopyCurrent)
                .unwrap();

        assert_eq!(summary.target_side, Side::Left);
        assert!(state.left.is_some());
        assert_eq!(state.right.as_ref().unwrap().path(), source);
    }

    #[test]
    fn temp_target_preparation_releases_shared_state_lock_before_filesystem_work() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));

        let prepared = prepare_temp_target_with_lock_probe(
            &shared_state,
            Side::Left,
            TempTargetCreation::CopyCurrent,
            || assert!(shared_state.try_lock().is_ok()),
        )
        .unwrap();
        let summary = install_prepared_temp_target(&shared_state, prepared).unwrap();

        assert_eq!(summary.target_side, Side::Right);
    }

    #[test]
    fn prepared_temp_target_rechecks_source_before_publish() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement = dir.path().join("replacement.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement, &[("replacement.txt", b"replacement")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        let prepared =
            prepare_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent)
                .unwrap();
        shared_state
            .lock()
            .unwrap()
            .install_archive(
                Archive::open(replacement.to_string_lossy()).unwrap(),
                Side::Left,
            )
            .unwrap();

        let error = install_prepared_temp_target(&shared_state, prepared).unwrap_err();

        assert!(error.contains("changed"));
        let state = shared_state.lock().unwrap();
        assert_eq!(state.left.as_ref().unwrap().path(), replacement);
        assert!(state.right.is_none());
        assert!(state.temp_merge_session.is_none());
    }

    #[test]
    fn temp_target_rejects_file_and_directory_sources_before_creation() {
        let dir = tempdir().unwrap();
        let text = dir.path().join("source.txt");
        let folder = dir.path().join("source-folder");
        std::fs::write(&text, "text").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("entry.txt"), "entry").unwrap();

        for source in [&text, &folder] {
            let mut state = AppState::default();
            load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left)
                .unwrap();
            let shared_state = Arc::new(Mutex::new(state));
            let mut entered_filesystem_phase = false;

            let result = prepare_temp_target_with_lock_probe(
                &shared_state,
                Side::Left,
                TempTargetCreation::CopyCurrent,
                || entered_filesystem_phase = true,
            );
            let error = match result {
                Ok(_) => panic!("non-archive source entered temporary target preparation"),
                Err(error) => error,
            };

            assert!(error.contains("archive source"));
            assert!(!entered_filesystem_phase);
            let state = shared_state.lock().unwrap();
            assert!(state.right.is_none());
            assert!(state.temp_merge_session.is_none());
        }
    }

    #[test]
    fn temp_target_creation_requires_declared_source_empty_target_and_no_pending_plan() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let other = dir.path().join("other.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&other, &[("other.txt", b"other")]);

        let mut wrong_source = AppState::default();
        load_archive_through_production(&mut wrong_source, other.to_str().unwrap(), Side::Right)
            .unwrap();
        assert!(
            create_temp_target_in_state(
                &mut wrong_source,
                Side::Left,
                TempTargetCreation::CopyCurrent,
            )
            .unwrap_err()
            .contains("source")
        );

        let mut occupied_target = AppState::default();
        load_archive_through_production(&mut occupied_target, source.to_str().unwrap(), Side::Left)
            .unwrap();
        load_archive_through_production(&mut occupied_target, other.to_str().unwrap(), Side::Right)
            .unwrap();
        assert!(
            create_temp_target_in_state(
                &mut occupied_target,
                Side::Left,
                TempTargetCreation::CopyCurrent,
            )
            .unwrap_err()
            .contains("target")
        );

        let mut pending = AppState::default();
        load_archive_through_production(&mut pending, source.to_str().unwrap(), Side::Left)
            .unwrap();
        pending
            .stage_write(Side::Left, "source.txt", "changed")
            .unwrap();
        assert!(
            create_temp_target_in_state(&mut pending, Side::Left, TempTargetCreation::CopyCurrent,)
                .unwrap_err()
                .contains("pending")
        );
        assert!(pending.right.is_none());
        assert!(pending.temp_merge_session.is_none());
    }

    #[test]
    fn failed_temp_target_creation_preserves_compare_state() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let source_path = state.left.as_ref().unwrap().path().to_owned();
        let source_cache = Arc::clone(&state.left_nested);

        let error = create_temp_target_in_state(
            &mut state,
            Side::Left,
            TempTargetCreation::Empty {
                extension: "txt".to_owned(),
            },
        )
        .unwrap_err();

        assert!(error.contains("temporary archive"));
        assert_eq!(state.left.as_ref().unwrap().path(), source_path);
        assert!(Arc::ptr_eq(&state.left_nested, &source_cache));
        assert!(state.right.is_none());
        assert!(state.temp_merge_session.is_none());
    }

    #[test]
    fn temp_target_allows_source_replacement_but_rejects_target_replacement_and_second_session() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement = dir.path().join("replacement.jar");
        let forbidden_target = dir.path().join("forbidden.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement, &[("replacement.txt", b"replacement")]);
        create_zip(&forbidden_target, &[("forbidden.txt", b"forbidden")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
            .unwrap();
        let target_path = state.right.as_ref().unwrap().path().to_owned();

        let second_error =
            create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
                .unwrap_err();
        assert!(second_error.contains("already"));

        state
            .install_archive(
                Archive::open(replacement.to_string_lossy()).unwrap(),
                Side::Left,
            )
            .unwrap();
        assert_eq!(state.left.as_ref().unwrap().path(), replacement);
        assert_eq!(state.right.as_ref().unwrap().path(), target_path);

        let target_error = state
            .install_archive(
                Archive::open(forbidden_target.to_string_lossy()).unwrap(),
                Side::Right,
            )
            .unwrap_err();
        assert!(target_error.contains("temporary merge target"));
        assert_eq!(state.right.as_ref().unwrap().path(), target_path);
    }

    #[test]
    fn temp_target_rejects_atomic_compare_pair_replacement() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement_left = dir.path().join("replacement-left.jar");
        let replacement_right = dir.path().join("replacement-right.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement_left, &[("left.txt", b"left")]);
        create_zip(&replacement_right, &[("right.txt", b"right")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
            .unwrap();
        let target_path = state.right.as_ref().unwrap().path().to_owned();
        let shared_state = Arc::new(Mutex::new(state));

        let error = open_compare_sources_through_production(
            &shared_state,
            replacement_left.display().to_string(),
            replacement_right.display().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("temporary merge target"));
        let state = shared_state.lock().unwrap();
        assert_eq!(state.left.as_ref().unwrap().path(), source);
        assert_eq!(state.right.as_ref().unwrap().path(), target_path);
        assert!(state.temp_merge_session.is_some());
    }

    #[test]
    fn temp_target_staging_can_modify_only_fixed_target_side() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
            .unwrap();

        let source_error = state
            .stage_copy(Side::Right, Side::Left, "source.txt")
            .unwrap_err();
        assert!(source_error.contains("temporary merge source"));
        assert!(state.left_plan.is_empty());

        state
            .stage_copy(Side::Left, Side::Right, "source.txt")
            .unwrap();
        assert!(!state.right_plan.is_empty());
    }

    #[test]
    fn discard_temp_target_clears_target_and_only_removes_owned_temp_directory() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let source_before = std::fs::read(&source).unwrap();
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        create_temp_target_in_state(&mut state, Side::Left, TempTargetCreation::CopyCurrent)
            .unwrap();
        state
            .stage_copy(Side::Left, Side::Right, "source.txt")
            .unwrap();
        let target_path = state.right.as_ref().unwrap().path().to_owned();
        let owned_temp_dir = target_path.parent().unwrap().to_owned();

        discard_temp_target_in_state(&mut state).unwrap();

        assert!(source.is_file());
        assert_eq!(std::fs::read(&source).unwrap(), source_before);
        assert!(!target_path.exists());
        assert!(!owned_temp_dir.exists());
        assert!(state.left.is_some());
        assert!(state.right.is_none());
        assert!(state.right_plan.is_empty());
        assert!(state.temp_merge_session.is_none());
    }

    #[test]
    fn discard_temp_target_without_session_preserves_loaded_archives() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();

        assert!(
            discard_temp_target_in_state(&mut state)
                .unwrap_err()
                .contains("not active")
        );
        assert_eq!(state.left.as_ref().unwrap().path(), source);
        assert!(source.is_file());
    }

    #[test]
    fn temp_target_cleanup_failure_restores_left_session_and_plan() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let forbidden_target = dir.path().join("forbidden-target.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&forbidden_target, &[("forbidden.txt", b"forbidden")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Right, TempTargetCreation::CopyCurrent).unwrap();
        {
            let mut state = shared_state.lock().unwrap();
            state
                .stage_copy(Side::Right, Side::Left, "source.txt")
                .unwrap();
        }
        let target_path = shared_state
            .lock()
            .unwrap()
            .left
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        let target_before = std::fs::read(&target_path).unwrap();
        let mut forbidden_target = Some(Archive::open(forbidden_target.to_string_lossy()).unwrap());

        let error = discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            let target_error = shared_state
                .lock()
                .unwrap()
                .install_archive(
                    forbidden_target
                        .take()
                        .expect("cleanup probe runs only until its first failure"),
                    Side::Left,
                )
                .unwrap_err();
            assert!(target_error.contains("temporary merge target"));
            std::fs::remove_dir_all(owned_dir).unwrap();
            Err(std::io::Error::other("injected cleanup failure"))
        })
        .unwrap_err();

        assert!(error.contains("injected cleanup failure"));
        let state = shared_state.lock().unwrap();
        let restored_target = state.left.as_ref().unwrap().path();
        assert!(restored_target.is_file());
        assert_eq!(std::fs::read(restored_target).unwrap(), target_before);
        assert!(!state.left_plan.is_empty());
        assert!(state.temp_merge_session.is_some());
    }

    #[test]
    fn temp_target_discard_blocks_source_replacement_while_plan_is_detached() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement_source = dir.path().join("replacement-source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement_source, &[("replacement.txt", b"replacement")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Right, TempTargetCreation::CopyCurrent).unwrap();
        shared_state
            .lock()
            .unwrap()
            .stage_copy(Side::Right, Side::Left, "source.txt")
            .unwrap();
        let mut replacement_source =
            Some(Archive::open(replacement_source.to_string_lossy()).unwrap());

        let error = discard_temp_target_with_cleanup(&shared_state, |_| {
            let replacement_error = shared_state
                .lock()
                .unwrap()
                .install_archive(
                    replacement_source
                        .take()
                        .expect("cleanup probe runs only until its first failure"),
                    Side::Right,
                )
                .unwrap_err();
            assert!(replacement_error.contains("discarded"));
            Err(std::io::Error::other("injected cleanup failure"))
        })
        .unwrap_err();

        assert!(error.contains("injected cleanup failure"));
        let state = shared_state.lock().unwrap();
        assert_eq!(state.right.as_ref().unwrap().path(), source);
        assert!(!state.left_plan.is_empty());
        assert!(state.temp_merge_session.is_some());
    }

    #[test]
    fn temp_target_cleanup_disarms_owner_and_retries_recreated_path_once() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent).unwrap();
        let original_target_dir = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_owned();
        let recreated_marker = original_target_dir.join("recreated-after-delete.txt");
        let mut attempts = Vec::new();

        let error = discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            attempts.push(owned_dir.to_owned());
            std::fs::remove_dir_all(owned_dir).unwrap();
            std::fs::create_dir(owned_dir).unwrap();
            std::fs::write(&recreated_marker, "still-owned").unwrap();
            Err(std::io::Error::other("injected cleanup failure"))
        })
        .unwrap_err();

        assert!(error.contains("injected cleanup failure"));
        assert_eq!(
            attempts.as_slice(),
            std::slice::from_ref(&original_target_dir)
        );
        assert!(recreated_marker.is_file());
        let recovery_target_dir = {
            let state = shared_state.lock().unwrap();
            assert!(state.temp_merge_session.is_some());
            let recovery_target = state.right.as_ref().unwrap().path();
            assert!(recovery_target.is_file());
            recovery_target.parent().unwrap().to_owned()
        };
        assert_ne!(recovery_target_dir, original_target_dir);

        let mut retry_attempts = Vec::new();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            retry_attempts.push(owned_dir.to_owned());
            match std::fs::remove_dir_all(owned_dir) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        })
        .unwrap();

        assert_eq!(retry_attempts.len(), 2);
        assert_eq!(retry_attempts[0], original_target_dir);
        assert_eq!(retry_attempts[1], recovery_target_dir);
        assert!(!recreated_marker.exists());
        assert!(shared_state.lock().unwrap().temp_merge_session.is_none());
    }

    #[test]
    fn temp_target_pending_cleanup_failure_does_not_create_more_recoveries() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent).unwrap();
        let original_target_dir = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_owned();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            std::fs::remove_dir_all(owned_dir).unwrap();
            std::fs::create_dir(owned_dir).unwrap();
            Err(std::io::Error::other("seed pending cleanup"))
        })
        .unwrap_err();
        let recovery_target = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .to_owned();

        for _ in 0..2 {
            let mut attempts = Vec::new();
            let error = discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
                attempts.push(owned_dir.to_owned());
                Err(std::io::Error::other("persistent pending cleanup failure"))
            })
            .unwrap_err();

            assert!(error.contains("persistent pending cleanup failure"));
            assert_eq!(
                attempts.as_slice(),
                std::slice::from_ref(&original_target_dir)
            );
            let state = shared_state.lock().unwrap();
            assert_eq!(state.right.as_ref().unwrap().path(), recovery_target);
            assert!(recovery_target.is_file());
            assert!(state.temp_merge_session.is_some());
        }
    }

    #[test]
    fn temp_target_final_working_cleanup_failure_retains_same_usable_session() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent).unwrap();
        let original_target_dir = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_owned();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            std::fs::remove_dir_all(owned_dir).unwrap();
            std::fs::create_dir(owned_dir).unwrap();
            Err(std::io::Error::other("seed pending cleanup"))
        })
        .unwrap_err();
        let recovery_target = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        let recovery_bytes = std::fs::read(&recovery_target).unwrap();
        let recovery_dir = recovery_target.parent().unwrap().to_owned();
        let mut attempts = Vec::new();

        let error = discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            attempts.push(owned_dir.to_owned());
            if owned_dir == original_target_dir {
                std::fs::remove_dir_all(owned_dir)
            } else {
                Err(std::io::Error::other("final working cleanup failure"))
            }
        })
        .unwrap_err();

        assert!(error.contains("final working cleanup failure"));
        assert_eq!(attempts, [original_target_dir, recovery_dir.clone()]);
        let state = shared_state.lock().unwrap();
        assert_eq!(state.right.as_ref().unwrap().path(), recovery_target);
        assert_eq!(std::fs::read(&recovery_target).unwrap(), recovery_bytes);
        assert!(state.temp_merge_session.is_some());
        drop(state);

        let mut final_attempts = Vec::new();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            final_attempts.push(owned_dir.to_owned());
            std::fs::remove_dir_all(owned_dir)
        })
        .unwrap();
        assert_eq!(final_attempts, [recovery_dir]);
        assert!(shared_state.lock().unwrap().temp_merge_session.is_none());
    }

    #[test]
    fn temp_target_compound_recovery_failure_retains_owned_snapshot_for_retry() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement_source = dir.path().join("replacement-source.jar");
        create_zip(&source, &[("source.txt", b"last-good")]);
        create_zip(&replacement_source, &[("replacement.txt", b"replacement")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent).unwrap();
        let target_path = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        let target_dir = target_path.parent().unwrap().to_owned();
        let last_good_bytes = std::fs::read(&target_path).unwrap();
        let mut cleanup_attempts = Vec::new();
        let mut incomplete_recovery_dir = None;
        let mut write_attempts = 0;

        let error = discard_temp_target_with_cleanup_and_write(
            &shared_state,
            |owned_dir| {
                cleanup_attempts.push(owned_dir.to_owned());
                if owned_dir == target_dir {
                    std::fs::remove_dir_all(owned_dir).unwrap();
                    Err(std::io::Error::other("destructive working cleanup failure"))
                } else {
                    incomplete_recovery_dir = Some(owned_dir.to_owned());
                    Err(std::io::Error::other("incomplete recovery cleanup failure"))
                }
            },
            |_, _| {
                write_attempts += 1;
                let message = match write_attempts {
                    1 => "fresh recovery materialization failure",
                    2 => "original snapshot restore failure",
                    _ => panic!("compound recovery performs exactly two snapshot writes"),
                };
                Err(std::io::Error::other(message))
            },
        )
        .unwrap_err();

        assert!(error.contains("destructive working cleanup failure"));
        assert!(error.contains("fresh recovery materialization failure"));
        assert!(error.contains("incomplete recovery cleanup failure"));
        assert!(error.contains("original snapshot restore failure"));
        assert_eq!(cleanup_attempts.len(), 2);
        let incomplete_recovery_dir =
            incomplete_recovery_dir.expect("failed recovery path remains known");
        assert!(incomplete_recovery_dir.is_dir());
        {
            let mut state = shared_state.lock().unwrap();
            assert!(state.right.is_none());
            assert!(state.temp_merge_session.is_none());
            assert_eq!(
                state.pending_temp_target_recovery_bytes(),
                Some(last_good_bytes.as_slice())
            );
            let replacement_error = state
                .install_archive(
                    Archive::open(replacement_source.to_string_lossy()).unwrap(),
                    Side::Left,
                )
                .unwrap_err();
            assert!(replacement_error.contains("discarded"));
        }

        let mut retry_attempts = Vec::new();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            retry_attempts.push(owned_dir.to_owned());
            match std::fs::remove_dir_all(owned_dir) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        })
        .unwrap();

        retry_attempts.sort();
        let mut expected_attempts = vec![target_dir, incomplete_recovery_dir];
        expected_attempts.sort();
        assert_eq!(retry_attempts, expected_attempts);
        let state = shared_state.lock().unwrap();
        assert!(state.right.is_none());
        assert!(state.temp_merge_session.is_none());
        assert_eq!(state.pending_temp_target_recovery_bytes(), None);
    }

    #[test]
    fn temp_target_incomplete_recovery_cleanup_failure_retains_path_for_retry() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Left).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Left, TempTargetCreation::CopyCurrent).unwrap();
        let target_path = shared_state
            .lock()
            .unwrap()
            .right
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        let target_dir = target_path.parent().unwrap().to_owned();
        let target_bytes = std::fs::read(&target_path).unwrap();
        let mut incomplete_recovery_dir = None;
        let mut write_attempts = 0;

        let error = discard_temp_target_with_cleanup_and_write(
            &shared_state,
            |owned_dir| {
                if owned_dir == target_dir {
                    std::fs::remove_dir_all(owned_dir).unwrap();
                    Err(std::io::Error::other("destructive working cleanup failure"))
                } else {
                    incomplete_recovery_dir = Some(owned_dir.to_owned());
                    Err(std::io::Error::other("incomplete recovery cleanup failure"))
                }
            },
            |working_path, bytes| {
                write_attempts += 1;
                if write_attempts == 1 {
                    Err(std::io::Error::other(
                        "fresh recovery materialization failure",
                    ))
                } else {
                    std::fs::write(working_path, bytes)
                }
            },
        )
        .unwrap_err();

        assert!(error.contains("fresh recovery materialization failure"));
        assert!(error.contains("incomplete recovery cleanup failure"));
        let incomplete_recovery_dir =
            incomplete_recovery_dir.expect("failed recovery path remains known");
        assert!(incomplete_recovery_dir.is_dir());
        {
            let state = shared_state.lock().unwrap();
            assert_eq!(state.right.as_ref().unwrap().path(), target_path);
            assert_eq!(std::fs::read(&target_path).unwrap(), target_bytes);
            assert!(state.temp_merge_session.is_some());
        }

        let mut retry_attempts = Vec::new();
        discard_temp_target_with_cleanup(&shared_state, |owned_dir| {
            retry_attempts.push(owned_dir.to_owned());
            std::fs::remove_dir_all(owned_dir)
        })
        .unwrap();

        assert_eq!(retry_attempts, [incomplete_recovery_dir, target_dir]);
        assert!(shared_state.lock().unwrap().temp_merge_session.is_none());
    }

    #[test]
    fn right_source_temp_target_guards_left_target_and_right_source() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement_source = dir.path().join("replacement-source.jar");
        let forbidden_target = dir.path().join("forbidden-target.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement_source, &[("replacement.txt", b"replacement")]);
        create_zip(&forbidden_target, &[("forbidden.txt", b"forbidden")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Right, TempTargetCreation::CopyCurrent).unwrap();
        let mut state = shared_state.lock().unwrap();
        let target_path = state.left.as_ref().unwrap().path().to_owned();

        assert!(
            state
                .stage_copy(Side::Left, Side::Right, "source.txt")
                .unwrap_err()
                .contains("temporary merge source")
        );
        state
            .install_archive(
                Archive::open(replacement_source.to_string_lossy()).unwrap(),
                Side::Right,
            )
            .unwrap();
        state
            .stage_copy(Side::Right, Side::Left, "replacement.txt")
            .unwrap();
        assert!(!state.left_plan.is_empty());
        assert!(
            state
                .install_archive(
                    Archive::open(forbidden_target.to_string_lossy()).unwrap(),
                    Side::Left,
                )
                .unwrap_err()
                .contains("temporary merge target")
        );
        assert_eq!(state.left.as_ref().unwrap().path(), target_path);
    }

    #[test]
    fn right_source_temp_target_rejects_atomic_compare_pair_replacement() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        let replacement_left = dir.path().join("replacement-left.jar");
        let replacement_right = dir.path().join("replacement-right.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        create_zip(&replacement_left, &[("left.txt", b"left")]);
        create_zip(&replacement_right, &[("right.txt", b"right")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Right, TempTargetCreation::CopyCurrent).unwrap();
        let target_path = shared_state
            .lock()
            .unwrap()
            .left
            .as_ref()
            .unwrap()
            .path()
            .to_owned();

        let error = open_compare_sources_through_production(
            &shared_state,
            replacement_left.display().to_string(),
            replacement_right.display().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("temporary merge target"));
        let state = shared_state.lock().unwrap();
        assert_eq!(state.left.as_ref().unwrap().path(), target_path);
        assert_eq!(state.right.as_ref().unwrap().path(), source);
    }

    #[test]
    fn discard_left_temp_target_preserves_right_source_and_removes_owned_directory() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.jar");
        create_zip(&source, &[("source.txt", b"source")]);
        let source_before = std::fs::read(&source).unwrap();
        let mut state = AppState::default();
        load_archive_through_production(&mut state, source.to_str().unwrap(), Side::Right).unwrap();
        let shared_state = Arc::new(Mutex::new(state));
        create_temp_target(&shared_state, Side::Right, TempTargetCreation::CopyCurrent).unwrap();
        {
            let mut state = shared_state.lock().unwrap();
            state
                .stage_copy(Side::Right, Side::Left, "source.txt")
                .unwrap();
        }
        let target_path = shared_state
            .lock()
            .unwrap()
            .left
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        let owned_temp_dir = target_path.parent().unwrap().to_owned();

        discard_temp_target(&shared_state).unwrap();

        assert_eq!(std::fs::read(&source).unwrap(), source_before);
        assert!(!target_path.exists());
        assert!(!owned_temp_dir.exists());
        let state = shared_state.lock().unwrap();
        assert!(state.left.is_none());
        assert!(state.left_plan.is_empty());
        assert!(state.right.is_some());
        assert!(state.temp_merge_session.is_none());
    }

    fn with_shared_state<R>(
        state: &mut AppState,
        action: impl FnOnce(&super::state::SharedState) -> R,
    ) -> R {
        let shared_state = Arc::new(Mutex::new(std::mem::take(state)));
        let result = action(&shared_state);
        let mutex = match Arc::try_unwrap(shared_state) {
            Ok(mutex) => mutex,
            Err(_) => panic!("production state helper retained a shared-state clone"),
        };
        *state = mutex.into_inner().unwrap();
        result
    }

    fn create_temp_target_in_state(
        state: &mut AppState,
        source_side: Side,
        creation: TempTargetCreation,
    ) -> Result<super::state::TempMergeSessionSummary, String> {
        with_shared_state(state, |shared_state| {
            create_temp_target(shared_state, source_side, creation)
        })
    }

    fn discard_temp_target_in_state(state: &mut AppState) -> Result<(), String> {
        with_shared_state(state, discard_temp_target)
    }

    fn load_archive_through_production(
        state: &mut AppState,
        path: &str,
        side: Side,
    ) -> Result<super::state::ArchiveSummary, String> {
        let archive = tauri::async_runtime::block_on(open_archive_from_path(path.to_owned()))?;
        state.install_archive(archive, side)
    }

    fn open_compare_sources_through_production(
        state: &super::state::SharedState,
        left_path: String,
        right_path: String,
    ) -> Result<
        (
            super::state::ArchiveSummary,
            super::state::ArchiveSummary,
            lcdiff_core::ArchiveDiff,
        ),
        String,
    > {
        let (left, right, diff) = tauri::async_runtime::block_on(
            open_compare_archives_from_paths(left_path, right_path),
        )?;
        let prepared = prepare_compare_archives(left, right)?;
        let (left_summary, right_summary, displaced) =
            install_prepared_compare_archives(state, prepared)?;
        drop(displaced);
        Ok((left_summary, right_summary, diff))
    }

    fn read_text_file_through_production(
        path: String,
    ) -> Result<super::state::TextFileContent, String> {
        tauri::async_runtime::block_on(read_text_file_from_path(path))
    }

    #[test]
    fn read_text_file_returns_canonical_path_and_valid_utf8_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "hello \u{1f30d}\n").unwrap();

        let content = read_text_file_through_production(path.display().to_string()).unwrap();

        assert_eq!(
            content.path,
            std::fs::canonicalize(&path).unwrap().display().to_string()
        );
        assert_eq!(content.content, "hello \u{1f30d}\n");
    }

    #[test]
    fn read_text_file_rejects_nul_binary_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("binary.txt");
        std::fs::write(&path, b"before\0after").unwrap();

        let error = read_text_file_through_production(path.display().to_string()).unwrap_err();

        assert!(error.contains(&path.display().to_string()), "{error}");
        assert!(error.contains("file is not valid UTF-8 text"), "{error}");
    }

    #[test]
    fn read_text_file_rejects_invalid_utf8_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("invalid.txt");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();

        let error = read_text_file_through_production(path.display().to_string()).unwrap_err();

        assert!(error.contains(&path.display().to_string()), "{error}");
        assert!(error.contains("file is not valid UTF-8 text"), "{error}");
    }

    #[test]
    fn read_text_file_rejects_directories() {
        let dir = tempdir().unwrap();

        let error =
            read_text_file_through_production(dir.path().display().to_string()).unwrap_err();

        assert!(error.contains("regular file"), "{error}");
    }

    #[test]
    fn compare_pair_install_is_atomic_when_right_open_fails() {
        let dir = tempdir().unwrap();
        let old_left = dir.path().join("old-left.jar");
        let old_right = dir.path().join("old-right.jar");
        let candidate_left = dir.path().join("candidate-left.jar");
        create_zip(&old_left, &[("old-left.txt", b"left")]);
        create_zip(&old_right, &[("old-right.txt", b"right")]);
        create_zip(&candidate_left, &[("new-left.txt", b"new")]);

        let state = Arc::new(Mutex::new(AppState::new(None)));
        let (before_left, before_right) = {
            let mut state = state.lock().unwrap();
            load_archive_through_production(&mut state, old_left.to_str().unwrap(), Side::Left)
                .unwrap();
            load_archive_through_production(&mut state, old_right.to_str().unwrap(), Side::Right)
                .unwrap();
            (
                state.left.as_ref().map(|archive| archive.path().to_owned()),
                state
                    .right
                    .as_ref()
                    .map(|archive| archive.path().to_owned()),
            )
        };

        let result = open_compare_sources_through_production(
            &state,
            candidate_left.display().to_string(),
            dir.path().join("missing-right.jar").display().to_string(),
        );

        assert!(result.is_err());
        let state = state.lock().unwrap();
        assert_eq!(
            state.left.as_ref().map(|archive| archive.path().to_owned()),
            before_left
        );
        assert_eq!(
            state
                .right
                .as_ref()
                .map(|archive| archive.path().to_owned()),
            before_right
        );
    }

    #[test]
    fn compare_pair_install_returns_displaced_resources_after_unlock() {
        let dir = tempdir().unwrap();
        let old_left = dir.path().join("old-left.jar");
        let old_right = dir.path().join("old-right.jar");
        let new_left = dir.path().join("new-left.jar");
        let new_right = dir.path().join("new-right.jar");
        create_zip(&old_left, &[("old-left.txt", b"left")]);
        create_zip(&old_right, &[("old-right.txt", b"right")]);
        create_zip(&new_left, &[("new-left.txt", b"new left")]);
        create_zip(&new_right, &[("new-right.txt", b"new right")]);

        let mut initial = AppState::new(None);
        load_archive_through_production(&mut initial, old_left.to_str().unwrap(), Side::Left)
            .unwrap();
        load_archive_through_production(&mut initial, old_right.to_str().unwrap(), Side::Right)
            .unwrap();
        let old_left_cache = Arc::downgrade(&initial.left_nested);
        let old_right_cache = Arc::downgrade(&initial.right_nested);
        let state = Arc::new(Mutex::new(initial));
        let prepared = prepare_compare_archives(
            Archive::open(new_left.to_string_lossy()).unwrap(),
            Archive::open(new_right.to_string_lossy()).unwrap(),
        )
        .unwrap();

        let (left, right, displaced) = install_prepared_compare_archives(&state, prepared).unwrap();

        assert!(state.try_lock().is_ok(), "state lock must be released");
        assert_eq!(left.path, new_left.display().to_string());
        assert_eq!(right.path, new_right.display().to_string());
        assert_eq!(
            displaced.0.as_ref().map(Archive::path),
            Some(old_left.as_path())
        );
        assert_eq!(
            displaced.1.as_ref().map(Archive::path),
            Some(old_right.as_path())
        );
        assert!(old_left_cache.upgrade().is_some());
        assert!(old_right_cache.upgrade().is_some());

        drop(displaced);

        assert!(old_left_cache.upgrade().is_none());
        assert!(old_right_cache.upgrade().is_none());
    }

    fn open_view_source_through_production(
        state: &mut AppState,
        path: String,
    ) -> Result<ViewSourceSummary, String> {
        let archive = tauri::async_runtime::block_on(open_view_archive_from_path(path))?;
        state.insert_view_source(archive)
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        create_zip(path, entries);
    }

    fn archive_alias_path(path: &Path) -> PathBuf {
        let alias_path = path.with_file_name("app-alias.jar");
        #[cfg(unix)]
        {
            if std::os::unix::fs::symlink(path, &alias_path).is_ok() {
                return alias_path;
            }
        }
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_file(path, &alias_path).is_ok() {
                return alias_path;
            }
        }
        path.parent()
            .unwrap()
            .join(".")
            .join(path.file_name().unwrap())
    }

    fn create_nested_view_archive(dir: &Path) -> PathBuf {
        let inner_path = dir.join("inner.jar");
        create_zip(&inner_path, &[("docs/file.txt", b"nested-content")]);
        let inner_bytes = std::fs::read(&inner_path).expect("read inner jar");

        let outer_path = dir.join("outer.jar");
        create_zip(&outer_path, &[("lib/inner.jar", &inner_bytes)]);
        outer_path
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
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        let right = dir.path().join("right.jar");
        create_zip(&right, &[("config.xml", b"<r/>")]);
        load_archive_through_production(&mut state, right.to_str().unwrap(), Side::Right).unwrap();

        state
            .stage_write(Side::Left, "config.xml", "<new/>")
            .unwrap();
        assert!(!state.plan(Side::Left).is_empty());

        let err = state
            .stage_write(Side::Right, "config.xml", "<x/>")
            .unwrap_err();
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
        state
            .stage_write(Side::Left, "config.json", "{\"v\":9}\n")
            .unwrap();
        state
            .stage_write(Side::Right, "config.json", "{\"v\":9}\n")
            .unwrap();

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
        state
            .stage_write(Side::Left, "config.json", "{\"v\":9}\n")
            .unwrap();
        state
            .stage_write(Side::Right, "config.json", "{\"v\":9}\n")
            .unwrap();
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
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        let err = state
            .stage_write(Side::Left, "blob.bin", "text")
            .unwrap_err();
        assert!(err.contains("editable"));
    }

    #[test]
    fn unstage_last_write_unlocks_archive_switch() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        create_zip(&left, &[("a.txt", b"old")]);
        let mut state = AppState::default();
        load_archive_through_production(&mut state, left.to_str().unwrap(), Side::Left).unwrap();
        state.stage_write(Side::Left, "a.txt", "new").unwrap();

        state.unstage("a.txt", None).unwrap();

        assert!(!state.any_pending());
    }
}
