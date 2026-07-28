use std::{env, path::PathBuf};

use tauri::{
    AppHandle, Manager, RunEvent, Runtime,
    menu::{
        AboutMetadata, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, Submenu,
        SubmenuBuilder,
    },
};

use crate::{
    events::{emit_app_action, emit_open_paths},
    state::SharedState,
};

pub(crate) const MENU_ACTIONS: &[(&str, &str, &str, &str)] = &[
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
    ("File", "file.refresh", "Refresh Sources", "CmdOrCtrl+R"),
    ("File", "file.save", "Save Staged Target", "CmdOrCtrl+S"),
    (
        "Edit",
        "edit.clearStaged",
        "Clear Staged Changes",
        "CmdOrCtrl+Shift+Backspace",
    ),
    ("Search", "search.toggle", "Toggle Search", "CmdOrCtrl+F"),
    (
        "Search",
        "search.runContextual",
        "Run Search Or Find",
        "CmdOrCtrl+Enter",
    ),
    (
        "View",
        "view.togglePreferences",
        "Toggle Preferences",
        "CmdOrCtrl+,",
    ),
    (
        "Workspace",
        "workspace.focusFiles",
        "Focus Files",
        "CmdOrCtrl+1",
    ),
    ("Workspace", "workspace.nextTab", "Next Tab", "Ctrl+Tab"),
    (
        "Workspace",
        "workspace.previousTab",
        "Previous Tab",
        "Ctrl+Shift+Tab",
    ),
    (
        "Workspace",
        "workspace.closeTab",
        "Close Active Tab",
        "CmdOrCtrl+W",
    ),
    ("Merge", "merge.copyToLeft", "Copy Entry To Left", "Alt+["),
    ("Merge", "merge.copyToRight", "Copy Entry To Right", "Alt+]"),
    (
        "Merge",
        "merge.takeAllToLeft",
        "Take All Into Left",
        "Alt+Shift+[",
    ),
    (
        "Merge",
        "merge.takeAllToRight",
        "Take All Into Right",
        "Alt+Shift+]",
    ),
    (
        "Merge",
        "merge.moveHunkToLeft",
        "Move Hunk Into Left",
        "CmdOrCtrl+Alt+[",
    ),
    (
        "Merge",
        "merge.moveHunkToRight",
        "Move Hunk Into Right",
        "CmdOrCtrl+Alt+]",
    ),
    (
        "Help",
        "help.showShortcuts",
        "Keyboard Shortcuts",
        "CmdOrCtrl+/",
    ),
];

fn menu_item_for_action<R: Runtime, M: Manager<R>>(
    manager: &M,
    action_id: &str,
    label: &str,
    shortcut: &str,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    MenuItemBuilder::with_id(action_id, label)
        .accelerator(shortcut)
        .build(manager)
}

fn custom_submenu<R: Runtime, M: Manager<R>>(
    manager: &M,
    group: &str,
) -> tauri::Result<Submenu<R>> {
    let mut submenu = SubmenuBuilder::new(manager, group);
    for (_, action_id, label, shortcut) in MENU_ACTIONS
        .iter()
        .filter(|(action_group, _, _, _)| *action_group == group)
    {
        let item = menu_item_for_action(manager, action_id, label, shortcut)?;
        submenu = submenu.item(&item);
    }
    submenu.build()
}

pub(crate) struct CloseWindowPlacement {
    pub(crate) file: bool,
    pub(crate) window: bool,
}

pub(crate) fn close_window_placement(target_os: &str) -> CloseWindowPlacement {
    CloseWindowPlacement {
        file: false,
        window: target_os != "macos",
    }
}

