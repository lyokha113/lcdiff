import type { FocusKind, ShortcutBinding } from "@/lib/shortcuts";
import type { Mode, Side } from "@/lib/types";

type AppActionGroup = "File" | "Edit" | "Search" | "View" | "Workspace" | "Merge";

interface AppActionDefinitionShape {
  id: string;
  label: string;
  group: AppActionGroup;
  shortcut: string;
  contentChanging?: boolean;
}

export interface AppActionContext {
  mode: Mode;
  activeTab: "files" | string;
  openTabs: string[];
  selectedPath?: string;
  selectedCanCopyLeft: boolean;
  selectedCanCopyRight: boolean;
  stagedTarget?: Side;
  stagedCount: number;
  hunkMerge: boolean;
  focusKind: FocusKind;
}

export interface AppActionHandlers {
  openLeft: () => void | Promise<void>;
  openRight: () => void | Promise<void>;
  refresh: () => void | Promise<void>;
  save: () => void | Promise<void>;
  clearStaged: () => void | Promise<void>;
  toggleSearch: () => void | Promise<void>;
  runContextualSearch: () => void | Promise<void>;
  togglePreferences: () => void | Promise<void>;
  focusFiles: () => void | Promise<void>;
  nextTab: () => void | Promise<void>;
  previousTab: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  copyToLeft: () => void | Promise<void>;
  copyToRight: () => void | Promise<void>;
  takeAllToLeft: () => void | Promise<void>;
  takeAllToRight: () => void | Promise<void>;
  moveHunkToLeft: () => void | Promise<void>;
  moveHunkToRight: () => void | Promise<void>;
  reportBlocked: (message: string) => void;
}

export interface AppActionState {
  enabled: boolean;
  blockedReason?: string;
}

export const ACTION_DEFINITIONS = [
  { id: "file.openLeft", label: "Open Left Source", group: "File", shortcut: "CmdOrCtrl+O" },
  { id: "file.openRight", label: "Open Right Target", group: "File", shortcut: "CmdOrCtrl+Shift+O" },
  { id: "file.refresh", label: "Refresh Sources", group: "File", shortcut: "CmdOrCtrl+R" },
  { id: "file.save", label: "Save Staged Target", group: "File", shortcut: "CmdOrCtrl+S" },
  { id: "edit.clearStaged", label: "Clear Staged Changes", group: "Edit", shortcut: "CmdOrCtrl+Shift+Backspace", contentChanging: true },
  { id: "search.toggle", label: "Toggle Search", group: "Search", shortcut: "CmdOrCtrl+F" },
  { id: "search.runContextual", label: "Run Search Or Find", group: "Search", shortcut: "CmdOrCtrl+Enter" },
  { id: "view.togglePreferences", label: "Toggle Preferences", group: "View", shortcut: "CmdOrCtrl+," },
  { id: "workspace.focusFiles", label: "Focus Files", group: "Workspace", shortcut: "CmdOrCtrl+1" },
  { id: "workspace.nextTab", label: "Next Tab", group: "Workspace", shortcut: "CmdOrCtrl+Tab" },
  { id: "workspace.previousTab", label: "Previous Tab", group: "Workspace", shortcut: "CmdOrCtrl+Shift+Tab" },
  { id: "workspace.closeTab", label: "Close Active Tab", group: "Workspace", shortcut: "CmdOrCtrl+W" },
  { id: "merge.copyToLeft", label: "Copy Entry To Left", group: "Merge", shortcut: "Alt+[", contentChanging: true },
  { id: "merge.copyToRight", label: "Copy Entry To Right", group: "Merge", shortcut: "Alt+]", contentChanging: true },
  { id: "merge.takeAllToLeft", label: "Take All Into Left", group: "Merge", shortcut: "Alt+Shift+[", contentChanging: true },
  { id: "merge.takeAllToRight", label: "Take All Into Right", group: "Merge", shortcut: "Alt+Shift+]", contentChanging: true },
  { id: "merge.moveHunkToLeft", label: "Move Hunk Into Left", group: "Merge", shortcut: "CmdOrCtrl+Alt+[", contentChanging: true },
  { id: "merge.moveHunkToRight", label: "Move Hunk Into Right", group: "Merge", shortcut: "CmdOrCtrl+Alt+]", contentChanging: true },
] as const satisfies readonly AppActionDefinitionShape[];

