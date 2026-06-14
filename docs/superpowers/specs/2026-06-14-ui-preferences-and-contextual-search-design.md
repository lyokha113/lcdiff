# UI Preferences and Contextual Search

## Problem

LDiff already has a center-focused workspace, a right-side Config drawer, a
collapsible Search bar, file tree tabs, and per-file diff tabs. The current UI
still has three product issues:

1. Appearance settings are hard-coded in CSS. Users cannot choose common light
   or dark themes, role-specific fonts, density, editor display, or small visual
   preferences.
2. The Config drawer is a flat list of controls. It mixes daily actions
   (`Deep search`, `Cancel search`, `Clear search`) with durable preferences
   (`Decompiler engine`, backup, whitespace).
3. Search does not make its target clear. The UI presents one query and one
   button, while the backend currently distinguishes path, text, constant-pool,
   and decompiled-source matches through `matchKind`. Users cannot easily tell
   whether they are filtering the file tree, searching archive content, or
   finding text in the currently opened diff.

## Goals

- Add a stable `UiPreferences` contract in the React adapter with frontend-local
  persistence for this phase.
- Add a curated theme catalog split into explicit Light and Dark sections.
- Add role-based font configuration for UI, file tree/path surfaces, and editor
  content.
- Add practical UI customization controls, plus limited visual customization.
- Refactor the right Config drawer into a professional Preferences drawer with
  internal sections.
- Redesign Search as contextual and tab-aware:
  - Files tab: archive-wide backend search with grouped results.
  - Diff tab: current-open-document find first, with an explicit "Search all
    files" expansion path.
- Tighten the Tauri search contract so frontend result grouping is based on
  typed search result data, not string interpretation alone.

## Non-goals

- No cloud sync, import/export, or config-file persistence in this phase.
- No custom CSS editor or external theme marketplace.
- No rewrite of `ldiff-core` archive, diff, merge, save, or decompiler cache
  semantics.
- No change to merge writes: decompiled Java remains read-only and never enters
  the write path.
- No full search subsystem rewrite with persistent index caching.
- No large menu-bar redesign.

## Existing Context

The frontend currently uses React, shadcn/ui source components, Tailwind v4,
Monaco, and Tauri IPC. Main relevant files:

- `src/App.tsx` owns archive state, selected/open tabs, search state, drawer
  state, and Tauri command orchestration.
- `src/components/ConfigDrawer.tsx` renders view, search, decompiler/diff, and
  save settings in a flat drawer.
- `src/components/SearchBar.tsx` renders query, Search button, and tree filter.
- `src/components/WorkspaceTabs.tsx` separates Files and opened diff tabs.
- `src-tauri/src/main.rs` exposes `search`, `deep_search`, and
  `cancel_deep_search`.

Current backend search behavior:

- `search_archive` returns `SearchHit { path, match_kind, line }`.
- A path match short-circuits payload search for that entry.
- Text entries can report a line.
- Class entries can match constant-pool values.
- `deep_search` streams source matches after decompilation.

## Architecture

Keep the work in two layers.

### Frontend React Adapter

Add focused helper modules rather than expanding `App.tsx` further:

- `src/lib/preferences.ts`
  - `UiPreferences`
  - defaults
  - load/save from local storage
  - merge persisted partial preferences with current defaults
  - validation for known enum values
- `src/lib/themes.ts`
  - theme registry
  - light/dark grouping
  - CSS variable mapping
  - accent presets
- `src/lib/search.ts`
  - frontend search mode/result grouping types
  - current-tab context helpers
  - typed label mapping from backend hit kind to UI label

`App.tsx` remains the orchestration owner for archive state, tab state, and Tauri
invokes. It passes preferences and search context into presentational
components.

### Tauri Search Adapter

Do not move search into a new core subsystem. Instead, tighten the adapter
contract around the existing behavior.

Introduce typed search options and typed result kinds at the Tauri command
boundary. The frontend should be able to request path, text, constant-pool, and
source categories explicitly and group results without parsing arbitrary labels.

## Preferences Contract

`UiPreferences` should include:

```ts
interface UiPreferences {
  appearance: {
    colorMode: "light" | "dark";
    themeId: string;
    accent: "brass" | "blue" | "green" | "violet" | "rose";
    density: "compact" | "comfortable";
    radius: "sharp" | "default" | "soft";
    motion: "reduced" | "standard";
    iconLabels: "auto" | "always" | "iconsOnly";
  };
  typography: {
    uiFont: "geist" | "bricolage" | "system";
    treeFont: "jetbrainsMono" | "systemMono";
    editorFont: "jetbrainsMono" | "systemMono";
    uiScale: 12 | 13 | 14 | 15 | 16;
    treeScale: 12 | 13 | 14 | 15 | 16;
    editorScale: 12 | 13 | 14 | 15 | 16;
  };
  editor: {
    wordWrap: "off" | "on";
    lineNumbers: "on" | "off";
    minimap: "on" | "off";
  };
  layout: {
    preferencesDrawerWidth: "default" | "wide";
    searchResultsDensity: "compact" | "comfortable";
  };
  search: {
    includeSourceByDefault: boolean;
    resultGrouping: "kind" | "side";
  };
}
```

