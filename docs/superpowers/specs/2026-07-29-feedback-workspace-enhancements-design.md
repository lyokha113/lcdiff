# LCDiff Feedback and Workspace Enhancements Design

## Summary

This design converts feedback collected against the Windows v0.3.10 release
into a focused set of defect fixes and workspace-continuity improvements.

The work preserves LCDiff's existing safety contract:

- Decompiled Java remains read-only.
- Archive edits and copies remain staged before save.
- Original entry bytes remain the source for archive copy operations.
- Existing source files are never changed merely by opening, dropping, or
  switching workspace modes.

The cumulative temporary-merge workflow is intentionally excluded from this
design and specified separately.

## Goals

- Remove the unintended console window from packaged Windows releases.
- Make native multi-file drops behave according to the active workspace.
- Render one-sided Compare folders truthfully.
- Remove false View dirty state and preserve existing multi-source navigation.
- Allow editing an existing one-sided text entry in Compare without creating a
  missing entry implicitly.
- Expose existing tree expansion controls in View.
- Let Free text accept text files and clear its draft inputs quickly.
- Preserve Compare, View, and Free text state while switching modes in the same
  app session.

## Non-goals

- Persist open sources, tabs, or Free text drafts across app restarts.
- Create an entry by typing into the missing pane of a one-sided Compare row.
- Add hunk merge or Take all actions when only one Compare entry exists.
- Change the archive merge, atomic-save, backup, or signed-archive contracts.
- Add a new workspace mode.

## Baseline

The reported behavior comes from the Windows v0.3.10 installer. The v0.3.11
architecture standardization moved ownership into feature and IPC boundaries
but intentionally preserved these behaviors, so the design targets the current
main architecture rather than patching the older file layout.

## Product Decisions

### Windows packaged launch

The Windows release binary uses the GUI subsystem and does not open a console
window. Development behavior remains controlled by debug builds and the normal
development command.

### Native drag and drop

Drop routing remains mode-aware at the application composition boundary.

#### Compare

- One dropped path keeps the existing position-based side selection.
- Exactly two dropped paths map in payload order: first to left, second to
  right.
- Both paths are validated before either Compare slot changes.
- More than two paths are rejected with a clear message.

If either path fails validation or open preparation, the previous Compare
workspace remains unchanged.

#### View

- Every dropped path is opened as an independent View source.
- Paths are processed sequentially so request generations cannot cancel earlier
  opens.
- A failure does not remove sources that opened successfully.
- The final message reports success and failure counts and identifies failed
  paths.

#### Free text

- One dropped file loads the pane selected by horizontal drop position.
- Exactly two files map in payload order to left and right.
- Directories and binary files are rejected.
- Both files are read before a two-file draft update is published.
- More than two files are rejected.

### One-sided Compare folders

`TreeFolder` records whether any descendant exists on the left and right.
Folder rows remain aligned across the two-pane tree, but a missing side renders
the existing muted gap instead of a folder icon and name.

This keeps path alignment without falsely claiming that a folder exists.

### View dirty-state correctness

Opening or switching an editable View entry must not stage an edit.

The View editor:

- ignores Monaco model-flush changes;
- compares candidate content with the loaded preview before staging;
- uses the existing request-generation guards when sources or tabs change; and
- clears dirty state when content returns to the original bytes.

The existing View source-tab behavior remains the product contract. The
reported inability to return to the first source is treated as a regression
caused by false dirty state, not as a request for a second navigation model.

### One-sided Compare editing

For `onlyLeft` or `onlyRight` text entries:

- only the pane backed by a real editable entry is writable;
- the missing pane stays read-only and visually empty;
- edits stage through the existing `stage_write` command for the real side;
- Copy remains the explicit action for creating the entry on the missing side;
- hunk merge, Move hunk, and Take all remain unavailable.

For two-sided editable text, current diff editing and hunk actions remain
unchanged.

### View tree expansion

Expand all and Collapse all render in both Compare and View. The Compare tree
filter remains Compare-only.

The existing `FileTree` expansion version contract is reused; no second tree
expansion implementation is introduced.

### Free text file loading and clearing

