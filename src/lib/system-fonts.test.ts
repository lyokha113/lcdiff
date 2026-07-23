import { describe, expect, it } from "vitest";
import {
  FALLBACK_SYSTEM_FONTS,
  installedFontFaceCss,
  installedFontFacesCss,
  normalizeSystemFonts,
  type SystemFont,
} from "@/lib/system-fonts";
import { DEFAULT_EDITOR_FONT_FAMILY, editorFontAlias } from "@/lib/preferences";

describe("system font helpers", () => {
  it("sorts monospace fonts first and removes duplicate families", () => {
    const fonts: SystemFont[] = [
      { family: "Helvetica Neue", monospaceLikely: false },
      {
        family: "Menlo",
        monospaceLikely: true,
        localNames: ["Menlo-Regular", "Menlo"],
        fontFile: "/System/Library/Fonts/Menlo.ttc",
      },
      { family: "menlo", monospaceLikely: true, localNames: ["menlo"] },
      { family: "Arial", monospaceLikely: false },
    ];

    const normalized = normalizeSystemFonts(fonts);

    expect(normalized.map((font) => font.family)).toEqual([
      DEFAULT_EDITOR_FONT_FAMILY,
      "Menlo",
      "ui-monospace, monospace",
      "Arial",
      "Helvetica Neue",
      "ui-sans-serif, system-ui, sans-serif",
    ]);
    expect(normalized[1]?.localNames).toEqual(["Menlo-Regular", "Menlo"]);
    expect(normalized[1]?.fontFile).toBe("/System/Library/Fonts/Menlo.ttc");
  });

  it("uses fallback choices when native enumeration returns nothing", () => {
    expect(normalizeSystemFonts([])).toEqual(FALLBACK_SYSTEM_FONTS);
  });

  it("keeps fallback results isolated from later callers", () => {
    const first = normalizeSystemFonts([]);
    first[0].family = "Mutated";
    first[0].monospaceLikely = false;

    expect(normalizeSystemFonts([])).toEqual(FALLBACK_SYSTEM_FONTS);
    expect(FALLBACK_SYSTEM_FONTS).toEqual([
      { family: DEFAULT_EDITOR_FONT_FAMILY, monospaceLikely: true },
      { family: "ui-monospace, monospace", monospaceLikely: true },
      { family: "ui-sans-serif, system-ui, sans-serif", monospaceLikely: false },
    ]);
  });

  it("creates an isolated CSS alias for installed editor fonts", () => {
    expect(editorFontAlias("Fira Code")).toBe("LCDiff Editor Font Fira Code");
    expect(installedFontFaceCss({
      family: "Fira Code",
      monospaceLikely: true,
      fontFile: "/Users/lyo/Library/Fonts/FiraCode-Regular.ttf",
      localNames: ["FiraCode-Regular", "Fira Code Regular", "Fira Code"],
    }, (path) => `asset://localhost/${path}`)).toBe(
      '@font-face{font-family:"LCDiff Editor Font Fira Code";src:url("asset://localhost//Users/lyo/Library/Fonts/FiraCode-Regular.ttf"), local("FiraCode-Regular"), local("Fira Code Regular"), local("Fira Code");font-weight:400;font-style:normal;font-display:block;}',
    );
  });

  it("omits font-face rules when native names are unavailable", () => {
    expect(installedFontFaceCss({ family: "Menlo", monospaceLikely: true })).toBeUndefined();
    expect(installedFontFacesCss([{ family: "Menlo", monospaceLikely: true }])).toBe("");
  });
});
