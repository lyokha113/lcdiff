# Preferences Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor LCDiff Preferences into working Appearance, Editor, and Misc sections with editor-only installed-font selection.

**Architecture:** Keep preference persistence in the React adapter and keep archive/decompiler/save domain state out of presentational components. Add one narrow Tauri adapter command for installed font families, backed by a pure Rust helper that is unit tested. Monaco receives editor font and effective light/dark theme through `DiffView`; app chrome keeps its normal UI fonts.

**Tech Stack:** React 19, TypeScript, Vitest, shadcn/ui source components, Tauri 2, Rust 2024, `font-kit = 0.14.3`, Monaco via `@monaco-editor/react`.

---

## File Structure

- Modify `src/lib/preferences.ts`
  - Own the new `UiPreferences` shape, defaults, localStorage merge/save, effective appearance helpers, and root CSS application.
- Replace `src/lib/preferences.test.ts`
  - Cover old persisted-shape migration, invalid values, system color behavior, and editor font fallback.
- Create `src/lib/system-fonts.ts`
  - Own frontend font fallback constants and normalization for Tauri font command results.
- Create `src/lib/system-fonts.test.ts`
  - Cover frontend fallback and sort behavior.
- Modify `src/components/ConfigDrawer.tsx`
  - Keep the drawer shell and top-level section state.
  - Render `Appearance`, `Editor`, and `Misc` only.
- Create `src/components/preferences/AppearancePreferences.tsx`
  - Render Light, Dark, System.
- Create `src/components/preferences/EditorPreferences.tsx`
  - Render installed font selector, font size selector, word wrap, line numbers, minimap, and fallback status.
- Create `src/components/preferences/MiscPreferences.tsx`
  - Render segmented `Search`, `Decompiler`, `Save` sub-panels.
- Modify `src/components/ConfigDrawer.test.tsx`
  - Cover the new drawer structure and interactions.
- Modify `src/components/DiffView.tsx`
  - Use `preferences.editor.fontFamily`, `preferences.editor.fontSize`, and an effective color pattern passed from `App`.
- Create `src/components/DiffView.test.tsx`
  - Mock Monaco components and assert editor-only Monaco options.
- Modify `src/App.tsx`
  - Load system fonts on Preferences/Editor demand.
  - Store engine, whitespace, backup, and search defaults through `preferences.misc`.
  - Keep Tauri command invocation in App.
- Modify `src/App.test.tsx`
  - Update preference persistence assertions and add system-font command coverage.
- Modify `src-tauri/Cargo.toml`
  - Add `font-kit = "0.14.3"`.
- Create `src-tauri/src/system_fonts.rs`
  - Implement pure font normalization/classification plus the Tauri command.
- Modify `src-tauri/src/main.rs`
  - Register `mod system_fonts;` and `list_system_fonts`.
- Modify `README.md` and `docs/ARCHITECTURE.md`
  - Update Preferences behavior docs.
- Modify `scripts/verify-frontend-render.mjs`
  - Assert the new Preferences IA appears in render verification.

## Task 1: Refactor Preferences Contract

**Files:**
- Modify: `src/lib/preferences.test.ts`
- Modify: `src/lib/preferences.ts`
- Leave `src/lib/themes.ts` unchanged in this task; Task 7 removes it after all runtime imports are gone.

- [ ] **Step 1: Replace preference model tests with failing contract tests**

Replace `src/lib/preferences.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPreferencesToRoot,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_UI_PREFERENCES,
  effectiveColorPattern,
  loadUiPreferences,
  mergeUiPreferences,
  normalizeUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
  type UiPreferences,
} from "@/lib/preferences";

describe("UI preferences persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when storage is empty", () => {
    const preferences = loadUiPreferences();

    expect(preferences).toEqual(DEFAULT_UI_PREFERENCES);
    expect(preferences).not.toBe(DEFAULT_UI_PREFERENCES);
  });

  it("returns fresh defaults when storage contains invalid JSON", () => {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, "{not json");

    const preferences = loadUiPreferences();

    expect(preferences).toEqual(DEFAULT_UI_PREFERENCES);
    expect(preferences).not.toBe(DEFAULT_UI_PREFERENCES);
  });

  it("merges old persisted shape into the new Preferences contract", () => {
    localStorage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        appearance: { colorMode: "light", themeId: "github-light" },
        typography: { editorFont: "systemMono", editorScale: 15 },
        editor: { wordWrap: "on" },
        search: { includeSourceByDefault: true, resultGrouping: "side" },
      }),
    );

    expect(loadUiPreferences()).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "light" },
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "ui-monospace, monospace",
        fontSize: 15,
        wordWrap: "on",
      },
      misc: {
        ...DEFAULT_UI_PREFERENCES.misc,
        search: {
          includeSourceByDefault: true,
          resultGrouping: "side",
        },
      },
    });
  });

  it("falls back to defaults for unknown enum and invalid numeric values", () => {
    expect(
      mergeUiPreferences({
        appearance: { colorPattern: "sepia" },
        editor: {
          fontFamily: "",
          fontSize: 99,
          wordWrap: "sometimes",
          lineNumbers: "maybe",
          minimap: "huge",
        },
        misc: {
          search: { includeSourceByDefault: "yes", resultGrouping: "folder" },
          decompiler: { engine: "fernflower", ignoreTrimWhitespace: "yes" },
          save: { backupEnabled: "always" },
        },
      }),
    ).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("falls back when a selected font is unavailable", () => {
    const preferences = normalizeUiPreferences(
      {
        ...DEFAULT_UI_PREFERENCES,
        editor: {
          ...DEFAULT_UI_PREFERENCES.editor,
          fontFamily: "Missing Font",
        },
      },
      ["Menlo", DEFAULT_EDITOR_FONT_FAMILY],
    );

    expect(preferences.editor.fontFamily).toBe(DEFAULT_EDITOR_FONT_FAMILY);
  });

  it("keeps a selected font when it is available", () => {
    const preferences = normalizeUiPreferences(
      {
        ...DEFAULT_UI_PREFERENCES,
        editor: {
          ...DEFAULT_UI_PREFERENCES.editor,
          fontFamily: "Menlo",
        },
      },
      ["Menlo", DEFAULT_EDITOR_FONT_FAMILY],
    );

    expect(preferences.editor.fontFamily).toBe("Menlo");
  });

  it("writes normalized preferences JSON to localStorage", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "system" },
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontSize: 16,
      },
    };

    saveUiPreferences(preferences);

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "")).toEqual(
      preferences,
    );
  });

  it("computes effective color pattern from system preference", () => {
    expect(effectiveColorPattern("light", true)).toBe("light");
    expect(effectiveColorPattern("dark", false)).toBe("dark");
    expect(effectiveColorPattern("system", true)).toBe("dark");
    expect(effectiveColorPattern("system", false)).toBe("light");
  });

  it("applies only appearance variables to the app root", () => {
    const root = document.createElement("div");
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "light" },
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Menlo",
        fontSize: 18,
      },
    };

    applyPreferencesToRoot(root, preferences, false);

    expect(root.dataset.colorPattern).toBe("light");
    expect(root.dataset.effectiveColorPattern).toBe("light");
    expect(root.style.getPropertyValue("--background")).not.toBe("");
    expect(root.style.getPropertyValue("--font-mono")).toBe("");
    expect(root.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/lib/preferences.test.ts
```

