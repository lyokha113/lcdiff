# Compare Content Line Filter

## Problem

Compare mode currently provides `All`, `Differences`, and `Identical` filters
for the file tree. Once a file is open, its Monaco diff always shows the full
content. Large files therefore require excessive scrolling even though the
workspace already knows the changed line blocks and provides next/previous diff
navigation.

The content filter must remain distinct from the file-tree filter:

- the tree filter chooses which file pairs are visible;
- the content filter chooses how much unchanged line context is visible inside
  the active file comparison.

## Goals

- Add `All` and `Differences` display modes for line-oriented content in
  Compare mode.
- Keep `All` as the default and preserve the current full-content behavior.
- In `Differences`, collapse sufficiently large unchanged regions while keeping
  three context lines around each changed block.
- Keep the filter shared across the whole Compare workspace rather than storing
  it per tab.
- Preserve Monaco alignment, original line numbers, cursor state, undo state,
  diff navigation, editing, and merge operations.
- Place the content filter in the center of the merge toolbar beside the diff
  block navigator.

## Non-goals

- No `Identical` content mode in this iteration.
- No custom diff renderer, projected text model, or manual hidden-range engine.
- No changes to the file-tree filter or `PairStatus`.
- No persistence in Preferences or local storage.
- No Rust core, archive, merge-plan, preview, or IPC changes.
- No change to View or Free text behavior.

An `Identical` content mode would require a custom projection or unsupported
editor internals to hide changed ranges while keeping the two sides aligned. It
is intentionally deferred because `All` and `Differences` provide the primary
value without that cost or risk.

## Research and Selected Approach

LCDiff uses `monaco-editor` 0.52.2. Its public diff editor options include
`hideUnchangedRegions`, with controls for enabling the behavior, context line
count, minimum collapsible region size, and reveal line count.

The selected approach is to toggle Monaco's native
`hideUnchangedRegions.enabled` option:

- `All` disables hidden unchanged regions.
- `Differences` enables hidden unchanged regions with three context lines.

This approach retains the real editor models and Monaco's alignment machinery.
It also follows the same product concept as Beyond Compare's display filter for
showing only differences without introducing a second diff implementation.

Rejected approaches:

1. Manual hidden ranges depend on editor internals that are not part of
   Monaco's public API and would be fragile across upgrades.
2. Derived display models or a custom renderer could support `Identical`, but
   would need new synchronization for line numbers, alignment, edits, undo,
   staged content, and hunk coordinates.

References:

- [Monaco `IDiffEditorBaseOptions`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html)
- [Beyond Compare feature comparison](https://www.scootersoftware.com/kb/feature_compare)

## Architecture and Ownership

Introduce a dedicated content-filter type with exactly two values:

```text
ContentFilter = "all" | "diff"
```

It must not reuse `TreeFilter`; the two types represent different product
scopes and may evolve independently.

`App.tsx` owns one `contentFilter` state:

- initial value: `all`;
- lifetime: the current application session;
- scope: all Compare tabs, source/bytecode views, and source replacements;
- persistence: none.

The state is passed into `DiffView` together with a typed change callback.
`DiffTab` does not gain filter state.

`DiffView` maps the selected value to Monaco options. No preview content is
transformed, and no backend command is invoked.

## User Interface

The center column of the existing merge toolbar becomes one compact control
cluster:

```text
[All | Differences]  [↑ current/total ↓]
```

The two pane-specific merge-action groups remain on the left and right. The
filter must not move to the workspace tab row or overlay the editor.

Accessibility contract:

- group label: `Content line filter`;
- All button label: `Show all content lines`;
- Differences button label: `Show differences only`;
- each button exposes its selected state through `aria-pressed`.

The control renders only when `mode === "compare"`. It remains available for
line-oriented source, bytecode, and text previews. View and Free text do not
render it.

At narrow widths, the center cluster may shrink or participate in the toolbar's
existing overflow behavior. It must not cover editor content or cause Monaco to
switch to an inline diff.

## Monaco Configuration

The filter maps to the public Monaco diff option:

| Content filter | Monaco configuration |
| --- | --- |
| `all` | `hideUnchangedRegions.enabled = false` |
| `diff` | `hideUnchangedRegions.enabled = true`, `contextLineCount = 3` |

Monaco 0.52.2 defaults for minimum collapsible line count and reveal line count
remain in effect. This keeps short unchanged spans visible as context and keeps
Monaco's native control for revealing collapsed regions.

The filter changes display configuration only. It must not replace either
editor model, rewrite content, reset cursor or undo state, or update staged
archive content.

## Data Flow

```text
User selects All or Differences
  -> App updates the workspace-level ContentFilter
  -> DiffView receives the new value
  -> Monaco updates hideUnchangedRegions
  -> Monaco recomputes visible unchanged regions
```

Monaco continues to own line alignment and `getLineChanges()`. Existing
consumers therefore remain on the same data:

- the diff block navigator;
- current-hunk lookup;
- `Move hunk`;
- `Take all`;
- editable left and right models;
- staging callbacks.

When an edit or merge operation changes a model, Monaco recomputes both the diff
and the collapsed unchanged regions. The content filter does not add a separate
recompute path.

## Edge Cases

- **Identical content:** `Differences` collapses the unchanged content and the
  navigator shows `0/0`. Monaco's reveal control remains available.
- **One-sided content:** every present line is changed, so `All` and
  `Differences` are visually similar.
- **Short unchanged spans:** spans below Monaco's collapse threshold remain
  visible.
- **Source/bytecode switch:** the selected content filter remains unchanged.
- **Tab switch, close, or LRU eviction:** the workspace-level filter remains
  unchanged.
- **Source replacement or mode round-trip:** the application-session state
  remains unchanged; a fresh application launch starts at `All`.
- **Diff recomputation in progress:** the selected button updates immediately;
  Monaco updates collapsed regions when its diff result is ready.

There is no new backend error path. If Monaco has no line-change result yet, the
editor remains usable and updates when the native diff computation completes.

## Testing

### Component tests

`DiffView.test.tsx` must verify:

- `All` is represented as selected when passed as the current filter;
- selecting either button emits the corresponding typed value;
- `All` passes disabled hidden unchanged regions to Monaco;
- `Differences` passes enabled hidden unchanged regions with three context
  lines;
- the content filter renders in Compare mode only;
- the merge-action groups and diff navigator retain their current behavior.

### Application tests

`App.test.tsx` must verify:

- the initial content filter is `All`;
- the selection is shared while switching between Compare tabs;
- switching source/bytecode does not reset it;
- source replacement does not reset it;
- View and Free text do not expose the content filter.

### Render verification

The frontend render harness must verify that:

- the segmented control is in the center toolbar cluster beside the diff
  navigator;
- it is not part of the workspace tab row;
- the compact layout remains usable at the project's validated viewport sizes.

### Manual smoke test

Exercise:

1. a large file with multiple long unchanged regions;
2. identical content;
3. a one-sided entry;
4. Source and Bytecode views;
5. editing, `Move hunk`, and `Take all` while `Differences` is active.

Confirm that collapsed regions update, navigation still targets the correct
line blocks, and staged content matches the editor models.

## Validation

Run the frontend test and render gates defined by the repository, followed by
the relevant project umbrella verification when implementation is complete.
No new backend-specific validation is required because the design does not
change Rust or IPC boundaries.
