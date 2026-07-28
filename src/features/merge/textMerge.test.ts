import { describe, expect, it } from "vitest";
import { applyHunk, moveHunk, type Hunk } from "./textMerge";

describe("applyHunk", () => {
  it("replaces target lines with source lines", () => {
    const target = "1\n2\n3\n";
    const source = "1\nX\n3\n";
    const hunk: Hunk = { targetStart: 2, targetEnd: 2, sourceStart: 2, sourceEnd: 2 };
    expect(applyHunk(target, source, hunk)).toBe("1\nX\n3\n");
  });

  it("handles insertion (target range empty)", () => {
    const target = "1\n3\n";
    const source = "1\n2\n3\n";
    const hunk: Hunk = { targetStart: 2, targetEnd: 1, sourceStart: 2, sourceEnd: 2 };
    expect(applyHunk(target, source, hunk)).toBe("1\n2\n3\n");
  });
});

describe("moveHunk", () => {
  it("adds to target and removes from source", () => {
    const target = "1\n3\n";
    const source = "1\n2\n3\n";
    const hunk: Hunk = { targetStart: 2, targetEnd: 1, sourceStart: 2, sourceEnd: 2 };
    const { target: t, source: s } = moveHunk(target, source, hunk);
    expect(t).toBe("1\n2\n3\n");
    expect(s).toBe("1\n3\n");
  });
});
