# Hierarchical File Tree + Status Redesign

**Date:** 2026-06-07
**Scope:** Frontend only (`src/components/FileTree.tsx`, new `src/lib/tree.ts`, new `src/lib/status.ts`, `src/styles.css`). No backend/Tauri changes. Builds on the component layout from `2026-06-07-ui-refactor-config-panel-design.md`.

## Goal

The file tree currently renders compare pairs as a **flat list of full paths** (`com/example/App.class`) with a plain text status badge and a 3-column `left-path | badge | right-path` row. It's hard to scan in real archives. Replace it with a **VSCode/Finder-style hierarchical tree** (folders that expand/collapse, indentation per path level) and a **clear git-style status visual language** (colored glyph pill + filename tint), so differences are instantly recognizable.

## Approved Decisions

| Topic | Decision |
|-------|----------|
| Tree model | Full **hierarchical** tree built from path segments; folders expand/collapse with a chevron |
| Status visual | **VSCode git style**: single-glyph colored pill at row's right edge + filename text tinted to match. Color **and** glyph (colorblind-safe) |
| Status map | `different`→`M` amber · `differentMetadataOnly`→`M̃` blue · `onlyLeft`→`+` green · `onlyRight`→`−` orange · `identical`→`≡` muted (no pill) |
| Folder rollup | Folder row shows a small status dot + count of contained differences |
| Expand on load | **Auto-expand folders containing differences; collapse the rest.** Re-applied when the tree filter changes |
| Search/filter | Search match auto-expands ancestor folders; tree filter prunes to matching leaves while keeping their ancestor folders |
| Row layout | Single tree with **one status chip per file** (replaces the 3-column left/badge/right row) |
| Library | **Custom recursion** — no tree library (shadcn has none; the data is small and known) |
| Out of scope (YAGNI) | Keyboard navigation, folder-level bulk copy, drag-reorder, virtualization |

## Status Visual Language

| status | glyph | color token | filename tint | pill bg |
|--------|-------|-------------|---------------|---------|
| `different` | `M` | amber | yes | tinted |
| `differentMetadataOnly` | `M̃` | blue | yes | tinted |
| `onlyLeft` | `+` | green | yes | tinted |
| `onlyRight` | `−` | orange | yes | tinted |
| `identical` | `≡` | muted | no | none (glyph only) |

Each status also has a human label (e.g. "modified", "left only") used for `title`/tooltip and `aria-label`.

## Architecture

### `src/lib/tree.ts` (new, pure, unit-tested)

Builds a nested tree from the flat `ComparePair[]`.

```ts
import type { ComparePair, PairStatus } from "@/lib/types";

export interface TreeFolder {
  kind: "folder";
  name: string;          // segment name, e.g. "example"
  path: string;          // full folder path, e.g. "com/example"
  children: TreeNode[];  // folders first (sorted), then files (sorted)
  diffCount: number;     // count of descendant files whose status !== "identical"
}
export interface TreeFile {
  kind: "file";
  name: string;          // leaf filename, e.g. "App.class"
  path: string;          // full entry path (matches pair.path)
  pair: ComparePair;
}
export type TreeNode = TreeFolder | TreeFile;

export function buildTree(pairs: ComparePair[]): TreeNode[];
```

Rules: split each `pair.path` on `/`; intermediate segments become nested `TreeFolder`s (deduped by path); the final segment is a `TreeFile` carrying its `pair`. Sort each level: folders before files, each alphabetically. `diffCount` = number of descendant files with `status !== "identical"`. Paths with no `/` are top-level files.

### `src/lib/status.ts` (new, pure, unit-tested)

```ts
import type { PairStatus } from "@/lib/types";

export interface StatusPresentation {
  glyph: string;       // "M" | "M̃" | "+" | "−" | "≡"
  label: string;       // "modified" | "meta only" | "left only" | "right only" | "identical"
  className: string;   // e.g. "status-different" — drives color via CSS
}
export function statusPresentation(status: PairStatus): StatusPresentation;
```

### `src/components/FileTree.tsx` (rewrite of the renderer)

