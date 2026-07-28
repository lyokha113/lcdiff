export const UI_PREFERENCES_STORAGE_KEY = "lcdiff.uiPreferences.v1";

export type ColorPattern = "light" | "dark" | "system";
export type EffectiveColorPattern = "light" | "dark";
export type Toggle = "on" | "off";
export type ResultGrouping = "kind" | "side";
export type DecompilerEngine = "vineflower" | "cfr" | "jdCore" | "jdCoreV0";

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
    updates: {
      autoCheck: boolean;
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
    updates: {
      autoCheck: true,
    },
  },
};

const COLOR_PATTERNS = ["light", "dark", "system"] as const;
const TOGGLES = ["on", "off"] as const;
const RESULT_GROUPINGS = ["kind", "side"] as const;
const DECOMPILER_ENGINES = ["vineflower", "cfr", "jdCore", "jdCoreV0"] as const;
const BUILT_IN_FONT_FAMILIES = [
  DEFAULT_EDITOR_FONT_FAMILY,
  SYSTEM_MONO_FONT_FAMILY,
  SYSTEM_SANS_FONT_FAMILY,
] as const;

const lightVariables: Record<string, string> = {
  "--background": "#edf2f7",
  "--foreground": "oklch(0.18 0.022 245)",
  "--card": "#f8fafc",
  "--card-foreground": "oklch(0.18 0.022 245)",
  "--popover": "#ffffff",
  "--popover-foreground": "oklch(0.18 0.022 245)",
  "--primary": "#286f9f",
  "--primary-foreground": "#f7fbff",
  "--secondary": "oklch(0.925 0.012 235)",
  "--secondary-foreground": "oklch(0.22 0.022 245)",
  "--muted": "oklch(0.93 0.01 235)",
  "--muted-foreground": "oklch(0.43 0.024 245)",
  "--accent": "oklch(0.9 0.018 235)",
  "--accent-foreground": "oklch(0.2 0.024 245)",
  "--destructive": "oklch(0.55 0.19 25)",
  "--border": "oklch(0.53 0.026 245 / 28%)",
  "--input": "oklch(0.53 0.026 245 / 30%)",
  "--ring": "oklch(0.55 0.12 225 / 40%)",
  "--ink-0": "#e7edf4",
  "--ink-1": "#f8fafc",
  "--ink-2": "#dce5ee",
  "--ink-3": "#c9d5e1",
  "--line": "#b6c3d0",
  "--line-soft": "#d2dbe5",
  "--text-0": "#17212b",
  "--text-1": "#405060",
  "--text-2": "#687789",
  "--brass": "#286f9f",
  "--brass-dim": "#205a80",
  "--st-diff": "#a15c00",
  "--st-only": "#1d63b8",
  "--st-same": "#167347",
  "--danger": "#c92a2a",
  "--status-diff-text": "#8a4f00",
  "--status-diff-bg": "#fff1d2",
  "--status-meta-text": "#245e9b",
  "--status-meta-bg": "#e2effc",
  "--status-left-text": "#167347",
  "--status-left-bg": "#dff5e8",
  "--status-right-text": "#9a4d2e",
  "--status-right-bg": "#fce8df",
  "--tree-hover-bg": "#dce5ee",
  "--tree-selected-bg": "#d9e9f6",
  "--tree-gap-stripe-a": "rgba(23, 33, 43, 0.035)",
  "--tree-gap-stripe-b": "rgba(23, 33, 43, 0.075)",
  "--drawer-surface": "#f8fbff",
  "--drawer-border": "#96abc0",
  "--drawer-shadow": "-1.4rem 0 3rem rgba(68, 84, 100, 0.18), 0 1rem 3rem rgba(68, 84, 100, 0.10), inset 0 1px rgba(255, 255, 255, 0.9)",
  "--drawer-backdrop-filter": "none",
  "--preference-control-bg": "#f3f7fb",
  "--preference-control-border": "#bac7d4",
  "--preference-control-hover": "#e6eef6",
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
  "--status-diff-text": "#e0a030",
  "--status-diff-bg": "#3a2f1a",
  "--status-meta-text": "#8aabd0",
  "--status-meta-bg": "#23304a",
  "--status-left-text": "#6cc99a",
  "--status-left-bg": "#1f3320",
  "--status-right-text": "#d9997a",
  "--status-right-bg": "#33231f",
  "--tree-hover-bg": "rgba(255, 255, 255, 0.04)",
  "--tree-selected-bg": "rgba(217, 176, 102, 0.16)",
  "--tree-gap-stripe-a": "rgba(255, 255, 255, 0.02)",
  "--tree-gap-stripe-b": "rgba(255, 255, 255, 0.05)",
  "--drawer-surface": "color-mix(in oklab, var(--ink-1) 97%, transparent)",
  "--drawer-border": "color-mix(in oklab, var(--brass) 24%, var(--line))",
  "--drawer-shadow": "-2rem 0 5rem color-mix(in oklab, black 54%, transparent), inset 0 1px color-mix(in oklab, white 5%, transparent)",
  "--drawer-backdrop-filter": "blur(22px)",
  "--preference-control-bg": "var(--ink-0)",
  "--preference-control-border": "var(--line)",
  "--preference-control-hover": "var(--ink-2)",
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
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isBuiltInFontFamily(value: string): boolean {
  return BUILT_IN_FONT_FAMILIES.includes(value as (typeof BUILT_IN_FONT_FAMILIES)[number]);
}

function normalizeFontFamily(value: unknown, availableFonts?: readonly string[]): string {
  const candidate = stringValue(value, DEFAULT_EDITOR_FONT_FAMILY);
  if (availableFonts === undefined) {
    return candidate;
  }
  if (isBuiltInFontFamily(candidate) || availableFonts.includes(candidate)) {
    return candidate;
  }
  return DEFAULT_EDITOR_FONT_FAMILY;
}

function quoteCssFontFamilyName(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function editorFontAlias(fontFamily: string): string {
  return `LCDiff Editor Font ${fontFamily}`;
}

export function editorFontFamilyForCss(fontFamily: string): string {
  const normalized = stringValue(fontFamily, DEFAULT_EDITOR_FONT_FAMILY);
  if (isBuiltInFontFamily(normalized)) {
    return normalized;
  }
  return `${quoteCssFontFamilyName(editorFontAlias(normalized))}, ${quoteCssFontFamilyName(normalized)}, ui-monospace, monospace`;
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
  const updates = isRecord(misc.updates) ? misc.updates : {};

  const oldColorPattern =
    appearance.colorMode === "light" || appearance.colorMode === "dark"
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
      updates: {
        autoCheck: booleanValue(
          updates.autoCheck,
          DEFAULT_UI_PREFERENCES.misc.updates.autoCheck,
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
  delete root.dataset.colorMode;
  delete root.dataset.theme;
  delete root.dataset.density;
  delete root.dataset.radius;
  delete root.dataset.motion;
  delete root.dataset.iconLabels;
  delete root.dataset.drawerWidth;
  delete root.dataset.searchResultsDensity;

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
