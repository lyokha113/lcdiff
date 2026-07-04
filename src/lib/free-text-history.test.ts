import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFreeTextHistory,
  FREE_TEXT_HISTORY_LIMIT,
  FREE_TEXT_HISTORY_STORAGE_KEY,
  loadFreeTextHistory,
  recordFreeTextResult,
} from "./free-text-history";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Free text history", () => {
  it("stores confirmed results newest first", () => {
    const first = recordFreeTextResult({ left: "a", right: "b", createdAt: 1000 });
    const second = recordFreeTextResult({ left: "c", right: "d", createdAt: 2000 });

    expect(second.map((entry) => entry.id)).toEqual([
      "free-text:2000:1:1",
      "free-text:1000:1:1",
    ]);
    expect(first[0]).toMatchObject({
      id: "free-text:1000:1:1",
      left: "a",
      right: "b",
      title: "Same length edit",
      summary: "1 char left -> 1 char right / same length",
    });
  });

  it("persists through localStorage", () => {
    recordFreeTextResult({ left: "left text", right: "right text", createdAt: 3000 });

    expect(loadFreeTextHistory()).toEqual([
      {
        id: "free-text:3000:9:10",
        left: "left text",
        right: "right text",
        createdAt: 3000,
        title: "Grew by 1 char",
        summary: "9 chars left -> 10 chars right / +1 char",
      },
    ]);
  });

  it("uses timeline summaries instead of length-only titles", () => {
    const [entry] = recordFreeTextResult({
      left: "first line\nwith extra    spacing and a very long continuation",
      right: "",
      createdAt: 3500,
    });

    expect(entry.title).toBe("Shrank by 61 chars");
    expect(entry.summary).toBe("61 chars left -> empty right / -61 chars");
  });

  it("limits history to the newest confirmed results", () => {
    for (let i = 0; i < FREE_TEXT_HISTORY_LIMIT + 3; i += 1) {
      recordFreeTextResult({ left: `L${i}`, right: `R${i}`, createdAt: i });
    }

    const list = loadFreeTextHistory();
    expect(list).toHaveLength(FREE_TEXT_HISTORY_LIMIT);
    expect(list[0].createdAt).toBe(FREE_TEXT_HISTORY_LIMIT + 2);
    expect(list.at(-1)?.createdAt).toBe(3);
  });

  it("discards corrupt storage", () => {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, "{broken");

    expect(loadFreeTextHistory()).toEqual([]);
  });

  it("returns an empty Free text history when localStorage read fails", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(loadFreeTextHistory()).toEqual([]);
    expect(getItemSpy).toHaveBeenCalledWith(FREE_TEXT_HISTORY_STORAGE_KEY);

    getItemSpy.mockRestore();
  });

  it("filters malformed entries from valid JSON arrays", () => {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify([
      { id: "bad", left: 1, right: "r", createdAt: 1, title: "bad", summary: "bad" },
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Empty vs 1 char", summary: "Left empty, right 1 char" },
    ]));

    expect(loadFreeTextHistory()).toEqual([
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Grew by 1 char", summary: "empty left -> 1 char right / +1 char" },
    ]);
  });

  it("rejects non-finite timestamps from overflowed JSON numbers", () => {
    localStorage.setItem(
      FREE_TEXT_HISTORY_STORAGE_KEY,
      '[{"id":"bad","left":"x","right":"y","createdAt":1e999,"title":"Bad","summary":"Bad"},{"id":"ok","left":"","right":"r","createdAt":2,"title":"Empty vs 1 char","summary":"Left empty, right 1 char"}]',
    );

    expect(loadFreeTextHistory()).toEqual([
      {
        id: "ok",
        left: "",
        right: "r",
        createdAt: 2,
        title: "Grew by 1 char",
        summary: "empty left -> 1 char right / +1 char",
      },
    ]);
  });

  it("dedupes duplicate ids from stored history", () => {
    localStorage.setItem(
      FREE_TEXT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "dup",
          left: "older",
          right: "value",
          createdAt: 1000,
          title: "Older",
          summary: "Older",
        },
        {
          id: "dup",
          left: "newer",
          right: "value",
          createdAt: 2000,
          title: "Newer",
          summary: "Newer",
        },
      ]),
    );

    expect(loadFreeTextHistory()).toEqual([
      {
        id: "dup",
        left: "newer",
        right: "value",
        createdAt: 2000,
        title: "Same length edit",
        summary: "5 chars left -> 5 chars right / same length",
      },
    ]);
  });

  it("normalizes out-of-order stored history to newest first", () => {
    localStorage.setItem(
      FREE_TEXT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "older",
          left: "old",
          right: "value",
          createdAt: 1000,
          title: "Older",
          summary: "Older",
        },
        {
          id: "newer",
          left: "new",
          right: "value",
          createdAt: 2000,
          title: "Newer",
          summary: "Newer",
        },
      ]),
    );

    expect(loadFreeTextHistory().map((entry) => entry.id)).toEqual(["newer", "older"]);
  });

  it("assigns a suffixed id when the base id already exists", () => {
    const first = recordFreeTextResult({ left: "ab", right: "cd", createdAt: 5000 });
    const second = recordFreeTextResult({ left: "ef", right: "gh", createdAt: 5000 });

    expect(first[0].id).toBe("free-text:5000:2:2");
    expect(second.map((entry) => entry.id)).toEqual([
      "free-text:5000:2:2:1",
      "free-text:5000:2:2",
    ]);
    expect(loadFreeTextHistory().map((entry) => entry.id)).toEqual([
      "free-text:5000:2:2:1",
      "free-text:5000:2:2",
    ]);
  });

  it("does not throw when localStorage write fails", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() =>
      recordFreeTextResult({ left: "large left", right: "large right", createdAt: 6000 }),
    ).not.toThrow();
    expect(loadFreeTextHistory()).toEqual([]);
    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it("clears only free text history storage", () => {
    localStorage.setItem("lcdiff.history", "keep");
    recordFreeTextResult({ left: "a", right: "b", createdAt: 4000 });

    clearFreeTextHistory();

    expect(loadFreeTextHistory()).toEqual([]);
    expect(localStorage.getItem("lcdiff.history")).toBe("keep");
  });

  it("does not throw when Free text history removal fails", () => {
    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => clearFreeTextHistory()).not.toThrow();
    expect(removeItemSpy).toHaveBeenCalledWith(FREE_TEXT_HISTORY_STORAGE_KEY);

    removeItemSpy.mockRestore();
  });
});
