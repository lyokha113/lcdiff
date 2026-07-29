import { describe, expect, it } from "vitest";
import type { ComparePair, EntryPreview } from "@/lib/types";
import type { DiffTab } from "./tabs";
import {
  emptyCompareWorkspace,
  focusCompareWorkspaceTab,
} from "./compare-workspace";

const pair: ComparePair = {
  path: "config.json",
  status: "different",
  left: { path: "config.json", kind: "text" },
  right: { path: "config.json", kind: "text" },
};

const leftPreview: EntryPreview = {
  path: "config.json",
  kind: "text",
  language: "json",
  content: "left",
};

const rightPreview: EntryPreview = {
  path: "config.json",
  kind: "text",
  language: "json",
  content: "right",
};

function tab(path: string, lastFocus: number): DiffTab {
  return {
    path,
    pair: { ...pair, path },
    preview: {
      left: { ...leftPreview, path },
      right: { ...rightPreview, path },
    },
    viewMode: "bytecode",
    lastFocus,
  };
}

describe("Compare workspace state", () => {
  it("starts on Files with no selected pair, previews, tabs, or edit buffer", () => {
    expect(emptyCompareWorkspace()).toEqual({
      preview: {},
      openTabs: [],
      activeTab: "files",
      editBuffer: "",
      viewMode: "source",
    });
  });

  it("focuses an existing tab without changing the other Compare tabs", () => {
    const first = tab("first.json", 2);
    const config = tab("config.json", 3);
    const state = {
      ...emptyCompareWorkspace(),
      openTabs: [first, config],
    };

    const next = focusCompareWorkspaceTab(state, "config.json", 7);

    expect(next).toMatchObject({
      selected: config.pair,
      preview: config.preview,
      activeTab: "config.json",
      editBuffer: "left",
      viewMode: "bytecode",
    });
    expect(next.openTabs).toEqual([
      first,
      { ...config, lastFocus: 7 },
    ]);
  });

  it("leaves Compare state unchanged when a requested tab no longer exists", () => {
    const state = {
      ...emptyCompareWorkspace(),
      openTabs: [tab("config.json", 3)],
    };

    expect(focusCompareWorkspaceTab(state, "missing.json", 7)).toBe(state);
  });
});
