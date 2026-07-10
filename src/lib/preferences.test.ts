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
  SYSTEM_MONO_FONT_FAMILY,
  SYSTEM_SANS_FONT_FAMILY,
  UI_PREFERENCES_STORAGE_KEY,
  type UiPreferences,
} from "@/lib/preferences";

function hexChannelToLinear(channel: string): number {
  const value = Number.parseInt(channel, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hexColor: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexColor);
  if (!match) {
    throw new Error(`Expected a six-digit hex color, received ${hexColor}`);
  }
  const [, red, green, blue] = match;
  return (
    0.2126 * hexChannelToLinear(red) +
    0.7152 * hexChannelToLinear(green) +
    0.0722 * hexChannelToLinear(blue)
  );
}

function contrastRatio(firstColor: string, secondColor: string): number {
  const firstLuminance = relativeLuminance(firstColor);
  const secondLuminance = relativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it("defaults update auto-check to enabled", () => {
    expect(loadUiPreferences().misc.updates.autoCheck).toBe(true);
  });

  it("keeps persisted update auto-check preference", () => {
    const preferences = mergeUiPreferences({
      misc: {
        updates: { autoCheck: false },
      },
    });

    expect(preferences.misc.updates.autoCheck).toBe(false);
  });

  it("normalizes invalid update preferences to defaults", () => {
    const preferences = mergeUiPreferences({
      misc: {
        updates: { autoCheck: "sometimes" },
      },
    });

    expect(preferences.misc.updates.autoCheck).toBe(true);
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

  it("keeps JD-Core decompiler engine selections", () => {
    expect(
      mergeUiPreferences({
        misc: { decompiler: { engine: "jdCore", ignoreTrimWhitespace: true } },
      }).misc.decompiler.engine,
    ).toBe("jdCore");
    expect(
      mergeUiPreferences({
        misc: { decompiler: { engine: "jdCoreV0", ignoreTrimWhitespace: true } },
      }).misc.decompiler.engine,
    ).toBe("jdCoreV0");
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

  it("keeps a custom font when no allowlist is provided", () => {
    const preferences = normalizeUiPreferences({
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "Menlo",
      },
    });

    expect(preferences.editor.fontFamily).toBe("Menlo");
  });

  it("falls back to the default editor font when an empty allowlist is provided", () => {
    const preferences = normalizeUiPreferences(
      {
        ...DEFAULT_UI_PREFERENCES,
        editor: {
          ...DEFAULT_UI_PREFERENCES.editor,
          fontFamily: "Menlo",
        },
      },
      [],
    );

    expect(preferences.editor.fontFamily).toBe(DEFAULT_EDITOR_FONT_FAMILY);
  });

  it("preserves built-in fallback font families even when not installed", () => {
    const monospacePreferences = normalizeUiPreferences(
      {
        ...DEFAULT_UI_PREFERENCES,
        editor: {
          ...DEFAULT_UI_PREFERENCES.editor,
          fontFamily: SYSTEM_MONO_FONT_FAMILY,
        },
      },
      [],
    );

    const sansPreferences = normalizeUiPreferences(
      {
        ...DEFAULT_UI_PREFERENCES,
        editor: {
          ...DEFAULT_UI_PREFERENCES.editor,
          fontFamily: SYSTEM_SANS_FONT_FAMILY,
        },
      },
      [],
    );

    expect(monospacePreferences.editor.fontFamily).toBe(SYSTEM_MONO_FONT_FAMILY);
    expect(sansPreferences.editor.fontFamily).toBe(SYSTEM_SANS_FONT_FAMILY);
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

  it("trims font-family strings before normalization and persistence", () => {
    const normalized = normalizeUiPreferences({
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "  Menlo  ",
      },
    });

    saveUiPreferences({
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        fontFamily: "  Menlo  ",
      },
    });

    expect(normalized.editor.fontFamily).toBe("Menlo");
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "")).toMatchObject({
      editor: { fontFamily: "Menlo" },
    });
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
    root.dataset.colorMode = "dark";
    root.dataset.theme = "github-dark";
    root.dataset.density = "compact";
    root.dataset.radius = "default";
    root.dataset.motion = "standard";
    root.dataset.iconLabels = "auto";
    root.dataset.drawerWidth = "wide";
    root.dataset.searchResultsDensity = "compact";
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
    expect(root.dataset.colorMode).toBeUndefined();
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.density).toBeUndefined();
    expect(root.dataset.radius).toBeUndefined();
    expect(root.dataset.motion).toBeUndefined();
    expect(root.dataset.iconLabels).toBeUndefined();
    expect(root.dataset.drawerWidth).toBeUndefined();
    expect(root.dataset.searchResultsDensity).toBeUndefined();
    expect(root.style.getPropertyValue("--background")).not.toBe("");
    expect(root.style.getPropertyValue("--font-mono")).toBe("");
    expect(root.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("");
  });

  it("applies light appearance tokens with distinct drawer-safe surfaces", () => {
    const root = document.createElement("div");

    applyPreferencesToRoot(
      root,
      { ...DEFAULT_UI_PREFERENCES, appearance: { colorPattern: "light" } },
      false,
    );

    expect(root.dataset.effectiveColorPattern).toBe("light");
    const background = root.style.getPropertyValue("--background");
    const ink0 = root.style.getPropertyValue("--ink-0");
    const ink1 = root.style.getPropertyValue("--ink-1");
    const ink2 = root.style.getPropertyValue("--ink-2");
    const popover = root.style.getPropertyValue("--popover");
    const input = root.style.getPropertyValue("--input");
    const line = root.style.getPropertyValue("--line");
    const text0 = root.style.getPropertyValue("--text-0");
    const text2 = root.style.getPropertyValue("--text-2");
    const drawerSurface = root.style.getPropertyValue("--drawer-surface");
    const drawerBorder = root.style.getPropertyValue("--drawer-border");
    const drawerShadow = root.style.getPropertyValue("--drawer-shadow");
    const preferenceControlBg = root.style.getPropertyValue("--preference-control-bg");
    const preferenceControlBorder = root.style.getPropertyValue("--preference-control-border");

    expect(background).not.toBe("");
    expect(popover).not.toBe("");
    expect(input).not.toBe("");
    expect(ink0).not.toBe("");
    expect(ink1).not.toBe("");
    expect(ink2).not.toBe("");
    expect(line).not.toBe("");
    expect(text0).not.toBe("");
    expect(text2).not.toBe("");
    expect(drawerSurface).not.toBe("");
    expect(drawerBorder).not.toBe("");
    expect(drawerShadow).not.toBe("");
    expect(preferenceControlBg).not.toBe("");
    expect(preferenceControlBorder).not.toBe("");
    expect(ink0).not.toBe(ink1);
    expect(ink0).not.toBe(ink2);
    expect(ink1).not.toBe(ink2);
    expect(popover).not.toBe(background);
    expect(input).not.toBe(background);
    expect(popover).not.toBe(input);
    expect(text0).not.toBe(text2);
    expect(drawerSurface).not.toContain("transparent");
    expect(drawerShadow).not.toContain("black 54%");
    expect(preferenceControlBg).not.toBe(background);
  });

  it("keeps light accent tokens readable for small text use", () => {
    const root = document.createElement("div");

    applyPreferencesToRoot(
      root,
      { ...DEFAULT_UI_PREFERENCES, appearance: { colorPattern: "light" } },
      false,
    );

    expect(
      contrastRatio(
        root.style.getPropertyValue("--primary"),
        root.style.getPropertyValue("--primary-foreground"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(root.style.getPropertyValue("--brass"), root.style.getPropertyValue("--ink-0")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        root.style.getPropertyValue("--brass-dim"),
        root.style.getPropertyValue("--ink-0"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        root.style.getPropertyValue("--text-0"),
        root.style.getPropertyValue("--preference-control-bg"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        root.style.getPropertyValue("--text-0"),
        root.style.getPropertyValue("--drawer-surface"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
