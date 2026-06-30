# Open Source Hotkeys and Shortcut Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit file/directory hotkeys for both source sides and an in-app Keyboard Shortcuts dialog backed by the existing frontend action registry.

**Architecture:** Extend the frontend registry with four open actions, one Help action, availability metadata, and modal-aware action state. Keep picker and dialog state in `App.tsx`, render shortcut metadata through a focused formatter and dialog component, and keep the Tauri menu as an action-id adapter protected by the existing frontend/native parity test.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Testing Library, Radix/shadcn Dialog, Playwright render verifier, Tauri 2.11 Rust menu APIs.

---

## File Structure

- Modify `src/lib/actions.ts`: define four open actions, the Help action, availability metadata, dialog-open context, handler mapping, and blocking rules.
- Modify `src/lib/actions.test.ts`: verify the new registry contract, Compare-only state, modal blocking, and handler dispatch.
- Create `src/lib/shortcut-display.ts`: convert canonical shortcut strings into platform-facing keycap tokens.
- Create `src/lib/shortcut-display.test.ts`: verify macOS and Windows/Linux formatting.
- Modify `src/lib/shortcuts.test.ts`: prove the new slash and open-directory shortcuts parse and match.
- Create `src/components/KeyboardShortcutsDialog.tsx`: group registry actions and render the modal reference list.
- Create `src/components/KeyboardShortcutsDialog.test.tsx`: verify groups, keycaps, availability notes, and close behavior.
- Modify `src/styles.css`: size the dialog, build flat action rows, and constrain the body at short window heights.
- Modify `src/App.tsx`: own dialog state, bind four picker handlers, wire the Help action, and consume background shortcuts while the modal is open.
- Modify `src/App.test.tsx`: verify picker mode/side, keyboard and native-menu dialog paths, View-mode blocking, and modal isolation.
- Modify `src-tauri/src/main.rs`: add four File menu actions and `Help -> Keyboard Shortcuts`, preserving action-id event dispatch and parity checks.
- Modify `scripts/verify-frontend-render.mjs`: render-check the dialog at normal and constrained heights.
- Modify `README.md`: document the four open shortcuts and shortcut-reference entry point.

## Task 1: Extend the Action Registry Contract

**Files:**
- Modify: `src/lib/actions.test.ts:13-205`
- Modify: `src/lib/actions.ts:4-176`

- [ ] **Step 1: Write failing registry tests**

Update the `context()` and `handlers()` fixtures in `src/lib/actions.test.ts`:

```ts
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
    toggleShortcutDialog: vi.fn(),
    reportBlocked: vi.fn(),
  };
}
```

Replace the old open-right test and add registry/modal coverage:

```ts
it("defines explicit file and directory open actions", () => {
  expect(ACTION_DEFINITIONS.slice(0, 4)).toEqual([
    { id: "file.openLeftFile", label: "Open Left File", group: "File", shortcut: "CmdOrCtrl+O" },
    { id: "file.openLeftDirectory", label: "Open Left Directory", group: "File", shortcut: "CmdOrCtrl+Alt+O" },
    { id: "file.openRightFile", label: "Open Right File", group: "File", shortcut: "CmdOrCtrl+Shift+O", availabilityNote: "Compare only" },
    { id: "file.openRightDirectory", label: "Open Right Directory", group: "File", shortcut: "CmdOrCtrl+Alt+Shift+O", availabilityNote: "Compare only" },
  ]);
  expect(ACTION_DEFINITIONS.at(-1)).toEqual({
    id: "help.showShortcuts",
    label: "Keyboard Shortcuts",
    group: "Help",
    shortcut: "CmdOrCtrl+/",
  });
});

it.each(["file.openRightFile", "file.openRightDirectory"] as const)(
  "blocks %s in View mode",
  (actionId) => {
    expect(getActionState(actionId, context({ mode: "single" }))).toEqual({
      enabled: false,
      blockedReason: "Open right source is available only in Compare mode.",
    });
  },
);

it("blocks background actions while the shortcut dialog is open", () => {
  expect(getActionState("file.openLeftFile", context({ shortcutDialogOpen: true }))).toEqual({
    enabled: false,
    blockedReason: "Close Keyboard Shortcuts before running another command.",
  });
  expect(getActionState("help.showShortcuts", context({ shortcutDialogOpen: true }))).toEqual({ enabled: true });
});

it("reports a blocked right-side action without invoking its handler", async () => {
  const actionHandlers = handlers();
  await expect(dispatchAppAction(
    "file.openRightFile",
    context({ mode: "single" }),
    actionHandlers,
  )).resolves.toBe(false);
  expect(actionHandlers.openRightFile).not.toHaveBeenCalled();
  expect(actionHandlers.reportBlocked).toHaveBeenCalledWith(
    "Open right source is available only in Compare mode.",
  );
});
```