Expected: FAIL with TypeScript/runtime errors for `colorPattern`, `misc`, `DEFAULT_EDITOR_FONT_FAMILY`, and `effectiveColorPattern`.

- [ ] **Step 3: Replace `src/lib/preferences.ts` with the new contract**

Replace `src/lib/preferences.ts` with:

```ts
export const UI_PREFERENCES_STORAGE_KEY = "lcdiff.uiPreferences.v1";

export type ColorPattern = "light" | "dark" | "system";
export type EffectiveColorPattern = "light" | "dark";
export type Toggle = "on" | "off";
export type ResultGrouping = "kind" | "side";
export type DecompilerEngine = "vineflower" | "cfr";

export const DEFAULT_EDITOR_FONT_FAMILY = "\"JetBrains Mono Variable\", ui-monospace, monospace";
export const SYSTEM_MONO_FONT_FAMILY = "ui-monospace, monospace";
export const SYSTEM_SANS_FONT_FAMILY = "ui-sans-serif, system-ui, sans-serif";
export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];

export interface UiPreferences {
  appearance: {
    colorPattern: ColorPattern;
  };
  editor: {
    fontFamily: string;
    fontSize: EditorFontSize;
    wordWrap: Toggle;
    lineNumbers: Toggle;
    minimap: Toggle;
  };
  misc: {
    search: {
      includeSourceByDefault: boolean;
      resultGrouping: ResultGrouping;
    };
    decompiler: {
      engine: DecompilerEngine;
      ignoreTrimWhitespace: boolean;
    };
    save: {
      backupEnabled: boolean;
    };
  };
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  appearance: {
    colorPattern: "dark",
  },
  editor: {
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    fontSize: 13,
    wordWrap: "off",
    lineNumbers: "on",
    minimap: "off",
  },
  misc: {
    search: {
      includeSourceByDefault: false,
      resultGrouping: "kind",
    },
    decompiler: {
      engine: "vineflower",
      ignoreTrimWhitespace: true,
    },
    save: {
      backupEnabled: false,
    },
  },
};

const COLOR_PATTERNS = ["light", "dark", "system"] as const;
const TOGGLES = ["on", "off"] as const;
const RESULT_GROUPINGS = ["kind", "side"] as const;
const DECOMPILER_ENGINES = ["vineflower", "cfr"] as const;

const lightVariables: Record<string, string> = {
  "--background": "oklch(0.985 0.004 250)",
  "--foreground": "oklch(0.18 0.018 250)",
  "--card": "oklch(0.965 0.006 250)",
  "--card-foreground": "oklch(0.18 0.018 250)",
  "--popover": "oklch(0.99 0.004 250)",
  "--popover-foreground": "oklch(0.18 0.018 250)",
  "--primary": "#5aa9e6",
  "--primary-foreground": "#071a2a",
  "--secondary": "oklch(0.93 0.01 250)",
  "--secondary-foreground": "oklch(0.2 0.018 250)",
  "--muted": "oklch(0.935 0.008 250)",
  "--muted-foreground": "oklch(0.48 0.018 250)",
  "--accent": "oklch(0.91 0.014 250)",
  "--accent-foreground": "oklch(0.18 0.018 250)",
  "--destructive": "oklch(0.58 0.18 24)",
  "--border": "oklch(0.6 0.02 250 / 22%)",
  "--input": "oklch(0.6 0.02 250 / 24%)",
  "--ring": "oklch(0.62 0.12 78 / 38%)",
  "--ink-0": "#f6f8fa",
  "--ink-1": "#ffffff",
  "--ink-2": "#eef2f6",
  "--ink-3": "#d8dee8",
  "--line": "#d0d7de",
  "--line-soft": "#e5eaf0",
  "--text-0": "#24292f",
  "--text-1": "#57606a",
  "--text-2": "#6e7781",
  "--brass": "#5aa9e6",
  "--brass-dim": "#417ea9",
  "--st-diff": "#b7791f",
  "--st-only": "#2563eb",
  "--st-same": "#15803d",
  "--danger": "#dc2626",
};

const darkVariables: Record<string, string> = {
  "--background": "oklch(0.169 0.013 256)",
  "--foreground": "oklch(0.93 0.008 250)",
  "--card": "oklch(0.214 0.016 256)",
  "--card-foreground": "oklch(0.95 0.006 250)",
  "--popover": "oklch(0.205 0.016 256)",
  "--popover-foreground": "oklch(0.95 0.006 250)",
  "--primary": "#d9b066",
  "--primary-foreground": "#2b2110",
  "--secondary": "oklch(0.29 0.016 256)",
  "--secondary-foreground": "oklch(0.94 0.006 250)",
  "--muted": "oklch(0.27 0.014 256)",
  "--muted-foreground": "oklch(0.69 0.014 256)",
  "--accent": "oklch(0.32 0.02 256)",
  "--accent-foreground": "oklch(0.96 0.006 250)",
  "--destructive": "oklch(0.66 0.18 22)",
  "--border": "oklch(0.86 0.02 250 / 11%)",
  "--input": "oklch(0.86 0.02 250 / 16%)",
  "--ring": "oklch(0.806 0.118 78 / 55%)",
  "--ink-0": "#10131a",
  "--ink-1": "#161a22",
  "--ink-2": "#1c212b",
  "--ink-3": "#232a36",
  "--line": "#2a323f",
  "--line-soft": "#222934",
  "--text-0": "#e7ecf3",
  "--text-1": "#aab6c6",
  "--text-2": "#76828f",
  "--brass": "#d9b066",
  "--brass-dim": "#b8944f",
  "--st-diff": "#e6b766",
  "--st-only": "#84a9e0",
  "--st-same": "#7fc69a",
  "--danger": "#ef9a9a",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<const T extends readonly (number | string)[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function normalizeFontFamily(value: unknown, availableFonts?: readonly string[]): string {
  const candidate = stringValue(value, DEFAULT_EDITOR_FONT_FAMILY);
  if (!availableFonts || availableFonts.length === 0) {
    return candidate;
  }
  return availableFonts.includes(candidate) ? candidate : DEFAULT_EDITOR_FONT_FAMILY;
}

function migrateOldFontFamily(typography: Record<string, unknown>): string | undefined {
  if (typography.editorFont === "systemMono") {
    return SYSTEM_MONO_FONT_FAMILY;
  }
  if (typography.editorFont === "jetbrainsMono") {
    return DEFAULT_EDITOR_FONT_FAMILY;
  }
  return undefined;
}

export function normalizeUiPreferences(
  raw: unknown,
  availableFonts?: readonly string[],
): UiPreferences {
  const input = isRecord(raw) ? raw : {};
  const appearance = isRecord(input.appearance) ? input.appearance : {};
  const editor = isRecord(input.editor) ? input.editor : {};
  const typography = isRecord(input.typography) ? input.typography : {};
  const misc = isRecord(input.misc) ? input.misc : {};
  const oldSearch = isRecord(input.search) ? input.search : {};
  const search = isRecord(misc.search) ? misc.search : oldSearch;
  const decompiler = isRecord(misc.decompiler) ? misc.decompiler : {};
  const save = isRecord(misc.save) ? misc.save : {};

  const oldColorPattern = appearance.colorMode === "light" || appearance.colorMode === "dark"
    ? appearance.colorMode
    : undefined;

  return {
    appearance: {
      colorPattern: enumValue(
        appearance.colorPattern ?? oldColorPattern,
        COLOR_PATTERNS,
        DEFAULT_UI_PREFERENCES.appearance.colorPattern,
      ),
    },
    editor: {
      fontFamily: normalizeFontFamily(
        editor.fontFamily ?? migrateOldFontFamily(typography),
        availableFonts,
      ),
      fontSize: enumValue(
        editor.fontSize ?? typography.editorScale,
        EDITOR_FONT_SIZES,
        DEFAULT_UI_PREFERENCES.editor.fontSize,
      ),
      wordWrap: enumValue(editor.wordWrap, TOGGLES, DEFAULT_UI_PREFERENCES.editor.wordWrap),
      lineNumbers: enumValue(
        editor.lineNumbers,
        TOGGLES,
        DEFAULT_UI_PREFERENCES.editor.lineNumbers,
      ),
      minimap: enumValue(editor.minimap, TOGGLES, DEFAULT_UI_PREFERENCES.editor.minimap),
    },
    misc: {
      search: {
        includeSourceByDefault: booleanValue(
          search.includeSourceByDefault,
          DEFAULT_UI_PREFERENCES.misc.search.includeSourceByDefault,
        ),
        resultGrouping: enumValue(
          search.resultGrouping,
          RESULT_GROUPINGS,
          DEFAULT_UI_PREFERENCES.misc.search.resultGrouping,
        ),
      },
      decompiler: {
        engine: enumValue(
          decompiler.engine,
          DECOMPILER_ENGINES,
          DEFAULT_UI_PREFERENCES.misc.decompiler.engine,
        ),
        ignoreTrimWhitespace: booleanValue(
          decompiler.ignoreTrimWhitespace,
          DEFAULT_UI_PREFERENCES.misc.decompiler.ignoreTrimWhitespace,
        ),
      },
      save: {
        backupEnabled: booleanValue(
          save.backupEnabled,
          DEFAULT_UI_PREFERENCES.misc.save.backupEnabled,
        ),
      },
    },
  };
}

export function mergeUiPreferences(raw: unknown): UiPreferences {
  return normalizeUiPreferences(raw);
}

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    return normalizeUiPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeUiPreferences(undefined);
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  localStorage.setItem(
    UI_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeUiPreferences(preferences)),
  );
}

export function effectiveColorPattern(
  colorPattern: ColorPattern,
  systemPrefersDark: boolean,
): EffectiveColorPattern {
  if (colorPattern === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return colorPattern;
}

export function variablesForEffectiveColorPattern(
  effectivePattern: EffectiveColorPattern,
): Record<string, string> {
  return effectivePattern === "light" ? lightVariables : darkVariables;
}

export function applyPreferencesToRoot(
  root: HTMLElement,
  preferences: UiPreferences,
  systemPrefersDark: boolean,
): void {
  const normalizedPreferences = normalizeUiPreferences(preferences);
  const effectivePattern = effectiveColorPattern(
    normalizedPreferences.appearance.colorPattern,
    systemPrefersDark,
  );

  root.dataset.colorPattern = normalizedPreferences.appearance.colorPattern;
  root.dataset.effectiveColorPattern = effectivePattern;

  for (const [name, value] of Object.entries(variablesForEffectiveColorPattern(effectivePattern))) {
    root.style.setProperty(name, value);
  }

  root.style.removeProperty("--font-sans");
  root.style.removeProperty("--font-tree");
  root.style.removeProperty("--font-mono");
  root.style.removeProperty("--lcdiff-ui-font-size");
  root.style.removeProperty("--lcdiff-tree-font-size");
  root.style.removeProperty("--lcdiff-editor-font-size");
}
```

