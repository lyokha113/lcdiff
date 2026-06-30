# Hotkeys Design

Date: 2026-06-16

## Goal

Add keyboard shortcuts for LCDiff's main desktop workflows while keeping command
semantics centralized and testable.

The first phase supports:

- core file, search, save, preferences, and workspace navigation commands
- merge commands for copy, take-all, and move-hunk workflows
- native menu accelerators backed by the same frontend command registry used by
  in-window shortcuts

This phase does not add user-configurable shortcut remapping or global hotkeys
that fire while LCDiff is not the active app.

## Product Decisions

### Shortcut Model

Use a hybrid native/menu and frontend-registry model.

The frontend action registry is the source of truth for:

- stable action ids
- labels and menu grouping
- default shortcut metadata
- enabled and blocked-state decisions
- command handlers
- user-facing blocked messages

Tauri native menu accelerators are adapters. They send an action id to the
frontend and do not directly run product behavior. DOM `keydown` handling is
also an adapter and dispatches through the same frontend registry.

Target flow:

```text
Tauri native menu accelerator
  -> app-action event with actionId
  -> frontend action dispatcher
  -> registry validates focus and app state
  -> existing App handler runs
```

```text
DOM keydown shortcut
  -> shortcut matcher resolves actionId
  -> same frontend action dispatcher
  -> same registry validation
  -> same existing App handler runs
```

### Default Shortcut Style

Use desktop-standard defaults for app-level commands. Prefer `Cmd` on macOS and
`Ctrl` on Windows/Linux through `CmdOrCtrl` metadata.

Tab navigation is the exception: it uses explicit `Ctrl+Tab` and
`Ctrl+Shift+Tab` on every platform to avoid macOS-reserved command shortcuts.

Merge commands use bracket-based shortcuts to avoid common editor shortcuts and
to express direction:

- left-target actions use `[`
- right-target actions use `]`

### Focus Semantics

Use context-safe behavior:

- Safe app commands can run while focus is inside an input or Monaco editor:
  save, search, preferences, close tab, and next/previous tab.
- Content-changing or destructive commands are blocked while focus is inside a
  text input or Monaco editor: copy to left/right, take all, move hunk, and
  clear staged changes.
- `Enter` in the search input keeps the existing contextual behavior: Files tab
  runs files-index search, and diff tabs run current-diff find.

These rules preserve desktop-app keyboard behavior without surprising users who
are typing or editing text.

## Action Map

| Area | Action | Action id | Default shortcut |
| --- | --- | --- | --- |
| File | Open left/source | `file.openLeft` | `CmdOrCtrl+O` |
| File | Open right target | `file.openRight` | `CmdOrCtrl+Shift+O` |
| File | Refresh sources | `file.refresh` | `CmdOrCtrl+R` |
| File | Save staged target | `file.save` | `CmdOrCtrl+S` |
| Edit | Clear staged changes | `edit.clearStaged` | `CmdOrCtrl+Shift+Backspace` |
| Search | Toggle search bar | `search.toggle` | `CmdOrCtrl+F` |
| Search | Run contextual search/find | `search.runContextual` | `CmdOrCtrl+Enter` |
| View | Toggle Preferences | `view.togglePreferences` | `CmdOrCtrl+,` |
| Workspace | Focus Files tab | `workspace.focusFiles` | `CmdOrCtrl+1` |
| Workspace | Next tab | `workspace.nextTab` | `Ctrl+Tab` |
| Workspace | Previous tab | `workspace.previousTab` | `Ctrl+Shift+Tab` |
| Workspace | Close active tab | `workspace.closeTab` | `CmdOrCtrl+W` |
| Merge | Copy entry to left | `merge.copyToLeft` | `Alt+[` |
| Merge | Copy entry to right | `merge.copyToRight` | `Alt+]` |
| Merge | Take all into left | `merge.takeAllToLeft` | `Alt+Shift+[` |
| Merge | Take all into right | `merge.takeAllToRight` | `Alt+Shift+]` |
| Merge | Move hunk into left | `merge.moveHunkToLeft` | `CmdOrCtrl+Alt+[` |
| Merge | Move hunk into right | `merge.moveHunkToRight` | `CmdOrCtrl+Alt+]` |

Additional action semantics:

