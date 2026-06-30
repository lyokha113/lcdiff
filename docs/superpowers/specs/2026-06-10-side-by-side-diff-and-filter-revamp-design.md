# Side-by-side diff and filter revamp

## Problem

The diff workspace reads as a git-style view rather than a friendly
two-pane comparison:

1. The Monaco `DiffEditor` is configured to collapse from side-by-side to
   an inline (unified, git-like) diff whenever the pane is narrower than
   720px. Users expect two panes always aligned horizontally, like Beyond
   Compare.
2. The tree filter exposes four modes — `all`, `differences`, `onlyLeft`,
   `onlyRight`. The left/right modes are noise. A clearer set is
   `all`, `diff`, `same`.

## Goals

- Diff editor always renders two panes side by side, never folding to an
  inline diff.
- Tree filter offers exactly three choices: `all`, `diff`, `same`.

## Non-goals

- No change to `lcdiff-core` or any Rust/IPC code.
- No custom diff renderer; keep Monaco `DiffEditor`.
- No change to per-entry `PairStatus` values (`onlyLeft`, `onlyRight`,
  `identical`, `different`, `differentMetadataOnly` remain).

## Changes

### 1. Always side-by-side — `src/components/DiffView.tsx`

In the `DiffEditor` `options`:

- Remove `useInlineViewWhenSpaceIsLimited: true`.
- Remove `renderSideBySideInlineBreakpoint: 720`.
- Keep `renderSideBySide: true`.

Result: the editor stays two-pane at any width.

### 2. Filter `all | diff | same`

- `src/lib/types.ts` — `TreeFilter = "all" | "diff" | "same"`.
- `src/lib/tree.ts` — `pairPassesTreeFilter`:
  - `all` → always true
  - `diff` → `pair.status !== "identical"`
  - `same` → `pair.status === "identical"`

  `diff` therefore covers `different`, `onlyLeft`, `onlyRight`, and
  `differentMetadataOnly` — identical behaviour to the old `differences`
  mode, just renamed and folding in the old left/right modes.
- `src/App.tsx` — default filter state `"differences"` → `"diff"`. The
  existing `setTreeFilter("all")` fallback (when a selected pair fails the
  active filter) is unchanged.
- `src/components/SearchBar.tsx` — replace the four `SelectItem`s with
  three:
  - `all` → "Show all"
  - `diff` → "Differences"
  - `same` → "Identical"

### 3. Tests

- `src/components/FileTree.test.tsx:84` — `treeFilter="differences"` → `"diff"`.
- `src/components/SearchBar.test.tsx:8` — `treeFilter: "differences"` → `"diff"`.

`PairStatus` references (`status: "onlyLeft"` etc.) in tests are entry
statuses, not filter values, and stay as-is.

## Verification

- `npm test` (or project test runner) green.
- Manual: open a compare, shrink the workspace pane below 720px — editor
  stays two-pane. Filter dropdown shows three options; each filters the
  tree as specified.
