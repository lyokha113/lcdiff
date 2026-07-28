import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFreeTextHistory,
  FREE_TEXT_HISTORY_LIMIT,
  loadFreeTextHistory,
  recordFreeTextResult,
} from "./free-text-history";

describe("free text history", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("records newest first and replaces a duplicate timestamp", () => {
    recordFreeTextResult({ left: "old", right: "", createdAt: 1 });
    recordFreeTextResult({ left: "abc", right: "", createdAt: 2 });
    recordFreeTextResult({ left: "new", right: "", createdAt: 2 });
    expect(loadFreeTextHistory().map((entry) => entry.left)).toEqual(["new", "old"]);
  });

  it("keeps only the latest entries", () => {
    for (let index = 0; index <= FREE_TEXT_HISTORY_LIMIT; index += 1) {
      recordFreeTextResult({ left: String(index), right: "", createdAt: index });
    }
    expect(loadFreeTextHistory()).toHaveLength(FREE_TEXT_HISTORY_LIMIT);
  });

  it("ignores invalid storage", () => {
    localStorage.setItem("lcdiff.freeTextHistory.v1", "not json");
    expect(loadFreeTextHistory()).toEqual([]);
  });

  it("keeps comparison non-blocking when localStorage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });

    expect(loadFreeTextHistory()).toEqual([]);
    expect(recordFreeTextResult({ left: "a", right: "b", createdAt: 1 })).toHaveLength(1);
    getItem.mockRestore();
  });

  it("clears history", () => {
    recordFreeTextResult({ left: "a", right: "b", createdAt: 1 });
    clearFreeTextHistory();
    expect(loadFreeTextHistory()).toEqual([]);
  });
});
