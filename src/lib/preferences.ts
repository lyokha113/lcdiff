import {
  DEFAULT_THEME_ID,
  getAccent,
  getDefaultThemeForMode,
  getTheme,
  themeToCssVariables,
  type AccentId,
  type ColorMode,
} from "@/lib/themes";

export const UI_PREFERENCES_STORAGE_KEY = "ldiff.uiPreferences.v1";

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

const COLOR_MODES = ["light", "dark"] as const;
const DENSITIES = ["compact", "comfortable"] as const;
const RADII = ["sharp", "default", "soft"] as const;
const MOTIONS = ["reduced", "standard"] as const;
const ICON_LABELS = ["auto", "always", "iconsOnly"] as const;
const UI_FONTS = ["geist", "bricolage", "system"] as const;
const MONO_FONTS = ["jetbrainsMono", "systemMono"] as const;
const FONT_SCALES = [12, 13, 14, 15, 16] as const;
const TOGGLES = ["on", "off"] as const;
const DRAWER_WIDTHS = ["default", "wide"] as const;
const RESULT_GROUPINGS = ["kind", "side"] as const;

const SANS_FONT_FAMILIES: Record<FontId, string> = {
  geist: "\"Geist Variable\", ui-sans-serif, system-ui, sans-serif",
  bricolage: "\"Bricolage Grotesque Variable\", ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, sans-serif",
};

const MONO_FONT_FAMILIES: Record<MonoFontId, string> = {
  jetbrainsMono: "\"JetBrains Mono Variable\", ui-monospace, monospace",
  systemMono: "ui-monospace, monospace",
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

function themeIdValue(value: unknown, colorMode: ColorMode): string {
  if (typeof value !== "string") {
    return getDefaultThemeForMode(colorMode).id;
  }

  const theme = getTheme(value);
  if (theme.id !== value || theme.mode !== colorMode) {
    return getDefaultThemeForMode(colorMode).id;
  }

  return theme.id;
}

function normalizeUiPreferencesInput(raw: unknown): UiPreferences {
  const input = isRecord(raw) ? raw : {};
  const appearance = isRecord(input.appearance) ? input.appearance : {};
  const typography = isRecord(input.typography) ? input.typography : {};
  const editor = isRecord(input.editor) ? input.editor : {};
  const layout = isRecord(input.layout) ? input.layout : {};
  const search = isRecord(input.search) ? input.search : {};

  const colorMode = enumValue(
    appearance.colorMode,
    COLOR_MODES,
    DEFAULT_UI_PREFERENCES.appearance.colorMode,
  );

  return {
    appearance: {
      colorMode,
      themeId: themeIdValue(appearance.themeId, colorMode),
      accent: getAccent(
        typeof appearance.accent === "string"
          ? appearance.accent
          : DEFAULT_UI_PREFERENCES.appearance.accent,
      ).id,
      density: enumValue(
        appearance.density,
        DENSITIES,
        DEFAULT_UI_PREFERENCES.appearance.density,
      ),
      radius: enumValue(appearance.radius, RADII, DEFAULT_UI_PREFERENCES.appearance.radius),
      motion: enumValue(appearance.motion, MOTIONS, DEFAULT_UI_PREFERENCES.appearance.motion),
      iconLabels: enumValue(
        appearance.iconLabels,
        ICON_LABELS,
        DEFAULT_UI_PREFERENCES.appearance.iconLabels,
      ),
    },
    typography: {
      uiFont: enumValue(typography.uiFont, UI_FONTS, DEFAULT_UI_PREFERENCES.typography.uiFont),
      treeFont: enumValue(
        typography.treeFont,
        MONO_FONTS,
        DEFAULT_UI_PREFERENCES.typography.treeFont,
      ),
      editorFont: enumValue(
        typography.editorFont,
        MONO_FONTS,
        DEFAULT_UI_PREFERENCES.typography.editorFont,
      ),
      uiScale: enumValue(
        typography.uiScale,
        FONT_SCALES,
        DEFAULT_UI_PREFERENCES.typography.uiScale,
      ),
      treeScale: enumValue(
        typography.treeScale,
        FONT_SCALES,
        DEFAULT_UI_PREFERENCES.typography.treeScale,
      ),
      editorScale: enumValue(
        typography.editorScale,
        FONT_SCALES,
        DEFAULT_UI_PREFERENCES.typography.editorScale,
      ),
    },
    editor: {
      wordWrap: enumValue(editor.wordWrap, TOGGLES, DEFAULT_UI_PREFERENCES.editor.wordWrap),
      lineNumbers: enumValue(
        editor.lineNumbers,
        TOGGLES,
        DEFAULT_UI_PREFERENCES.editor.lineNumbers,
      ),
      minimap: enumValue(editor.minimap, TOGGLES, DEFAULT_UI_PREFERENCES.editor.minimap),
    },
    layout: {
      preferencesDrawerWidth: enumValue(
        layout.preferencesDrawerWidth,
        DRAWER_WIDTHS,
        DEFAULT_UI_PREFERENCES.layout.preferencesDrawerWidth,
      ),
      searchResultsDensity: enumValue(
        layout.searchResultsDensity,
        DENSITIES,
        DEFAULT_UI_PREFERENCES.layout.searchResultsDensity,
      ),
    },
    search: {
      includeSourceByDefault: booleanValue(
        search.includeSourceByDefault,
        DEFAULT_UI_PREFERENCES.search.includeSourceByDefault,
      ),
      resultGrouping: enumValue(
        search.resultGrouping,
        RESULT_GROUPINGS,
        DEFAULT_UI_PREFERENCES.search.resultGrouping,
      ),
    },
  };
}

export function normalizeUiPreferences(preferences: UiPreferences): UiPreferences {
  return normalizeUiPreferencesInput(preferences);
}

export function mergeUiPreferences(raw: unknown): UiPreferences {
  return normalizeUiPreferencesInput(raw);
}

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    return mergeUiPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return mergeUiPreferences(undefined);
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  localStorage.setItem(
    UI_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeUiPreferences(preferences)),
  );
}