- [ ] **Step 4: Run tests to verify preference contract passes**

Run:

```bash
rtk npm test -- src/lib/preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/preferences.ts src/lib/preferences.test.ts
rtk git commit -m "refactor(ui): simplify preferences contract"
```

## Task 2: Add Native System Font Enumeration

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/system_fonts.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add Rust tests for font normalization**

Create `src-tauri/src/system_fonts.rs` with this initial test-only body:

```rust
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    pub monospace_likely: bool,
}

pub fn monospace_likely(family: &str) -> bool {
    let lower = family.to_ascii_lowercase();
    [
        "mono",
        "code",
        "console",
        "terminal",
        "menlo",
        "consolas",
        "courier",
        "cascadia",
        "sfmono",
        "sf mono",
    ]
    .iter()
    .any(|hint| lower.contains(hint))
}

pub fn normalize_font_families<I, S>(families: I) -> Vec<SystemFont>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut fonts = families
        .into_iter()
        .filter_map(|family| {
            let family = family.as_ref().trim();
            if family.is_empty() {
                return None;
            }
            Some(SystemFont {
                family: family.to_owned(),
                monospace_likely: monospace_likely(family),
            })
        })
        .collect::<Vec<_>>();

    fonts.sort_by(|a, b| {
        b.monospace_likely
            .cmp(&a.monospace_likely)
            .then_with(|| a.family.to_ascii_lowercase().cmp(&b.family.to_ascii_lowercase()))
    });
    fonts.dedup_by(|a, b| a.family.eq_ignore_ascii_case(&b.family));
    fonts
}

#[cfg(test)]
mod tests {
    use super::{monospace_likely, normalize_font_families};

    #[test]
    fn classifies_common_monospace_family_names() {
        assert!(monospace_likely("JetBrains Mono"));
        assert!(monospace_likely("Menlo"));
        assert!(monospace_likely("Cascadia Code"));
        assert!(!monospace_likely("Helvetica Neue"));
    }

    #[test]
    fn normalizes_fonts_with_monospace_first_and_unique_families() {
        let fonts = normalize_font_families([
            "Helvetica Neue",
            "Menlo",
            "menlo",
            "",
            "Cascadia Code",
            "Arial",
        ]);

        assert_eq!(
            fonts.iter().map(|font| font.family.as_str()).collect::<Vec<_>>(),
            ["Cascadia Code", "Menlo", "Arial", "Helvetica Neue"]
        );
        assert!(fonts[0].monospace_likely);
        assert!(fonts[1].monospace_likely);
        assert!(!fonts[2].monospace_likely);
    }
}
```

