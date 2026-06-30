# UI Refactor — Config Panel + Center-Focused Layout

**Date:** 2026-06-07
**Scope:** Frontend only (`src/App.tsx`, `src/styles.css`, new components under `src/components/`). Pure UI reorganization — **no backend/Tauri command changes, no behavior changes.**

## Goal

The current main view stacks everything vertically: header → file pickers → search/view/decompiler toolbar → save-settings row → status message → search results → workspace (tree + diff). The user must scroll past config clutter to reach the File Tree and Diff, which are the primary work surfaces.

Refactor so the main view is clean and the **File Tree + Diff dominate the center** with no scrolling to reach them. Move all configuration into a right-side drawer. Replace text controls with icons (+ tooltips) where meaning is clear.

## Approved Design Decisions

| Topic | Decision |
|-------|----------|
| Config panel placement | **Right slide-out drawer**, closed by default, toggled by ⚙ in menu bar |
| Drawer open behavior | **Push** — diff column shrinks; nothing hidden |
| Search placement | Search **bar stays in main view** above tree (collapsible to 🔍 icon); advanced search (scope, deep search, cancel) lives in drawer |
| Menu bar style | **Clean horizontal toolbar** (no dropdown menus) |
| Top-area space | After files load, file pickers collapse to a compact **chip bar** (1 line) to maximize center |
| Picker re-pick interaction | **Click** chip → popover. NOT hover (hover misfires over the scrollable Monaco diff and occludes content) |
| Diff actions toolbar | **Pro toolbar**: copy-direction icon buttons (⬅ ➡) + segmented Source⇄Bytecode toggle |
| Iconography | lucide-react icons + tooltips throughout; keep text for tree status badges, dropdown values, destructive confirms |

## Target Layout

```
┌─ MenuBar ───────────────────────────────────────────────┐
│ ⬦ LCDiff   [Single|Compare]   💾 Save  🗑 Clear  ·2↦   🔍 ⚙ │
├─ SourceChips (compact, 1 line; click chip → re-pick) ────┤
│ 📦 app.jar      ⇄      📦 app2.jar                        │
├─ SearchBar (collapsible; expands inline, pushes layout) ─┤
│ 🔍 [query…………]   [filter: differences ▾]                 │
├─ Workspace (vertical ResizablePanelGroup) ───────────────┤
│  ┌ FileTree (fills) ───────────────────────────────────┐ │
│  │ path … [status badge] [pending→right]               │ │
│  └─────────────────────────────────────────────────────┘ │
│  ═══ resize handle ═══                                    │
│  ┌ DiffView ───────────────────────────────────────────┐ │
│  │ [⬅][➡]              [ </> Source | ⚙ Bytecode ]      │ │  ← pro toolbar
│  │ Monaco diff/editor (fills, scrolls both axes)        │ │
│  └─────────────────────────────────────────────────────┘ │
├─ status message line ────────────────────────────────────┤
```

Drawer (push, right column) when ⚙ active:

```
│ Search   — scope: both ▾ · [Deep search] [Cancel] [Clear] │
│ View     — tree filter: differences ▾                     │
│ Decompiler & diff — engine: CFR ▾ · ☑ Ignore trim ws      │
│ Save     — ☐ Keep one .bak on save                        │
```

## Component Decomposition

`App.tsx` (957 lines) holds all state + Tauri `invoke` logic. Keep that logic in `App` (single source of truth) and extract **presentational components** that receive state + callbacks via props. No new state owners except local UI toggles (drawer open, search-expanded, active picker popover) which live in `App` too for simplicity.

New files under `src/components/`:

