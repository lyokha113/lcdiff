import { beforeEach, describe, expect, it } from "vitest";
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

describe("free text history", () => {
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
      title: "1 char vs 1 char",
      summary: "Left 1 char, right 1 char",
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
        title: "9 chars vs 10 chars",
        summary: "Left 9 chars, right 10 chars",
      },
    ]);
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

  it("filters malformed entries from valid JSON arrays", () => {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify([
      { id: "bad", left: 1, right: "r", createdAt: 1, title: "bad", summary: "bad" },
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Empty vs 1 char", summary: "Left empty, right 1 char" },
    ]));

    expect(loadFreeTextHistory()).toEqual([
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Empty vs 1 char", summary: "Left empty, right 1 char" },
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
        title: "Newer",
        summary: "Newer",
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

  it("clears only free text history storage", () => {
    localStorage.setItem("lcdiff.history", "keep");
    recordFreeTextResult({ left: "a", right: "b", createdAt: 4000 });

    clearFreeTextHistory();

    expect(loadFreeTextHistory()).toEqual([]);
    expect(localStorage.getItem("lcdiff.history")).toBe("keep");
  });
});
