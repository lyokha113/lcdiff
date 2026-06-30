# Preferences Polish and Diff Navigator Design

## Problem

The Preferences drawer has several regressions after the recent simplification:

- Appearance Light mode breaks the visual hierarchy.
- The `System` appearance button can overflow.
- Editor font choices do not load predictably the first time the Editor section
  is opened.
- Long installed font names can overflow the font select.
- Misc segmented buttons can overflow.
- The Editor minimap setting is present but not visually clear enough.
- The diff editor has no visible quick navigation for moving between changed
  blocks.

This work is a controlled polish pass. It keeps the current
`Appearance / Editor / Misc` Preferences contract and adds a small visible diff
block navigator to the editor surface.

## Goals

- Keep Preferences compact and predictable without redesigning the full app.
- Consolidate Preferences layout CSS so old drawer rules cannot override the
  current drawer structure.
- Make Light mode readable and structurally clear across Preferences and the
  main shell.
- Make all Preferences controls overflow-safe at drawer and compact widths.
- Load installed editor fonts predictably when Preferences or Editor needs the
  list.
- Clarify that the minimap setting controls the Monaco editor minimap.
- Add a visible compact diff block navigator for quick previous/next changed
  block jumps.
- Add focused tests and render verification for the reported regressions.

## Non-goals

- No new theme marketplace, theme catalog, or arbitrary CSS editor.
- No native preference config file or sync.
- No changes to `lcdiff-core`, archive diff semantics, merge semantics, save
  semantics, or sidecar behavior.
- No keyboard shortcut remapping UI.
- No full editor toolbar redesign beyond the compact diff navigator.
- No replacement of Monaco or shadcn/Radix primitives.

## Approved Direction

Use the controlled polish direction:

- Keep the existing Preferences sections: `Appearance`, `Editor`, and `Misc`.
- Clean up duplicated Preferences CSS and make the controls resilient.
- Add a compact diff navigator cluster at the right edge of the editor action
  area: previous diff, current/total count, next diff.

## Preferences Layout

`ConfigDrawer` remains the Preferences shell. It owns:

- open/close chrome
- active top-level section
- active Misc sub-panel
- the trigger for loading system fonts

`AppearancePreferences`, `EditorPreferences`, and `MiscPreferences` remain
section components. They should render controls and emit complete
`UiPreferences` updates, but they should not own archive, diff, save, search, or
backend state.

The CSS should have one coherent rule set for:

- `.config-drawer.open`
- `.preferences-drawer`
- `.preferences-header`
- `.preferences-body`
- `.preferences-nav`
- `.preferences-content`
- `.drawer-group`
- `.appearance-pattern-grid`
- `.segmented-control`

Older duplicate rules that reintroduce fixed 360px drawer behavior, incomplete
grid definitions, or conflicting `.drawer-group` spacing should be removed or
merged.

At normal desktop width, Preferences uses a left section nav and scrollable
content region. At narrow widths, the section nav can become horizontal, but
buttons must remain readable and must not push the drawer wider than the
viewport.

## Appearance Behavior

The visible choices remain:

- `Light`
- `Dark`
- `System`

The `System` button must fit without overflowing. The grid should use
`minmax(0, 1fr)`, control text should be truncation-safe, and buttons should
not depend on intrinsic text width.

Light mode should keep the existing product personality but use clearer
structural separation:

- app background, drawer surface, input surface, and popover surface should be
  distinct
- borders should remain visible on pale surfaces
- muted text must stay readable
- active/selected states must not wash out
- status colors should stay legible on light surfaces

This is a token-level adjustment through `preferences.ts` variables, not a new
theme catalog.

## Editor Preferences

The Editor section controls only Monaco editor and diff editor behavior:

- editor font family
- editor font size
- word wrap
- line numbers
- minimap

The selected editor font must not affect app chrome, file tree, search results,
source rail, status bar, or Preferences text.

The font family select must be full-width within the Preferences content
column. Long font family names should ellipsize in the closed trigger and in
the opened list items. The select popup should not exceed the viewport or
drawer-safe width.

The minimap control should make the target explicit. Preferred copy is
`Monaco minimap` or an equivalent concise label, rather than a generic
`Minimap` label.

When minimap is enabled, `DiffView` should pass a clear Monaco minimap option
object rather than only toggling `{ enabled: true }`. The option should make the
result visually apparent while staying compact enough for the desktop layout.

## System Font Loading

System font enumeration remains a Tauri adapter concern through the existing
`list_system_fonts` command.

Font loading should be predictable:

```text
Preferences opens
  -> request system font loading once when the current state is idle
  -> normalize/sort font list
  -> Editor font select renders installed fonts or fallback fonts
```

