# Two-pane (Beyond Compare) file tree

## Problem

The archive/folder comparison tree (`FileTree`) renders a single merged
column with a status badge per row (git-style: `+` left-only, `−`
right-only, `M` modified). The user wants a Beyond Compare folder view:
two columns, left source vs right source, rows aligned by path, with the
missing side shown as a gap.

(An earlier change already made the in-file Monaco diff side-by-side and
reduced the filter to all/diff/same. This spec covers the *tree*, which is
what the user actually meant.)

## Key insight

`buildTree(visiblePairs)` already pairs left and right entries by path —
each `ComparePair` carries `.left` and `.right` (either may be undefined)
plus a `status`. The merged tree IS the alignment. So we do not need two
independent synced trees; we render each existing row as two cells.

## Goals

- In **compare** mode, each tree row shows two columns: left cell and
  right cell, separated by a center status indicator.
  - Both `.left` and `.right` present (different / identical / meta) →
    name shown in both cells.
  - `onlyLeft` → name in left cell, right cell is a muted gap.
  - `onlyRight` → name in right cell, left cell is a muted gap.
  - Folders/archives → name in both cells (they exist on both sides).
- A header row labels the two columns (left source vs right source).
- Expand/collapse, scroll, and selection stay synchronized — guaranteed,
  because it is still one DOM list with one expand state.
- Single mode is unchanged: one column, no status, no gaps.

## Non-goals

- No second scroll container / scroll-sync logic (Approach B, rejected).
- No change to `buildTree`, filtering, nested-archive expansion, staging,
  context menu, or `ldiff-core`.
- No change to the Monaco in-file diff (already done).

## Design (Approach A: split-row, single tree)

### Layout

Each row becomes three parts inside the existing row element:

```
[ left half: indent · chevron? · icon · left-name|gap ] [ status ] [ right half: indent · icon · right-name|gap ]
```

- Left and right halves each get their own indent (`paddingLeft` by
  depth) so the two sides mirror and align.
- The chevron (expand toggle) lives only in the left half; toggling
  expands/collapses the node on both sides (one node).
- The center status indicator is the existing glyph from
  `statusPresentation(pair.status)`, shown only in compare mode.
- A gap cell (absent side) gets a muted/striped style (`.tree-gap`).

### Header

A non-scrolling header above the rows with two labels:
`leftLabel` | `rightLabel`. `App.tsx` passes these (basename of the left /
right archive or folder path, falling back to "Left" / "Right"). Hidden in
single mode.

### Components / files

- `src/components/FileTree.tsx` — rework `FileTreeNode` row rendering into
  the two-cell layout; add a header in `FileTree`; thread `leftLabel` /
  `rightLabel` props. Folder rows, archive rows, and file rows all use the
  same two-cell row structure. Clicking either cell of a file row calls
  `onInspect` / `onSelect` with the same pair (unchanged handlers).
- `src/styles.css` — add `.tree-header`, `.tree-half`, `.tree-half-left`,
  `.tree-half-right`, `.tree-mid`, `.tree-gap`, and the column grid; keep
  existing status colors.
- `src/App.tsx` — compute and pass `leftLabel` / `rightLabel` from
  `archives` / `paths`.
- `src/components/FileTree.test.tsx` — paired entries now render their name
  twice (left + right cell); switch the affected `getByText` assertions to
  `getAllByText(...).length` / first match. Add a test that an `onlyLeft`
  pair renders a gap on the right and an `onlyRight` pair a gap on the left.

## Edge cases

- Single mode (`mode === "single"`): render one column only (current
  behavior), no header, no status, no gap.
- `onlyLeft` / `onlyRight`: exactly one populated cell; the other is
  `.tree-gap`.
- Selection highlight (`.selected`) applies to the whole row.
- Folder roll-up count (`folder-rollup`) stays (compare mode only).

## Verification

- `npm test` green (with updated FileTree tests).
- `npm run verify:all` green.
- Manual: open two jars in compare mode → tree shows two aligned columns;
  a left-only entry shows a gap on the right and vice-versa; expanding a
  folder expands both sides; single-open shows one column.
