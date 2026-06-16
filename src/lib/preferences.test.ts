import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, themeToCssVariables } from "@/lib/themes";
import {
  applyPreferencesToRoot,
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  mergeUiPreferences,
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

  it("merges persisted partial values with defaults", () => {
    localStorage.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        appearance: { colorMode: "light", themeId: "github-light" },
        editor: { wordWrap: "on" },
      }),
    );

    expect(loadUiPreferences()).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      appearance: {
        ...DEFAULT_UI_PREFERENCES.appearance,
        colorMode: "light",
        themeId: "github-light",
      },
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        wordWrap: "on",
      },
    });
  });

  it("falls back to defaults for unknown enum values", () => {
    expect(
      mergeUiPreferences({
        appearance: {
          colorMode: "sepia",
          accent: "orange",
          density: "spacious",
        },
        typography: {
          editorScale: 20,
          uiFont: "comicSans",
        },
      }),
    ).toMatchObject({
      appearance: {
        colorMode: DEFAULT_UI_PREFERENCES.appearance.colorMode,
        accent: DEFAULT_UI_PREFERENCES.appearance.accent,
        density: DEFAULT_UI_PREFERENCES.appearance.density,
      },
      typography: {
        editorScale: DEFAULT_UI_PREFERENCES.typography.editorScale,
        uiFont: DEFAULT_UI_PREFERENCES.typography.uiFont,
      },
    });
  });

  it("falls back to default theme for unknown theme ids", () => {
    expect(
      mergeUiPreferences({
        appearance: { themeId: "missing-theme" },
      }).appearance.themeId,
    ).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to default theme when theme mode mismatches color mode", () => {
    expect(
      mergeUiPreferences({
        appearance: { colorMode: "dark", themeId: "github-light" },
      }).appearance.themeId,
    ).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to the light default theme when light mode has no persisted theme", () => {
    expect(
      mergeUiPreferences({
        appearance: { colorMode: "light" },
      }).appearance.themeId,
    ).toBe("github-light");
  });

  it("falls back to the light default theme for unknown light theme ids", () => {
    expect(
      mergeUiPreferences({
        appearance: { colorMode: "light", themeId: "missing-theme" },
      }).appearance.themeId,
    ).toBe("github-light");
  });

  it("falls back to the light default theme when persisted theme is dark", () => {
    expect(
      mergeUiPreferences({
        appearance: { colorMode: "light", themeId: "github-dark" },
      }).appearance.themeId,
    ).toBe("github-light");
  });

  it("writes preferences JSON to localStorage", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      editor: {
        ...DEFAULT_UI_PREFERENCES.editor,
        wordWrap: "on",
      },
    };

    saveUiPreferences(preferences);

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "")).toEqual(
      preferences,
    );
  });

  it("normalizes mismatched theme mode before saving preferences", () => {
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: {
        ...DEFAULT_UI_PREFERENCES.appearance,
        colorMode: "light",
        themeId: "github-dark",
      },
    };

    saveUiPreferences(preferences);

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "")).toMatchObject({
      appearance: {
        colorMode: "light",
        themeId: "github-light",
      },
    });
  });

  it("applies data attributes and CSS variables to the root element", () => {
    const root = document.createElement("div");
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: {
        ...DEFAULT_UI_PREFERENCES.appearance,
        accent: "blue",
        density: "comfortable",
        radius: "soft",
        motion: "reduced",
        iconLabels: "always",
      },
      typography: {
        ...DEFAULT_UI_PREFERENCES.typography,
        uiFont: "system",
        treeFont: "systemMono",
        editorFont: "systemMono",
        uiScale: 14,
        treeScale: 13,
        editorScale: 15,
      },
      layout: {
        preferencesDrawerWidth: "wide",
        searchResultsDensity: "comfortable",
      },
    };

    applyPreferencesToRoot(root, preferences);

    expect(root.dataset.colorMode).toBe("dark");
    expect(root.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(root.dataset.density).toBe("comfortable");
    expect(root.dataset.radius).toBe("soft");
    expect(root.dataset.motion).toBe("reduced");
    expect(root.dataset.iconLabels).toBe("always");
    expect(root.dataset.drawerWidth).toBe("wide");
    expect(root.dataset.searchResultsDensity).toBe("comfortable");
    expect(root.style.getPropertyValue("--primary")).toBe(
      themeToCssVariables(DEFAULT_THEME_ID, "blue")["--primary"],
    );
    expect(root.style.getPropertyValue("--font-sans")).toBe(
      "ui-sans-serif, system-ui, sans-serif",
    );
    expect(root.style.getPropertyValue("--font-tree")).toBe("ui-monospace, monospace");
    expect(root.style.getPropertyValue("--font-mono")).toBe("ui-monospace, monospace");
    expect(root.style.getPropertyValue("--ldiff-ui-font-size")).toBe("14px");
    expect(root.style.getPropertyValue("--ldiff-tree-font-size")).toBe("13px");
    expect(root.style.getPropertyValue("--ldiff-editor-font-size")).toBe("15px");
  });

  it("normalizes mismatched theme mode before applying preferences to root", () => {
    const root = document.createElement("div");
    const preferences: UiPreferences = {
      ...DEFAULT_UI_PREFERENCES,
      appearance: {
        ...DEFAULT_UI_PREFERENCES.appearance,
        colorMode: "light",
        themeId: "github-dark",
      },
    };

    applyPreferencesToRoot(root, preferences);

    expect(root.dataset.colorMode).toBe("light");
    expect(root.dataset.theme).toBe("github-light");
    expect(root.style.getPropertyValue("--background")).toBe(
      themeToCssVariables("github-light", "brass")["--background"],
    );
    expect(root.style.getPropertyValue("--background")).not.toBe(
      themeToCssVariables("github-dark", "brass")["--background"],
    );
    expect(root.style.getPropertyValue("--background")).not.toBe(
      themeToCssVariables(DEFAULT_THEME_ID, "brass")["--background"],
    );
  });
});
