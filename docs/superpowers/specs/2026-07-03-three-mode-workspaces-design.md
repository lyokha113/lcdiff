# Three Mode Workspaces Design

Date: 2026-07-03

## Goal

LCDiff should present three distinct workspaces with clear responsibilities:

- **Compare and Merge**: keep the current two-source comparison, diff, staging, and save workflow.
- **View**: inspect multiple opened folders or archives at once, with source tabs at the top, a file tree on the left, and entry content on the right.
- **Free text**: compare two typed or pasted text buffers only after the user confirms the comparison, then keep confirmed results in a local temporary history.

This is a product-contract change across UI, state boundaries, documentation, and tests. It is not only a label change.

## Approved Direction

Use a mode-isolated workspace design:

- Compare and Merge keeps the existing `left` and `right` source model.
- View gets its own multi-source inspector state.
- Free text gets its own draft/result/history state.
- Backend changes are limited to View multi-source support if the current `Side = left | right` commands cannot safely represent more than two opened sources.

The approved View layout is a two-level tab model:

1. Source tabs list the opened folders or archives.
2. Entry tabs belong to the active source.

When the user switches from one source tab to another, the left tree and right entry tabs switch to that source. Entry tabs are remembered separately per source.

The approved Free text history is local-persistent temporary history: it survives app restart through local storage, has a fixed limit, and can be cleared. It does not merge into the general Recent work list.

## Current State

The app already has three mode values in the frontend:

- `single`
- `compare`
- `text`

However, the product language and behavior are not cleanly separated:

- `single` is user-facing View, but it is still shaped like a one-source variant of the compare workspace.
- `text` uses a Monaco diff editor directly and updates the comparison result from editable content instead of separating draft input from confirmed output.
- `App.tsx` owns orchestration for mode, source loading, tabs, preview, search, staging, and text compare state.
- Tauri commands are currently built around `left` and `right` source slots.

The design should improve these boundaries only where they serve the three-mode goal.

## Architecture

### Compare And Merge

Compare and Merge remains the primary archive surgery workflow. It keeps:

- two source slots, left and right;
- tree diff and status filtering;
- file or entry diff tabs;
- copy entry actions;
- hunk merge controls where currently valid;
- staged changes;
- signed-save confirmation and atomic save behavior;
- existing left/right backend state.

The implementation may adjust labels from "Compare" to "Compare and Merge" where user-facing clarity needs it, but it must not rewrite compare behavior unless needed to preserve compatibility with the new mode boundaries.

### View

View becomes a multi-source inspector. Its state should be independent from compare state.

Core state shape:

```text
viewSources[]
  sourceId
  path
  metadata
  entries
  nestedPairs or nestedEntries
  tree expansion state
  entryTabs[]
    entryPath
    preview
    viewMode
    lastFocus

activeViewSourceId
activeViewEntryTabId
```

View UI zones:

```text
View command/source area
  -> source tabs for opened folders/archives
    -> left tree for active source
      -> entry tabs and preview for active source
```

View supports opening multiple folders or archives. Source tabs show the opened source label and close action. The active source owns the tree and entry tabs. Closing a source closes only that source and its entry tabs.

The tree is single-column and should not show left/right compare-only status controls. Nested archives keep lazy expansion where the backend supports it.

Preview behavior:

- class entries can show decompiled source and bytecode;
- text entries show text source;
- binary entries show metadata or hex preview;
- decompiled source remains read-only.

If current backend state cannot hold multiple opened sources at once, add View-specific commands rather than forcing many sources into `left` and `right`:

```text
open_view_source(path) -> ViewSourceSummary { sourceId, path, metadata, entries }
read_view_entry(sourceId, entryPath, viewMode) -> EntryPreview
compute_view_nested_entries(sourceId, entryPath) -> entries
close_view_source(sourceId)
```

Use these command names unless implementation discovery finds an existing View command namespace that already establishes a different naming pattern.

### Free Text

Free text separates text input from diff result.

Core state shape:

```text
draftLeft
draftRight
confirmedResults[]
  id
  left
  right
  createdAt
  title
  summary

activeConfirmedResultId
```

The two input editors are editable draft buffers. The diff result is created only when the user clicks the compare/confirm action. Editing the draft after confirmation does not mutate the active result until the user confirms again.

Confirmed results are saved to local storage with a fixed limit. The history UI supports selecting a previous confirmed result and clearing the list. Corrupt local storage is discarded and replaced with an empty history.

Free text does not use file pickers, archive trees, merge staging, save, reload, hunk merge controls, or archive search. Diff navigation may be kept if it works naturally on the confirmed result.

## Component Design

### Shared Shell

The shell should route to distinct workspaces by mode:

```text
CompareMergeWorkspace
ViewWorkspace
FreeTextWorkspace
```

This can begin inside `App.tsx` if extraction would be too large for one change, but the state boundaries should follow the workspace split. New components should be introduced where they reduce `App.tsx` mode conditionals.

### CompareMergeWorkspace

Reuse existing components when their props stay compare-specific and do not add View or Free text branches:

- `SourceChips`
- `WorkspaceTabs`
- `FileTree`
- `DiffView`
- search and pending-change overlays

