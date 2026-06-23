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
