# UI Preferences and Contextual Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable UI preferences, a curated theme/font customization system, a professional Preferences drawer, and tab-aware contextual search that separates Files-index search from current-diff find.

**Architecture:** Keep durable UI customization in focused frontend helper modules and local persistence behind a `UiPreferences` contract. Keep backend archive/search ownership in the Tauri adapter and tighten the search command boundary with typed options/results instead of string-only `matchKind`. Keep `App.tsx` as orchestration owner, but move reusable search/preference/theme behavior into `src/lib/*` and presentational components.

**Tech Stack:** React 19, TypeScript, shadcn/ui source components, Tailwind v4 CSS variables, Monaco via `@monaco-editor/react`, Tauri v2 IPC, Rust adapter tests in `src-tauri/src/main.rs`, Vitest + Testing Library.

---

## Scope Check

The approved spec covers one coherent product slice: UI preferences and search UX. It touches frontend and the Tauri search adapter, but the backend change is limited to the search command contract. Do not change merge/save semantics, decompiler cache architecture, or `lcdiff-core` archive ownership.

## File Structure

- Create `src/lib/preferences.ts`
  - Owns `UiPreferences`, defaults, local-storage key, validation, `loadUiPreferences`, `saveUiPreferences`, `mergeUiPreferences`, and `applyPreferencesToRoot`.
- Create `src/lib/preferences.test.ts`
  - Tests default loading, persisted partial merge, unknown enum fallback, and root data attributes/CSS variables.
- Create `src/lib/themes.ts`
  - Owns curated theme registry, light/dark group helpers, accent presets, and CSS variable maps.
- Create `src/lib/themes.test.ts`
  - Tests light/dark catalog, known defaults, theme lookup, and required status color variables.
- Modify `src/lib/types.ts`
  - Add frontend search types: `SearchHitKind`, `SearchContext`, `SearchOptions`, `SearchResult`, `SearchTier`.
- Modify `src/lib/types.test.ts`
  - Add type-level/default search option assertions.
- Create `src/lib/search.ts`
  - Owns search result keying, grouping, labels, current-tab context helpers, and mapping from backend hits to frontend results.
- Create `src/lib/search.test.ts`
  - Tests grouping, keying, labels, and Files vs Current-diff context helpers.
- Modify `src-tauri/src/main.rs`
  - Replace implicit `search(side, query)` payload with typed `SearchOptions`.
  - Return typed `SearchHit { entry_path, kind, line, preview }`.
  - Preserve `deep_search` streaming/cancel behavior with `Source` hits.
- Modify `src/components/SearchBar.tsx`
  - Add context label, side scope, include source option, primary/secondary actions, and tree filter placement.
- Modify `src/components/SearchBar.test.tsx`
  - Replace old button-only tests with Files-index and Current-diff context tests.
- Create `src/components/SearchResultsPanel.tsx`
  - Renders grouped vertical result rows with side/kind badges, path, line, preview.
- Create `src/components/SearchResultsPanel.test.tsx`
  - Tests grouped rendering and row click behavior.
- Modify `src/components/ConfigDrawer.tsx`
  - Refactor into Preferences drawer with section navigation and durable preference controls only.
- Modify `src/components/ConfigDrawer.test.tsx`
  - Test closed state, section navigation, light/dark themes, typography controls, decompiler/save controls.
- Modify `src/components/DiffView.tsx`
  - Accept editor preferences for Monaco options and theme base.
- Modify `src/App.tsx`
  - Load/apply preferences, route Files-index search vs Current-diff find, aggregate backend search results, and pass props to new components.
- Modify `src/App.test.tsx`
  - Add app-level tests for contextual search behavior.
- Modify `src/styles.css`
  - Add preference-driven data-attribute rules, theme variables, Preferences drawer layout, Search command bar, grouped search results, density/radius/motion rules.
- Update docs/audit only if implementation changes product-visible behavior outside this plan.

---

### Task 1: Add Theme Registry

**Files:**
- Create: `src/lib/themes.ts`
- Create: `src/lib/themes.test.ts`

- [ ] **Step 1: Write failing theme registry tests**

Create `src/lib/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  getTheme,
  listThemesByMode,
  themeToCssVariables,
  THEMES,
} from "@/lib/themes";

describe("theme registry", () => {
  it("groups curated themes into light and dark sections", () => {
    expect(listThemesByMode("light").map((theme) => theme.id)).toEqual([
      "github-light",
      "vscode-light",
      "solarized-light",
      "catppuccin-latte",
      "gruvbox-light",
      "nord-light",
    ]);
    expect(listThemesByMode("dark").map((theme) => theme.id)).toEqual([
      "lcdiff-graphite",
      "github-dark",
      "one-dark",
      "dracula",
      "monokai",
      "solarized-dark",
      "tokyo-night",
      "catppuccin-mocha",
    ]);
  });

  it("uses LCDiff Graphite as the default dark theme", () => {
    expect(DEFAULT_THEME_ID).toBe("lcdiff-graphite");
    expect(getTheme(DEFAULT_THEME_ID).label).toBe("LCDiff Graphite");
  });

  it("falls back to default theme for unknown ids", () => {
    expect(getTheme("missing-theme").id).toBe(DEFAULT_THEME_ID);
  });

  it("exposes required app and status CSS variables for every theme", () => {
    for (const theme of THEMES) {
      const variables = themeToCssVariables(theme.id, "brass");
      expect(variables["--background"]).toBeTruthy();
      expect(variables["--foreground"]).toBeTruthy();
      expect(variables["--ink-0"]).toBeTruthy();
      expect(variables["--text-0"]).toBeTruthy();
      expect(variables["--st-diff"]).toBeTruthy();
      expect(variables["--st-only"]).toBeTruthy();
      expect(variables["--st-same"]).toBeTruthy();
      expect(variables["--danger"]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/lib/themes.test.ts
```

Expected: FAIL because `src/lib/themes.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/themes.ts`**

Create `src/lib/themes.ts`:

```ts
export type ColorMode = "light" | "dark";
export type AccentId = "brass" | "blue" | "green" | "violet" | "rose";

export interface ThemeDefinition {
  id: string;
  label: string;
  mode: ColorMode;
  official: boolean;
  variables: Record<string, string>;
}

export const DEFAULT_THEME_ID = "lcdiff-graphite";

const sharedStatus = {
  "--st-diff": "#d9a441",
  "--st-only": "#4d8fd7",
  "--st-same": "#57a773",
  "--danger": "#df6b6b",
};

const lightBase = {
  "--background": "oklch(0.985 0.004 250)",
  "--foreground": "oklch(0.18 0.018 250)",
  "--card": "oklch(0.965 0.006 250)",
  "--card-foreground": "oklch(0.18 0.018 250)",
  "--popover": "oklch(0.99 0.004 250)",
  "--popover-foreground": "oklch(0.18 0.018 250)",
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
  ...sharedStatus,
};

const darkBase = {
  "--background": "oklch(0.169 0.013 256)",
  "--foreground": "oklch(0.93 0.008 250)",
  "--card": "oklch(0.214 0.016 256)",
  "--card-foreground": "oklch(0.95 0.006 250)",
  "--popover": "oklch(0.205 0.016 256)",
  "--popover-foreground": "oklch(0.95 0.006 250)",
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
  ...sharedStatus,
};

export const ACCENTS: Record<AccentId, { primary: string; foreground: string; dim: string }> = {
  brass: { primary: "#d9b066", foreground: "#2b2110", dim: "#b8944f" },
  blue: { primary: "#5aa9e6", foreground: "#071a2a", dim: "#417ea9" },
  green: { primary: "#74c69d", foreground: "#092014", dim: "#4e9d76" },
  violet: { primary: "#a78bfa", foreground: "#1b1237", dim: "#7c61ce" },
  rose: { primary: "#fb7185", foreground: "#320d16", dim: "#c85065" },
};

export const THEMES: ThemeDefinition[] = [
  { id: "github-light", label: "GitHub Light inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#f6f8fa", "--ink-1": "#ffffff", "--line": "#d0d7de" } },
  { id: "vscode-light", label: "VS Code Light inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#f3f3f3", "--ink-1": "#ffffff", "--line": "#d4d4d4" } },
  { id: "solarized-light", label: "Solarized Light inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#fdf6e3", "--ink-1": "#eee8d5", "--text-0": "#073642", "--text-1": "#586e75" } },
  { id: "catppuccin-latte", label: "Catppuccin Latte inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#eff1f5", "--ink-1": "#e6e9ef", "--text-0": "#4c4f69", "--text-1": "#6c6f85" } },
  { id: "gruvbox-light", label: "Gruvbox Light inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#fbf1c7", "--ink-1": "#f2e5bc", "--text-0": "#3c3836", "--text-1": "#665c54" } },
  { id: "nord-light", label: "Nord Light inspired", mode: "light", official: false, variables: { ...lightBase, "--ink-0": "#eceff4", "--ink-1": "#e5e9f0", "--text-0": "#2e3440", "--text-1": "#4c566a" } },
  { id: "lcdiff-graphite", label: "LCDiff Graphite", mode: "dark", official: true, variables: darkBase },
  { id: "github-dark", label: "GitHub Dark inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#0d1117", "--ink-1": "#161b22", "--line": "#30363d", "--text-0": "#e6edf3" } },
  { id: "one-dark", label: "One Dark inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#1e222a", "--ink-1": "#282c34", "--text-0": "#abb2bf" } },
  { id: "dracula", label: "Dracula inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#282a36", "--ink-1": "#343746", "--text-0": "#f8f8f2", "--text-1": "#bd93f9" } },
  { id: "monokai", label: "Monokai inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#272822", "--ink-1": "#303128", "--text-0": "#f8f8f2", "--text-1": "#cfcfc2" } },
  { id: "solarized-dark", label: "Solarized Dark inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#002b36", "--ink-1": "#073642", "--text-0": "#eee8d5", "--text-1": "#93a1a1" } },
  { id: "tokyo-night", label: "Tokyo Night inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#1a1b26", "--ink-1": "#24283b", "--text-0": "#c0caf5", "--text-1": "#a9b1d6" } },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha inspired", mode: "dark", official: false, variables: { ...darkBase, "--ink-0": "#1e1e2e", "--ink-1": "#181825", "--text-0": "#cdd6f4", "--text-1": "#bac2de" } },
];

export function listThemesByMode(mode: ColorMode) {
  return THEMES.filter((theme) => theme.mode === mode);
}

export function getTheme(id: string) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
}

export function themeToCssVariables(themeId: string, accentId: AccentId) {
  const theme = getTheme(themeId);
  const accent = ACCENTS[accentId] ?? ACCENTS.brass;
  return {
    ...theme.variables,
    "--primary": accent.primary,
    "--primary-foreground": accent.foreground,
    "--brass": accent.primary,
    "--brass-dim": accent.dim,
  };
}
```