| Component | Responsibility | Key props (in) | Callbacks (out) |
|-----------|----------------|----------------|-----------------|
| `MenuBar.tsx` | brand, mode toggle, Save, Clear staged, staged badge, search-toggle, drawer-toggle | `mode`, `stagedTarget`, `stagedCount`, `searchOpen`, `drawerOpen` | `onChangeMode`, `onSave`, `onClearStaged`, `onToggleSearch`, `onToggleDrawer` |
| `SourceChips.tsx` | compact filename chips + re-pick popover (browse file/folder, save staged per side) | `mode`, `archives`, `paths`, `pathErrors` | `onOpenPath`, `onBrowse`, `onBrowseFolder`, `onSave` |
| `SearchBar.tsx` | query input + tree-filter quick dropdown (inline, collapsible) | `query`, `treeFilter`, `open` | `onQueryChange`, `onSearch`, `onFilterChange` |
| `ConfigDrawer.tsx` | drawer shell + Search(scope/deep/cancel/clear), View(filter), Decompiler(engine, ignore-ws), Save(backup) | `open`, `mode`, `searchScope`, `searching`, `treeFilter`, `engine`, `ignoreTrimWhitespace`, `backupEnabled` | corresponding setters/handlers |
| `FileTree.tsx` | visible pairs list, status badges, selection, context menu (copy/unstage) | `visiblePairs`, `selected`, `stagedEntries`, `mode` | `onInspect`, `onSelect`, `onCopy`, `onUnstage` |
| `DiffView.tsx` | pro action toolbar (copy arrows + Source/Bytecode segmented toggle) + Monaco `Editor`/`DiffEditor` | `mode`, `selected`, `preview`, `ignoreTrimWhitespace`, `viewMode` | `onCopy`, `onShowSource`, `onShowBytecode`, editor `onMount` refs |

Stays in `App.tsx`: all `useState`/`useRef`/`useEffect`, every `invoke` wrapper (`openPath`, `inspect`, `runSearch`, `save`, …), the signed-save `Dialog`, and `SplashScreen` routing.

Editor `onMount` refs (`editorRef`, `diffEditorRef`, `monacoRef`) must still be set from `DiffView` — pass setter callbacks (or forward the existing refs as props) so the search-highlight `useEffect` in `App` keeps working unchanged.

## State Additions (UI-only)

- `drawerOpen: boolean` — config drawer visibility (default `false`)
- `searchOpen: boolean` — inline search bar expanded (default `false`, or `true` once a query exists)
- `viewMode: "source" | "bytecode"` — replaces the implicit source/bytecode toggle so `DiffView` segmented control reflects active state
- `activePicker: Side | undefined` — which source chip popover is open

## Styling

- Rework `src/styles.css`: replace stacked sections with a CSS grid / flex column where `.workspace` flexes to fill remaining height (so tree+diff own the viewport). Menu bar, chip bar, search bar are fixed-height rows; status line pinned bottom.
- Drawer: flex sibling of workspace that animates width 0 → ~280px (push, not `position:fixed` overlay).
- Use existing shadcn primitives: `Tooltip` (already imported) wraps every icon button; `Popover` (add via shadcn if missing) for source chip re-pick; reuse `ResizablePanelGroup` for tree↔diff.
- Icons from `lucide-react` (already a dependency): `Settings`, `Search`, `Save`, `Trash2`, `FileText`, `Folder`, `ArrowLeft`, `ArrowRight`, `Code`, `Binary`, `ArrowLeftRight`.

## Out of Scope (YAGNI)

- No backend / Tauri command changes.
- No new search/diff/merge features.
- No theme/color redesign beyond layout + icon swaps.
- No real dropdown menu bar (File/View/Help) — rejected in favor of toolbar.

## Testing / Verification

- `SplashScreen.test.tsx` unaffected.
- Add light render tests for extracted components where they hold logic (e.g. `DiffView` segmented toggle disabled states, `SourceChips` popover open/close). Keep tests focused — these are presentational.
- Manual verification (the `verify`/`run` skill): launch app, confirm (1) tree+diff fill center with no page scroll, (2) drawer pushes diff and holds all moved configs, (3) search bar inline works, (4) chip click re-picks, (5) icon buttons have tooltips, (6) copy/source/bytecode behavior identical to before.
- Existing behavior is the regression oracle: diff, search, deep search, staging, signed-save dialog, history must all behave exactly as today.

## Risks

- **Editor ref wiring** across the `App`/`DiffView` boundary is the main correctness risk — the search-highlight effect depends on those refs. Mitigate by passing refs as props rather than re-creating them in the child.
- **Monaco re-layout on drawer push** — Monaco must re-measure when its container resizes; ensure `automaticLayout: true` or trigger `editor.layout()` on drawer toggle.
