import { describe, expect, it } from "vitest";
import { statusPresentation } from "@/lib/status";
import type { PairStatus } from "@/lib/types";

describe("statusPresentation", () => {
  const cases: Array<[PairStatus, string, string, string]> = [
    ["different", "M", "modified", "status-different"],
    ["differentMetadataOnly", "M̃", "meta only", "status-meta"],
    ["onlyLeft", "+", "left only", "status-onlyLeft"],
    ["onlyRight", "−", "right only", "status-onlyRight"],
    ["identical", "≡", "identical", "status-identical"],
  ];
  it.each(cases)("maps %s", (status, glyph, label, className) => {
    const p = statusPresentation(status);
    expect(p.glyph).toBe(glyph);
    expect(p.label).toBe(label);
    expect(p.className).toBe(className);
  });
});
