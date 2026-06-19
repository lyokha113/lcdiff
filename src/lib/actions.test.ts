import { describe, expect, it, vi } from "vitest";
import {
  APP_ACTION_GROUPS,
  ACTION_DEFINITIONS,
  dispatchAppAction,
  getActionState,
  isAppActionId,
  shortcutBindings,
  type AppActionId,
  type AppActionContext,
  type AppActionHandlers,
} from "@/lib/actions";

function context(overrides: Partial<AppActionContext> = {}): AppActionContext {
  return {
    mode: "compare",
    activeTab: "files",
    openTabs: [],
    selectedPath: undefined,
    selectedCanCopyLeft: false,
    selectedCanCopyRight: false,
    stagedTarget: undefined,
    stagedCount: 0,
    loadedSourceCount: 0,
    hunkMerge: false,
    focusKind: "none",
    shortcutDialogOpen: false,
    ...overrides,
  };
}

function handlers(): AppActionHandlers {
  return {
    openLeftFile: vi.fn(),
    openLeftDirectory: vi.fn(),
    openRightFile: vi.fn(),
    openRightDirectory: vi.fn(),
    refresh: vi.fn(),
    save: vi.fn(),
    clearStaged: vi.fn(),
    toggleSearch: vi.fn(),
    runContextualSearch: vi.fn(),
    togglePreferences: vi.fn(),
    toggleShortcutDialog: vi.fn(),
    focusFiles: vi.fn(),
    nextTab: vi.fn(),
    previousTab: vi.fn(),
    closeActiveTab: vi.fn(),
    copyToLeft: vi.fn(),
    copyToRight: vi.fn(),
    takeAllToLeft: vi.fn(),
    takeAllToRight: vi.fn(),
    moveHunkToLeft: vi.fn(),
    moveHunkToRight: vi.fn(),
    reportBlocked: vi.fn(),
  };
}

