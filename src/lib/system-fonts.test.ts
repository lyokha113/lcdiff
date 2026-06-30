import { describe, expect, it } from "vitest";
import {
  FALLBACK_SYSTEM_FONTS,
  normalizeSystemFonts,
  type SystemFont,
} from "@/lib/system-fonts";
import { DEFAULT_EDITOR_FONT_FAMILY } from "@/lib/preferences";

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
});