- [ ] **Step 4: Run theme tests**

Run:

```bash
rtk npm test -- src/lib/themes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/themes.ts src/lib/themes.test.ts
rtk git commit -m "feat: add curated UI theme registry"
```

---

### Task 2: Add UI Preferences Contract and Persistence

**Files:**
- Create: `src/lib/preferences.ts`
- Create: `src/lib/preferences.test.ts`

- [ ] **Step 1: Write failing preference tests**

Create `src/lib/preferences.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UI_PREFERENCES,
  applyPreferencesToRoot,
  loadUiPreferences,
  mergeUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
} from "@/lib/preferences";

describe("ui preferences", () => {
  beforeEach(() => localStorage.clear());

  it("loads defaults when storage is empty", () => {
    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("merges persisted partial values with defaults", () => {
    localStorage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ appearance: { colorMode: "light", themeId: "github-light" }, editor: { wordWrap: "on" } }),
    );
    expect(loadUiPreferences()).toMatchObject({
      appearance: { colorMode: "light", themeId: "github-light" },
      editor: { wordWrap: "on", lineNumbers: "on", minimap: "off" },
    });
  });

  it("drops unknown enum values", () => {
    const merged = mergeUiPreferences({
      appearance: { colorMode: "sepia", accent: "orange", density: "huge" },
      typography: { editorScale: 99, uiFont: "comic" },
    });
    expect(merged.appearance.colorMode).toBe(DEFAULT_UI_PREFERENCES.appearance.colorMode);
    expect(merged.appearance.accent).toBe(DEFAULT_UI_PREFERENCES.appearance.accent);
    expect(merged.appearance.density).toBe(DEFAULT_UI_PREFERENCES.appearance.density);
    expect(merged.typography.editorScale).toBe(DEFAULT_UI_PREFERENCES.typography.editorScale);
    expect(merged.typography.uiFont).toBe(DEFAULT_UI_PREFERENCES.typography.uiFont);
  });

  it("saves preferences as JSON", () => {
    saveUiPreferences({ ...DEFAULT_UI_PREFERENCES, appearance: { ...DEFAULT_UI_PREFERENCES.appearance, colorMode: "light" } });
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "{}").appearance.colorMode).toBe("light");
  });

  it("applies preferences as root attributes and CSS variables", () => {
    const root = document.createElement("main");
    applyPreferencesToRoot(root, {
      ...DEFAULT_UI_PREFERENCES,
      appearance: { ...DEFAULT_UI_PREFERENCES.appearance, density: "comfortable", radius: "soft", motion: "reduced" },
      typography: { ...DEFAULT_UI_PREFERENCES.typography, editorScale: 15 },
    });

    expect(root.dataset.colorMode).toBe("dark");
    expect(root.dataset.density).toBe("comfortable");
    expect(root.dataset.radius).toBe("soft");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("15px");
    expect(root.style.getPropertyValue("--background")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/lib/preferences.test.ts
```

Expected: FAIL because `src/lib/preferences.ts` does not exist.

- [ ] **Step 3: Implement preferences helper**

Create `src/lib/preferences.ts`:

```ts
import {
  type AccentId,
  type ColorMode,
  DEFAULT_THEME_ID,
  getTheme,
  themeToCssVariables,
} from "@/lib/themes";

export const UI_PREFERENCES_STORAGE_KEY = "lcdiff.uiPreferences.v1";

export type Density = "compact" | "comfortable";
export type Radius = "sharp" | "default" | "soft";
export type Motion = "reduced" | "standard";
export type IconLabels = "auto" | "always" | "iconsOnly";
export type FontId = "geist" | "bricolage" | "system";
export type MonoFontId = "jetbrainsMono" | "systemMono";
export type FontScale = 12 | 13 | 14 | 15 | 16;
export type Toggle = "on" | "off";
export type DrawerWidth = "default" | "wide";
export type ResultGrouping = "kind" | "side";

export interface UiPreferences {
  appearance: {
    colorMode: ColorMode;
    themeId: string;
    accent: AccentId;
    density: Density;
    radius: Radius;
    motion: Motion;
    iconLabels: IconLabels;
  };
  typography: {
    uiFont: FontId;
    treeFont: MonoFontId;
    editorFont: MonoFontId;
    uiScale: FontScale;
    treeScale: FontScale;
    editorScale: FontScale;
  };
  editor: {
    wordWrap: Toggle;
    lineNumbers: Toggle;
    minimap: Toggle;
  };
  layout: {
    preferencesDrawerWidth: DrawerWidth;
    searchResultsDensity: Density;
  };
  search: {
    includeSourceByDefault: boolean;
    resultGrouping: ResultGrouping;
  };
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  appearance: {
    colorMode: "dark",
    themeId: DEFAULT_THEME_ID,
    accent: "brass",
    density: "compact",
    radius: "default",
    motion: "standard",
    iconLabels: "auto",
  },
  typography: {
    uiFont: "geist",
    treeFont: "jetbrainsMono",
    editorFont: "jetbrainsMono",
    uiScale: 13,
    treeScale: 12,
    editorScale: 13,
  },
  editor: {
    wordWrap: "off",
    lineNumbers: "on",
    minimap: "off",
  },
  layout: {
    preferencesDrawerWidth: "default",
    searchResultsDensity: "compact",
  },
  search: {
    includeSourceByDefault: false,
    resultGrouping: "kind",
  },
};

const allowed = <T extends string | number>(value: unknown, values: readonly T[], fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const scales = [12, 13, 14, 15, 16] as const;

export function mergeUiPreferences(raw: unknown): UiPreferences {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const appearance = value.appearance && typeof value.appearance === "object" ? value.appearance as Record<string, unknown> : {};
  const typography = value.typography && typeof value.typography === "object" ? value.typography as Record<string, unknown> : {};
  const editor = value.editor && typeof value.editor === "object" ? value.editor as Record<string, unknown> : {};
  const layout = value.layout && typeof value.layout === "object" ? value.layout as Record<string, unknown> : {};
  const search = value.search && typeof value.search === "object" ? value.search as Record<string, unknown> : {};
  const colorMode = allowed(appearance.colorMode, ["light", "dark"] as const, DEFAULT_UI_PREFERENCES.appearance.colorMode);
  const theme = getTheme(typeof appearance.themeId === "string" ? appearance.themeId : DEFAULT_UI_PREFERENCES.appearance.themeId);
  const themeId = theme.mode === colorMode ? theme.id : DEFAULT_UI_PREFERENCES.appearance.themeId;

  return {
    appearance: {
      colorMode,
      themeId,
      accent: allowed(appearance.accent, ["brass", "blue", "green", "violet", "rose"] as const, DEFAULT_UI_PREFERENCES.appearance.accent),
      density: allowed(appearance.density, ["compact", "comfortable"] as const, DEFAULT_UI_PREFERENCES.appearance.density),
      radius: allowed(appearance.radius, ["sharp", "default", "soft"] as const, DEFAULT_UI_PREFERENCES.appearance.radius),
      motion: allowed(appearance.motion, ["reduced", "standard"] as const, DEFAULT_UI_PREFERENCES.appearance.motion),
      iconLabels: allowed(appearance.iconLabels, ["auto", "always", "iconsOnly"] as const, DEFAULT_UI_PREFERENCES.appearance.iconLabels),
    },
    typography: {
      uiFont: allowed(typography.uiFont, ["geist", "bricolage", "system"] as const, DEFAULT_UI_PREFERENCES.typography.uiFont),
      treeFont: allowed(typography.treeFont, ["jetbrainsMono", "systemMono"] as const, DEFAULT_UI_PREFERENCES.typography.treeFont),
      editorFont: allowed(typography.editorFont, ["jetbrainsMono", "systemMono"] as const, DEFAULT_UI_PREFERENCES.typography.editorFont),
      uiScale: allowed(typography.uiScale, scales, DEFAULT_UI_PREFERENCES.typography.uiScale),
      treeScale: allowed(typography.treeScale, scales, DEFAULT_UI_PREFERENCES.typography.treeScale),
      editorScale: allowed(typography.editorScale, scales, DEFAULT_UI_PREFERENCES.typography.editorScale),
    },
    editor: {
      wordWrap: allowed(editor.wordWrap, ["off", "on"] as const, DEFAULT_UI_PREFERENCES.editor.wordWrap),
      lineNumbers: allowed(editor.lineNumbers, ["off", "on"] as const, DEFAULT_UI_PREFERENCES.editor.lineNumbers),
      minimap: allowed(editor.minimap, ["off", "on"] as const, DEFAULT_UI_PREFERENCES.editor.minimap),
    },
    layout: {
      preferencesDrawerWidth: allowed(layout.preferencesDrawerWidth, ["default", "wide"] as const, DEFAULT_UI_PREFERENCES.layout.preferencesDrawerWidth),
      searchResultsDensity: allowed(layout.searchResultsDensity, ["compact", "comfortable"] as const, DEFAULT_UI_PREFERENCES.layout.searchResultsDensity),
    },
    search: {
      includeSourceByDefault: typeof search.includeSourceByDefault === "boolean" ? search.includeSourceByDefault : DEFAULT_UI_PREFERENCES.search.includeSourceByDefault,
      resultGrouping: allowed(search.resultGrouping, ["kind", "side"] as const, DEFAULT_UI_PREFERENCES.search.resultGrouping),
    },
  };
}

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    return mergeUiPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function saveUiPreferences(preferences: UiPreferences) {
  localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

const fontFamily = {
  geist: "\"Geist Variable\", ui-sans-serif, system-ui, sans-serif",
  bricolage: "\"Bricolage Grotesque Variable\", ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, sans-serif",
  jetbrainsMono: "\"JetBrains Mono Variable\", ui-monospace, monospace",
  systemMono: "ui-monospace, monospace",
};

export function applyPreferencesToRoot(root: HTMLElement, preferences: UiPreferences) {
  root.dataset.colorMode = preferences.appearance.colorMode;
  root.dataset.theme = preferences.appearance.themeId;
  root.dataset.density = preferences.appearance.density;
  root.dataset.radius = preferences.appearance.radius;
  root.dataset.motion = preferences.appearance.motion;
  root.dataset.iconLabels = preferences.appearance.iconLabels;
  root.dataset.drawerWidth = preferences.layout.preferencesDrawerWidth;
  root.dataset.searchResultsDensity = preferences.layout.searchResultsDensity;
  for (const [name, value] of Object.entries(themeToCssVariables(preferences.appearance.themeId, preferences.appearance.accent))) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("--font-sans", fontFamily[preferences.typography.uiFont]);
  root.style.setProperty("--font-tree", fontFamily[preferences.typography.treeFont]);
  root.style.setProperty("--font-mono", fontFamily[preferences.typography.editorFont]);
  root.style.setProperty("--lcdiff-ui-font-size", `${preferences.typography.uiScale}px`);
  root.style.setProperty("--lcdiff-tree-font-size", `${preferences.typography.treeScale}px`);
  root.style.setProperty("--lcdiff-editor-font-size", `${preferences.typography.editorScale}px`);
}
```

- [ ] **Step 4: Run preference tests**

Run:

```bash
rtk npm test -- src/lib/preferences.test.ts src/lib/themes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/preferences.ts src/lib/preferences.test.ts
rtk git commit -m "feat: add UI preferences persistence contract"
```

---

### Task 3: Add Typed Frontend Search Helpers

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/search.ts`
- Create: `src/lib/search.test.ts`

- [ ] **Step 1: Write failing search helper tests**

Create `src/lib/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  groupSearchResults,
  labelForSearchContext,
  labelForSearchKind,
  searchResultKey,
  searchContextForActiveTab,
} from "@/lib/search";
import type { SearchResult } from "@/lib/types";

const results: SearchResult[] = [
  { side: "left", path: "pkg/App.class", kind: "path", tier: "T2" },
  { side: "left", path: "pkg/App.class", kind: "constantPool", tier: "T2" },
  { side: "right", path: "config/app.properties", kind: "text", tier: "T2", line: 4, preview: "needle=value" },
  { side: "right", path: "pkg/App.class", kind: "source", tier: "T3", line: 12 },
];