Delete the old `file.openRight` blocked-dispatch test so no removed action id or
`openRight` handler reference remains in this file.

Replace the first two entries in `expectedHandlers` and append the Help entry:

```ts
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
  ["help.showShortcuts", "toggleShortcutDialog"],
];
```

- [ ] **Step 2: Run the registry tests and verify failure**

Run:

```bash
rtk npm run test -- src/lib/actions.test.ts
```

Expected: FAIL because the four action ids, `shortcutDialogOpen`, Help group, and new handlers do not exist.

- [ ] **Step 3: Implement the registry changes**

In `src/lib/actions.ts`, export the group contract and extend the definition shape:

```ts
export const APP_ACTION_GROUPS = ["File", "Edit", "Search", "View", "Workspace", "Merge", "Help"] as const;
export type AppActionGroup = (typeof APP_ACTION_GROUPS)[number];

interface AppActionDefinitionShape {
  id: string;
  label: string;
  group: AppActionGroup;
  shortcut: string;
  availabilityNote?: string;
  contentChanging?: boolean;
}
```

Add `shortcutDialogOpen: boolean` to `AppActionContext`, replace the two open handlers with four handlers, and add `toggleShortcutDialog` to `AppActionHandlers`.

Replace the registry open rows and append the Help row:

```ts
export const ACTION_DEFINITIONS = [
  { id: "file.openLeftFile", label: "Open Left File", group: "File", shortcut: "CmdOrCtrl+O" },
  { id: "file.openLeftDirectory", label: "Open Left Directory", group: "File", shortcut: "CmdOrCtrl+Alt+O" },
  { id: "file.openRightFile", label: "Open Right File", group: "File", shortcut: "CmdOrCtrl+Shift+O", availabilityNote: "Compare only" },
  { id: "file.openRightDirectory", label: "Open Right Directory", group: "File", shortcut: "CmdOrCtrl+Alt+Shift+O", availabilityNote: "Compare only" },
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
```

Map the five new action ids to their handler names. At the beginning of `getActionState`, before editable-focus checks, add:

```ts
if (context.shortcutDialogOpen && actionId !== "help.showShortcuts") {
  return blocked("Close Keyboard Shortcuts before running another command.");
}
```

Replace the old right-side switch case with:

```ts
case "file.openRightFile":
case "file.openRightDirectory":
  return context.mode === "single"
    ? blocked("Open right source is available only in Compare mode.")
    : enabled();
```

- [ ] **Step 4: Run the registry tests and verify success**

Run:

```bash
rtk npm run test -- src/lib/actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry contract**

```bash
rtk git add src/lib/actions.ts src/lib/actions.test.ts
rtk git commit -m "feat: define file and directory hotkey actions"
```

## Task 2: Add Platform Shortcut Display Formatting

**Files:**
- Create: `src/lib/shortcut-display.test.ts`
- Create: `src/lib/shortcut-display.ts`
- Modify: `src/lib/shortcuts.test.ts:22-107`

- [ ] **Step 1: Write failing formatter and matching tests**

Create `src/lib/shortcut-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatShortcutTokens } from "@/lib/shortcut-display";

