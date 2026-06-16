import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  getAccent,
  getDefaultThemeForMode,
  getTheme,
  listAccents,
  listThemesByMode,
  themeToCssVariables,
  THEMES,
} from "@/lib/themes";

const REQUIRED_CSS_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--brass",
  "--brass-dim",
  "--ink-0",
  "--ink-1",
  "--ink-2",
  "--ink-3",
  "--line",
  "--line-soft",
  "--text-0",
  "--text-1",
  "--text-2",
  "--st-diff",
  "--st-only",
  "--st-same",
  "--danger",
] as const;

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
      "ldiff-graphite",
      "github-dark",
      "one-dark",
      "dracula",
      "monokai",
      "solarized-dark",
      "tokyo-night",
      "catppuccin-mocha",
    ]);
  });

  it("uses LDiff Graphite as the default dark theme", () => {
    expect(DEFAULT_THEME_ID).toBe("ldiff-graphite");
    expect(getTheme(DEFAULT_THEME_ID).label).toBe("LDiff Graphite");
  });

  it("uses the first registered theme as the default for each color mode", () => {
    expect(getDefaultThemeForMode("light").id).toBe("github-light");
    expect(getDefaultThemeForMode("dark").id).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to default theme for unknown ids", () => {
    expect(getTheme("missing-theme").id).toBe(DEFAULT_THEME_ID);
  });

  it("exposes required app and status CSS variables for every theme", () => {
    for (const theme of THEMES) {
      const variables = themeToCssVariables(theme.id, "brass");

      for (const variableName of REQUIRED_CSS_VARIABLES) {
        expect(variables[variableName]).toBeTruthy();
      }
    }
  });

  it("lists curated accents in deterministic order", () => {
    expect(listAccents().map((accent) => accent.id)).toEqual([
      "brass",
      "blue",
      "green",
      "violet",
      "rose",
    ]);
  });

  it("falls back to brass for unknown accent ids", () => {
    expect(getAccent("missing-accent").id).toBe("brass");
    expect(getAccent("toString").id).toBe("brass");
    expect(themeToCssVariables(DEFAULT_THEME_ID, "missing-accent")["--brass"]).toBe(
      getAccent("brass").primary,
    );
    expect(themeToCssVariables(DEFAULT_THEME_ID, "toString")["--brass"]).toBe(
      getAccent("brass").primary,
    );
  });
});
