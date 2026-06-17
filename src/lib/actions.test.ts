import { describe, expect, it, vi } from "vitest";
import {
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
    hunkMerge: false,
    focusKind: "none",
    ...overrides,
  };
}

function handlers(): AppActionHandlers {
  return {
    openLeft: vi.fn(),
    openRight: vi.fn(),
    refresh: vi.fn(),
    save: vi.fn(),
    clearStaged: vi.fn(),
    toggleSearch: vi.fn(),
    runContextualSearch: vi.fn(),
    togglePreferences: vi.fn(),
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
  it("creates one shortcut binding per action definition", () => {
    const bindings = shortcutBindings();
    expect(bindings).toHaveLength(ACTION_DEFINITIONS.length);
    expect(bindings.map((binding) => binding.actionId)).toEqual(ACTION_DEFINITIONS.map((definition) => definition.id));
    expect(bindings.find((binding) => binding.actionId === "search.toggle")?.shortcut).toBe("CmdOrCtrl+F");
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
  });

  it("blocks opening the right source in single mode", () => {
    expect(getActionState("file.openRight", context({ mode: "single" }))).toEqual({
      enabled: false,
      blockedReason: "Open right source is available only in Compare mode.",
    });
  });

  it("blocks save without staged changes and enables it with a staged target and count", () => {
    expect(getActionState("file.save", context())).toEqual({
      enabled: false,
      blockedReason: "No staged changes to save.",
    });
    expect(getActionState("file.save", context({ stagedTarget: "right", stagedCount: 1 }))).toEqual({ enabled: true });
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
    await expect(dispatchAppAction("file.openRight", context({ mode: "single" }), actionHandlers)).resolves.toBe(false);
    expect(actionHandlers.openRight).not.toHaveBeenCalled();
    expect(actionHandlers.reportBlocked).toHaveBeenCalledWith("Open right source is available only in Compare mode.");
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
      hunkMerge: true,
    });

    const expectedHandlers: Array<[AppActionId, keyof AppActionHandlers]> = [
      ["file.openLeft", "openLeft"],
      ["file.openRight", "openRight"],
      ["file.refresh", "refresh"],
      ["file.save", "save"],
      ["edit.clearStaged", "clearStaged"],
      ["search.toggle", "toggleSearch"],
      ["search.runContextual", "runContextualSearch"],
      ["view.togglePreferences", "togglePreferences"],
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