describe("formatShortcutTokens", () => {
  it("uses macOS keycap symbols", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Alt+Shift+O", "darwin")).toEqual([
      "\u2318", "\u2325", "\u21e7", "O",
    ]);
    expect(formatShortcutTokens("Ctrl+Tab", "darwin")).toEqual(["\u2303", "Tab"]);
  });

  it.each(["linux", "windows"] as const)("uses readable modifiers on %s", (platform) => {
    expect(formatShortcutTokens("CmdOrCtrl+Alt+O", platform)).toEqual(["Ctrl", "Alt", "O"]);
    expect(formatShortcutTokens("Ctrl+Shift+Tab", platform)).toEqual(["Ctrl", "Shift", "Tab"]);
  });

  it("formats named keys without changing canonical metadata", () => {
    expect(formatShortcutTokens("CmdOrCtrl+Shift+Backspace", "darwin")).toEqual([
      "\u2318", "\u21e7", "\u232b",
    ]);
    expect(formatShortcutTokens("CmdOrCtrl+Enter", "linux")).toEqual(["Ctrl", "Enter"]);
  });
});
```

Add to `src/lib/shortcuts.test.ts`:

```ts
it("matches directory and shortcut-reference combinations", () => {
  expect(shortcutMatches(
    event({ key: "o", metaKey: true, altKey: true }),
    parseShortcut("CmdOrCtrl+Alt+O"),
    "darwin",
  )).toBe(true);
  expect(shortcutMatches(
    event({ key: "/", ctrlKey: true }),
    parseShortcut("CmdOrCtrl+/"),
    "linux",
  )).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
rtk npm run test -- src/lib/shortcut-display.test.ts src/lib/shortcuts.test.ts
```

Expected: FAIL because `shortcut-display.ts` does not exist; the existing parser test remains green.

- [ ] **Step 3: Implement the pure formatter**

Create `src/lib/shortcut-display.ts`:

```ts
import type { PlatformName } from "@/lib/shortcuts";

const MAC_TOKENS: Record<string, string> = {
  cmdorctrl: "\u2318",
  ctrl: "\u2303",
  control: "\u2303",
  alt: "\u2325",
  option: "\u2325",
  shift: "\u21e7",
  backspace: "\u232b",
};

const OTHER_TOKENS: Record<string, string> = {
  cmdorctrl: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

export function formatShortcutTokens(shortcut: string, platform: PlatformName): string[] {
  const tokens = platform === "darwin" ? MAC_TOKENS : OTHER_TOKENS;
  return shortcut.split("+").map((rawToken) => {
    const token = rawToken.trim();
    const normalized = token.toLowerCase();
    const replacement = tokens[normalized];
    if (replacement) return replacement;
    if (token.length === 1) return token.toUpperCase();
    return token;
  });
}
```

- [ ] **Step 4: Run focused tests and verify success**

Run:

```bash
rtk npm run test -- src/lib/shortcut-display.test.ts src/lib/shortcuts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the formatter**

```bash
rtk git add src/lib/shortcut-display.ts src/lib/shortcut-display.test.ts src/lib/shortcuts.test.ts
rtk git commit -m "feat: format shortcut labels by platform"
```

## Task 3: Build the Keyboard Shortcuts Dialog

**Files:**
- Create: `src/components/KeyboardShortcutsDialog.test.tsx`
- Create: `src/components/KeyboardShortcutsDialog.tsx`
- Modify: `src/styles.css:250-330,869-903`

- [ ] **Step 1: Write the failing dialog tests**

Create `src/components/KeyboardShortcutsDialog.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";

describe("KeyboardShortcutsDialog", () => {
  it("groups registry actions and shows Compare-only metadata", () => {
    render(<KeyboardShortcutsDialog open onOpenChange={vi.fn()} platform="darwin" />);

    expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    for (const group of ["File", "Edit", "Search", "View", "Workspace", "Merge", "Help"]) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }

    const row = screen.getByText("Open Right Directory").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Compare only")).toBeInTheDocument();
    expect(within(row!).getByLabelText("Command Option Shift O")).toBeInTheDocument();
  });

  it("renders Windows and Linux modifier names", () => {
    render(<KeyboardShortcutsDialog open onOpenChange={vi.fn()} platform="windows" />);
    const row = screen.getByText("Open Left Directory").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByLabelText("Ctrl Alt O")).toBeInTheDocument();
  });

  it("closes through the dialog close button", async () => {
    const onOpenChange = vi.fn();
    render(<KeyboardShortcutsDialog open onOpenChange={onOpenChange} platform="linux" />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
rtk npm run test -- src/components/KeyboardShortcutsDialog.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the dialog component**

Create `src/components/KeyboardShortcutsDialog.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ACTION_DEFINITIONS,
  APP_ACTION_GROUPS,
  type AppActionDefinition,
} from "@/lib/actions";
import { formatShortcutTokens } from "@/lib/shortcut-display";
import type { PlatformName } from "@/lib/shortcuts";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformName;
  definitions?: readonly AppActionDefinition[];
}

const ACCESSIBLE_TOKEN_NAMES: Record<string, string> = {
  "\u2318": "Command",
  "\u2303": "Control",
  "\u2325": "Option",
  "\u21e7": "Shift",
  "\u232b": "Backspace",
};

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  platform,
  definitions = ACTION_DEFINITIONS,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shortcut-dialog sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Available app-level keyboard shortcuts.
          </DialogDescription>
        </DialogHeader>
        <div className="shortcut-dialog-body">
          {APP_ACTION_GROUPS.map((group) => {
            const actions = definitions.filter((definition) => definition.group === group);
            if (actions.length === 0) return null;
            return (
              <section className="shortcut-group" key={group}>
                <h3>{group}</h3>
                <ul>
                  {actions.map((definition) => {
                    const tokens = formatShortcutTokens(definition.shortcut, platform);
                    const accessibleLabel = tokens
                      .map((token) => ACCESSIBLE_TOKEN_NAMES[token] ?? token)
                      .join(" ");
                    const availabilityNote = "availabilityNote" in definition
                      ? definition.availabilityNote
                      : undefined;
                    return (
                      <li key={definition.id}>
                        <span className="shortcut-action">
                          {definition.label}
                          {availabilityNote && <small>{availabilityNote}</small>}
                        </span>
                        <span className="shortcut-keys" aria-label={accessibleLabel}>
                          {tokens.map((token, index) => <kbd key={`${definition.id}-${index}`}>{token}</kbd>)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Add these flat, responsive styles to `src/styles.css`:

```css
.shortcut-dialog { width: min(720px, calc(100vw - 2rem)); max-width: 720px; padding: 0; gap: 0; overflow: hidden; }
.shortcut-dialog [data-slot="dialog-header"] { padding: 1rem 1.25rem; border-bottom: 1px solid var(--line); }
.shortcut-dialog-body { max-height: min(70vh, 620px); overflow-y: auto; padding: 0.5rem 1.25rem 1.25rem; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 2rem; align-items: start; }
.shortcut-group { min-width: 0; padding-top: 0.75rem; }
.shortcut-group h3 { margin: 0 0 0.5rem; color: var(--text-2); font-family: var(--font-mono); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0; }
.shortcut-group ul { list-style: none; margin: 0; padding: 0; }
.shortcut-group li { min-height: 2rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--line-soft); }
.shortcut-action { min-width: 0; display: flex; align-items: baseline; gap: 0.5rem; }
.shortcut-action small { color: var(--text-2); font-size: 0.68rem; white-space: nowrap; }
.shortcut-keys { display: inline-flex; align-items: center; gap: 0.25rem; }
.shortcut-keys kbd { min-width: 1.55rem; height: 1.45rem; display: inline-flex; align-items: center; justify-content: center; padding: 0 0.35rem; border: 1px solid var(--line); border-radius: 4px; background: var(--ink-3); color: var(--text-0); font-family: var(--font-mono); font-size: 0.7rem; line-height: 1; }

@media (max-width: 620px) {
  .shortcut-dialog-body { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run the component test and verify success**

Run:

```bash
rtk npm run test -- src/components/KeyboardShortcutsDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the dialog component**

```bash
rtk git add src/components/KeyboardShortcutsDialog.tsx src/components/KeyboardShortcutsDialog.test.tsx src/styles.css
rtk git commit -m "feat: add keyboard shortcuts reference dialog"
```

## Task 4: Wire Pickers, Dialog State, and Modal Isolation

**Files:**
- Modify: `src/App.test.tsx:93-235,428-537`
- Modify: `src/App.tsx:29-70,112-145,389-421,988-1102,1231-1278`

- [ ] **Step 1: Preserve dialog options in the test mock**

Replace the plugin-dialog mock in `src/App.test.tsx`:

```ts
type OpenDialogOptions = {
  multiple?: boolean;
  directory?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
};

const chooseFile = vi.fn<
  (_options?: OpenDialogOptions) => Promise<string | null>
>(async () => "/tmp/config.json");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options?: OpenDialogOptions) => chooseFile(options),
}));
```

- [ ] **Step 2: Write failing App integration tests**

Add to `src/App.test.tsx`:

```tsx
it.each([
  { name: "left file", key: "o", modifiers: {}, side: "left", directory: undefined },
  { name: "left directory", key: "o", modifiers: { altKey: true }, side: "left", directory: true },
  { name: "right file", key: "o", modifiers: { shiftKey: true }, side: "right", directory: undefined },
  { name: "right directory", key: "o", modifiers: { altKey: true, shiftKey: true }, side: "right", directory: true },
] as const)("opens the $name picker from its shortcut", async ({ key, modifiers, side, directory }) => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));

  fireEvent.keyDown(window, { key, ...cmdOrCtrl(), ...modifiers });

  await waitFor(() => expect(chooseFile).toHaveBeenCalledTimes(1));
  const options = chooseFile.mock.calls[0][0];
  expect(options?.directory).toBe(directory);
  expect(options?.multiple).toBe(false);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_archive", {
    path: "/tmp/config.json",
    side,
  }));
});

it("blocks right-side open shortcuts in View mode", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText("Decompile"));

  fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl(), altKey: true, shiftKey: true });

  expect(await screen.findByText("Open right source is available only in Compare mode.")).toBeInTheDocument();
  expect(chooseFile).not.toHaveBeenCalled();
});

it("leaves archive state unchanged when the picker is canceled", async () => {
  const user = userEvent.setup();
  chooseFile.mockResolvedValueOnce(null);
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));

  fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl(), altKey: true });

  await waitFor(() => expect(chooseFile).toHaveBeenCalledTimes(1));
  expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
});

it("opens and closes Keyboard Shortcuts from the registered shortcut", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));

  fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
  expect(await screen.findByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument());

  fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
  expect(await screen.findByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument());
});

it("opens Keyboard Shortcuts from the native app-action event", async () => {
  const user = userEvent.setup();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));
  await waitFor(() => expect(appActionHandler).toBeDefined());

  await act(async () => {
    appActionHandler?.({ payload: { actionId: "help.showShortcuts" } });
  });

  expect(await screen.findByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
});

it("does not run matched background actions while Keyboard Shortcuts is open", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));
  fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
  await screen.findByRole("heading", { name: "Keyboard Shortcuts" });

  const accepted = fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl() });

  expect(accepted).toBe(false);
  expect(chooseFile).not.toHaveBeenCalled();
});

it("blocks native app actions behind Keyboard Shortcuts", async () => {
  const user = userEvent.setup();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  render(<App />);
  await user.click(screen.getByText("Compare / Merge"));
  await waitFor(() => expect(appActionHandler).toBeDefined());

  await act(async () => {
    appActionHandler?.({ payload: { actionId: "help.showShortcuts" } });
  });
  await screen.findByRole("heading", { name: "Keyboard Shortcuts" });

  await act(async () => {
    appActionHandler?.({ payload: { actionId: "file.openLeftFile" } });
  });

  expect(chooseFile).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run App tests and verify failure**

Run:

```bash
rtk npm run test -- src/App.test.tsx
```

Expected: FAIL because `App` still binds the old open actions and does not render the shortcut dialog.

- [ ] **Step 4: Implement App wiring**

In `src/App.tsx`:

1. Import `KeyboardShortcutsDialog` and `currentPlatform`.
2. Add `const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);` beside the other shell UI state.
3. Add `shortcutDialogOpen` to `actionContext` and its dependency list.
4. Replace the old action handlers with:

```ts
openLeftFile: () => void browse("left"),
openLeftDirectory: () => void browseFolder("left"),
openRightFile: () => void browse("right"),
openRightDirectory: () => void browseFolder("right"),
toggleShortcutDialog: () => setShortcutDialogOpen((open) => !open),
```

Keep all existing handlers unchanged, and add `browseFolder` to the `useMemo` dependency list.

In the DOM keydown handler, consume all registered shortcuts while the modal is open, even when action state blocks execution:

```ts
const state = getActionState(actionId, focusedContext);
if (state.enabled || focusedContext.shortcutDialogOpen) {
  event.preventDefault();
}
void dispatchAppAction(actionId, focusedContext, handlers);
```

Render the dialog before the existing confirmation dialogs:

```tsx
<KeyboardShortcutsDialog
  open={shortcutDialogOpen}
  onOpenChange={setShortcutDialogOpen}
  platform={currentPlatform()}
/>
```

- [ ] **Step 5: Run App and focused frontend tests**

Run:

```bash
rtk npm run test -- src/App.test.tsx src/lib/actions.test.ts src/components/KeyboardShortcutsDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit App integration**

```bash
rtk git add src/App.tsx src/App.test.tsx
rtk git commit -m "feat: wire open pickers and shortcut dialog actions"
```

## Task 5: Update the Native Tauri Menu

**Files:**
- Modify: `src-tauri/src/main.rs:28-102,1115-1234,1309-1474`

- [ ] **Step 1: Write failing native menu contract assertions**

Update `menu_actions_follow_expected_group_order`:

```rust
assert_eq!(
    groups,
    ["File", "Edit", "Search", "View", "Workspace", "Merge", "Help"]
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
    assert_eq!(actual_count, expected_count, "unexpected {group} action count");
}
```

Add an exact action assertion:

```rust
#[test]
fn menu_contains_explicit_open_and_shortcut_reference_actions() {
    assert!(MENU_ACTIONS.contains(&(
        "File",
        "file.openLeftDirectory",
        "Open Left Directory",
        "CmdOrCtrl+Alt+O",
    )));
    assert!(MENU_ACTIONS.contains(&(
        "File",
        "file.openRightDirectory",
        "Open Right Directory",
        "CmdOrCtrl+Alt+Shift+O",
    )));
    assert!(MENU_ACTIONS.contains(&(
        "Help",
        "help.showShortcuts",
        "Keyboard Shortcuts",
        "CmdOrCtrl+/",
    )));
}
```

- [ ] **Step 2: Run native menu tests and verify failure**

Run:

```bash
rtk cargo test -p lcdiff-desktop menu_action
```

Expected: FAIL because File still has four actions and Help has none.

- [ ] **Step 3: Replace native action metadata and build the Help item**

Replace the first two `MENU_ACTIONS` rows with the same four ids, labels, groups, and accelerators used in `ACTION_DEFINITIONS`. Append:

```rust
(
    "Help",
    "help.showShortcuts",
    "Keyboard Shortcuts",
    "CmdOrCtrl+/",
),
```

In `build_app_menu`, replace the empty Help builder with:

```rust
let shortcut_reference = MENU_ACTIONS
    .iter()
    .find(|(group, _, _, _)| *group == "Help")
    .expect("shortcut reference menu action");
let shortcut_reference = MenuItemBuilder::with_id(shortcut_reference.1, shortcut_reference.2)
    .accelerator(shortcut_reference.3)
    .build(handle)?;
let help = SubmenuBuilder::new(handle, "Help").item(&shortcut_reference);
#[cfg(not(target_os = "macos"))]
let help = help.separator().item(&PredefinedMenuItem::about(
    handle,
    None,
    Some(about_metadata),
)?);
menu.append(&help.build()?)?;
```

- [ ] **Step 4: Run Rust menu and parity tests**

Run:

```bash
rtk cargo test -p lcdiff-desktop menu_action
rtk cargo test -p lcdiff-desktop full_app_menu_builds_with_standard_and_custom_groups
```

Expected: PASS, including accelerator acceptance and frontend/native parity.

- [ ] **Step 5: Commit the native menu**

```bash
rtk git add src-tauri/src/main.rs
rtk git commit -m "feat: expose open and shortcut actions in native menus"
```

## Task 6: Render Verification, Documentation, and Full Gates

**Files:**
- Modify: `scripts/verify-frontend-render.mjs:53-95`
- Modify: `README.md:164-196`

- [ ] **Step 1: Add the render-verifier assertions**

In the first browser page flow in `scripts/verify-frontend-render.mjs`, after the Preferences assertions, add:

```js
await page.keyboard.down(commandKey);
await page.keyboard.press("/");
await page.keyboard.up(commandKey);
const shortcutDialog = page.getByRole("dialog");
await shortcutDialog.waitFor({ timeout: 5_000 });
await shortcutDialog.getByRole("heading", { name: "Keyboard Shortcuts" }).waitFor();
await shortcutDialog.getByText("Open Left Directory").waitFor();
await shortcutDialog.getByText("Open Right Directory").waitFor();
await shortcutDialog.getByText("Compare only").first().waitFor();

await page.setViewportSize({ width: 720, height: 420 });
const dialogBox = await shortcutDialog.boundingBox();
if (!dialogBox || dialogBox.y < 0 || dialogBox.y + dialogBox.height > 420) {
  throw new Error(`shortcut dialog exceeds constrained viewport: ${JSON.stringify(dialogBox)}`);
}
await page.keyboard.press("Escape");
await shortcutDialog.waitFor({ state: "detached", timeout: 5_000 });
```

- [ ] **Step 2: Run the render verifier and confirm the new path passes**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS with the dialog opening, fitting the constrained viewport, and closing via Escape.

- [ ] **Step 3: Update the README shortcut contract**

Replace the first two open rows in `README.md` with:

```markdown
| Open left file | `Cmd/Ctrl+O` | Single mode opens the only source; Compare mode opens the left source. |
| Open left directory | `Cmd/Ctrl+Alt+O` | Single mode opens the only source; Compare mode opens the left source. |
| Open right file | `Cmd/Ctrl+Shift+O` | Compare mode only. |
| Open right directory | `Cmd/Ctrl+Alt+Shift+O` | Compare mode only. |
```

Add after the Preferences row:

```markdown
| Keyboard Shortcuts | `Cmd/Ctrl+/` | Opens or closes the in-app shortcut reference. |
```

- [ ] **Step 4: Run all frontend and documentation gates**

Run:

```bash
rtk npm run test
rtk npm run verify:all
```

Expected: all Vitest tests pass; TypeScript/Vite build, packaging scripts, frontend invariants, render verification, and docs verification all pass.

- [ ] **Step 5: Run all Rust quality gates**

Run:

```bash
rtk cargo fmt --all -- --check
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
```

Expected: formatting is clean, all workspace tests pass, and Clippy reports no warnings.

- [ ] **Step 6: Check the final diff and commit verification surfaces**

Run:

```bash
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors; only the render verifier and README remain uncommitted.

Commit:

```bash
rtk git add scripts/verify-frontend-render.mjs README.md
rtk git commit -m "docs: publish open source shortcut reference"
```

- [ ] **Step 7: Confirm the branch is clean**

Run:

```bash
rtk git status --short --branch
```

Expected: `codex/hotkeys` is clean and ahead of its remote by the implementation commits until explicitly pushed.