- [ ] **Step 2: Wire module into tests and run**

Add this near the existing `mod sidecar_process;` in `src-tauri/src/main.rs`:

```rust
mod system_fonts;
```

Run:

```bash
rtk cargo test -p lcdiff-desktop system_fonts
```

Expected: PASS for the pure helper tests.

- [ ] **Step 3: Add `font-kit` dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
font-kit = "0.14.3"
```

- [ ] **Step 4: Add the Tauri command implementation**

Append this to `src-tauri/src/system_fonts.rs` above the test module:

```rust
#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    let families = font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| format!("failed to list system fonts: {error}"))?;
    Ok(normalize_font_families(families))
}
```

- [ ] **Step 5: Register command in `main.rs`**

Update the imports after `use sidecar_process::SidecarClient;`:

```rust
use sidecar_process::SidecarClient;
use system_fonts::list_system_fonts;
```

Add `list_system_fonts` to the `tauri::generate_handler!` list after `platform_hints`:

```rust
        .invoke_handler(tauri::generate_handler![
            validate_path,
            platform_hints,
            list_system_fonts,
            open_archive,
            compute_diff,
            compute_nested_diff,
            read_entry,
            set_engine,
            disassemble,
            stage_copy,
            stage_write,
            commit_merge,
            clear_staged,
            unstage,
            search,
            deep_search,
            cancel_deep_search,
            prefetch_siblings
        ])
```

- [ ] **Step 6: Run Rust checks for desktop crate**

Run:

```bash
rtk cargo fmt --all -- --check
rtk cargo test -p lcdiff-desktop system_fonts
rtk cargo check -p lcdiff-desktop
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/src/system_fonts.rs Cargo.lock
rtk git commit -m "feat(desktop): expose installed fonts"
```

## Task 3: Add Frontend Font Helpers

**Files:**
- Create: `src/lib/system-fonts.ts`
- Create: `src/lib/system-fonts.test.ts`

- [ ] **Step 1: Write failing frontend font-helper tests**

Create `src/lib/system-fonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FALLBACK_SYSTEM_FONTS,
  normalizeSystemFonts,
  type SystemFont,
} from "@/lib/system-fonts";