The persisted value is a partial object. Loading must merge it with current
defaults so future preference fields can be added without migration failures.
Unknown enum values are ignored and replaced by defaults.

Frontend-local persistence is the implementation for this phase. The contract
must not assume local storage forever; all callers use helper functions so a
future Tauri-backed config file can replace the persistence implementation.

## Theme Catalog

Use a curated hybrid catalog. The UI must present two sections:

### Light Themes

- GitHub Light inspired
- VS Code Light inspired
- Solarized Light inspired
- Catppuccin Latte inspired
- Gruvbox Light inspired
- Nord Light inspired

### Dark Themes

- LDiff Graphite
- GitHub Dark inspired
- One Dark inspired
- Dracula inspired
- Monokai inspired
- Solarized Dark inspired
- Tokyo Night inspired
- Catppuccin Mocha inspired

Use "inspired" labels for non-official palette implementations unless an
official source package is imported and its license/source is documented. This
phase should define in-app CSS variable sets, not import arbitrary user theme
files.

The active theme is applied through CSS variables on the app root. In this
phase, Monaco maps light themes to a light Monaco base and dark themes to
`vs-dark`. Exact Monaco theme registration is out of scope for this spec.

## Typography and UI Customization

Role-based font controls:

- UI font affects app chrome, labels, buttons, and drawer content.
- Tree font affects file paths, search result paths, and status-heavy rows.
- Editor font affects Monaco editor/diff content.

Font size uses fixed choices, not free sliders, to avoid broken layout and
unbounded Monaco measurements.

Practical customization:

- density: compact or comfortable spacing
- radius: sharp/default/soft
- drawer width: default or wide
- icon label behavior
- editor word wrap
- editor line numbers
- editor minimap
- search result density

Limited visual customization:

- accent preset
- reduced motion / standard motion

No custom CSS text area is included.

## Preferences Drawer UX

Refactor `ConfigDrawer` into a Preferences drawer.

Placement:

- Desktop: right-side drawer that pushes the workspace.
- Narrow viewport: overlay drawer with bounded width.
- Default width: approximately 360px.
- Wide preset: approximately 420px.

Internal sections:

- Appearance
- Typography
- Editor
- Search
- Decompiler
- Save

The drawer must use section navigation and grouped rows. Avoid nested cards.
Controls should be scan-friendly and stable in height. The drawer is for durable
preferences, not daily search actions.

Control mapping:

- Appearance: color mode, light/dark theme sections, accent, density, radius,
  motion, icon labels.
- Typography: UI/tree/editor font and size controls.
- Editor: wrap, line numbers, minimap. The contextual Source/Bytecode view
  toggle is not a durable preference and should move back near the active
  editor/diff surface if it is removed from the current drawer.
- Search: include source default, result grouping, result density.
- Decompiler: CFR/Vineflower with short explanatory text.
- Save: backup toggle.

Menu bar keeps the gear icon, but labels and aria text should use
`Preferences`.

## Contextual Search UX

Search remains one command-bar workflow, but its behavior is tab-aware.

### Files Tab

The command bar context label is `Files index`.

Primary action:

- `Search all`

Options:

- side scope: left, right, both when in compare mode
- include source: off by default unless preference enables it
- tree filter: all, diff, same remains visible near search controls

Results:

- Use a vertical grouped result panel rather than horizontal chips.
- Group by kind by default:
  - Path
  - Text
  - Constants
  - Source
- Each row shows side badge, kind badge, path, optional line, and optional short
  preview.
- Clicking a result opens or focuses the matching diff tab and highlights the
  line if available.
- Path results also filter/highlight the file tree.

### Diff Tab

The command bar context label is `Current diff`.

Primary action:

- Find/highlight inside the currently opened editor/diff content.

Secondary action:

- `Search all files`, which switches to the Files-index backend search without
  hiding that it is an archive-wide operation.

Results/status:

- Current diff find uses Monaco highlighting and compact match status.
- Archive-wide results continue to use the grouped result panel and are labeled
  `Files index`.

This separation prevents users from confusing file-tree/path search with
in-document find.

## Backend Search Contract

Replace the implicit all-in-one `search(side, query)` boundary with typed
options. The exact Rust naming can follow current Tauri conventions, but the
contract should express:

```rust
struct SearchOptions {
    include_path: bool,
    include_text: bool,
    include_constants: bool,
}

enum SearchHitKind {
    Path,
    Text,
    ConstantPool,
    Source,
}

struct SearchHit {
    entry_path: String,
    kind: SearchHitKind,
    line: Option<usize>,
    preview: Option<String>,
}
```

The frontend wrapper adds `side` and tier/context metadata when aggregating
left/right results.

Behavior changes:

- One entry may return multiple hits if multiple requested categories match.
- Path matches no longer suppress text/constant-pool matches when those
  categories are requested.
- Path-only search still must not read binary payloads.
- Text search only reads text entries.
- Constant-pool search only reads class entries.
- Source search remains in `deep_search` because it depends on decompilation and
  streaming/cancel behavior.

`deep_search` should emit the same typed hit kind for `Source` so frontend
grouping is shared.

## Components

Expected frontend component changes:

- `SearchBar.tsx`
  - context label
  - tab-aware primary/secondary actions
  - include source option when in Files context
  - side scope control
  - tree filter remains close to Files search
- new or refactored `SearchResultsPanel.tsx`
  - grouped vertical results
  - result row badges
  - path/line/preview rendering
- `ConfigDrawer.tsx`
  - refactor into Preferences drawer sections
  - no daily search execution buttons
- `App.tsx`
  - manages active search context from `activeTab`
  - routes current diff find vs Files-index backend search
  - persists and applies `UiPreferences`
- `DiffView.tsx`
  - accepts editor preference props for wrap, line numbers, minimap, font size

## Error Handling

- Empty query: show a user-facing message in the Search bar/status area without
  invoking backend commands.
- No archive loaded: disable Files-index search until at least one source is
  open.
- Current diff with no loaded content: disable current find and explain through
  disabled state/tooltip.
- Deep/source search errors stay per-entry tolerant where possible; a global
  sidecar failure should show a clear source-search error without discarding
  path/text/constants results already available.
- Unknown persisted preferences are ignored and replaced with defaults.

## Testing

### Rust / Tauri Adapter

- Path-only search against a corrupt binary ZIP entry returns the path match
  without reading payload.
- A text entry whose path and content both match returns both `Path` and `Text`
  hits when both categories are requested.
- Text search reports line numbers.
- Constant-pool search reports `ConstantPool`.
- Category options include/exclude the expected hit kinds.
- Empty query remains rejected.
- Deep search reports `Source` with line and keeps cancel/streaming behavior.

### Frontend

- Preferences defaults render without persisted state.
- Persisted partial preferences merge with defaults.
- Unknown theme/font enum values fall back to defaults.
- Preferences drawer renders section navigation and only the active section's
  controls.
- Light and Dark theme sections are visible in Appearance.
- Typography controls call the expected preference update handlers.
- Files tab Search bar shows `Files index` and `Search all`.
- Diff tab Search bar shows `Current diff` and the secondary `Search all files`
  action.
- Files-index results group by kind and render side/kind/path/line.
- Clicking a grouped result opens/focuses the matching diff tab and line
  highlight when available.
- Current diff find does not invoke archive-wide backend search by default.

### Verification

Run scoped checks first:

```bash
rtk cargo test -p ldiff-core
rtk cargo test -p ldiff-cli
rtk npm test -- src/components/ConfigDrawer.test.tsx src/components/SearchBar.test.tsx
rtk npm test -- src/App.test.tsx
rtk npm run build
```

Before declaring the implementation complete, run:

```bash
rtk npm run verify:frontend-render
```

Run `rtk npm run verify:all` when the implementation touches docs or broad
frontend invariants.

## Rollout Plan

1. Add preference and theme modules with tests.
2. Apply preference-driven CSS variables and Monaco/editor options.
3. Refactor Config drawer into the Preferences drawer.
4. Update the Tauri search contract and adapter tests.
5. Refactor Search bar and add grouped Search results panel.
6. Wire tab-aware current-diff find vs Files-index search in `App.tsx`.
7. Update docs/audit references if implementation changes product-visible
   behavior beyond the spec.

## Risks

- `App.tsx` may grow further if search context, preferences, and result grouping
  are implemented inline. Mitigate with focused `src/lib/*` helpers and
  presentational components.
- Monaco layout can be sensitive to drawer width changes and font changes.
  Keep `automaticLayout` and verify render after theme/font/drawer changes.
- Returning multiple hits per entry changes frontend assumptions about
  `searchResultKey`. Keys must include side, path, kind, and line.
- Theme palettes can reduce diff/status contrast. Each theme must map status
  colors for `different`, `onlyLeft`, `onlyRight`, metadata-only, and identical
  states.
- "Inspired by" theme names must not imply official theme packaging.