pub(crate) fn build_app_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<Menu<R>> {
    let handle = app.handle();
    let menu = Menu::new(handle)?;
    let close_window = close_window_placement(std::env::consts::OS);
    let package = app.package_info();
    let about_metadata = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app
            .config()
            .bundle
            .publisher
            .clone()
            .map(|author| vec![author]),
        ..Default::default()
    };

    #[cfg(target_os = "macos")]
    menu.append(
        &SubmenuBuilder::new(handle, &package.name)
            .item(&PredefinedMenuItem::about(
                handle,
                None,
                Some(about_metadata),
            )?)
            .separator()
            .item(&PredefinedMenuItem::services(handle, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(handle, None)?)
            .item(&PredefinedMenuItem::hide_others(handle, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(handle, None)?)
            .build()?,
    )?;

    let mut file = SubmenuBuilder::new(handle, "File");
    for (_, action_id, label, shortcut) in MENU_ACTIONS
        .iter()
        .filter(|(group, _, _, _)| *group == "File")
    {
        let item = MenuItemBuilder::with_id(*action_id, *label)
            .accelerator(*shortcut)
            .build(handle)?;
        file = file.item(&item);
    }
    if close_window.file {
        file = file
            .separator()
            .item(&PredefinedMenuItem::close_window(handle, None)?);
    }
    #[cfg(not(target_os = "macos"))]
    {
        file = file
            .separator()
            .item(&PredefinedMenuItem::quit(handle, None)?);
    }
    menu.append(&file.build()?)?;

    let clear_staged = MENU_ACTIONS
        .iter()
        .find(|(_, action_id, _, _)| *action_id == "edit.clearStaged")
        .expect("clear staged menu action");
    let clear_staged = MenuItemBuilder::with_id(clear_staged.1, clear_staged.2)
        .accelerator(clear_staged.3)
        .build(handle)?;
    menu.append(
        &SubmenuBuilder::new(handle, "Edit")
            .item(&PredefinedMenuItem::undo(handle, None)?)
            .item(&PredefinedMenuItem::redo(handle, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(handle, None)?)
            .item(&PredefinedMenuItem::copy(handle, None)?)
            .item(&PredefinedMenuItem::paste(handle, None)?)
            .item(&PredefinedMenuItem::select_all(handle, None)?)
            .separator()
            .item(&clear_staged)
            .build()?,
    )?;

    menu.append(&custom_submenu(handle, "Search")?)?;

    let preferences = MENU_ACTIONS
        .iter()
        .find(|(_, action_id, _, _)| *action_id == "view.togglePreferences")
        .expect("preferences menu action");
    let preferences = MenuItemBuilder::with_id(preferences.1, preferences.2)
        .accelerator(preferences.3)
        .build(handle)?;
    menu.append(
        &SubmenuBuilder::new(handle, "View")
            .item(&preferences)
            .separator()
            .item(&PredefinedMenuItem::fullscreen(handle, None)?)
            .build()?,
    )?;

    menu.append(&custom_submenu(handle, "Workspace")?)?;
    menu.append(&custom_submenu(handle, "Merge")?)?;

    let mut window = SubmenuBuilder::new(handle, "Window")
        .item(&PredefinedMenuItem::minimize(handle, None)?)
        .item(&PredefinedMenuItem::maximize(handle, None)?);
    if close_window.window {
        window = window
            .separator()
            .item(&PredefinedMenuItem::close_window(handle, None)?);
    }
    menu.append(&window.build()?)?;

    let help_action = MENU_ACTIONS
        .iter()
        .find(|(group, _, _, _)| *group == "Help")
        .expect("help menu action");
    let help_item = menu_item_for_action(handle, help_action.1, help_action.2, help_action.3)?;
    let help = SubmenuBuilder::new(handle, "Help").item(&help_item);
    #[cfg(not(target_os = "macos"))]
    let help = help.separator().item(&PredefinedMenuItem::about(
        handle,
        None,
        Some(about_metadata),
    )?);
    menu.append(&help.build()?)?;

    Ok(menu)
}

pub(crate) fn install_app_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    app.set_menu(build_app_menu(app)?)?;
    Ok(())
}

pub(crate) fn open_paths_from_args<I, S>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .filter_map(|arg| open_path_from_arg(arg.as_ref()))
        .collect()
}

fn open_path_from_arg(arg: &str) -> Option<PathBuf> {
    if arg.is_empty() || arg.starts_with('-') {
        return None;
    }
    if arg.starts_with("file://") {
        let url = url::Url::parse(arg).ok()?;
        return url.to_file_path().ok();
    }
    Some(PathBuf::from(arg))
}

pub(crate) fn startup_open_paths() -> Vec<PathBuf> {
    open_paths_from_args(env::args_os().map(|arg| arg.to_string_lossy().to_string()))
}

pub(crate) fn path_strings(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.display().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

pub(crate) fn store_and_emit_open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let paths = path_strings(paths);
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<SharedState>()
        && let Ok(mut state) = state.lock()
    {
        state.push_pending_open_paths(paths.clone());
    }
    emit_open_paths(app, paths);
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let action_id = event.id().as_ref().to_owned();
    if MENU_ACTIONS
        .iter()
        .any(|(_, known_id, _, _)| *known_id == action_id)
    {
        emit_app_action(app, action_id);
    }
}

pub(crate) fn handle_run_event<R: Runtime>(app: &AppHandle<R>, event: RunEvent) {
    #[cfg(target_os = "macos")]
    {
        if let RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .collect();
            store_and_emit_open_paths(app, paths);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, event);
    }
}