export type AppActionDefinition = (typeof ACTION_DEFINITIONS)[number];
export type AppActionId = AppActionDefinition["id"];

type AppActionHandlerName = Exclude<keyof AppActionHandlers, "reportBlocked">;

const ACTION_IDS = new Set<string>(ACTION_DEFINITIONS.map((definition) => definition.id));

const ACTION_HANDLERS: Record<AppActionId, AppActionHandlerName> = {
  "file.openLeft": "openLeft",
  "file.openRight": "openRight",
  "file.refresh": "refresh",
  "file.save": "save",
  "edit.clearStaged": "clearStaged",
  "search.toggle": "toggleSearch",
  "search.runContextual": "runContextualSearch",
  "view.togglePreferences": "togglePreferences",
  "workspace.focusFiles": "focusFiles",
  "workspace.nextTab": "nextTab",
  "workspace.previousTab": "previousTab",
  "workspace.closeTab": "closeActiveTab",
  "merge.copyToLeft": "copyToLeft",
  "merge.copyToRight": "copyToRight",
  "merge.takeAllToLeft": "takeAllToLeft",
  "merge.takeAllToRight": "takeAllToRight",
  "merge.moveHunkToLeft": "moveHunkToLeft",
  "merge.moveHunkToRight": "moveHunkToRight",
};

export function shortcutBindings(): Array<ShortcutBinding<AppActionId>> {
  return ACTION_DEFINITIONS.map((definition) => ({
    actionId: definition.id,
    shortcut: definition.shortcut,
  }));
}

export function isAppActionId(value: string): value is AppActionId {
  return ACTION_IDS.has(value);
}

export function getActionState(actionId: AppActionId, context: AppActionContext): AppActionState {
  if (isContentChangingAction(actionId) && context.focusKind === "editable") {
    return blocked("Finish editing or leave the editor before running this shortcut.");
  }

  switch (actionId) {
    case "file.openRight":
      return context.mode === "single" ? blocked("Open right source is available only in Compare mode.") : enabled();
    case "file.save":
      return context.stagedTarget && context.stagedCount > 0 ? enabled() : blocked("No staged changes to save.");
    case "edit.clearStaged":
      return context.stagedCount > 0 ? enabled() : blocked("No staged changes to clear.");
    case "workspace.nextTab":
    case "workspace.previousTab":
      return context.openTabs.length > 0 ? enabled() : blocked("Open a diff tab before switching tabs.");
    case "workspace.closeTab":
      return context.activeTab === "files" ? blocked("Open a diff tab before closing a tab.") : enabled();
    case "merge.copyToLeft":
      return context.selectedCanCopyLeft ? enabled() : blocked("Select an entry before copying to the left.");
    case "merge.copyToRight":
      return context.selectedCanCopyRight ? enabled() : blocked("Select an entry before copying to the right.");
    case "merge.takeAllToLeft":
    case "merge.takeAllToRight":
      return context.hunkMerge ? enabled() : blocked("Open an editable diff before taking all changes.");
    case "merge.moveHunkToLeft":
    case "merge.moveHunkToRight":
      return context.hunkMerge ? enabled() : blocked("Open an editable diff before moving hunks.");
    default:
      return enabled();
  }
}

export async function dispatchAppAction(
  actionId: AppActionId,
  context: AppActionContext,
  handlers: AppActionHandlers,
): Promise<boolean> {
  const state = getActionState(actionId, context);
  if (!state.enabled) {
    handlers.reportBlocked(state.blockedReason ?? "Command is not available.");
    return false;
  }

  await handlers[ACTION_HANDLERS[actionId]]();
  return true;
}

function isContentChangingAction(actionId: AppActionId): boolean {
  return ACTION_DEFINITIONS.some((definition) =>
    definition.id === actionId && "contentChanging" in definition && definition.contentChanging === true
  );
}

function enabled(): AppActionState {
  return { enabled: true };
}

function blocked(blockedReason: string): AppActionState {
  return { enabled: false, blockedReason };
}