describe("system font helpers", () => {
  it("sorts monospace fonts first and removes duplicate families", () => {
    const fonts: SystemFont[] = [
      { family: "Helvetica Neue", monospaceLikely: false },
      { family: "Menlo", monospaceLikely: true },
      { family: "menlo", monospaceLikely: true },
      { family: "Arial", monospaceLikely: false },
    ];

    expect(normalizeSystemFonts(fonts).map((font) => font.family)).toEqual([
      "Menlo",
      "Arial",
      "Helvetica Neue",
    ]);
  });

  it("uses fallback choices when native enumeration returns nothing", () => {
    expect(normalizeSystemFonts([])).toEqual(FALLBACK_SYSTEM_FONTS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm test -- src/lib/system-fonts.test.ts
```

Expected: FAIL because `src/lib/system-fonts.ts` does not exist.

- [ ] **Step 3: Create the font helper**

Create `src/lib/system-fonts.ts`:

```ts
import {
  DEFAULT_EDITOR_FONT_FAMILY,
  SYSTEM_MONO_FONT_FAMILY,
  SYSTEM_SANS_FONT_FAMILY,
} from "@/lib/preferences";

export interface SystemFont {
  family: string;
  monospaceLikely: boolean;
}

export const FALLBACK_SYSTEM_FONTS: SystemFont[] = [
  { family: DEFAULT_EDITOR_FONT_FAMILY, monospaceLikely: true },
  { family: SYSTEM_MONO_FONT_FAMILY, monospaceLikely: true },
  { family: SYSTEM_SANS_FONT_FAMILY, monospaceLikely: false },
];

export function normalizeSystemFonts(fonts: readonly SystemFont[]): SystemFont[] {
  const byFamily = new Map<string, SystemFont>();
  for (const font of fonts) {
    const family = font.family.trim();
    if (!family) continue;
    const key = family.toLocaleLowerCase();
    if (!byFamily.has(key)) {
      byFamily.set(key, { family, monospaceLikely: font.monospaceLikely });
    }
  }

  const normalized = Array.from(byFamily.values()).sort((a, b) => {
    if (a.monospaceLikely !== b.monospaceLikely) {
      return a.monospaceLikely ? -1 : 1;
    }
    return a.family.localeCompare(b.family, undefined, { sensitivity: "base" });
  });

  return normalized.length > 0 ? normalized : [...FALLBACK_SYSTEM_FONTS];
}

export function fontFamilies(fonts: readonly SystemFont[]): string[] {
  return fonts.map((font) => font.family);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
rtk npm test -- src/lib/system-fonts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/system-fonts.ts src/lib/system-fonts.test.ts
rtk git commit -m "feat(ui): normalize system fonts"
```

## Task 4: Split Preferences Drawer Components

**Files:**
- Create: `src/components/preferences/AppearancePreferences.tsx`
- Create: `src/components/preferences/EditorPreferences.tsx`
- Create: `src/components/preferences/MiscPreferences.tsx`
- Modify: `src/components/ConfigDrawer.tsx`
- Modify: `src/components/ConfigDrawer.test.tsx`

- [ ] **Step 1: Replace drawer tests with the new IA tests**

Replace `src/components/ConfigDrawer.test.tsx` with:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FALLBACK_SYSTEM_FONTS } from "@/lib/system-fonts";

Object.assign(window.HTMLElement.prototype, {
  hasPointerCapture: vi.fn(() => false),
  scrollIntoView: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

function setup(overrides = {}) {
  const props = {
    open: true,
    mode: "compare" as const,
    preferences: DEFAULT_UI_PREFERENCES,
    systemFonts: FALLBACK_SYSTEM_FONTS,
    fontStatus: "ready" as const,
    onLoadSystemFonts: vi.fn(),
    onPreferencesChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><ConfigDrawer {...props} /></TooltipProvider>);
  return props;
}

describe("ConfigDrawer", () => {
  it("renders nothing actionable when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
  });

  it("renders only Appearance, Editor, and Misc as top-level sections", () => {
    setup();

    const nav = screen.getByRole("navigation", { name: "Preference categories" });
    expect(within(nav).getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-pressed", "true");
    expect(within(nav).getByRole("button", { name: "Editor" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Misc" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Typography" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Decompiler" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("changes Appearance color pattern", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(props.onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "light" },
    });
  });

  it("loads system fonts when Editor is opened and changes editor font size", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(props.onLoadSystemFonts).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("Editor font size"));
    await userEvent.click(within(screen.getByRole("listbox")).getByText("16"));

    expect(props.onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({
      editor: expect.objectContaining({ fontSize: 16 }),
    }));
  });

  it("shows fallback state when native font enumeration fails", async () => {
    setup({ fontStatus: "fallback" });

    await userEvent.click(screen.getByRole("button", { name: "Editor" }));

    expect(screen.getByText("Using bundled fallback fonts")).toBeInTheDocument();
  });

  it("renders Misc segmented controls and keeps Save visible in single mode", async () => {
    setup({ mode: "single" });

    await userEvent.click(screen.getByRole("button", { name: "Misc" }));

    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Decompiler" }));
    expect(screen.getByLabelText("Decompiler engine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Keep one overwritten .bak on save")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run drawer tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: FAIL because the component props and top-level sections are still old.

- [ ] **Step 3: Create `AppearancePreferences`**

Create `src/components/preferences/AppearancePreferences.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import type { ColorPattern, UiPreferences } from "@/lib/preferences";

interface AppearancePreferencesProps {
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

const patterns: Array<{ id: ColorPattern; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function AppearancePreferences({
  preferences,
  onPreferencesChange,
}: AppearancePreferencesProps) {
  return (
    <section className="drawer-group" aria-label="Appearance preferences">
      <span className="zone-label">Appearance</span>
      <div className="theme-grid">
        {patterns.map((pattern) => (
          <Button
            key={pattern.id}
            type="button"
            variant={preferences.appearance.colorPattern === pattern.id ? "secondary" : "outline"}
            size="sm"
            aria-pressed={preferences.appearance.colorPattern === pattern.id}
            onClick={() => onPreferencesChange({
              ...preferences,
              appearance: { colorPattern: pattern.id },
            })}
          >
            {pattern.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `EditorPreferences`**

Create `src/components/preferences/EditorPreferences.tsx`:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EDITOR_FONT_SIZES, type Toggle, type UiPreferences } from "@/lib/preferences";
import type { SystemFont } from "@/lib/system-fonts";

interface EditorPreferencesProps {
  preferences: UiPreferences;
  systemFonts: SystemFont[];
  fontStatus: "idle" | "loading" | "ready" | "fallback";
  onLoadSystemFonts: () => void;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

function toggleValue(checked: boolean): Toggle {
  return checked ? "on" : "off";
}

export function EditorPreferences({
  preferences,
  systemFonts,
  fontStatus,
  onLoadSystemFonts,
  onPreferencesChange,
}: EditorPreferencesProps) {
  const updateEditor = (editor: UiPreferences["editor"]) =>
    onPreferencesChange({ ...preferences, editor });

  return (
    <section className="drawer-group" aria-label="Editor preferences">
      <span className="zone-label">Editor</span>
      {fontStatus === "fallback" && (
        <p className="preference-note">Using bundled fallback fonts</p>
      )}
      {fontStatus === "loading" && (
        <p className="preference-note">Loading installed fonts...</p>
      )}
      <Select
        value={preferences.editor.fontFamily}
        onOpenChange={(open) => open && onLoadSystemFonts()}
        onValueChange={(fontFamily) => updateEditor({ ...preferences.editor, fontFamily })}
      >
        <SelectTrigger aria-label="Editor font family"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {systemFonts.map((font) => (
              <SelectItem key={font.family} value={font.family}>
                {font.family}{font.monospaceLikely ? " · mono" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={String(preferences.editor.fontSize)}
        onValueChange={(value) => updateEditor({
          ...preferences.editor,
          fontSize: Number(value) as UiPreferences["editor"]["fontSize"],
        })}
      >
        <SelectTrigger aria-label="Editor font size"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {EDITOR_FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <label className="check-label">
        <Checkbox
          checked={preferences.editor.wordWrap === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            wordWrap: toggleValue(checked === true),
          })}
        />
        Word wrap
      </label>
      <label className="check-label">
        <Checkbox
          checked={preferences.editor.lineNumbers === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            lineNumbers: toggleValue(checked === true),
          })}
        />
        Line numbers
      </label>
      <label className="check-label">
        <Checkbox
          checked={preferences.editor.minimap === "on"}
          onCheckedChange={(checked) => updateEditor({
            ...preferences.editor,
            minimap: toggleValue(checked === true),
          })}
        />
        Minimap
      </label>
    </section>
  );
}
```

- [ ] **Step 5: Create `MiscPreferences`**

Create `src/components/preferences/MiscPreferences.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UiPreferences } from "@/lib/preferences";

type MiscPanel = "search" | "decompiler" | "save";

interface MiscPreferencesProps {
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
}

export function MiscPreferences({ preferences, onPreferencesChange }: MiscPreferencesProps) {
  const [panel, setPanel] = useState<MiscPanel>("search");
  const updateMisc = (misc: UiPreferences["misc"]) => onPreferencesChange({ ...preferences, misc });

  return (
    <section className="drawer-group" aria-label="Misc preferences">
      <span className="zone-label">Misc</span>
      <div className="segmented-control" role="group" aria-label="Misc categories">
        {(["search", "decompiler", "save"] as const).map((id) => (
          <Button
            key={id}
            type="button"
            variant={panel === id ? "secondary" : "outline"}
            size="sm"
            aria-pressed={panel === id}
            onClick={() => setPanel(id)}
          >
            {id === "search" ? "Search" : id === "decompiler" ? "Decompiler" : "Save"}
          </Button>
        ))}
      </div>

      {panel === "search" && (
        <>
          <label className="check-label">
            <Checkbox
              checked={preferences.misc.search.includeSourceByDefault}
              onCheckedChange={(checked) => updateMisc({
                ...preferences.misc,
                search: {
                  ...preferences.misc.search,
                  includeSourceByDefault: checked === true,
                },
              })}
            />
            Include source by default
          </label>
          <Select
            value={preferences.misc.search.resultGrouping}
            onValueChange={(value) => updateMisc({
              ...preferences.misc,
              search: {
                ...preferences.misc.search,
                resultGrouping: value as UiPreferences["misc"]["search"]["resultGrouping"],
              },
            })}
          >
            <SelectTrigger aria-label="Search result grouping"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="kind">By kind</SelectItem>
              <SelectItem value="side">By side</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </>
      )}

      {panel === "decompiler" && (
        <>
          <Select
            value={preferences.misc.decompiler.engine}
            onValueChange={(value) => updateMisc({
              ...preferences.misc,
              decompiler: {
                ...preferences.misc.decompiler,
                engine: value as UiPreferences["misc"]["decompiler"]["engine"],
              },
            })}
          >
            <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="vineflower">Vineflower</SelectItem>
              <SelectItem value="cfr">CFR</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
          <label className="check-label">
            <Checkbox
              checked={preferences.misc.decompiler.ignoreTrimWhitespace}
              onCheckedChange={(checked) => updateMisc({
                ...preferences.misc,
                decompiler: {
                  ...preferences.misc.decompiler,
                  ignoreTrimWhitespace: checked === true,
                },
              })}
            />
            Ignore trim whitespace
          </label>
        </>
      )}

      {panel === "save" && (
        <label className="check-label">
          <Checkbox
            checked={preferences.misc.save.backupEnabled}
            onCheckedChange={(checked) => updateMisc({
              ...preferences.misc,
              save: {
                backupEnabled: checked === true,
              },
            })}
          />
          Keep one overwritten .bak on save
        </label>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Replace `ConfigDrawer` shell**

Replace `src/components/ConfigDrawer.tsx` with:

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import { AppearancePreferences } from "@/components/preferences/AppearancePreferences";
import { EditorPreferences } from "@/components/preferences/EditorPreferences";
import { MiscPreferences } from "@/components/preferences/MiscPreferences";
import { Button } from "@/components/ui/button";
import type { UiPreferences } from "@/lib/preferences";
import type { SystemFont } from "@/lib/system-fonts";
import type { Mode } from "@/lib/types";

type Section = "appearance" | "editor" | "misc";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  preferences: UiPreferences;
  systemFonts: SystemFont[];
  fontStatus: "idle" | "loading" | "ready" | "fallback";
  onLoadSystemFonts: () => void;
  onPreferencesChange: (preferences: UiPreferences) => void;
  onClose: () => void;
}

const sections: Array<{ id: Section; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "misc", label: "Misc" },
];

export function ConfigDrawer({
  open,
  mode: _mode,
  preferences,
  systemFonts,
  fontStatus,
  onLoadSystemFonts,
  onPreferencesChange,
  onClose,
}: ConfigDrawerProps) {
  const [section, setSection] = useState<Section>("appearance");
  if (!open) return null;

  return (
    <aside className="config-drawer open preferences-drawer" role="dialog" aria-modal="false" aria-label="Preferences">
      <header className="preferences-header">
        <div>
          <strong>Preferences</strong>
          <span>Shape the workspace without changing project data.</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close preferences" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="preferences-body">
        <nav className="preferences-nav" aria-label="Preference categories">
          {sections.map((item) => (
            <Button
              key={item.id}
              variant={section === item.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={section === item.id}
              onClick={() => {
                setSection(item.id);
                if (item.id === "editor") onLoadSystemFonts();
              }}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="preferences-content">
          {section === "appearance" && (
            <AppearancePreferences
              preferences={preferences}
              onPreferencesChange={onPreferencesChange}
            />
          )}
          {section === "editor" && (
            <EditorPreferences
              preferences={preferences}
              systemFonts={systemFonts}
              fontStatus={fontStatus}
              onLoadSystemFonts={onLoadSystemFonts}
              onPreferencesChange={onPreferencesChange}
            />
          )}
          {section === "misc" && (
            <MiscPreferences
              preferences={preferences}
              onPreferencesChange={onPreferencesChange}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Add compact CSS for Misc segmented control and notes**

Append near existing Preferences CSS in `src/styles.css`:

```css
.segmented-control {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.segmented-control button {
  min-width: 0;
}

.preference-note {
  margin: 0;
  color: var(--text-2);
  font-size: 0.7rem;
  line-height: 1.45;
}
```

- [ ] **Step 8: Run drawer tests**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/components/preferences/AppearancePreferences.tsx src/components/preferences/EditorPreferences.tsx src/components/preferences/MiscPreferences.tsx src/styles.css
rtk git commit -m "refactor(ui): restructure preferences drawer"
```

## Task 5: Apply Editor Preferences to Monaco Only

**Files:**
- Create: `src/components/DiffView.test.tsx`
- Modify: `src/components/DiffView.tsx`

- [ ] **Step 1: Add failing Monaco option tests**

Create `src/components/DiffView.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffView } from "@/components/DiffView";
import { DEFAULT_UI_PREFERENCES, type EffectiveColorPattern, type UiPreferences } from "@/lib/preferences";

const captured: Array<{ kind: "editor" | "diff"; props: Record<string, unknown> }> = [];

vi.mock("@monaco-editor/react", () => ({
  default: (props: Record<string, unknown>) => {
    captured.push({ kind: "editor", props });
    return <div data-testid="editor" />;
  },
  DiffEditor: (props: Record<string, unknown>) => {
    captured.push({ kind: "diff", props });
    return <div data-testid="diff-editor" />;
  },
}));

function renderDiffView(
  mode: "single" | "compare",
  preferences: UiPreferences,
  effectivePattern: EffectiveColorPattern = "dark",
) {
  captured.length = 0;
  render(
    <DiffView
      mode={mode}
      selected={{ left: { path: "A.java", kind: "class" }, right: { path: "A.java", kind: "class" } }}
      preview={{ left: { content: "class A {}", language: "java" }, right: { content: "class A {}", language: "java" } }}
      preferences={preferences}
      effectiveColorPattern={effectivePattern}
      ignoreTrimWhitespace
      onCopy={vi.fn()}
      onEditorMount={vi.fn()}
      onDiffMount={vi.fn()}
      editable={false}
      editValue=""
      onEditChange={vi.fn()}
      onEditBlur={vi.fn()}
      fileMerge={false}
      hunkMerge={false}
      onDiffEditEither={vi.fn()}
      onTakeAll={vi.fn()}
      onMoveHunk={vi.fn()}
    />,
  );
}

describe("DiffView preferences", () => {
  it("passes editor font family and size to single Monaco editor options", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: { colorPattern: "light" },
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Menlo",
        fontSize: 16,
      },
    };

    renderDiffView("single", preferences, "light");

    expect(captured[0].kind).toBe("editor");
    expect(captured[0].props.theme).toBe("light");
    expect(captured[0].props.options).toMatchObject({
      fontFamily: "Menlo",
      fontSize: 16,
    });
  });

  it("passes editor font family and size to Monaco diff editor options", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Cascadia Code",
        fontSize: 15,
      },
    };

    renderDiffView("compare", preferences, "dark");

    expect(captured[0].kind).toBe("diff");
    expect(captured[0].props.theme).toBe("vs-dark");
    expect(captured[0].props.options).toMatchObject({
      fontFamily: "Cascadia Code",
      fontSize: 15,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx
```

Expected: FAIL because `DiffView` does not accept `effectiveColorPattern` and still reads `preferences.appearance.colorMode` and `preferences.typography.editorScale`.

- [ ] **Step 3: Update `DiffView` preference usage**

In `src/components/DiffView.tsx`, update the preferences import:

```ts
import type { EffectiveColorPattern, UiPreferences } from "@/lib/preferences";
```

Add this field to `DiffViewProps`:

```ts
  effectiveColorPattern: EffectiveColorPattern;
```

Add it to the component destructuring:

```ts
  mode, selected, preview, preferences, effectiveColorPattern, ignoreTrimWhitespace,
```

Then replace:

```ts
  const monacoTheme = preferences.appearance.colorMode === "light" ? "light" : "vs-dark";
  const editorOptions = {
    fontFamily: "var(--font-mono)",
    fontSize: preferences.typography.editorScale,
```

with:

```ts
  const monacoTheme = effectiveColorPattern === "light" ? "light" : "vs-dark";
  const editorOptions = {
    fontFamily: preferences.editor.fontFamily,
    fontSize: preferences.editor.fontSize,
```

The final `editorOptions` block must still include:

```ts
    minimap: { enabled: preferences.editor.minimap === "on" },
    wordWrap: preferences.editor.wordWrap,
    lineNumbers: preferences.editor.lineNumbers,
    automaticLayout: true,
```

- [ ] **Step 4: Run tests**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/components/DiffView.tsx src/components/DiffView.test.tsx
rtk git commit -m "feat(ui): apply editor font to Monaco"
```

## Task 6: Wire Preferences Through App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update App tests for new preference behavior**

In `src/App.test.tsx`, update the existing "applies persisted UI preferences to the app shell" test to:

```tsx
  it("applies persisted Appearance preferences to the app shell", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lcdiff.uiPreferences.v1", JSON.stringify({
      appearance: { colorPattern: "light" },
      editor: { fontFamily: "Menlo", fontSize: 15 },
    }));

    render(<App />);
    await user.click(screen.getByText("Compare / Merge"));

    const shell = await screen.findByRole("main");
    await waitFor(() => expect(shell.dataset.colorPattern).toBe("light"));
    expect(shell.dataset.effectiveColorPattern).toBe("light");
    expect(shell.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("");
  });
```

Add this new test near the Preferences toggle tests:

```tsx
  it("loads installed fonts when Editor preferences open", async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByText("Compare / Merge"));
    await user.click(screen.getByLabelText("Preferences"));
    await user.click(screen.getByRole("button", { name: "Editor" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_system_fonts"));
    await user.click(screen.getByLabelText("Editor font family"));
    expect(await screen.findByText(/Menlo/)).toBeInTheDocument();
  });
```

Add this case to the central `invoke` switch near `platform_hints`:

```ts
    case "list_system_fonts":
      return [
        { family: "Menlo", monospaceLikely: true },
        { family: "Helvetica Neue", monospaceLikely: false },
      ];
```

- [ ] **Step 2: Run App tests to verify failures**

Run:

```bash
rtk npm test -- src/App.test.tsx
```

Expected: FAIL because `App` still passes old `ConfigDrawer` props and old preference paths.

- [ ] **Step 3: Add system font state and loader to `App.tsx`**

Update imports in `src/App.tsx`:

```ts
import {
  applyPreferencesToRoot,
  effectiveColorPattern,
  loadUiPreferences,
  normalizeUiPreferences,
  saveUiPreferences,
} from "@/lib/preferences";
import {
  FALLBACK_SYSTEM_FONTS,
  fontFamilies,
  normalizeSystemFonts,
  type SystemFont,
} from "@/lib/system-fonts";
```

Remove `DEFAULT_ENGINE` from the `@/lib/types` import. Remove `Engine` from that import once no explicit `Engine` annotation remains in `App.tsx`.

Add state near existing preference state:

```ts
  const [preferences, setPreferences] = useState(loadUiPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>(FALLBACK_SYSTEM_FONTS);
  const [fontStatus, setFontStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
```

Remove separate state declarations for:

```ts
  const [engine, setEngine] = useState<Engine>(DEFAULT_ENGINE);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(true);
```

Replace them with derived constants after state declarations:

```ts
  const engine = preferences.misc.decompiler.engine;
  const backupEnabled = preferences.misc.save.backupEnabled;
  const ignoreTrimWhitespace = preferences.misc.decompiler.ignoreTrimWhitespace;
  const activeColorPattern = effectiveColorPattern(
    preferences.appearance.colorPattern,
    systemPrefersDark,
  );
```

Add a system color listener effect:

```ts
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const updateSystemPreference = () => setSystemPrefersDark(query.matches);
    updateSystemPreference();
    query.addEventListener("change", updateSystemPreference);
    return () => query.removeEventListener("change", updateSystemPreference);
  }, []);
```

Update the existing apply/save preferences effect:

```ts
  useEffect(() => {
    const normalized = normalizeUiPreferences(preferences, fontFamilies(systemFonts));
    if (normalized !== preferences && JSON.stringify(normalized) !== JSON.stringify(preferences)) {
      setPreferences(normalized);
      return;
    }
    saveUiPreferences(normalized);
    if (appShellRef.current) applyPreferencesToRoot(appShellRef.current, normalized, systemPrefersDark);
  }, [preferences, systemFonts, systemPrefersDark, view]);
```

Add font loader:

```ts
  const loadSystemFonts = useCallback(async () => {
    if (fontStatus === "loading" || fontStatus === "ready") return;
    setFontStatus("loading");
    try {
      const fonts = normalizeSystemFonts(await invoke<SystemFont[]>("list_system_fonts"));
      setSystemFonts(fonts);
      setFontStatus("ready");
    } catch {
      setSystemFonts(FALLBACK_SYSTEM_FONTS);
      setFontStatus("fallback");
    }
  }, [fontStatus]);
```

- [ ] **Step 4: Update preference-dependent state paths**

Replace:

```ts
  const [includeSourceSearch, setIncludeSourceSearch] = useState(preferences.search.includeSourceByDefault);
```

with:

```ts
  const [includeSourceSearch, setIncludeSourceSearch] = useState(
    preferences.misc.search.includeSourceByDefault,
  );
```

Replace the effect dependency and body:

```ts
  useEffect(() => {
    setIncludeSourceSearch(preferences.search.includeSourceByDefault);
  }, [preferences.search.includeSourceByDefault]);
```

with:

```ts
  useEffect(() => {
    setIncludeSourceSearch(preferences.misc.search.includeSourceByDefault);
  }, [preferences.misc.search.includeSourceByDefault]);
```

Replace `preferences.search.resultGrouping` with:

```ts
preferences.misc.search.resultGrouping
```

Replace `preferences.appearance.motion` used by `SplashScreen` with the fixed standard motion value:

```tsx
        motion="standard"
```

- [ ] **Step 5: Update ConfigDrawer render in App**

Replace the `ConfigDrawer` props block with:

```tsx
        <ConfigDrawer
          open={drawerOpen}
          mode={mode}
          preferences={preferences}
          systemFonts={systemFonts}
          fontStatus={fontStatus}
          onLoadSystemFonts={loadSystemFonts}
          onPreferencesChange={setPreferences}
          onClose={() => setDrawerOpen(false)}
        />
```

Add `effectiveColorPattern` to the `DiffView` render in `src/App.tsx`:

```tsx
              <DiffView
                mode={mode}
                selected={selected}
                preview={preview}
                preferences={preferences}
                effectiveColorPattern={activeColorPattern}
                ignoreTrimWhitespace={ignoreTrimWhitespace}
                onCopy={(from, to) => void copy(from, to)}
                onEditorMount={handleEditorMount}
                onDiffMount={handleDiffMount}
                editable={isEditableEntry}
                editValue={editBuffer}
                onEditChange={(value) => setEditBuffer(value ?? "")}
                onEditBlur={(content) => selected && void stageEdit(selected.path, content)}
                fileMerge={isFileMerge}
                hunkMerge={isTextMerge}
                onDiffEditEither={(side, content) => void stageFileSide(side, content)}
                onTakeAll={(t) => void takeAllTo(t)}
                onMoveHunk={(t) => void moveHunkTo(t)}
              />
```

- [ ] **Step 6: Keep Tauri decompiler engine synchronized**

Keep the existing `set_engine` invoke behavior by adding this effect near other preference effects:

```ts
  useEffect(() => {
    invoke("set_engine", { engine }).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, [engine]);
```

Remove old `onEngineChange`, `onIgnoreWhitespaceChange`, and `onBackupEnabledChange` handler props from `ConfigDrawer` usage. Preferences are the single source of truth for these values.

- [ ] **Step 7: Run focused App tests**

Run:

```bash
rtk npm test -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/App.tsx src/App.test.tsx
rtk git commit -m "feat(ui): wire preferences through app"
```

## Task 7: Clean Up Old Theme Catalog References

**Files:**
- Delete: `src/lib/themes.ts`
- Delete: `src/lib/themes.test.ts`
- Modify imports that reference `@/lib/themes`

- [ ] **Step 1: Search old theme API references**

Run:

```bash
rtk rg -n "DEFAULT_THEME_ID|themeToCssVariables|listThemesByMode|getTheme|typography|colorMode|themeId|accent|uiScale|treeScale|editorScale" src
```

Expected: references remain only in `src/lib/themes.ts`, `src/lib/themes.test.ts`, and the old-name strings inside this cleanup task.

- [ ] **Step 2: Remove unused theme catalog**

Delete the old theme catalog files:

```bash
rtk git rm src/lib/themes.ts src/lib/themes.test.ts
```

- [ ] **Step 3: Run all frontend unit tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
rtk git add src
rtk git commit -m "refactor(ui): remove old theme catalog"
```

## Task 8: Update Docs and Render Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `scripts/verify-frontend-render.mjs`

- [ ] **Step 1: Update README Preferences wording**

In `README.md`, under the user-facing usage area after the Search/Save bullets, add:

```md
Preferences lets you switch between Light, Dark, and System appearance patterns,
choose installed editor fonts and font size for the diff panel, and set durable
Search, Decompiler, and Save defaults.
```

- [ ] **Step 2: Update architecture Preferences description**

In `docs/ARCHITECTURE.md`, replace the sentence fragment:

```md
a Preferences drawer for appearance,
typography, editor, search defaults, decompiler, and save options
```

with:

```md
a Preferences drawer organized into Appearance, Editor, and Misc sections, where
Appearance controls Light/Dark/System color pattern, Editor controls Monaco-only
font/display settings, and Misc groups Search, Decompiler, and Save defaults
```

- [ ] **Step 3: Update render verifier assertions**

In `scripts/verify-frontend-render.mjs`, immediately after this existing line:

```js
  if (preferencesBodyBox.y > preferencesHeaderBox.y + preferencesHeaderBox.height + 24) {
```

keep the existing excessive-gap check intact. Immediately after that check block, insert:

```js
  await preferencesDrawer.getByRole("button", { name: "Appearance" }).waitFor({ timeout: 5_000 });
  await preferencesDrawer.getByRole("button", { name: "Editor" }).waitFor({ timeout: 5_000 });
  await preferencesDrawer.getByRole("button", { name: "Misc" }).waitFor({ timeout: 5_000 });
  if (await preferencesDrawer.getByRole("button", { name: "Typography" }).count() !== 0) {
    throw new Error("preferences still exposes top-level Typography");
  }
  await preferencesDrawer.getByRole("button", { name: "Misc" }).click();
  await preferencesDrawer.getByRole("button", { name: "Search" }).waitFor({ timeout: 5_000 });
  await preferencesDrawer.getByRole("button", { name: "Decompiler" }).waitFor({ timeout: 5_000 });
  await preferencesDrawer.getByRole("button", { name: "Save" }).waitFor({ timeout: 5_000 });
```

- [ ] **Step 4: Run docs and render gates**

Run:

```bash
rtk npm run verify:frontend-render
rtk npm run verify:docs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add README.md docs/ARCHITECTURE.md scripts/verify-frontend-render.mjs
rtk git commit -m "docs: update preferences contract"
```

## Task 9: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
rtk npm test -- src/lib/preferences.test.ts src/lib/system-fonts.test.ts src/components/ConfigDrawer.test.tsx src/components/DiffView.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run Rust checks for desktop font command**

Run:

```bash
rtk cargo fmt --all -- --check
rtk cargo test -p lcdiff-desktop system_fonts
rtk cargo check -p lcdiff-desktop
```

Expected: PASS.

- [ ] **Step 3: Run umbrella frontend/repo gate**

Run:

```bash
rtk npm run verify:all
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
rtk git status --short --branch
```

Expected: only intentional committed branch changes plus pre-existing unrelated deletions under `platform-validation/` if they still exist.

- [ ] **Step 5: Stop and report**

Do not merge or push unless the user requests it. Report test evidence and mention any pre-existing dirty files that were not touched.
