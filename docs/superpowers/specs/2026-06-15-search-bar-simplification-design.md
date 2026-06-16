# Search Bar Simplification Design

Date: 2026-06-15

## Goal

Make search controls easier to understand by separating three concepts that are
currently crowded into the same command bar:

- Files-index search searches loaded file entries.
- Decompiled source search is an optional deep search tier.
- Tree filtering changes which compare rows are visible.

This change keeps the existing search capability, but removes misleading labels
and controls.

## Current Problem

The current Files-index command bar shows:

- a side-scope select with `Both sides`, `Left`, and `Right`
- a checkbox labeled `Source`
- a tree filter select with `Show all`, `Differences`, and `Identical`
- `Search all`, `Cancel search`, and `Clear`

This creates three UX issues:

1. The side-scope select is unnecessary for the intended workflow. Files-index
   search should search both sides in compare mode.
2. `Source` reads like a side selector, but it actually means decompiled source
   search.
3. The tree filter is not a search option. It filters compare rows, so it should
   live near the Files workspace.

## Product Decisions

### Files-Index Scope

Files-index search no longer exposes a side-scope control.

- Single mode searches the single loaded source.
- Compare mode always searches both left and right sources.
- The previous left-only and right-only search UI is removed.
- The implementation should remove or stop using the related UI state rather
  than hiding an active control.

### Decompiled Source Option

The checkbox currently labeled `Source` is renamed to `Decompiled source`.

Meaning:

- Off: Files-index search includes path, text, and constant-pool matches.
- On: Files-index search also runs the decompiled source/deep-search tier.

This label should appear only in the Files-index context. It should not appear
in Current-diff search.

### Tree Filter Placement

Move `Show all / Differences / Identical` out of the search bar and into
`WorkspaceTabs`, next to the `Files` tab and file count.

The control continues to drive the existing tree filter state:

- `Show all` shows every compare row.
- `Differences` shows changed, left-only, right-only, metadata-only, staged, or
  otherwise non-identical rows according to the current row-filter rules.
- `Identical` shows identical rows.

The placement intentionally communicates that this is a workspace/file-tree
filter, not a search-result filter.

### Files-Index Actions

Files-index search should use action labels that describe the operation:

- Primary button: `Search files`
- Optional long-running cancel action: `Cancel`
- Reset action: `Clear results`

`Cancel` should render only while a decompiled-source/deep-search job is
running. It should not occupy normal command-bar space when no cancelable job
exists.

`Clear results` clears Files-index search output:

- search result groups
- file-tree search highlighting/filtering driven by search results
- selected search result
- active search job token/state

### Current-Diff Actions

Current-diff search is a local find operation in the active editor or diff
editor. It does not use Files-index options.

Current-diff search bar:

- context label: `Current diff`
- primary button: `Find`
- reset action: `Clear find`

It should not show:

- `Decompiled source`
- `Cancel`
- Files-index side scope
- tree filter

`Clear find` should clear the query/find state and remove editor find
highlighting where the editor API makes that practical. At minimum it must clear
the app-level query/result state consistently.

## Component Shape

### SearchBar

`SearchBar` remains responsible for command-bar search inputs and actions.

Expected props after cleanup:

- context
- mode
- query
- include decompiled source flag
- searching/cancelable state
- query change handler
- search/find handler
- cancel handler for deep source search
- clear handler
- include decompiled source change handler

It should no longer own or render:

- tree filter select
- side-scope select
- side-scope change handler

### WorkspaceTabs

`WorkspaceTabs` receives the tree filter value and change handler, then renders
the filter next to the `Files` tab area.

The filter should remain accessible with a clear aria label such as
`Tree filter`.

### App State

Remove the obsolete side-scope state from the active UI path.

`searchSides()` should resolve sides directly:

- Single mode: `["left"]`
- Compare mode: `["left", "right"]`

Existing backend search commands can remain unchanged if they still accept a
single side per invocation. The frontend can continue invoking them once per
resolved side.

## Data Flow

Files-index search:

```text
SearchBar query
  -> Search files
  -> App resolves sides from mode
  -> backend search for path/text/constants per side
  -> optional deep_search per side when Decompiled source is enabled
  -> SearchResultsPanel and FileTree receive results/highlights
```

Current-diff search:

```text
SearchBar query
  -> Find
  -> active Monaco editor/diff editor findMatches
  -> reveal first match and update status message
```

Tree filter:

```text
WorkspaceTabs filter select
  -> App treeFilter state
  -> visiblePairs memo
  -> FileTree rows
```

## Error Handling

- Empty Files-index query should continue to report a clear empty-query message.
- Empty Current-diff query should continue to report a clear empty-query
  message.
- Deep-source failures should report a source-search error without redefining
  the meaning of path/text/constants search.
- Cancel should only represent a cancelable deep-source job.

## Testing

Frontend tests should cover:

- Files-index search bar no longer renders the side-scope select.
- Files-index search uses both sides in compare mode.
- Files-index search uses only left in single mode.
- Files-index label is `Search files`.
- The decompiled source option is labeled `Decompiled source`.
- `Cancel` is hidden or disabled when no cancelable deep-source search is
  running.
- Current-diff search renders `Find` and `Clear find`, without Files-index
  options.
- `WorkspaceTabs` renders `Show all / Differences / Identical` near the Files
  tab and emits filter changes.

Render/invariant verification should update any selectors that still expect the
tree filter inside `SearchBar` or a `Search all` button label.

## Out Of Scope

- Backend search API redesign.
- New search categories beyond existing path, text, constants, and decompiled
  source.
- Full Monaco find-widget replacement.
- Preferences redesign beyond preserving the existing default for including
  source search, mapped to the new `Decompiled source` label.