Compare-specific controls stay out of View and Free text.

### ViewWorkspace

New or adapted components:

- `ViewSourceTabs`: opened source list, active source selection, close source action.
- `ViewFileTree`: active source tree, single-column, nested archive expansion.
- `ViewEntryTabs`: per-source opened entry tabs.
- `ViewEntryPreview`: read-only content preview using Monaco where appropriate.

The current `WorkspaceTabs` and `FileTree` may be adapted if the resulting props remain clear. If adapting them creates more compare/view branching than clarity, create View-specific components.

### FreeTextWorkspace

New or adapted components:

- `FreeTextDraftEditors`: two editable input editors.
- `FreeTextCompareAction`: explicit confirm button.
- `FreeTextHistory`: local confirmed-result list and clear action.
- `FreeTextDiffResult`: readonly Monaco diff editor for active confirmed result.

The current `DiffView` may render the result if its props can stay simple. Do not keep editable diff behavior for Free text result.

## Data Flow

### View Source Open

1. User opens a folder or archive in View.
2. Frontend validates path through the existing `validate_path` command.
3. Frontend or backend creates a stable `sourceId`.
4. Backend opens/indexes the source and returns summary.
5. Frontend adds a source tab and makes it active.
6. The active source tree appears on the left.

### View Entry Open

1. User selects an entry in the active source tree.
2. Frontend calls read preview with `sourceId` and `entryPath`.
3. Backend reads from the correct source handle.
4. Frontend upserts the entry tab inside that source's tab list.
5. Preview appears on the right.

### View Source Switch

1. User selects another source tab.
2. Frontend updates `activeViewSourceId`.
3. Tree, entry tabs, active entry, and preview switch to the selected source.
4. Tabs from the prior source remain stored with that source.

### Free Text Confirm

1. User edits draft left and right.
2. No result snapshot is updated during typing.
3. User clicks the compare/confirm action.
4. Frontend creates a confirmed result snapshot.
5. Snapshot is prepended to local-persistent temp history.
6. Active result switches to the new snapshot.
7. Monaco diff renders from the confirmed snapshot only.

## Error Handling

View:

- Source open errors attach to the source opening surface and do not clear existing sources.
- Entry read errors render in the preview area for that entry and do not close tabs.
- Closing a source with active entry tabs closes only that source's tabs.
- Backend source-handle errors should include enough context for the UI to identify the affected source.

Free text:

- Empty left or right content is valid and should produce a result.
- Corrupt temp history local storage is ignored and replaced with an empty list.
- History limit eviction removes the oldest confirmed results.
- Clear history removes all confirmed results and leaves draft text untouched.

Compare and Merge:

- Existing staged-change guards remain in place when leaving compare mode.
- Compare source open/read/save errors keep their existing behavior unless a test shows they leak into View or Free text state.

## Documentation Changes

Update `README.md`:

- Present the three modes as `Compare and Merge`, `View`, and `Free text`.
- Describe View as multi-source inspection with source tabs, tree, and entry preview.
- Describe Free text as confirm-to-diff with local temporary history.

Update `docs/ARCHITECTURE.md`:

- Replace the current Text mode description with draft/result separation.
- Replace Single/View description with multi-source View inspector behavior.
- Keep the rule that decompiled Java is read-only and never a write path.

`docs/GLOSSARY.md` does not need a new term unless implementation introduces a stable product term beyond source, entry, and workspace.

## Testing Plan

Frontend tests:

- Splash/menu surfaces show `Compare and Merge`, `View`, and `Free text` distinctly.
- View opens multiple sources and renders source tabs.
- View remembers entry tabs separately per source.
- Switching active source restores that source's tree and entry tab state.
- Closing a View source removes only that source's state.
- Free text typing does not update the active diff result before confirmation.
- Free text confirm creates a snapshot and renders the result.
- Free text local history persists through reload, enforces the limit, and can be cleared.
- Corrupt Free text history storage falls back to empty history.

Backend tests if View-specific commands are added:

- Multiple View sources can be opened at the same time.
- Reading an entry by `sourceId` cannot read from a different source.
- Closing one View source does not invalidate other View sources.
- Compare left/right commands still work as before.

Render/invariant checks:

- View mode has source tabs and no compare-only tree filter.
- View entry tabs are visible for the active source.
- Free text result area shows an empty state before confirm.
- Free text confirmed result renders after confirm.

Final implementation gate:

```bash
rtk npm run verify:all
```

Run focused Rust checks as needed if backend commands or state are changed.

## Out Of Scope

- Rewriting Compare and Merge into a new backend session model.
- Merging Free text confirmed results into general Recent work.
- Saving Free text snapshots as files.
- Editing decompiled Java as a write path.
- Redesigning the whole visual system beyond the controls needed for clear mode separation.

## Open Decisions Closed In This Spec

- View layout: source tabs above, per-source entry tabs inside the selected source.
- View entry tabs: remembered separately per opened source.
- Architecture approach: mode-isolated frontend state with limited backend changes only where needed.
- Free text history: local-persistent temporary history with limit and clear action.
