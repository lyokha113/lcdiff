import { describe, expect, it } from "vitest";
import type { ComparePair, EntryPreview, ViewMode } from "@/lib/types";
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "@/lib/tabs";

function pair(path: string): ComparePair {
  return { path, status: "different", left: undefined, right: undefined };
}
function tab(path: string, lastFocus: number): DiffTab {
  return { path, pair: pair(path), preview: {} as Partial<Record<"left" | "right", EntryPreview>>, viewMode: "source" as ViewMode, lastFocus };
}

describe("upsertTab", () => {
  it("appends a new tab in insertion order", () => {
    const next = upsertTab([tab("a", 1)], tab("b", 2));
    expect(next.map((t) => t.path)).toEqual(["a", "b"]);
  });
  it("replaces an existing tab in place without reordering", () => {
    const next = upsertTab([tab("a", 1), tab("b", 2)], { ...tab("a", 3), viewMode: "bytecode" });
    expect(next.map((t) => t.path)).toEqual(["a", "b"]);
    expect(next[0].viewMode).toBe("bytecode");
  });
});

describe("evictLru", () => {
  it("returns the list unchanged when at or below the cap", () => {
    const list = [tab("a", 1), tab("b", 2)];
    expect(evictLru(list, 2)).toBe(list);
  });
  it("drops the lowest lastFocus when over the cap, preserving order", () => {
    const next = evictLru([tab("a", 5), tab("b", 1), tab("c", 9)], 2);
    expect(next.map((t) => t.path)).toEqual(["a", "c"]);
  });
});

describe("pickNeighbor", () => {
  it("returns the right neighbor of the closed path", () => {
    expect(pickNeighbor([tab("a", 1), tab("b", 2), tab("c", 3)], "b")).toBe("c");
  });
  it("returns the left neighbor when closing the last tab", () => {
    expect(pickNeighbor([tab("a", 1), tab("b", 2)], "b")).toBe("a");
  });
  it("returns 'files' when closing the only tab", () => {
    expect(pickNeighbor([tab("a", 1)], "a")).toBe("files");
  });
});
