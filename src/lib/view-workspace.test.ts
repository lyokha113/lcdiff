import { describe, expect, it } from "vitest";
import type { EntryPreview, ViewEntryTab, ViewSource } from "./types";
import {
  closeViewSource,
  focusViewEntryTab,
  openViewSource,
  upsertViewEntryTab,
} from "./view-workspace";

function source(id: string, path: string): ViewSource {
  return {
    sourceId: id,
    path,
    metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
    entries: [],
    nestedPairs: {},
    entryTabs: [],
  };
}

function preview(path: string): EntryPreview {
  return { path, kind: "text", language: "plaintext", content: path };
}

function tab(path: string, lastFocus: number): ViewEntryTab {
  return {
    entryPath: path,
    preview: preview(path),
    viewMode: "source",
    lastFocus,
  };
}

describe("view workspace state", () => {
  it("opens sources and makes the newest source active", () => {
    const first = openViewSource({ sources: [], activeSourceId: undefined }, source("s1", "/a.jar"));
    const second = openViewSource(first, source("s2", "/b.jar"));

    expect(second.sources.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
    expect(second.activeSourceId).toBe("s2");
  });

  it("replaces an existing source without moving it", () => {
    const state = {
      sources: [source("s1", "/old.jar"), source("s2", "/b.jar")],
      activeSourceId: "s2",
    };

    const next = openViewSource(state, source("s1", "/new.jar"));

    expect(next.sources.map((item) => item.path)).toEqual(["/new.jar", "/b.jar"]);
    expect(next.activeSourceId).toBe("s1");
  });

  it("keeps entry tabs isolated by source", () => {
    const state = {
      sources: [
        { ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] },
        { ...source("s2", "/b.jar"), entryTabs: [tab("B.class", 2)] },
      ],
      activeSourceId: "s1",
    };

    const next = upsertViewEntryTab(state, "s1", tab("C.class", 3), 10);

    expect(next.sources[0].entryTabs.map((entry) => entry.entryPath)).toEqual(["A.class", "C.class"]);
    expect(next.sources[1].entryTabs.map((entry) => entry.entryPath)).toEqual(["B.class"]);
  });

  it("ignores upserts for a missing source", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    };

    const next = upsertViewEntryTab(state, "missing", tab("B.class", 2), 10);

    expect(next).toEqual(state);
  });

  it("evicts least recently focused tabs within one source only", () => {
    const state = {
      sources: [
        { ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1), tab("B.class", 2)] },
        { ...source("s2", "/b.jar"), entryTabs: [tab("Other.class", 1)] },
      ],
      activeSourceId: "s1",
    };

    const next = upsertViewEntryTab(state, "s1", tab("C.class", 3), 2);

    expect(next.sources[0].entryTabs.map((entry) => entry.entryPath)).toEqual(["B.class", "C.class"]);
    expect(next.sources[1].entryTabs.map((entry) => entry.entryPath)).toEqual(["Other.class"]);
  });

  it("trims repeatedly until the source is within cap", () => {
    const state = {
      sources: [
        { ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1), tab("B.class", 2), tab("C.class", 3), tab("D.class", 4)] },
      ],
      activeSourceId: "s1",
      activeEntryPath: "D.class",
    };

    const next = upsertViewEntryTab(state, "s1", tab("E.class", 5), 2);

    expect(next.sources[0].entryTabs.map((entry) => entry.entryPath)).toEqual(["D.class", "E.class"]);
  });

  it("keeps focus state unchanged for a missing source", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    };

    const next = focusViewEntryTab(state, "missing", "B.class", 4);

    expect(next).toEqual(state);
  });

  it("ignores focus for a missing entry in an existing source", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    };

    const next = focusViewEntryTab(state, "s1", "Missing.class", 5);

    expect(next).toEqual(state);
  });

  it("focuses one entry tab for the active source", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: undefined,
    };

    expect(focusViewEntryTab(state, "s1", "A.class", 4)).toMatchObject({
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    });
  });

  it("drops all entry tabs when cap is zero", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    };

    const next = upsertViewEntryTab(state, "s1", tab("B.class", 2), 0);

    expect(next.sources[0].entryTabs).toEqual([]);
    expect(next.activeEntryPath).toBeUndefined();
  });

  it("closes a source and activates a neighbor", () => {
    const state = {
      sources: [source("s1", "/a.jar"), source("s2", "/b.jar"), source("s3", "/c.jar")],
      activeSourceId: "s2",
      activeEntryPath: "B.class",
    };

    const next = closeViewSource(state, "s2");

    expect(next.sources.map((item) => item.sourceId)).toEqual(["s1", "s3"]);
    expect(next.activeSourceId).toBe("s3");
    expect(next.activeEntryPath).toBeUndefined();
  });
});
