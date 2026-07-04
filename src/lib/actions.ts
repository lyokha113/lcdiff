import type { FocusKind, ShortcutBinding } from "@/lib/shortcuts";
import type { Mode, Side } from "@/lib/types";

export const APP_ACTION_GROUPS = ["File", "Edit", "Search", "View", "Workspace", "Merge", "Help"] as const;
export type AppActionGroup = (typeof APP_ACTION_GROUPS)[number];

interface AppActionDefinitionShape {
  id: string;
  label: string;
  group: AppActionGroup;
  shortcut: string;
  contentChanging?: boolean;
  availabilityNote?: string;
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
  loadedSourceCount: number;
  hunkMerge: boolean;
  focusKind: FocusKind;
  shortcutDialogOpen: boolean;
}

export interface AppActionHandlers {
  openLeftFile: () => void | Promise<void>;
  openLeftDirectory: () => void | Promise<void>;
  openRightFile: () => void | Promise<void>;
  openRightDirectory: () => void | Promise<void>;
  refresh: () => void | Promise<void>;
  save: () => void | Promise<void>;
  clearStaged: () => void | Promise<void>;
  toggleSearch: () => void | Promise<void>;
  runContextualSearch: () => void | Promise<void>;
  togglePreferences: () => void | Promise<void>;
  toggleShortcutDialog: () => void | Promise<void>;
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
  { id: "edit.clearStaged", label: "Clear Staged Changes", group: "Edit", shortcut: "CmdOrCtrl+Shift+Backspace", contentChanging: true },
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
] as const satisfies readonly AppActionDefinitionShape[];

export type AppActionDefinition = (typeof ACTION_DEFINITIONS)[number];
export type AppActionId = AppActionDefinition["id"];

type AppActionHandlerName = Exclude<keyof AppActionHandlers, "reportBlocked">;

const ACTION_IDS = new Set<string>(ACTION_DEFINITIONS.map((definition) => definition.id));

const ACTION_HANDLERS: Record<AppActionId, AppActionHandlerName> = {
  "file.openLeftFile": "openLeftFile",
  "file.openLeftDirectory": "openLeftDirectory",
  "file.openRightFile": "openRightFile",
  "file.openRightDirectory": "openRightDirectory",
  "file.refresh": "refresh",
  "file.save": "save",
  "edit.clearStaged": "clearStaged",
  "search.toggle": "toggleSearch",
  "search.runContextual": "runContextualSearch",
  "view.togglePreferences": "togglePreferences",
  "help.showShortcuts": "toggleShortcutDialog",
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
  if (context.shortcutDialogOpen && actionId !== "help.showShortcuts") {
    return blocked("Close Keyboard Shortcuts before running another command.");
  }

  if (isContentChangingAction(actionId) && context.focusKind === "editable") {
    return blocked("Finish editing or leave the editor before running this shortcut.");
  }

  switch (actionId) {
    case "file.openLeftFile":
    case "file.openLeftDirectory":
      return context.mode === "text" ? blocked("File sources are not available in Free text mode.") : enabled();
    case "file.openRightFile":
    case "file.openRightDirectory":
      return context.mode !== "compare" ? blocked("Open right source is available only in Compare mode.") : enabled();
    case "search.toggle":
    case "search.runContextual":
      return context.mode === "text" ? blocked("Search is not available in Free text mode.") : enabled();
    case "file.refresh":
      return context.loadedSourceCount > 0 ? enabled() : blocked("Open a source before refreshing.");
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
