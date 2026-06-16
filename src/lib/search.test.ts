import { describe, expect, it } from "vitest";
import {
  groupSearchResults,
  labelForSearchContext,
  labelForSearchKind,
  searchContextForActiveTab,
  searchResultKey,
} from "@/lib/search";
import type { SearchResult } from "@/lib/types";

const results: SearchResult[] = [
  { side: "left", path: "pkg/App.class", kind: "path", tier: "T2" },
  { side: "left", path: "pkg/App.class", kind: "constantPool", tier: "T2" },
  { side: "right", path: "config/app.properties", kind: "text", tier: "T2", line: 4, preview: "needle=value" },
  { side: "right", path: "pkg/App.class", kind: "source", tier: "T3", line: 12 },
];

describe("search helpers", () => {
  it("builds stable keys from side path kind and line", () => {
    expect(searchResultKey(results[2])).toBe("right:config/app.properties:text:4");
  });

  it("groups results by kind in display order", () => {
    expect(groupSearchResults(results, "kind").map((group) => [group.id, group.label, group.results.length])).toEqual([
      ["path", "Path", 1],
      ["constantPool", "Constants", 1],
      ["text", "Text", 1],
      ["source", "Source", 1],
    ]);
  });

  it("groups results by side", () => {
    expect(groupSearchResults(results, "side").map((group) => [group.id, group.label, group.results.length])).toEqual([
      ["left", "Left", 2],
      ["right", "Right", 2],
    ]);
  });

  it("labels search kinds and contexts", () => {
    expect(labelForSearchKind("constantPool")).toBe("Constants");
    expect(labelForSearchContext("files")).toBe("Files index");
    expect(labelForSearchContext("diff")).toBe("Current diff");
  });

  it("derives context from active tab", () => {
    expect(searchContextForActiveTab("files")).toBe("files");
    expect(searchContextForActiveTab("pkg/App.class")).toBe("diff");
  });
});
