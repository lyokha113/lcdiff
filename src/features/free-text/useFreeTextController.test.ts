import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_TEXT_HISTORY_STORAGE_KEY } from "./free-text-history";
import { useFreeTextController } from "./useFreeTextController";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-29T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Free text controller", () => {
  it("updates only the requested draft", () => {
    const { result } = renderHook(() => useFreeTextController(vi.fn()));

    act(() => result.current.setDraft("left", "left only"));
    expect(result.current.draftLeft).toBe("left only");
    expect(result.current.draftRight).toBe("");

    act(() => result.current.setDraft("right", "right only"));
    expect(result.current.draftLeft).toBe("left only");
    expect(result.current.draftRight).toBe("right only");
  });

  it("clears drafts without clearing history", () => {
    const { result } = renderHook(() => useFreeTextController(vi.fn()));

    act(() => result.current.setDrafts("left", "right"));
    act(() => result.current.confirmDiff());
    act(() => result.current.clearDrafts());

    expect(result.current.draftLeft).toBe("");
    expect(result.current.draftRight).toBe("");
    expect(result.current.history).toHaveLength(1);
    expect(result.current.activeResultId).toBe(result.current.history[0]?.id);
    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toContain("left");
  });

  it("clears history without clearing drafts", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useFreeTextController(onMessage));

    act(() => result.current.setDrafts("left", "right"));
    act(() => result.current.confirmDiff());
    act(() => result.current.clearHistory());

    expect(result.current.draftLeft).toBe("left");
    expect(result.current.draftRight).toBe("right");
    expect(result.current.history).toEqual([]);
    expect(result.current.activeResultId).toBeUndefined();
    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(onMessage).toHaveBeenLastCalledWith("Free text history cleared.");
  });

  it("selects an older confirmed result", () => {
    const { result } = renderHook(() => useFreeTextController(vi.fn()));

    act(() => result.current.setDrafts("older left", "older right"));
    act(() => result.current.confirmDiff());
    vi.setSystemTime(new Date("2026-07-29T00:00:01Z"));
    act(() => result.current.setDrafts("newer left", "newer right"));
    act(() => result.current.confirmDiff());

    const olderId = result.current.history[1]?.id;
    act(() => result.current.selectResult(olderId!));

    expect(result.current.activeResultId).toBe(olderId);
  });
});