- `file.openLeft` opens the only source in Single mode and the left source in
  Compare mode.
- `file.openRight` is available only in Compare mode.
- `file.save` is available only when a staged target exists.
- `search.toggle` preserves the contextual search contract: Files tab means
  files-index search and diff tabs mean current-diff find.
- `workspace.closeTab` closes only an active diff tab. It does not close the
  Files workspace.
- Merge actions are no-ops with a message when the selected row or active diff
  state does not support the requested operation.

## Component Shape

### `src/lib/actions.ts`

Add a frontend action module that defines:

- `AppActionId`
- `AppActionDefinition`
- `AppActionContext`
- `AppActionHandlers`
- `getActionState(actionId, context)`
- `dispatchAppAction(actionId, context, handlers)`

The action context should be derived from existing `App.tsx` state:

- mode
- active tab
- open tabs
- selected pair
- staged target and staged count
- preview and hunk-merge availability
- current focus kind

The handlers should bind to existing `App.tsx` functions rather than moving
archive, search, or merge behavior into the registry.

### `src/lib/shortcuts.ts`

Add shortcut parsing and matching helpers:

- parse stable shortcut strings such as `CmdOrCtrl+Shift+O`
- normalize `KeyboardEvent` modifier state by platform
- match keyboard events to action ids
- classify editable focus targets, including inputs, textareas,
  contenteditable elements, and Monaco editor focus

Shortcut matching should not mutate app state. It only resolves an action id and
lets the dispatcher decide whether the action can run.

### `src/App.tsx`

Wire the registry into the existing app shell:

- build `AppActionContext` from current state
- pass existing handlers into `dispatchAppAction`
- listen for the native `app-action` event from Tauri
- attach a window-level `keydown` listener for in-window shortcuts
- prevent default browser/editor behavior only when the registry accepts and
  handles the action

`App.tsx` remains the owner of workflow behavior such as browse, save, search,
copy, take-all, move-hunk, tab focus, and close-tab.

### `src-tauri`

Add a native application menu with accelerators for the action map. Menu items
emit a stable action id to the frontend, for example:

```text
app-action { actionId: "search.toggle" }
```

The native menu does not need full enabled-state synchronization in this phase.
Frontend validation is authoritative. If a menu accelerator fires while an
action is blocked, the frontend shows the same blocked message as DOM hotkeys.

## Error Handling

Invalid hotkey actions must not crash or mutate state.

For user-visible commands, show a short status message when blocked:

- `No staged changes to save.`
- `Open a right source before using this shortcut.`
- `Select an entry before copying.`
- `Open a diff tab before moving hunks.`
- `Finish editing or leave the editor before running this merge shortcut.`

Blocked messages should be produced by the registry so native menu and DOM
shortcut paths behave the same way.

## Documentation

Add a keyboard-shortcut table to product-facing documentation. The table should
include:

- action label
- default shortcut
- scope notes for context-sensitive actions

The documentation should explicitly state that this phase does not include
shortcut remapping or global system-wide hotkeys.

## Testing

### Unit Tests

Add focused tests for:

- shortcut parsing and matching
- `CmdOrCtrl` platform normalization
- shifted and alt-modified shortcuts
- editable-focus blocking for content-changing actions
- action enabled/blocked rules for save, open-right, close-tab, and merge
  actions

### Component Tests

Add or extend React tests to cover:

- `CmdOrCtrl+F` toggles search
- `CmdOrCtrl+S` dispatches save only when staged changes exist
- tab navigation shortcuts move between open diff tabs
- merge shortcuts no-op with a visible blocked message when state is invalid

### Render Smoke

Extend the frontend render verifier only for high-value smoke coverage:

- search toggle shortcut
- preferences toggle shortcut

Full shortcut coverage belongs in unit and component tests rather than the
Playwright render verifier.

## Out Of Scope

The first phase does not include:

- user-configurable remapping UI
- persistence for custom shortcuts
- global system-wide hotkeys while LCDiff is not focused
- full native menu enabled-state synchronization from frontend to Rust
- backend archive/search/merge contract changes

## Validation

Implementation should pass the relevant local gates:

```bash
npm run test
npm run verify:frontend-render
npm run verify:all
```

If Tauri menu code changes Rust compilation surfaces, also run:

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```