A typed `read_text_file` IPC command validates and reads a standalone text file
without opening it as an archive source.

Free text adds a `Clear drafts` action:

- it clears left and right draft buffers;
- it does not clear confirmed temporary history; and
- it asks for confirmation when either draft contains content.

### Workspace continuity

Compare, View, and Free text each keep mode-owned state for the lifetime of the
app process.

Switching modes hides one workspace and reveals another; it does not clear:

- Compare sources, pairs, tree state, open entry tabs, or selected entry;
- View sources, source tabs, entry tabs, or active source; or
- Free text left/right drafts and active confirmed result.

Existing staged-change guards continue to block unsafe mode or source changes.
The continuity contract is session-only and does not add persistence keys.

## Architecture and Ownership

### Application composition

`src/app/App.tsx` remains responsible for:

- subscribing to native drop events;
- selecting the routing behavior for the active mode; and
- composing the independent workspace states.

It does not parse files or own Monaco details.

### Workspace feature

`useWorkspaceController` keeps independent Compare and View state slices.
`DiffView` receives an explicit editable side (`left`, `right`, or none) and
only forwards edit events for that side.

### Free text feature

Free text draft and active-result state move into a feature-owned controller so
conditional rendering cannot destroy them. `FreeTextWorkspace` remains a
presentational editor surface.

### Source tree

`src/lib/tree.ts` derives folder side presence from descendant pairs.
`FileTree` renders that contract and does not re-infer archive ownership.

### IPC and backend

`read_text_file` belongs in the preview command boundary and returns decoded
text after canonical path validation and binary rejection.

One-sided Compare editing reuses `stage_write`; no new merge command or DTO is
required.

The Windows subsystem attribute belongs only on the binary entrypoint. The
architecture guard permits that exact attribute while retaining the thin
entrypoint rule.

## Error Handling

- Compare two-file drop is all-or-nothing.
- Free text two-file drop is all-or-nothing.
- View multi-file drop permits partial success because each source is
  independent.
- A read or validation failure reports the affected path without erasing prior
  workspace state.
- Programmatic editor model changes never become staged writes.
- Clear drafts cancellation leaves both drafts untouched.
- A failed stage operation restores the previous staged-state projection and
  surfaces the backend error.

## Testing and Validation

### Frontend behavior

- Compare one-file drop preserves position-based routing.
- Compare two-file drop maps both paths and is atomic on failure.
- Compare rejects more than two dropped paths.
- View opens N dropped sources sequentially and reports partial failure.
- Free text loads one or two text files and rejects binary/directory input.
- Clear drafts confirms destructive clearing and preserves confirmed history.
- `onlyLeft` and `onlyRight` allow edits only on the real side.
- The missing side cannot stage or implicitly create an entry.
- Folder rows render a gap on a side with no descendants.
- View Expand all and Collapse all invoke the existing expansion contract.
- Opening, switching, and closing unchanged View sources never requires
  Discard.
- `Compare -> View -> Text -> Compare` preserves each mode's state.

### Backend and IPC

- `read_text_file` validates canonical files, returns supported text, and
  rejects binary and directory inputs.
- IPC facade and Rust serialization fixtures lock the new command and DTO.
- The architecture mutation tests cover the Windows entrypoint allowance and
  retain all existing boundary rules.

### Platform and aggregate gates

- Windows CI verifies the packaged release executable uses the GUI subsystem.
- Frontend render checks cover View tree controls and one-sided folder gaps.
- `npm run verify:all` remains the frontend, architecture, render, branding, and
  documentation gate.
- Rust workspace tests cover backend and IPC additions.

## Acceptance Criteria

- The packaged Windows app opens without a companion console window.
- The documented drop mappings work without partial Compare or Free text state.
- View can open multiple dropped files and revisit earlier sources.
- An unchanged View source can be switched or closed without clearing staged
  changes.
- One-sided editable text can be modified only on its existing side and saved
  through the normal staged-save flow.
- View exposes Expand all and Collapse all.
- Free text accepts text-file drops, clears drafts independently from history,
  and retains drafts across mode switches.
- Compare and View retain their sources and tabs across mode switches within
  the same app session.