describe("action registry", () => {
  it("exports the supported action groups in order", () => {
    expect(APP_ACTION_GROUPS).toEqual(["File", "Edit", "Search", "View", "Workspace", "Merge", "Help"]);
  });

  it("creates one shortcut binding per action definition", () => {
    const bindings = shortcutBindings();
    expect(bindings).toHaveLength(ACTION_DEFINITIONS.length);
    expect(bindings.map((binding) => binding.actionId)).toEqual(ACTION_DEFINITIONS.map((definition) => definition.id));
    expect(bindings.find((binding) => binding.actionId === "search.toggle")?.shortcut).toBe("CmdOrCtrl+F");
    expect(bindings.find((binding) => binding.actionId === "workspace.nextTab")?.shortcut).toBe("Ctrl+Tab");
    expect(bindings.find((binding) => binding.actionId === "workspace.previousTab")?.shortcut).toBe("Ctrl+Shift+Tab");
  });

  it("defines the action registry with explicit labels, groups, shortcuts, and availability notes", () => {
    expect(ACTION_DEFINITIONS).toEqual([
      { id: "file.openLeftFile", label: "Open Left File", group: "File", shortcut: "CmdOrCtrl+O" },
      { id: "file.openLeftDirectory", label: "Open Left Directory", group: "File", shortcut: "CmdOrCtrl+Alt+O" },
      {
        id: "file.openRightFile",
        label: "Open Right File",
        group: "File",
        shortcut: "CmdOrCtrl+Shift+O",
        availabilityNote: "Compare only",
      },
      {
        id: "file.openRightDirectory",
        label: "Open Right Directory",
        group: "File",
        shortcut: "CmdOrCtrl+Alt+Shift+O",
        availabilityNote: "Compare only",
      },
      { id: "file.refresh", label: "Refresh Sources", group: "File", shortcut: "CmdOrCtrl+R" },
      { id: "file.save", label: "Save Staged Target", group: "File", shortcut: "CmdOrCtrl+S" },
      {
        id: "edit.clearStaged",
        label: "Clear Staged Changes",
        group: "Edit",
        shortcut: "CmdOrCtrl+Shift+Backspace",
        contentChanging: true,
      },
      { id: "search.toggle", label: "Toggle Search", group: "Search", shortcut: "CmdOrCtrl+F" },
      { id: "search.runContextual", label: "Run Search Or Find", group: "Search", shortcut: "CmdOrCtrl+Enter" },
      { id: "view.togglePreferences", label: "Toggle Preferences", group: "View", shortcut: "CmdOrCtrl+," },
      { id: "workspace.focusFiles", label: "Focus Files", group: "Workspace", shortcut: "CmdOrCtrl+1" },
      { id: "workspace.nextTab", label: "Next Tab", group: "Workspace", shortcut: "Ctrl+Tab" },
      { id: "workspace.previousTab", label: "Previous Tab", group: "Workspace", shortcut: "Ctrl+Shift+Tab" },
      { id: "workspace.closeTab", label: "Close Active Tab", group: "Workspace", shortcut: "CmdOrCtrl+W" },
      { id: "merge.copyToLeft", label: "Copy Entry To Left", group: "Merge", shortcut: "Alt+[", contentChanging: true },
      { id: "merge.copyToRight", label: "Copy Entry To Right", group: "Merge", shortcut: "Alt+]", contentChanging: true },
      { id: "merge.takeAllToLeft", label: "Take All Into Left", group: "Merge", shortcut: "Alt+Shift+[", contentChanging: true },
      { id: "merge.takeAllToRight", label: "Take All Into Right", group: "Merge", shortcut: "Alt+Shift+]", contentChanging: true },
      { id: "merge.moveHunkToLeft", label: "Move Hunk Into Left", group: "Merge", shortcut: "CmdOrCtrl+Alt+[", contentChanging: true },
      { id: "merge.moveHunkToRight", label: "Move Hunk Into Right", group: "Merge", shortcut: "CmdOrCtrl+Alt+]", contentChanging: true },
      { id: "help.showShortcuts", label: "Keyboard Shortcuts", group: "Help", shortcut: "CmdOrCtrl+/" },
    ]);
  });

  it("keeps action ids and shortcuts unique", () => {
    const actionIds = ACTION_DEFINITIONS.map((definition) => definition.id);
    const shortcuts = ACTION_DEFINITIONS.map((definition) => definition.shortcut);

    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("identifies known action ids", () => {
    expect(isAppActionId("file.save")).toBe(true);
    expect(isAppActionId("file.export")).toBe(false);
    expect(isAppActionId("file.openLeft")).toBe(false);
    expect(isAppActionId("file.openRight")).toBe(false);
  });

  it("exposes the new open handlers and rejects legacy handler names", () => {
    const actionHandlers = handlers();

    expect(actionHandlers).toHaveProperty("openLeftFile");
    expect(actionHandlers).toHaveProperty("openLeftDirectory");
    expect(actionHandlers).toHaveProperty("openRightFile");
    expect(actionHandlers).toHaveProperty("openRightDirectory");
    expect(actionHandlers).not.toHaveProperty("openLeft");
    expect(actionHandlers).not.toHaveProperty("openRight");
  });

  it("blocks opening right sources in single mode", () => {
    expect(getActionState("file.openRightFile", context({ mode: "single" }))).toEqual({
      enabled: false,
      blockedReason: "Open right source is available only in Compare mode.",
    });
    expect(getActionState("file.openRightDirectory", context({ mode: "single" }))).toEqual({
      enabled: false,
      blockedReason: "Open right source is available only in Compare mode.",
    });
  });

  it("blocks refresh with no loaded sources and enables it with loaded sources", () => {
    expect(getActionState("file.refresh", context())).toEqual({
      enabled: false,
      blockedReason: "Open a source before refreshing.",
    });
    expect(getActionState("file.refresh", context({ loadedSourceCount: 1 }))).toEqual({ enabled: true });
    expect(getActionState("file.refresh", context({ loadedSourceCount: 2 }))).toEqual({ enabled: true });
  });

  it("blocks save without staged changes and enables it with a staged target and count", () => {
    expect(getActionState("file.save", context())).toEqual({
      enabled: false,
      blockedReason: "No staged changes to save.",
    });
    expect(getActionState("file.save", context({ stagedTarget: "right", stagedCount: 1 }))).toEqual({ enabled: true });
  });

  it("blocks other actions while the keyboard shortcuts dialog is open", () => {
    for (const definition of ACTION_DEFINITIONS) {
      if (definition.id === "help.showShortcuts") {
        continue;
      }

      expect(getActionState(definition.id, context({ shortcutDialogOpen: true }))).toEqual({
        enabled: false,
        blockedReason: "Close Keyboard Shortcuts before running another command.",
      });
    }

    expect(getActionState("help.showShortcuts", context({ shortcutDialogOpen: true }))).toEqual({ enabled: true });
  });

  it("blocks content-changing merge shortcuts while editable content has focus", () => {
    expect(getActionState("merge.copyToRight", context({ focusKind: "editable", selectedCanCopyRight: true }))).toEqual({
      enabled: false,
      blockedReason: "Finish editing or leave the editor before running this shortcut.",
    });
  });

  it("blocks clearing staged changes while editable content has focus", () => {
    expect(getActionState("edit.clearStaged", context({ focusKind: "editable", stagedCount: 1 }))).toEqual({
      enabled: false,
      blockedReason: "Finish editing or leave the editor before running this shortcut.",
    });
  });

  it("blocks closing the Files tab", () => {
    expect(getActionState("workspace.closeTab", context({ activeTab: "files", openTabs: ["a.class"] }))).toEqual({
      enabled: false,
      blockedReason: "Open a diff tab before closing a tab.",
    });
  });

  it("requires diff tabs before switching workspace tabs", () => {
    expect(getActionState("workspace.nextTab", context())).toEqual({
      enabled: false,
      blockedReason: "Open a diff tab before switching tabs.",
    });
    expect(getActionState("workspace.previousTab", context({ openTabs: ["a.class"] }))).toEqual({ enabled: true });
  });

  it("requires hunk merge state for hunk movement actions", () => {
    expect(getActionState("merge.moveHunkToLeft", context())).toEqual({
      enabled: false,
      blockedReason: "Open an editable diff before moving hunks.",
    });
    expect(getActionState("merge.moveHunkToRight", context({ hunkMerge: true }))).toEqual({ enabled: true });
  });

  it("requires hunk merge state for take-all hunk actions", () => {
    expect(getActionState("merge.takeAllToLeft", context())).toEqual({
      enabled: false,
      blockedReason: "Open an editable diff before taking all changes.",
    });
    expect(getActionState("merge.takeAllToRight", context({ hunkMerge: true }))).toEqual({ enabled: true });
  });

  it("dispatches enabled actions without reporting a block", async () => {
    const actionHandlers = handlers();
    await expect(dispatchAppAction("search.toggle", context(), actionHandlers)).resolves.toBe(true);
    expect(actionHandlers.toggleSearch).toHaveBeenCalledTimes(1);
    expect(actionHandlers.reportBlocked).not.toHaveBeenCalled();
  });

  it("reports blocked actions without running their handler", async () => {
    const actionHandlers = handlers();
    await expect(dispatchAppAction("file.openRightFile", context({ mode: "single" }), actionHandlers)).resolves.toBe(false);
    expect(actionHandlers.openRightFile).not.toHaveBeenCalled();
    expect(actionHandlers.reportBlocked).toHaveBeenCalledWith("Open right source is available only in Compare mode.");
  });

  it("does not dispatch refresh when no source is loaded", async () => {
    const actionHandlers = handlers();
    await expect(dispatchAppAction("file.refresh", context(), actionHandlers)).resolves.toBe(false);
    expect(actionHandlers.refresh).not.toHaveBeenCalled();
    expect(actionHandlers.reportBlocked).toHaveBeenCalledWith("Open a source before refreshing.");
  });

  it("maps every action id to its expected handler", async () => {
    const actionHandlers = handlers();
    const enabledContext = context({
      activeTab: "a.class",
      openTabs: ["a.class"],
      selectedCanCopyLeft: true,
      selectedCanCopyRight: true,
      stagedTarget: "right",
      stagedCount: 1,
      loadedSourceCount: 2,
      hunkMerge: true,
    });

    const expectedHandlers: Array<[AppActionId, keyof AppActionHandlers]> = [
      ["file.openLeftFile", "openLeftFile"],
      ["file.openLeftDirectory", "openLeftDirectory"],
      ["file.openRightFile", "openRightFile"],
      ["file.openRightDirectory", "openRightDirectory"],
      ["file.refresh", "refresh"],
      ["file.save", "save"],
      ["edit.clearStaged", "clearStaged"],
      ["search.toggle", "toggleSearch"],
      ["search.runContextual", "runContextualSearch"],
      ["view.togglePreferences", "togglePreferences"],
      ["help.showShortcuts", "toggleShortcutDialog"],
      ["workspace.focusFiles", "focusFiles"],
      ["workspace.nextTab", "nextTab"],
      ["workspace.previousTab", "previousTab"],
      ["workspace.closeTab", "closeActiveTab"],
      ["merge.copyToLeft", "copyToLeft"],
      ["merge.copyToRight", "copyToRight"],
      ["merge.takeAllToLeft", "takeAllToLeft"],
      ["merge.takeAllToRight", "takeAllToRight"],
      ["merge.moveHunkToLeft", "moveHunkToLeft"],
      ["merge.moveHunkToRight", "moveHunkToRight"],
    ];

    for (const [actionId, handlerName] of expectedHandlers) {
      await expect(dispatchAppAction(actionId, enabledContext, actionHandlers)).resolves.toBe(true);
      expect(actionHandlers[handlerName]).toHaveBeenCalledTimes(1);
    }
  });
});