The UI must not get stuck in an idle-looking first-open state when the user
enters Editor. Opening Editor can call the same load helper as a defensive
guard, but the expected first request is tied to opening Preferences. If
enumeration fails, the Editor section uses bundled fallback choices and shows a
lightweight fallback note.

Persisted font values are still normalized through `normalizeUiPreferences`.
If a saved font is no longer available after font enumeration, the editor font
falls back to the default editor font.

## Misc Preferences

`Misc` keeps the existing segmented sub-panels:

- `Search`
- `Decompiler`
- `Save`

The segmented control must fit in the drawer without text overflow. It should
use equal-width tracks with `minmax(0, 1fr)`, min-width-safe buttons, and
ellipsis-safe labels. The control remains visible in single and compare mode.

## Diff Block Navigator

Add a compact visible navigator for compare-mode diff editors.

The approved placement is a small cluster at the right edge of the editor action
area:

```text
[previous diff] [current / total] [next diff]
```

The navigator should be present when compare mode renders a diff editor. It
should be disabled or show an empty state when Monaco reports no changed blocks.

Behavior:

- Use the mounted Monaco `DiffEditor` instance.
- Read changed blocks from `getLineChanges()`.
- Track the current block based on the focused pane cursor line when possible.
- `Previous` reveals the previous changed block.
- `Next` reveals the next changed block.
- Revealing a block should use the relevant pane editor and
  `revealLineInCenter`.
- For changed blocks with ranges on both sides, prefer the modified/right pane
  when focus is unknown. If focus is in the original/left pane, reveal the left
  range.
- Insertions or deletions where one side has a zero line range should reveal the
  non-empty side or the nearest valid insertion line.

The navigator is frontend-only. It does not call Rust, does not alter staged
changes, and does not change hunk merge behavior.

## Component Boundaries

Expected ownership:

- `ConfigDrawer`: drawer shell, top-level section state, Misc panel state, font
  loading trigger.
- `AppearancePreferences`: color pattern buttons.
- `EditorPreferences`: font select, font size select, word wrap, line numbers,
  Monaco minimap toggle, loading/fallback notes.
- `MiscPreferences`: Search/Decompiler/Save segmented panels.
- `DiffView`: editor action layout and visible diff navigator UI.
- `App.tsx`: mounted Monaco editor refs, navigation callbacks, preference
  persistence, system font command invocation.
- `preferences.ts`: normalization, persistence, appearance tokens, effective
  appearance helpers.

Navigator calculation and callbacks belong in `App.tsx` because it already owns
the mounted Monaco diff editor ref. The visible controls and disabled state are
passed into `DiffView`, so the editor surface remains the only place that
renders the navigator.

## Error Handling

- Invalid persisted preferences continue falling back to defaults.
- Missing or invalid font values fall back to the default editor font after the
  available font list is known.
- Font enumeration failure uses bundled fallback fonts and shows a non-blocking
  fallback note.
- Diff navigator controls are disabled when the diff editor is not mounted or
  Monaco reports no line changes.
- Navigation must tolerate stale line-change data during preview changes and
  should never throw from a button click.

## Testing and Verification

Add or update focused unit tests for:

- Preferences renders only `Appearance`, `Editor`, and `Misc`.
- Appearance updates `light`, `dark`, and `system` values.
- Editor requests font loading predictably.
- Font fallback note still appears on command failure.
- Long font names render in the font select without requiring intrinsic-width
  controls.
- Misc segmented controls keep all three panels accessible.
- `DiffView` passes explicit minimap options to Monaco.
- `DiffView` renders the compact diff navigator in compare mode and hides or
  disables it when no diff block exists.
- Navigator callbacks are wired to previous/next controls.

Update render verification to cover:

- Preferences in Light mode.
- The `System` appearance button.
- Editor with a long installed font family.
- Misc segmented control at normal and compact drawer widths.
- Diff editor navigator geometry, including no overlap with merge actions.

Use the existing local validation ladder:

```bash
rtk npm test -- src/lib/preferences.test.ts src/lib/system-fonts.test.ts src/components/ConfigDrawer.test.tsx src/components/DiffView.test.tsx
rtk npm run verify:frontend
rtk npm run verify:all
```

If the full verification ladder is too slow during implementation, run focused
tests first and then finish with the umbrella gate before completion.

## Acceptance Criteria

- Light mode no longer visually breaks Preferences or the shell.
- `System` does not overflow in Appearance.
- Installed fonts load predictably on first Preferences/Editor use.
- Long font names do not overflow the Editor font select.
- Misc segmented buttons do not overflow.
- The minimap control clearly communicates Monaco minimap behavior.
- When enabled, minimap settings are passed clearly to Monaco.
- Compare-mode diff editor shows a compact previous/current/next diff navigator.
- Previous/next navigator buttons jump between Monaco diff blocks without
  backend calls.
- Existing merge, search, save, and decompile semantics remain unchanged.
