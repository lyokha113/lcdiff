# Preferences Refactor Design

## Problem

The current Preferences work is partially wired but still feels like a
placeholder. It exposes a large theme catalog, a top-level Typography section,
and several controls that do not map cleanly to the user's real workflow. Some
typography controls are modeled as app-wide UI choices even though the requested
behavior is editor-only.

This phase refactors Preferences into a smaller, clearer contract that works
properly:

- Appearance controls the app color pattern.
- Editor controls diff/editor typography and Monaco display behavior.
- Misc groups lower-frequency Search, Decompiler, and Save defaults behind a
  segmented sub-navigation.

## Goals

- Replace the theme catalog with three clear Appearance patterns: Light, Dark,
  and System.
- Apply Appearance immediately to app chrome and the Monaco base theme.
- Move typography into Editor and apply font family and font size only to the
  Monaco diff/editor panel.
- Let users choose from fonts installed on the machine, with monospace-looking
  families sorted first but all families still selectable.
- Group Search, Decompiler, and Save under a single Misc section with a
  segmented sub-navigation.
- Keep preference persistence frontend-local for this phase while isolating the
  load/save helpers so a future native config file can replace local storage.
- Add focused tests for preference normalization, drawer behavior, font fallback,
  and Monaco option application.

## Non-goals

- No custom theme marketplace, imported third-party theme packages, or arbitrary
  CSS editor.
- No per-theme Monaco palette registration beyond mapping Light/System-light to
  Monaco `light` and Dark/System-dark to `vs-dark`.
- No native preference config file or cross-device sync in this phase.
- No changes to archive, merge, save, decompiler cache, or `lcdiff-core`
  semantics.
- No search workflow redesign beyond moving default controls into Misc.

## Approved Direction

Use the recommended compact design:

- `Appearance`
- `Editor`
- `Misc`

`Appearance` owns only color pattern. `Editor` owns the font list, font size,
word wrap, line numbers, and minimap. `Misc` contains a segmented control for
`Search`, `Decompiler`, and `Save`.

## Preferences Contract

Refactor the frontend preference model toward this shape:

```ts
interface UiPreferences {
  appearance: {
    colorPattern: "light" | "dark" | "system";
  };
  editor: {
    fontFamily: string;
    fontSize: number;
    wordWrap: "on" | "off";
    lineNumbers: "on" | "off";
    minimap: "on" | "off";
  };
  misc: {
    search: {
      includeSourceByDefault: boolean;
      resultGrouping: "kind" | "side";
    };
    decompiler: {
      engine: "vineflower" | "cfr";
      ignoreTrimWhitespace: boolean;
    };
    save: {
      backupEnabled: boolean;
    };
  };
}
```

Persisted values remain partial and must be normalized through helper functions.
Unknown enum values, invalid font sizes, missing nested objects, or unavailable
fonts fall back to defaults.

Recommended defaults:

- `appearance.colorPattern`: `dark`
- `editor.fontFamily`: bundled JetBrains Mono first, then system monospace
  fallback
- `editor.fontSize`: `13`
- `editor.wordWrap`: `off`
- `editor.lineNumbers`: `on`
- `editor.minimap`: `off`
- `misc.search.includeSourceByDefault`: `false`
- `misc.search.resultGrouping`: `kind`
- `misc.decompiler.engine`: `vineflower`
- `misc.decompiler.ignoreTrimWhitespace`: `true`
- `misc.save.backupEnabled`: `false`

## Appearance Behavior

The Appearance section renders three choices:

- `Light`
- `Dark`
- `System`

When `System` is selected, the app follows `prefers-color-scheme`. The effective
pattern is recalculated when the OS preference changes.

The active pattern updates app root data attributes and CSS variables. Monaco
uses:

- `light` for effective Light
- `vs-dark` for effective Dark

The old curated theme list and accent controls are removed from the visible
Preferences surface for this phase.

## Editor Font Behavior

Typography is no longer a top-level section. Editor font choices apply only to
Monaco `Editor` and `DiffEditor` instances.

The UI must not apply the selected editor font to:

- app chrome
- file tree
- search result rows
- status bar
- menu or source controls

Font size uses a bounded select with numeric choices from `11` through `20`.
Invalid values must never enter persisted preferences.

If the selected font is no longer available on a later launch, normalization
falls back to the bundled/default editor font and keeps the app usable.

## System Font Enumeration

Add a narrow Tauri command for installed fonts:

```ts
type SystemFont = {
  family: string;
  monospaceLikely: boolean;
};
```

The frontend calls this command when Preferences opens or when Editor first
needs the font list. Results are sorted with `monospaceLikely` entries first,
then alphabetically. All returned families remain selectable.

