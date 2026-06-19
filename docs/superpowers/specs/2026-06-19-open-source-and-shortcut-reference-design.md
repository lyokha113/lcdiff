# Open Source Hotkeys and Shortcut Reference Design

Date: 2026-06-19

## Goal

Extend LDiff's existing app-level hotkey system so file and directory pickers
have distinct shortcuts for both compare sides, and make the complete shortcut
map discoverable inside the app.

This work extends the hybrid native-menu/frontend-registry architecture from
the original hotkeys design. It does not add shortcut remapping, global
system-wide hotkeys, a command palette, or backend archive behavior.

## Product Decisions

### Four Explicit Open Actions

Use four actions instead of an inferred active side. The shortcut modifiers
form a consistent model:

- `Shift` selects the right side.
- `Alt` or `Option` selects a directory picker.
- Without either modifier, the action selects a file on the left side.

| Action | Action id | Default shortcut | Availability |
| --- | --- | --- | --- |
| Open Left File | `file.openLeftFile` | `CmdOrCtrl+O` | View and Compare |
| Open Left Directory | `file.openLeftDirectory` | `CmdOrCtrl+Alt+O` | View and Compare |
| Open Right File | `file.openRightFile` | `CmdOrCtrl+Shift+O` | Compare only |
| Open Right Directory | `file.openRightDirectory` | `CmdOrCtrl+Alt+Shift+O` | Compare only |

The two file shortcuts preserve the behavior and muscle memory of the existing
`file.openLeft` and `file.openRight` actions. Directory actions invoke the
native picker with `directory: true`. File actions retain the current file
filters and unrestricted backend open behavior.

View mode has one source, represented by the left-side actions. Right-side
actions are blocked with `Open right source is available only in Compare
mode.` No active-side or last-interacted-side state is introduced.

### Shortcut Reference Entry Point

Add `help.showShortcuts` with `CmdOrCtrl+/`. The action opens or closes a modal
titled `Keyboard Shortcuts`.

The same action appears as `Help -> Keyboard Shortcuts` in the native menu.
There is no additional toolbar icon. This keeps the persistent toolbar focused
on workspace commands while preserving a conventional desktop discovery path.

### Registry Ownership

Frontend `ACTION_DEFINITIONS` remains authoritative for the shortcut reference
UI. The dialog must derive action labels, groups, shortcuts, and availability
notes from registry metadata rather than maintaining a second handwritten
shortcut list.

The Rust native menu remains an adapter with duplicated compile-time menu
metadata. Existing parity verification must fail when action ids, labels,
groups, order, or accelerators drift between the frontend registry and native
menu definitions.

## Architecture

### Action Registry

Extend `src/lib/actions.ts` to:

- replace `file.openLeft` and `file.openRight` with the four explicit open
  action ids
- add the `Help` action group and `help.showShortcuts`
- expose optional presentation metadata for availability notes such as
  `Compare only`
- map each new action to a focused handler
- preserve current enabled-state and blocked-message behavior

The registry remains the source for DOM shortcut bindings and app action
dispatch. Opening the shortcut dialog is not content-changing and remains
available while an input or Monaco editor has focus.

### App Handlers and Picker Flow

`App.tsx` binds the four action handlers to existing open-path behavior:

```text
open action
  -> choose file picker or directory picker
  -> user selects a path
  -> existing openPath(side, path)
  -> existing archive state and error flow
```

Canceling either picker is a successful no-op. Picker or open-path errors use
the current user-visible message flow. No new Tauri command or Rust archive
state is required.

### Keyboard Shortcuts Dialog

Add a focused presentation component that receives registry definitions and
the detected platform. It renders:

- a `Keyboard Shortcuts` title and close button
- flat sections grouped by File, Edit, Search, View, Workspace, Merge, and Help
- action labels on the left and stable keycaps on the right
- a `Compare only` note for right-side open actions
- a scrollable body constrained to the current window height

The dialog does not render nested cards. It does not provide filtering,
editing, remapping, or command execution.

A pure formatter converts canonical registry strings to platform-facing
labels. macOS uses symbols such as `Cmd`, `Option`, `Shift`, and `Control`
keycaps; Windows/Linux use readable names such as `Ctrl`, `Alt`, and `Shift`.
The canonical shortcut string remains unchanged for matching and parity
verification.

### Modal Interaction

`App.tsx` owns the dialog open state. The following paths all use the same
state transition:

- DOM `CmdOrCtrl+/`
- native `Help -> Keyboard Shortcuts`
- the dialog close button

The shortcut toggles the dialog. `Escape` closes it through the existing dialog
primitive. Focus is trapped inside the modal and restored after close.

While the shortcut dialog is open, other registered app actions are blocked so
file, save, merge, search, or navigation commands cannot mutate the workspace
behind the modal. `help.showShortcuts` remains available so the same shortcut
can close it. This rule applies to both DOM keyboard and native-menu events.

## Native Menu

Update the File menu to contain the four open actions with their accelerators.
Update the Help menu to contain `Keyboard Shortcuts`; retain the existing About
placement rules for each platform.

Native menu accelerators continue to emit `app-action { actionId }`. They do
not open pickers or dialogs directly. Frontend action validation remains
authoritative, including the Compare-only rules and modal blocking.

## Error Handling

- Canceling a native picker produces no message and changes no state.
- Right-side open actions in View mode show the registry-owned Compare-mode
  blocked message.
- Actions attempted behind the shortcut dialog do not execute. The dialog
  remains the active surface.
- An unknown native action id remains ignored by the existing event guard.
- Invalid or duplicate shortcut metadata fails tests and verification rather
  than degrading silently at runtime.

## Documentation

Update the README keyboard shortcut table to replace the two generic open rows
with the four explicit file/directory actions and add the shortcut reference
action. Preserve the statements that shortcuts are app-scoped and not
remappable in this release.

## Testing

### Unit Tests

- registry ids, handler mapping, shortcut uniqueness, and parser acceptance
- enabled and blocked state for both right-side actions in View and Compare
- platform formatting for macOS and Windows/Linux
- availability metadata used by the reference dialog

### Component and App Tests

- dialog grouping, labels, keycaps, and `Compare only` notes
- `CmdOrCtrl+/` and native `app-action` open the same dialog
- repeated shortcut, close button, and `Escape` close the dialog
- other registered actions do not execute while the dialog is open
- each open shortcut calls the picker with the correct file/directory option
  and opens the correct side
- picker cancellation is a no-op

### Native and Render Verification

- Rust menu structure tests cover the four File items and Help item
- frontend/native registry parity covers all new ids and accelerators
- frontend render verification opens and validates the shortcut dialog at a
  representative desktop viewport and a constrained-height viewport

## Out of Scope

- custom shortcut remapping and persistence
- global hotkeys when LDiff is not focused
- command palette or action search
- active-side or last-interacted-side tracking
- dynamic native-menu enabled-state synchronization
- backend archive, search, merge, or save contract changes

## Validation

Implementation must pass:

```bash
npm run test
npm run verify:frontend-render
npm run verify:all
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```
