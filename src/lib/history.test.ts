import { beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  type HistoryEntry,
  clearHistory,
  entryKey,
  loadHistory,
  recordSession,
} from "@/lib/history";

beforeEach(() => {
  localStorage.clear();
});

describe("entryKey", () => {
  it("is stable for same mode + paths", () => {
    expect(entryKey("compare", ["a.jar", "b.jar"])).toBe(
      entryKey("compare", ["a.jar", "b.jar"]),
    );
  });

  it("differs when mode differs", () => {
    expect(entryKey("single", ["a.jar"])).not.toBe(entryKey("compare", ["a.jar"]));
  });

  it("is order-sensitive for paths", () => {
    expect(entryKey("compare", ["a.jar", "b.jar"])).not.toBe(
      entryKey("compare", ["b.jar", "a.jar"]),
    );
  });
});

describe("loadHistory", () => {
  it("returns [] when nothing stored", () => {
    expect(loadHistory()).toEqual([]);
  });

  it("returns [] on malformed JSON instead of throwing", () => {
    localStorage.setItem("lcdiff.history", "{not json");
    expect(loadHistory()).toEqual([]);
  });

  it("returns [] when stored value is not an array", () => {
    localStorage.setItem("lcdiff.history", JSON.stringify({ nope: true }));
    expect(loadHistory()).toEqual([]);
  });
});

describe("recordSession", () => {
  it("adds a new entry at the top", () => {
    recordSession("single", ["a.jar"], 1000);
    const next = recordSession("compare", ["b.jar", "c.jar"], 2000);
    expect(next.map((e) => e.mode)).toEqual(["compare", "single"]);
    expect(next[0].paths).toEqual(["b.jar", "c.jar"]);
    expect(next[0].openedAt).toBe(2000);
  });

  it("persists to localStorage", () => {
    recordSession("single", ["a.jar"], 1000);
    expect(loadHistory()).toHaveLength(1);
  });

  it("dedupes same mode + paths by moving to top with fresh time", () => {
    recordSession("single", ["a.jar"], 1000);
    recordSession("compare", ["b.jar", "c.jar"], 2000);
    const next = recordSession("single", ["a.jar"], 3000);
    expect(next).toHaveLength(2);
    expect(next[0].mode).toBe("single");
    expect(next[0].openedAt).toBe(3000);
  });

  it("caps at HISTORY_LIMIT, evicting the oldest", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      list = recordSession("single", [`file-${i}.jar`], i);
    }
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].paths).toEqual([`file-${HISTORY_LIMIT + 4}.jar`]);
    expect(list.some((e) => e.paths[0] === "file-0.jar")).toBe(false);
  });
});

describe("clearHistory", () => {
  it("empties the stored history", () => {
    recordSession("single", ["a.jar"], 1000);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});