If font enumeration fails, the Editor section still works with fallback choices:

- bundled JetBrains Mono
- system monospace
- system sans-serif

The failure should be visible as a lightweight fallback state in the Editor
section, not as a blocking error dialog.

The command is an adapter concern. It must not touch `lcdiff-core`.

## Misc Behavior

`Misc` uses a segmented sub-navigation:

- `Search`
- `Decompiler`
- `Save`

`Misc > Search` controls durable search defaults only. It must not contain live
actions such as running, clearing, or canceling a search.

`Misc > Decompiler` owns Vineflower/CFR engine selection and trim-whitespace
diff behavior because both affect rendered decompile/diff output.

`Misc > Save` owns backup behavior. It should be visible in single mode as a
preference, even when no save target is currently available. Runtime save
eligibility still belongs to the existing save workflow.

## Component Design

`ConfigDrawer` remains the right-side Preferences surface, but its internal
navigation changes to the approved structure.

Recommended component boundaries:

- `ConfigDrawer`: open/close shell and top-level section state.
- `AppearancePreferences`: color pattern choices.
- `EditorPreferences`: font list, font size, word wrap, line numbers, minimap,
  and font enumeration fallback state.
- `MiscPreferences`: segmented Search/Decompiler/Save sub-panel.
- `preferences.ts`: normalization, persistence, effective appearance helpers,
  editor font defaults.

Keep `App.tsx` as the orchestration owner for archive state, active engine,
whitespace setting, backup setting, and Tauri invocation. Do not move archive or
merge state into Preferences components.

## Data Flow

```text
localStorage persisted partial preferences
  -> loadUiPreferences()
  -> normalizeUiPreferences()
  -> App state
  -> applyPreferencesToRoot(app root, effective appearance)
  -> ConfigDrawer sections
  -> DiffView Monaco options
```

Font list data flow:

```text
ConfigDrawer opens Editor
  -> invoke list_system_fonts
  -> normalize/sort families
  -> Editor font dropdown
  -> selected family persisted in UiPreferences
  -> DiffView passes fontFamily/fontSize to Monaco options
```

## Error Handling

- Invalid persisted preferences fall back to defaults without throwing.
- Font command failure falls back to bundled/system choices and shows a
  non-blocking fallback state in Editor.
- Missing selected font on reload falls back to the default editor font.
- Unsupported color pattern falls back to `dark`.
- System color-scheme listeners must be cleaned up when no longer needed.

## Testing

Add or update focused tests:

- `src/lib/preferences.test.ts`
  - normalizes old or partial preference objects into the new shape
  - rejects invalid color pattern, font size, result grouping, engine, and
    toggle values
  - falls back when a selected font is unavailable
  - computes effective Light/Dark behavior for System mode
- `src/components/ConfigDrawer.test.tsx`
  - renders only `Appearance`, `Editor`, and `Misc` as top-level sections
  - renders Misc segmented controls for `Search`, `Decompiler`, and `Save`
  - shows Editor font fallback state when font enumeration fails
  - keeps Save preference visible in single mode
- `src/App.test.tsx` or `src/components/DiffView.test.tsx`
  - applies selected editor font family and size to Monaco options
  - does not apply editor font as app chrome, tree, or search-result font
  - applies Light/Dark/System appearance to the app root and Monaco theme
- Rust/Tauri adapter tests
  - factor font-family deduplication and monospace classification into a pure
    helper
  - verify the helper returns unique family names with a stable
    `monospaceLikely` boolean shape
- Render verification
  - confirms Preferences shows the three approved top-level sections
  - confirms Misc sub-navigation is visible and stable

## Documentation

Update product-facing docs only where they describe Preferences behavior:

- `README.md`: mention Appearance patterns and editor-only font preferences if
  the Preferences section is documented there.
- `docs/ARCHITECTURE.md`: update the Preferences drawer description from the
  old appearance/typography/editor/search/decompiler/save split to the new
  Appearance/Editor/Misc contract.

## Acceptance Criteria

- Users can choose Light, Dark, or System and the app updates immediately.
- Users can choose installed machine fonts, with monospace-looking fonts listed
  first.
- Editor font family and size affect only the Monaco diff/editor panel.
- Search, Decompiler, and Save are grouped under Misc with segmented
  sub-navigation.
- Preference persistence survives reload and invalid stored data does not break
  startup.
- Existing compare, decompile, search, and save behavior remains unchanged
  except for preference UI placement and defaults.
- Focused frontend tests pass.
- Repo verification includes the existing frontend/render gates selected in the
  implementation plan.