export function applyPreferencesToRoot(
  root: HTMLElement,
  preferences: UiPreferences,
): void {
  const normalizedPreferences = normalizeUiPreferences(preferences);

  root.dataset.colorMode = normalizedPreferences.appearance.colorMode;
  root.dataset.theme = normalizedPreferences.appearance.themeId;
  root.dataset.density = normalizedPreferences.appearance.density;
  root.dataset.radius = normalizedPreferences.appearance.radius;
  root.dataset.motion = normalizedPreferences.appearance.motion;
  root.dataset.iconLabels = normalizedPreferences.appearance.iconLabels;
  root.dataset.drawerWidth = normalizedPreferences.layout.preferencesDrawerWidth;
  root.dataset.searchResultsDensity = normalizedPreferences.layout.searchResultsDensity;

  const themeVariables = themeToCssVariables(
    normalizedPreferences.appearance.themeId,
    normalizedPreferences.appearance.accent,
  );
  for (const [name, value] of Object.entries(themeVariables)) {
    root.style.setProperty(name, value);
  }

  root.style.setProperty(
    "--font-sans",
    SANS_FONT_FAMILIES[normalizedPreferences.typography.uiFont],
  );
  root.style.setProperty(
    "--font-tree",
    MONO_FONT_FAMILIES[normalizedPreferences.typography.treeFont],
  );
  root.style.setProperty(
    "--font-mono",
    MONO_FONT_FAMILIES[normalizedPreferences.typography.editorFont],
  );
  root.style.setProperty(
    "--ldiff-ui-font-size",
    `${normalizedPreferences.typography.uiScale}px`,
  );
  root.style.setProperty(
    "--ldiff-tree-font-size",
    `${normalizedPreferences.typography.treeScale}px`,
  );
  root.style.setProperty(
    "--ldiff-editor-font-size",
    `${normalizedPreferences.typography.editorScale}px`,
  );
}