describe("search helpers", () => {
  it("builds stable keys from side path kind and line", () => {
    expect(searchResultKey(results[2])).toBe("right:config/app.properties:text:4");
  });

  it("groups results by kind in display order", () => {
    expect(groupSearchResults(results, "kind").map((group) => [group.label, group.results.length])).toEqual([
      ["Path", 1],
      ["Constants", 1],
      ["Text", 1],
      ["Source", 1],
    ]);
  });

  it("groups results by side", () => {
    expect(groupSearchResults(results, "side").map((group) => [group.label, group.results.length])).toEqual([
      ["Left", 2],
      ["Right", 2],
    ]);
  });

  it("labels search kinds and contexts", () => {
    expect(labelForSearchKind("constantPool")).toBe("Constants");
    expect(labelForSearchContext("files")).toBe("Files index");
    expect(labelForSearchContext("diff")).toBe("Current diff");
  });

  it("derives context from active tab", () => {
    expect(searchContextForActiveTab("files")).toBe("files");
    expect(searchContextForActiveTab("pkg/App.class")).toBe("diff");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/lib/search.test.ts
```

Expected: FAIL because `src/lib/search.ts` and new type fields do not exist.

- [ ] **Step 3: Update `src/lib/types.ts` search types**

Replace the current `SearchResult` and `SearchHit` definitions in `src/lib/types.ts` with:

```ts
export type SearchScope = Side | "both";
export type TreeFilter = "all" | "diff" | "same";
export type SearchTier = "T2" | "T3";
export type SearchHitKind = "path" | "text" | "constantPool" | "source";
export type SearchContext = "files" | "diff";

export interface BackendSearchOptions {
  includePath: boolean;
  includeText: boolean;
  includeConstants: boolean;
}

export interface BackendSearchHit {
  entryPath: string;
  kind: SearchHitKind;
  line?: number;
  preview?: string;
}

export interface SearchResult {
  side: Side;
  path: string;
  tier: SearchTier;
  kind: SearchHitKind;
  line?: number;
  preview?: string;
}
```

Remove the old `SearchHit` interface. Later tasks update imports from `SearchHit` to `BackendSearchHit`.

- [ ] **Step 4: Implement `src/lib/search.ts`**

Create `src/lib/search.ts`:

```ts
import type { SearchContext, SearchHitKind, SearchResult, Side } from "@/lib/types";
import type { ResultGrouping } from "@/lib/preferences";

export interface SearchResultGroup {
  id: string;
  label: string;
  results: SearchResult[];
}

const kindOrder: SearchHitKind[] = ["path", "constantPool", "text", "source"];
const sideOrder: Side[] = ["left", "right"];

export function searchResultKey(result: SearchResult) {
  return `${result.side}:${result.path}:${result.kind}:${result.line ?? "entry"}`;
}

export function labelForSearchKind(kind: SearchHitKind) {
  switch (kind) {
    case "path":
      return "Path";
    case "constantPool":
      return "Constants";
    case "text":
      return "Text";
    case "source":
      return "Source";
  }
}

export function labelForSearchContext(context: SearchContext) {
  return context === "files" ? "Files index" : "Current diff";
}

export function searchContextForActiveTab(activeTab: "files" | string): SearchContext {
  return activeTab === "files" ? "files" : "diff";
}

export function groupSearchResults(results: SearchResult[], grouping: ResultGrouping): SearchResultGroup[] {
  if (grouping === "side") {
    return sideOrder
      .map((side) => ({
        id: side,
        label: side === "left" ? "Left" : "Right",
        results: results.filter((result) => result.side === side),
      }))
      .filter((group) => group.results.length > 0);
  }
  return kindOrder
    .map((kind) => ({
      id: kind,
      label: labelForSearchKind(kind),
      results: results.filter((result) => result.kind === kind),
    }))
    .filter((group) => group.results.length > 0);
}
```

- [ ] **Step 5: Run search helper tests**

Run:

```bash
rtk npm test -- src/lib/search.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/types.ts src/lib/search.ts src/lib/search.test.ts
rtk git commit -m "feat: add typed frontend search helpers"
```

---

### Task 4: Tighten Tauri Search Contract

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing Rust tests for typed and multi-hit search**

In `src-tauri/src/main.rs`, inside the existing `#[cfg(test)] mod tests`, add these tests after `t2_path_search_skips_binary_payload_reads`:

```rust
    #[test]
    fn t2_search_can_return_path_and_text_for_same_entry() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("needle.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(
            &archive,
            "needle",
            SearchOptions {
                include_path: true,
                include_text: true,
                include_constants: false,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|hit| {
            hit.entry_path == "needle.properties"
                && hit.kind == SearchHitKind::Path
                && hit.line.is_none()
        }));
        assert!(hits.iter().any(|hit| {
            hit.entry_path == "needle.properties"
                && hit.kind == SearchHitKind::Text
                && hit.line == Some(2)
                && hit.preview.as_deref() == Some("needle=value")
        }));
    }

    #[test]
    fn t2_search_options_exclude_unrequested_categories() {
        let dir = tempdir().unwrap();
        let archive_path = dir.path().join("text.zip");
        create_zip(
            &archive_path,
            &[("needle.properties", b"first\nneedle=value\n")],
        );
        let archive = Archive::open(archive_path.to_str().unwrap()).unwrap();

        let hits = search_archive(
            &archive,
            "needle",
            SearchOptions {
                include_path: false,
                include_text: true,
                include_constants: false,
            },
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, SearchHitKind::Text);
    }
```

Update the existing search tests in the same file to call `search_archive` with `SearchOptions`. For example:

```rust
        let hits = search_archive(
            &archive,
            "blob",
            SearchOptions {
                include_path: true,
                include_text: false,
                include_constants: false,
            },
        )
        .unwrap();
```

Replace `hits[0].path` assertions with `hits[0].entry_path`, and replace string `match_kind` assertions with `SearchHitKind::*`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk cargo test -p lcdiff-desktop t2_search_can_return_path_and_text_for_same_entry
```

Expected: FAIL for the same missing symbols.

- [ ] **Step 3: Implement typed search options and hits**

In `src-tauri/src/main.rs`, replace the current `search` command and `search_archive` helpers with this shape:

```rust
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchOptions {
    include_path: bool,
    include_text: bool,
    include_constants: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum SearchHitKind {
    Path,
    Text,
    ConstantPool,
    Source,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    entry_path: String,
    kind: SearchHitKind,
    line: Option<usize>,
    preview: Option<String>,
}

impl SearchHit {
    fn new(entry_path: String, kind: SearchHitKind) -> Self {
        Self {
            entry_path,
            kind,
            line: None,
            preview: None,
        }
    }

    fn with_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }

    fn with_preview(mut self, preview: impl Into<String>) -> Self {
        self.preview = Some(preview.into());
        self
    }
}

#[tauri::command]
async fn search(
    side: Side,
    query: String,
    options: SearchOptions,
    state: State<'_, SharedState>,
) -> Result<Vec<SearchHit>, String> {
    let archive = {
        let state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        archive(&state, side)
            .ok_or("archive is not loaded")?
            .clone()
    };
    tauri::async_runtime::spawn_blocking(move || search_archive(&archive, &query, options))
        .await
        .map_err(|error| error.to_string())?
}

fn search_archive(archive: &Archive, query: &str, options: SearchOptions) -> Result<Vec<SearchHit>, String> {
    let query = normalize_search_query(query)?;
    let query_lower = query.to_ascii_lowercase();
    let mut matches = Vec::new();
    for entry in archive.entries() {
        if options.include_path && entry.path.to_ascii_lowercase().contains(&query_lower) {
            matches.push(SearchHit::new(entry.path.clone(), SearchHitKind::Path));
        }
        match entry.kind {
            EntryKind::Class if options.include_constants => {
                let bytes = archive
                    .read_entry(&entry.path)
                    .map_err(|error| error.to_string())?;
                if let Ok(values) = search_constant_pool(&bytes, &query)
                    && let Some(first) = values.first()
                {
                    matches.push(
                        SearchHit::new(entry.path.clone(), SearchHitKind::ConstantPool)
                            .with_preview(first.value.clone()),
                    );
                }
            }
            EntryKind::Text if options.include_text => {
                let bytes = archive
                    .read_entry(&entry.path)
                    .map_err(|error| error.to_string())?;
                if let Some((line, preview)) =
                    line_match_for_search(&String::from_utf8_lossy(&bytes), &query_lower)
                {
                    matches.push(
                        SearchHit::new(entry.path.clone(), SearchHitKind::Text)
                            .with_line(line)
                            .with_preview(preview),
                    );
                }
            }
            EntryKind::Directory | EntryKind::Binary | EntryKind::Archive | EntryKind::Class | EntryKind::Text => {}
        }
    }
    Ok(matches)
}

fn line_match_for_search(content: &str, query_lower: &str) -> Option<(usize, String)> {
    content
        .lines()
        .enumerate()
        .find_map(|(index, line)| {
            line.to_ascii_lowercase()
                .contains(query_lower)
                .then(|| (index + 1, line.trim().chars().take(160).collect::<String>()))
        })
}
```

Keep `normalize_search_query` unchanged. Remove the old `line_number_for_match` only after updating `deep_search_hit` to use `line_match_for_search`.

Update `deep_search_hit`:

```rust
fn deep_search_hit(
    entry_path: &str,
    source: Result<String, String>,
    query_lower: &str,
) -> Option<SearchHit> {
    let source = source.ok()?;
    line_match_for_search(&source, query_lower).map(|(line, preview)| {
        SearchHit::new(entry_path.to_owned(), SearchHitKind::Source)
            .with_line(line)
            .with_preview(preview)
    })
}
```

- [ ] **Step 4: Update existing Rust test assertions**

In `src-tauri/src/main.rs`, update old assertions:

```rust
assert_eq!(hits[0].entry_path, "blob.bin");
assert_eq!(hits[0].kind, SearchHitKind::Path);
assert_eq!(hits[0].line, None);
```

```rust
assert_eq!(hits[0].entry_path, "app.properties");
assert_eq!(hits[0].kind, SearchHitKind::Text);
assert_eq!(hits[0].line, Some(2));
assert_eq!(hits[0].preview.as_deref(), Some("needle=value"));
```

```rust
assert_eq!(hits[0].entry_path, "pkg/NeedleHolder.class");
assert_eq!(hits[0].kind, SearchHitKind::ConstantPool);
```

Update `deep_search_skips_decompile_errors_per_entry`:

```rust
assert_eq!(hit.entry_path, "pkg/A.class");
assert_eq!(hit.kind, SearchHitKind::Source);
```

- [ ] **Step 5: Run Rust search tests**

Run:

```bash
rtk cargo test --workspace t2_search
rtk cargo test --workspace deep_search_skips_decompile_errors_per_entry
rtk cargo test --workspace search_rejects_empty_query
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src-tauri/src/main.rs
rtk git commit -m "feat: type desktop search results"
```

---

### Task 5: Add Search Results Panel

**Files:**
- Create: `src/components/SearchResultsPanel.tsx`
- Create: `src/components/SearchResultsPanel.test.tsx`

- [ ] **Step 1: Write failing SearchResultsPanel tests**

Create `src/components/SearchResultsPanel.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchResultsPanel } from "@/components/SearchResultsPanel";
import type { SearchResult } from "@/lib/types";

const results: SearchResult[] = [
  { side: "left", path: "pkg/App.class", kind: "path", tier: "T2" },
  { side: "left", path: "pkg/App.class", kind: "constantPool", tier: "T2", preview: "Needle" },
  { side: "right", path: "config/app.properties", kind: "text", tier: "T2", line: 4, preview: "needle=value" },
];

describe("SearchResultsPanel", () => {
  it("renders grouped result rows", () => {
    render(<SearchResultsPanel results={results} grouping="kind" onInspect={vi.fn()} />);

    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Constants")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getAllByText("pkg/App.class")).toHaveLength(2);
    expect(screen.getByText("config/app.properties")).toBeInTheDocument();
    expect(screen.getByText(":4")).toBeInTheDocument();
    expect(screen.getByText("needle=value")).toBeInTheDocument();
  });

  it("calls onInspect with the clicked result", async () => {
    const onInspect = vi.fn();
    render(<SearchResultsPanel results={results} grouping="kind" onInspect={onInspect} />);

    await userEvent.click(within(screen.getByLabelText("Text search results")).getByRole("button"));

    expect(onInspect).toHaveBeenCalledWith(results[2]);
  });

  it("renders nothing for empty results", () => {
    const { container } = render(<SearchResultsPanel results={[]} grouping="kind" onInspect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/SearchResultsPanel.test.tsx
```

Expected: FAIL because `SearchResultsPanel.tsx` does not exist.

- [ ] **Step 3: Implement `SearchResultsPanel.tsx`**

Create `src/components/SearchResultsPanel.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupSearchResults, labelForSearchKind, searchResultKey } from "@/lib/search";
import type { ResultGrouping } from "@/lib/preferences";
import type { SearchResult } from "@/lib/types";

interface SearchResultsPanelProps {
  results: SearchResult[];
  grouping: ResultGrouping;
  onInspect: (result: SearchResult) => void;
}

export function SearchResultsPanel({ results, grouping, onInspect }: SearchResultsPanelProps) {
  const groups = groupSearchResults(results, grouping);
  if (groups.length === 0) return null;

  return (
    <section className="search-results-panel" aria-label="Search results">
      {groups.map((group) => (
        <div className="search-result-group" key={group.id} aria-label={`${group.label} search results`}>
          <div className="search-result-group-header">
            <span>{group.label}</span>
            <Badge variant="secondary">{group.results.length}</Badge>
          </div>
          <div className="search-result-rows">
            {group.results.map((result) => (
              <Button
                key={searchResultKey(result)}
                type="button"
                variant="outline"
                className="search-result-row"
                onClick={() => onInspect(result)}
              >
                <Badge variant="secondary">{result.side}</Badge>
                <Badge variant="outline">{labelForSearchKind(result.kind)}</Badge>
                <span className="search-result-path">{result.path}</span>
                {result.line !== undefined && <span className="search-result-line">:{result.line}</span>}
                {result.preview && <span className="search-result-preview">{result.preview}</span>}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Add CSS for grouped results**

In `src/styles.css`, replace the current horizontal `.search-results` block with:

```css
.search-results-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 8px;
  max-height: 9.5rem;
  overflow: auto;
  padding: 4px 2px 8px;
}
.search-result-group {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--ink-1) 76%, transparent);
}
.search-result-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-1);
  border-bottom: 1px solid var(--line-soft);
}
.search-result-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
}
.search-result-row {
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  gap: 6px;
  font-family: var(--font-tree, var(--font-mono));
  font-size: var(--lcdiff-tree-font-size, 0.74rem);
}
.search-result-path,
.search-result-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result-path { flex: 1 1 auto; text-align: left; }
.search-result-preview { flex: 0 2 18rem; color: var(--text-2); text-align: left; }
.search-result-line { flex: 0 0 auto; color: var(--brass); }
```

- [ ] **Step 5: Run SearchResultsPanel tests**

Run:

```bash
rtk npm test -- src/components/SearchResultsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/SearchResultsPanel.tsx src/components/SearchResultsPanel.test.tsx src/styles.css
rtk git commit -m "feat: add grouped search results panel"
```

---

### Task 6: Refactor SearchBar for Tab-Aware Context

**Files:**
- Modify: `src/components/SearchBar.tsx`
- Modify: `src/components/SearchBar.test.tsx`

- [ ] **Step 1: Replace SearchBar tests**

Replace `src/components/SearchBar.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/SearchBar";

function setup(overrides = {}) {
  const props = {
    open: true,
    context: "files" as const,
    mode: "compare" as const,
    query: "",
    treeFilter: "diff" as const,
    searchScope: "both" as const,
    includeSource: false,
    searching: false,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onSearchAllFiles: vi.fn(),
    onCancel: vi.fn(),
    onClear: vi.fn(),
    onFilterChange: vi.fn(),
    onScopeChange: vi.fn(),
    onIncludeSourceChange: vi.fn(),
    ...overrides,
  };
  render(<SearchBar {...props} />);
  return props;
}

describe("SearchBar", () => {
  it("shows Files index controls on the Files tab", async () => {
    const props = setup({ query: "needle" });

    expect(screen.getByText("Files index")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search all/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Include source search")).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /search all/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("shows Current diff controls on a diff tab", async () => {
    const props = setup({ context: "diff", query: "needle" });

    expect(screen.getByText("Current diff")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^find$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search all files/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /search all files/i }));
    expect(props.onSearchAllFiles).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Files index")).not.toBeInTheDocument();
  });

  it("fires clear and cancel actions", async () => {
    const props = setup({ searching: true });
    await userEvent.click(screen.getByRole("button", { name: /cancel search/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx
```

Expected: FAIL because `SearchBarProps` lacks the new props.

- [ ] **Step 3: Implement new SearchBar**

Replace `src/components/SearchBar.tsx` with:

```tsx
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { labelForSearchContext } from "@/lib/search";
import type { Mode, SearchContext, SearchScope, TreeFilter } from "@/lib/types";

interface SearchBarProps {
  open: boolean;
  context: SearchContext;
  mode: Mode;
  query: string;
  treeFilter: TreeFilter;
  searchScope: SearchScope;
  includeSource: boolean;
  searching: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSearchAllFiles: () => void;
  onCancel: () => void;
  onClear: () => void;
  onFilterChange: (filter: TreeFilter) => void;
  onScopeChange: (scope: SearchScope) => void;
  onIncludeSourceChange: (value: boolean) => void;
}

export function SearchBar({
  open, context, mode, query, treeFilter, searchScope, includeSource, searching,
  onQueryChange, onSearch, onSearchAllFiles, onCancel, onClear, onFilterChange,
  onScopeChange, onIncludeSourceChange,
}: SearchBarProps) {
  if (!open) return null;
  const filesContext = context === "files";
  return (
    <div className="search-bar" data-context={context}>
      <span className="search-context-label">{labelForSearchContext(context)}</span>
      <Input
        className="search-input"
        value={query}
        placeholder={filesContext ? "Search paths, text, constants" : "Find in current diff"}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
      />
      {filesContext && (
        <>
          <Select value={searchScope} disabled={mode === "single"} onValueChange={(v) => onScopeChange(v as SearchScope)}>
            <SelectTrigger aria-label="Search scope"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="both">Both sides</SelectItem>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
          <label className="check-label search-inline-check">
            <Checkbox checked={includeSource} onCheckedChange={(c) => onIncludeSourceChange(c === true)} aria-label="Include source search" />
            Source
          </label>
          <Select value={treeFilter} onValueChange={(v) => onFilterChange(v as TreeFilter)}>
            <SelectTrigger aria-label="Tree filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">Show all</SelectItem>
              <SelectItem value="diff">Differences</SelectItem>
              <SelectItem value="same">Identical</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </>
      )}
      <Button aria-label={filesContext ? "Search all" : "Find"} onClick={onSearch} disabled={searching}>
        <Search /> {filesContext ? "Search all" : "Find"}
      </Button>
      {!filesContext && (
        <Button variant="outline" onClick={onSearchAllFiles}>Search all files</Button>
      )}
      <Button variant="outline" disabled={!searching} onClick={onCancel}>Cancel search</Button>
      <Button variant="ghost" aria-label="Clear search" onClick={onClear}><X /> Clear</Button>
    </div>
  );
}
```

- [ ] **Step 4: Add SearchBar CSS**

In `src/styles.css`, extend the existing `.search-bar` rules:

```css
.search-context-label {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-2);
  padding: 0 8px;
  border-left: 2px solid var(--brass);
}
.search-inline-check {
  flex: 0 0 auto;
}
```

- [ ] **Step 5: Run SearchBar tests**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/SearchBar.tsx src/components/SearchBar.test.tsx src/styles.css
rtk git commit -m "feat: make search bar tab aware"
```

---

### Task 7: Refactor ConfigDrawer into Preferences Drawer

**Files:**
- Modify: `src/components/ConfigDrawer.tsx`
- Modify: `src/components/ConfigDrawer.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Replace ConfigDrawer tests**

Replace `src/components/ConfigDrawer.test.tsx` with:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { DEFAULT_ENGINE } from "@/lib/types";

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
    engine: DEFAULT_ENGINE,
    backupEnabled: false,
    ignoreTrimWhitespace: true,
    preferences: DEFAULT_UI_PREFERENCES,
    onPreferencesChange: vi.fn(),
    onEngineChange: vi.fn(),
    onIgnoreWhitespaceChange: vi.fn(),
    onBackupEnabledChange: vi.fn(),
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

  it("shows Appearance with Light and Dark theme sections by default", () => {
    setup();
    expect(screen.getByRole("complementary", { name: /preferences/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Light themes")).toBeInTheDocument();
    expect(screen.getByText("Dark themes")).toBeInTheDocument();
    expect(screen.getByText("LCDiff Graphite")).toBeInTheDocument();
  });

  it("switches to Typography and changes editor font size", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Typography" }));
    await userEvent.click(screen.getByLabelText("Editor font size"));
    const options = screen.getByRole("listbox");
    await userEvent.click(within(options).getByText("15"));
    expect(props.onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({
      typography: expect.objectContaining({ editorScale: 15 }),
    }));
  });

  it("keeps Vineflower and CFR selectable in Decompiler", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "Decompiler" }));
    await userEvent.click(screen.getByLabelText("Decompiler engine"));
    const engineOptions = screen.getByRole("listbox");
    expect(within(engineOptions).getByText("Vineflower")).toBeInTheDocument();
    expect(within(engineOptions).getByText("CFR")).toBeInTheDocument();
    await userEvent.click(within(engineOptions).getByText("CFR"));
    expect(props.onEngineChange).toHaveBeenCalledWith("cfr");
  });

  it("shows backup toggle only in compare mode", async () => {
    setup({ mode: "single" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByText(/Keep one overwritten .bak on save/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: FAIL because `ConfigDrawerProps` does not accept preferences.

- [ ] **Step 3: Replace ConfigDrawer implementation**

Replace `src/components/ConfigDrawer.tsx` with a sectioned Preferences drawer. Use this implementation:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { listThemesByMode } from "@/lib/themes";
import type { UiPreferences } from "@/lib/preferences";
import type { Engine, Mode } from "@/lib/types";

type Section = "appearance" | "typography" | "editor" | "search" | "decompiler" | "save";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  engine: Engine;
  ignoreTrimWhitespace: boolean;
  backupEnabled: boolean;
  preferences: UiPreferences;
  onPreferencesChange: (preferences: UiPreferences) => void;
  onEngineChange: (engine: Engine) => void;
  onIgnoreWhitespaceChange: (value: boolean) => void;
  onBackupEnabledChange: (value: boolean) => void;
}

const sections: Array<{ id: Section; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "typography", label: "Typography" },
  { id: "editor", label: "Editor" },
  { id: "search", label: "Search" },
  { id: "decompiler", label: "Decompiler" },
  { id: "save", label: "Save" },
];

export function ConfigDrawer({
  open, mode, engine, ignoreTrimWhitespace, backupEnabled, preferences,
  onPreferencesChange, onEngineChange, onIgnoreWhitespaceChange, onBackupEnabledChange,
}: ConfigDrawerProps) {
  const [section, setSection] = useState<Section>("appearance");
  if (!open) return <aside className="config-drawer closed" aria-hidden="true" />;

  const update = (next: UiPreferences) => onPreferencesChange(next);

  return (
    <aside className="config-drawer open preferences-drawer" aria-label="Preferences">
      <nav className="preferences-nav" aria-label="Preferences sections">
        {sections.map((item) => (
          <Button
            key={item.id}
            variant={section === item.id ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      <div className="preferences-content">
        {section === "appearance" && (
          <section className="drawer-group">
            <span className="zone-label">Appearance</span>
            <Select value={preferences.appearance.colorMode} onValueChange={(colorMode) => update({
              ...preferences,
              appearance: { ...preferences.appearance, colorMode: colorMode as UiPreferences["appearance"]["colorMode"] },
            })}>
              <SelectTrigger aria-label="Color mode"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <span className="preference-subhead">Light themes</span>
            <div className="theme-grid">
              {listThemesByMode("light").map((theme) => (
                <Button key={theme.id} variant={preferences.appearance.themeId === theme.id ? "secondary" : "outline"} size="sm" onClick={() => update({
                  ...preferences,
                  appearance: { ...preferences.appearance, colorMode: "light", themeId: theme.id },
                })}>{theme.label}</Button>
              ))}
            </div>
            <span className="preference-subhead">Dark themes</span>
            <div className="theme-grid">
              {listThemesByMode("dark").map((theme) => (
                <Button key={theme.id} variant={preferences.appearance.themeId === theme.id ? "secondary" : "outline"} size="sm" onClick={() => update({
                  ...preferences,
                  appearance: { ...preferences.appearance, colorMode: "dark", themeId: theme.id },
                })}>{theme.label}</Button>
              ))}
            </div>
          </section>
        )}

        {section === "typography" && (
          <section className="drawer-group">
            <span className="zone-label">Typography</span>
            <Select value={String(preferences.typography.editorScale)} onValueChange={(value) => update({
              ...preferences,
              typography: { ...preferences.typography, editorScale: Number(value) as UiPreferences["typography"]["editorScale"] },
            })}>
              <SelectTrigger aria-label="Editor font size"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {[12, 13, 14, 15, 16].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </section>
        )}

        {section === "editor" && (
          <section className="drawer-group">
            <span className="zone-label">Editor</span>
            <label className="check-label">
              <Checkbox checked={preferences.editor.wordWrap === "on"} onCheckedChange={(c) => update({
                ...preferences,
                editor: { ...preferences.editor, wordWrap: c === true ? "on" : "off" },
              })} />
              Word wrap
            </label>
            <label className="check-label">
              <Checkbox checked={preferences.editor.lineNumbers === "on"} onCheckedChange={(c) => update({
                ...preferences,
                editor: { ...preferences.editor, lineNumbers: c === true ? "on" : "off" },
              })} />
              Line numbers
            </label>
            <label className="check-label">
              <Checkbox checked={preferences.editor.minimap === "on"} onCheckedChange={(c) => update({
                ...preferences,
                editor: { ...preferences.editor, minimap: c === true ? "on" : "off" },
              })} />
              Minimap
            </label>
          </section>
        )}

        {section === "search" && (
          <section className="drawer-group">
            <span className="zone-label">Search</span>
            <label className="check-label">
              <Checkbox checked={preferences.search.includeSourceByDefault} onCheckedChange={(c) => update({
                ...preferences,
                search: { ...preferences.search, includeSourceByDefault: c === true },
              })} />
              Include source by default
            </label>
          </section>
        )}

        {section === "decompiler" && (
          <section className="drawer-group">
            <span className="zone-label">Decompiler & diff</span>
            <Select value={engine} onValueChange={(v) => onEngineChange(v as Engine)}>
              <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="vineflower">Vineflower</SelectItem>
                <SelectItem value="cfr">CFR</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <label className="check-label">
              <Checkbox checked={ignoreTrimWhitespace} onCheckedChange={(c) => onIgnoreWhitespaceChange(c === true)} />
              Ignore trim whitespace
            </label>
          </section>
        )}

        {section === "save" && mode === "compare" && (
          <section className="drawer-group">
            <span className="zone-label">Save</span>
            <label className="check-label">
              <Checkbox checked={backupEnabled} onCheckedChange={(c) => onBackupEnabledChange(c === true)} />
              Keep one overwritten .bak on save
            </label>
          </section>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Add Preferences drawer CSS**

In `src/styles.css`, update drawer rules:

```css
.config-drawer.open { width: 360px; padding: 0.75rem; }
.app-shell[data-drawer-width="wide"] .config-drawer.open { width: 420px; }
.preferences-drawer {
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: 10px;
}
.preferences-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.preferences-nav button {
  justify-content: flex-start;
}
.preferences-content {
  min-width: 0;
  overflow-y: auto;
}
.preference-subhead {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-2);
}
.theme-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}
```

In the `@media (max-width: 820px)` drawer rule, change width to:

```css
width: min(360px, 88vw);
```

- [ ] **Step 5: Run ConfigDrawer tests**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/styles.css
rtk git commit -m "feat: refactor config drawer into preferences"
```

---

### Task 8: Apply Preferences to App, CSS, and Monaco

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/DiffView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add App preference loading test**

In `src/App.test.tsx`, add this test inside `describe("App file-merge wiring", () => { ... })`:

```tsx
  it("applies persisted UI preferences to the app shell", async () => {
    localStorage.setItem("lcdiff.uiPreferences.v1", JSON.stringify({
      appearance: { density: "comfortable", radius: "soft", motion: "reduced" },
      typography: { editorScale: 15 },
    }));

    render(<App />);

    const shell = await screen.findByRole("main");
    expect(shell.dataset.density).toBe("comfortable");
    expect(shell.dataset.radius).toBe("soft");
    expect(shell.dataset.motion).toBe("reduced");
    expect(shell.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("15px");
  });
```

- [ ] **Step 2: Run App test to verify it fails**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "applies persisted UI preferences"
```

Expected: FAIL because `main.app-shell` does not expose preference attributes.

- [ ] **Step 3: Update `DiffView.tsx` props and Monaco options**

In `src/components/DiffView.tsx`, import `UiPreferences`:

```ts
import type { UiPreferences } from "@/lib/preferences";
```

Add to `DiffViewProps`:

```ts
preferences: UiPreferences;
```

Add `preferences` to the destructured props, then define before `return`:

```ts
  const monacoTheme = preferences.appearance.colorMode === "light" ? "light" : "vs-dark";
  const editorOptions = {
    fontFamily: "var(--font-mono)",
    fontSize: preferences.typography.editorScale,
    minimap: { enabled: preferences.editor.minimap === "on" },
    wordWrap: preferences.editor.wordWrap,
    lineNumbers: preferences.editor.lineNumbers,
    automaticLayout: true,
  } as const;
```

In both `DiffEditor` and `Editor`, replace `theme="vs-dark"` with:

```tsx
theme={monacoTheme}
```

For `DiffEditor` options, merge `editorOptions`:

```tsx
options={{
  ...editorOptions,
  readOnly: !hunkMerge,
  originalEditable: hunkMerge,
  renderMarginRevertIcon: hunkMerge,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  ignoreTrimWhitespace,
}}
```

For `Editor` options:

```tsx
options={{ ...editorOptions, readOnly: !editable }}
```

- [ ] **Step 4: Update `App.tsx` preference state and root application**

In `src/App.tsx`, import:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
import { applyPreferencesToRoot, loadUiPreferences, saveUiPreferences } from "@/lib/preferences";
```

If `App.tsx` already imports React hooks on one line, merge the hooks rather than duplicating imports.

Add state near other UI state:

```ts
  const [preferences, setPreferences] = useState(loadUiPreferences);
  const appShellRef = useRef<HTMLElement>(null);
```

Add effect:

```ts
  useEffect(() => {
    saveUiPreferences(preferences);
    if (appShellRef.current) applyPreferencesToRoot(appShellRef.current, preferences);
  }, [preferences]);
```

Change:

```tsx
<main className="app-shell">
```

to:

```tsx
<main className="app-shell" ref={appShellRef}>
```

Pass `preferences={preferences}` to `DiffView`.

Replace old `ConfigDrawer` props with:

```tsx
          preferences={preferences}
          onPreferencesChange={setPreferences}
```

Keep engine, whitespace, and backup props.

- [ ] **Step 5: Add CSS data-attribute rules**

In `src/styles.css`, add:

```css
.app-shell[data-density="comfortable"] {
  gap: 14px;
}
.app-shell[data-radius="sharp"] {
  --radius: 0.28rem;
}
.app-shell[data-radius="soft"] {
  --radius: 0.8rem;
}
.app-shell[data-motion="reduced"],
.app-shell[data-motion="reduced"] * {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
.tree-row,
.search-result-row,
.search-result-path {
  font-family: var(--font-tree, var(--font-mono));
  font-size: var(--lcdiff-tree-font-size, 0.74rem);
}
```

- [ ] **Step 6: Run App preference test and component tests**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "applies persisted UI preferences"
rtk npm test -- src/components/DiffView.test.tsx src/components/ConfigDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/App.tsx src/components/DiffView.tsx src/styles.css src/App.test.tsx
rtk git commit -m "feat: apply UI preferences to app shell"
```

---

### Task 9: Wire Backend Search Options into App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add App-level Files-index search test**

In `src/App.test.tsx`, extend the `invoke` mock:

```ts
    case "search":
      return [
        { entryPath: "config.json", kind: "path" as const },
        { entryPath: "config.json", kind: "text" as const, line: 2, preview: '"v": 2' },
      ];
    case "deep_search":
      return [{ entryPath: "config.json", kind: "source" as const, line: 3, preview: "class Config" }];
    case "cancel_deep_search":
      return undefined;
```

Add this test:

```tsx
  it("runs Files index search with typed backend options", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.clear(screen.getByPlaceholderText(/Search paths, text, constants/));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByRole("button", { name: /search all/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("search", {
        side: "left",
        query: "config",
        options: { includePath: true, includeText: true, includeConstants: true },
      }),
    );
    expect(await screen.findByText("Path")).toBeInTheDocument();
    expect(await screen.findByText("Text")).toBeInTheDocument();
  });
```

Extend the fake Monaco sub-editor in `makeFakeDiffEditor` so current-diff find can be tested. Add `getModel` to the object returned by `subEditor`:

```ts
    getModel: () => ({
      findMatches: vi.fn(() => [
        { range: { startLineNumber: 2 } },
      ]),
    }),
```

Add this current-diff test:

```tsx
  it("finds inside the current diff without invoking archive search", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    invoke.mockClear();
    await user.click(screen.getByRole("tab", { name: /config.json/i }));
    await user.type(screen.getByPlaceholderText(/Find in current diff/), "v");
    await user.click(screen.getByRole("button", { name: /^find$/i }));

    expect(invoke).not.toHaveBeenCalledWith("search", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("deep_search", expect.anything());
    expect(await screen.findByText("Current diff matched line 2.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "runs Files index search|finds inside the current diff"
```

Expected: FAIL because `runSearch` still invokes `search` without typed options and old hit shape.

- [ ] **Step 3: Update App search imports and state**

In `src/App.tsx`, replace old `SearchHit` import with:

```ts
  type BackendSearchHit,
```

Import helpers:

```ts
import { searchContextForActiveTab, searchResultKey } from "@/lib/search";
```

Remove the local `searchResultKey` function from `App.tsx`.

Add state near search state:

```ts
  const [includeSourceSearch, setIncludeSourceSearch] = useState(preferences.search.includeSourceByDefault);
```

Add effect:

```ts
  useEffect(() => {
    setIncludeSourceSearch(preferences.search.includeSourceByDefault);
  }, [preferences.search.includeSourceByDefault]);
```

Define active search context before render:

```ts
  const searchContext = searchContextForActiveTab(activeTab);
```

- [ ] **Step 4: Update search result aggregation**

In `runSearch`, replace the invoke loop body with:

```ts
      const options = { includePath: true, includeText: true, includeConstants: true };
      for (const side of searchSides()) {
        if (!archives[side]) continue;
        for (const hit of await invoke<BackendSearchHit[]>("search", { side, query, options })) {
          if (searchStreamId.current !== searchId) return;
          matches.add(hit.entryPath);
          results.push({
            side,
            tier: "T2",
            path: hit.entryPath,
            kind: hit.kind,
            line: hit.line,
            preview: hit.preview,
          });
        }
      }
```

In `runDeepSearch`, replace hit mapping with:

```ts
        for (const hit of await invoke<BackendSearchHit[]>("deep_search", { side, query, searchId })) {
          if (searchStreamId.current !== searchId) return;
          matches.add(hit.entryPath);
          results.push({
            side,
            tier: "T3",
            path: hit.entryPath,
            kind: hit.kind,
            line: hit.line,
            preview: hit.preview,
          });
        }
```

Update the event listener type:

```ts
listen<{ searchId: number; side: Side; hit: BackendSearchHit }>("search-result", (event) => {
```

and event result construction:

```ts
      const result: SearchResult = {
        side: event.payload.side,
        tier: "T3",
        path: event.payload.hit.entryPath,
        kind: event.payload.hit.kind,
        line: event.payload.hit.line,
        preview: event.payload.hit.preview,
      };
```

- [ ] **Step 5: Wire SearchBar props**

Update the `SearchBar` render in `App.tsx`:

```tsx
      <SearchBar
        open={searchOpen}
        context={searchContext}
        mode={mode}
        query={query}
        treeFilter={treeFilter}
        searchScope={searchScope}
        includeSource={includeSourceSearch}
        searching={searching}
        onQueryChange={setQuery}
        onSearch={searchContext === "files" ? runSearch : findInCurrentDiff}
        onSearchAllFiles={runSearch}
        onCancel={cancelDeepSearch}
        onClear={clearSearch}
        onFilterChange={setTreeFilter}
        onScopeChange={setSearchScope}
        onIncludeSourceChange={setIncludeSourceSearch}
      />
```

Add `findInCurrentDiff` before `searchSides`:

```ts
  function findInCurrentDiff() {
    const trimmed = query.trim();
    if (!trimmed) {
      setMessage("Search query is empty");
      return;
    }
    const searchInEditor = (editor?: CodeEditor) => {
      const matches = editor?.getModel()?.findMatches(trimmed, true, false, false, null, true) ?? [];
      const line = matches[0]?.range.startLineNumber;
      if (line !== undefined) editor?.revealLineInCenter(line);
      return line;
    };
    const diffEditor = diffEditorRef.current;
    const line =
      mode === "compare"
        ? searchInEditor(diffEditor?.getModifiedEditor()) ?? searchInEditor(diffEditor?.getOriginalEditor())
        : searchInEditor(editorRef.current);
    if (line === undefined) {
      setMessage("Current diff found no matches.");
      return;
    }
    setMessage(`Current diff matched line ${line}.`);
  }
```

This keeps current-diff find local to the loaded Monaco model and avoids invoking archive-wide search commands.

- [ ] **Step 6: Render `SearchResultsPanel`**

Import:

```ts
import { SearchResultsPanel } from "@/components/SearchResultsPanel";
```

Replace the old horizontal `{searchResults.length > 0 && <section className="search-results">...` block with:

```tsx
      <SearchResultsPanel
        results={searchResults}
        grouping={preferences.search.resultGrouping}
        onInspect={inspectSearchResult}
      />
```

- [ ] **Step 7: Run App search test**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "runs Files index search|finds inside the current diff"
```

Expected: PASS.

- [ ] **Step 8: Run broader frontend tests touched by search**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx src/components/SearchResultsPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add src/App.tsx src/App.test.tsx
rtk git commit -m "feat: wire typed contextual search"
```

---

### Task 10: Support Include Source and Current-Diff Labeling

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add test for include-source search**

In `src/App.test.tsx`, add:

```tsx
  it("runs source search when Include source is enabled", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByLabelText("Include source search"));
    await user.click(screen.getByRole("button", { name: /search all/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("deep_search", {
        side: "left",
        query: "config",
        searchId: expect.any(Number),
      }),
    );
  });

  it("labels search as Current diff on opened diff tabs", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /config.json/i }));

    expect(screen.getByText("Current diff")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^find$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search all files/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify one fails**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "runs source search|labels search as Current diff"
```

Expected: The source-search test FAILS because `runSearch` does not call `runDeepSearch` when include source is enabled. The Current-diff label test should PASS if Task 9 was completed correctly.

- [ ] **Step 3: Update `runSearch` to include source when requested**

At the end of successful T2 search in `runSearch`, before setting message, add:

```ts
      if (includeSourceSearch) {
        for (const side of searchSides()) {
          if (!archives[side]) continue;
          for (const hit of await invoke<BackendSearchHit[]>("deep_search", { side, query, searchId })) {
            if (searchStreamId.current !== searchId) return;
            matches.add(hit.entryPath);
            results.push({
              side,
              tier: "T3",
              path: hit.entryPath,
              kind: hit.kind,
              line: hit.line,
              preview: hit.preview,
            });
          }
        }
      }
```

Change the message:

```ts
      setMessage(`${includeSourceSearch ? "Search with source" : "Search"} matched ${matches.size} entries.`);
```

Remove duplicated deep-source aggregation from `runDeepSearch` only if `runDeepSearch` becomes unused. If `cancelDeepSearch` still relies on the dedicated long-running command, keep `runDeepSearch` until all callers are replaced.

- [ ] **Step 4: Run source/context tests**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "runs source search|labels search as Current diff"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/App.tsx src/App.test.tsx
rtk git commit -m "feat: support source-inclusive search"
```

---

### Task 11: Remove Search Actions from Preferences Drawer and Polish Styles

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/MenuBar.tsx`
- Modify: `src/components/MenuBar.test.tsx`

- [ ] **Step 1: Update MenuBar test for Preferences label**

In `src/components/MenuBar.test.tsx`, change the settings toggle assertion to use `Preferences`:

```ts
await userEvent.click(screen.getByLabelText("Preferences"));
expect(props.onToggleDrawer).toHaveBeenCalled();
```

If the existing test is named `"toggles the drawer"`, keep the name.

- [ ] **Step 2: Run MenuBar test to verify it fails**

Run:

```bash
rtk npm test -- src/components/MenuBar.test.tsx
```

Expected: FAIL because the button aria-label is still `Settings`.

- [ ] **Step 3: Update MenuBar aria label**

In `src/components/MenuBar.tsx`, change:

```tsx
<Button variant={drawerOpen ? "secondary" : "ghost"} size="icon" aria-label="Settings" aria-pressed={drawerOpen} onClick={onToggleDrawer}>
```

to:

```tsx
<Button variant={drawerOpen ? "secondary" : "ghost"} size="icon" aria-label="Preferences" aria-pressed={drawerOpen} onClick={onToggleDrawer}>
```

- [ ] **Step 4: Add final responsive polish CSS**

In `src/styles.css`, add:

```css
.app-shell[data-search-results-density="comfortable"] .search-result-row {
  min-height: 2.25rem;
}
.app-shell[data-icon-labels="iconsOnly"] .button-label {
  display: none;
}
@media (max-width: 480px) {
  .search-bar {
    align-items: stretch;
  }
  .search-context-label {
    flex-basis: 100%;
  }
  .search-bar [data-slot="select-trigger"],
  .search-bar button {
    flex: 1 1 auto;
  }
  .preferences-drawer {
    grid-template-columns: 1fr;
  }
  .preferences-nav {
    flex-direction: row;
    overflow-x: auto;
  }
}
```

Update `applyPreferencesToRoot` in `src/lib/preferences.ts` to set attributes consumed by this CSS:

```ts
  root.dataset.searchResultsDensity = preferences.layout.searchResultsDensity;
  root.dataset.iconLabels = preferences.appearance.iconLabels;
```

If these lines already exist, do not duplicate them.

- [ ] **Step 5: Run MenuBar and preference tests**

Run:

```bash
rtk npm test -- src/components/MenuBar.test.tsx src/lib/preferences.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/MenuBar.tsx src/components/MenuBar.test.tsx src/styles.css src/lib/preferences.ts
rtk git commit -m "polish: label preferences and responsive controls"
```

---

### Task 12: Documentation and Verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/LCDIFF_COMPLETION_AUDIT.md`

- [ ] **Step 1: Update architecture documentation**

In `docs/ARCHITECTURE.md`, update the frontend paragraph that mentions Config drawer and search. Replace the sentence fragment:

```md
with per-tab view-mode/preview state), a Config drawer for engine and
diff options, and a startup splash while the sidecar warms.
```

with:

```md
with per-tab view-mode/preview state), a Preferences drawer for appearance,
typography, editor, search defaults, decompiler, and save options, contextual
Files-index/current-diff search, and a startup splash while the sidecar warms.
```

- [ ] **Step 2: Update completion audit UI/search rows**

In `docs/LCDIFF_COMPLETION_AUDIT.md`, update the `Search` row to mention typed grouped results and contextual current-diff find. Update the `UI design` row to mention the Preferences drawer and curated themes/fonts. Use concise wording:

```md
| Search | Monaco current-diff find plus contextual Files-index search with typed grouped path/text/constant-pool/source results; backend search can return multiple hit kinds per entry and deep source search still streams/cancels. |
| UI design | Preferences drawer with curated light/dark inspired themes, role-based fonts, density/radius/motion controls, editor display controls, and grouped search result panels. |
```

- [ ] **Step 3: Run scoped verification**

Run:

```bash
rtk cargo test --workspace t2_search
rtk cargo test --workspace deep_search_skips_decompile_errors_per_entry
rtk npm test -- src/lib/themes.test.ts src/lib/preferences.test.ts src/lib/search.test.ts
rtk npm test -- src/components/ConfigDrawer.test.tsx src/components/SearchBar.test.tsx src/components/SearchResultsPanel.test.tsx src/components/MenuBar.test.tsx
rtk npm test -- src/App.test.tsx
rtk npm run build
```

Expected: all commands PASS.

- [ ] **Step 4: Run render verifier**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS with no browser page errors.

- [ ] **Step 5: Run docs verifier**

Run:

```bash
rtk npm run verify:docs
```

Expected: PASS.

- [ ] **Step 6: Commit docs and verification alignment**

```bash
rtk git add docs/ARCHITECTURE.md docs/LCDIFF_COMPLETION_AUDIT.md
rtk git commit -m "docs: document preferences and contextual search"
```

---

## Final Verification

After all tasks are complete, run:

```bash
rtk cargo fmt --all -- --check
rtk cargo test --workspace
rtk npm run verify:all
```

Expected: all commands PASS. If `rtk cargo test --workspace` stalls on desktop/Tauri linking, run the scoped Rust tests from Task 12 and record the stall explicitly before handing off.

## Implementation Notes

- Do not stage or modify unrelated `AGENTS.md`.
- Do not stage `.superpowers/`; it is ignored local brainstorming state.
- Keep commits task-sized. Each task should pass its listed verification before committing.
- Preserve the product invariant that decompiled Java is read-only and never enters merge writes.
- Preserve the path-only corrupt-binary search invariant.