- Receives the same props as today: `visiblePairs`, `selected`, `stagedEntries`, `mode`, `onInspect`, `onSelect`, `onCopy`, `onUnstage`. **Prop contract unchanged** — the parent (App) keeps building `visiblePairs` exactly as now.
- Calls `buildTree(visiblePairs)` (memoized with `useMemo` on `visiblePairs`).
- Holds expand state locally: `const [expanded, setExpanded] = useState<Set<string>>(...)`.
  - Auto-expand: a `useEffect` recomputes the default expanded set whenever `visiblePairs` changes — expand every folder whose subtree contains a diff (`diffCount > 0`), collapse the rest. User toggles override until the next `visiblePairs` change. (Keep it simple: recompute defaults on data change; manual toggles persist within the same data.)
- Renders a recursive `FileTreeNode`:
  - **Folder row**: chevron (`ChevronRight`/`ChevronDown` from lucide) + folder icon (`Folder`/`FolderOpen`) + name + rollup (small dot + `diffCount` when > 0). Click toggles expand. Indented by depth.
  - **File row**: indent + file glyph, filename (tinted via status className), the status chip (glyph pill) at the right, plus the existing `pending → side` badge when staged. Click → `onInspect(pair)`; right-click sets selection; wrapped in the existing shadcn `ContextMenu` with Copy-to-left / Copy-to-right / Unstage (disabled conditions identical to today).
- Indentation: `padding-left` proportional to depth (e.g. `depth * 14px`), with an optional indent guide line.

`FileTreeNode` may live in the same file (it's small and only used here) or as `src/components/FileTreeNode.tsx` if `FileTree.tsx` grows past ~150 lines.

### `src/styles.css`

Add: `.tree-folder`, `.tree-file`, `.tree-indent`, `.tree-chevron`, status color classes (`.status-different`, `.status-meta`, `.status-onlyLeft`, `.status-onlyRight`, `.status-identical`) defining filename tint + pill bg, folder rollup dot, hover/selected states. Reuse existing theme tokens (`--brass`, `--danger`, etc.); add semantic color vars if needed. Keep `.tree`, `.tree-row` selected/hover behavior working (or migrate the `selected` highlight to the new file row).

## Invariant Guard Impact

`scripts/verify-frontend-invariants.mjs` checks (combined source) for ContextMenu composition markers (`ContextMenuTrigger asChild`, `ContextMenuContent`, `ContextMenuItem`) and the `mode === "single"` copy-guard count (≥5). The rewritten FileTree **must keep** the shadcn `ContextMenu` with the same `disabled={mode === "single" || ...}` conditions on Copy items, so these markers stay satisfied. `scripts/verify-frontend-render.mjs` drives the tree by `.tree-row` + status text and clicks rows — **this e2e must be updated**: the new rows are `.tree-file`/`.tree-folder`, status is a glyph not the word "different"/"onlyRight", and reaching a file may require expanding its folder (auto-expand-on-diff covers the diff cases the e2e uses, but "Only right" filter and metadata-only assertions must be re-pointed to the new markup/glyphs). Treat updating both guards as part of this work.

## Testing

- `src/lib/tree.test.ts`: buildTree from a known pair set → assert nesting, sort order (folders before files, alphabetical), `diffCount` rollup, top-level files, deep nesting.
- `src/lib/status.test.ts`: each `PairStatus` → correct glyph/label/className; exhaustive over the union.
- `src/components/FileTree.test.tsx`: renders folders + files; folder collapse hides children; clicking a file calls `onInspect`; status glyph present; context-menu Copy disabled in single mode.
- Update `scripts/verify-frontend-render.mjs` to drive the hierarchical tree (expand folders as needed, match new glyph/markup) and keep all prior behavioral coverage; `npm run verify:all` must pass.
- Manual: the regression oracle is current behavior — inspect/copy/stage/search/filter must work identically; the tree is just a nicer presentation of the same `visiblePairs`.

## Risks

- **Auto-expand recompute vs manual toggles**: recomputing defaults on every `visiblePairs` change could clobber a user's manual collapse. Mitigation: recompute the default set only when the *set of paths* changes (not on unrelated re-renders); accept that changing the filter resets expansion (intended).
- **e2e render guard**: most likely failure point — the script encodes old `.tree-row`/word-status interactions. Budget time to re-point it.
- **Selection highlight**: the `selected` row styling must follow the file row in the new markup so click-to-inspect still shows the active entry.
