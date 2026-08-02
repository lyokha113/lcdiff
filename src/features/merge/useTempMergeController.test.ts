import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  applyTempMerge: vi.fn(),
  createTempTarget: vi.fn(),
  discardTempTarget: vi.fn(),
  previewMergeAllConflicts: vi.fn(),
  saveTempTargetAs: vi.fn(),
  stageTempMergeAll: vi.fn(),
}));

vi.mock("@/ipc/commands", () => commands);

import { useTempMergeController } from "./useTempMergeController";

const session = {
  id: "temp-merge-1",
  targetSide: "right" as const,
  workingName: "working.jar",
  entryCount: 4,
  appliedSourceCount: 0,
  exportedPath: null,
};

const appliedSession = { ...session, appliedSourceCount: 1 };
const preview = { newEntries: ["new.txt"], conflicts: ["same.txt"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("temporary merge controller", () => {
  it("publishes a created session only after create succeeds", async () => {
    let resolveCreate: ((value: typeof session) => void) | undefined;
    commands.createTempTarget.mockReturnValue(new Promise<typeof session>((resolve) => {
      resolveCreate = resolve;
    }));
    const { result } = renderHook(() => useTempMergeController());

    act(() => result.current.setCreateOpen(true));
    act(() => void result.current.create("left", { kind: "copyCurrent" }));

    expect(result.current.session).toBeUndefined();
    expect(result.current.createOpen).toBe(true);
    expect(result.current.busy).toBe("create");

    await act(async () => resolveCreate?.(session));

    expect(result.current.session).toEqual(session);
    expect(result.current.createOpen).toBe(false);
    expect(result.current.busy).toBeUndefined();
  });

  it("opens conflict review from preview without staging", async () => {
    commands.previewMergeAllConflicts.mockResolvedValue(preview);
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.previewMergeAll("left"));

    expect(result.current.conflictReview).toEqual(preview);
    expect(commands.stageTempMergeAll).not.toHaveBeenCalled();
  });

  it("clears conflict review and refreshes the session after Apply", async () => {
    commands.previewMergeAllConflicts.mockResolvedValue(preview);
    commands.applyTempMerge.mockResolvedValue(appliedSession);
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.previewMergeAll("left"));
    await act(async () => result.current.apply());

    expect(result.current.session).toEqual(appliedSession);
    expect(result.current.conflictReview).toBeUndefined();
  });

  it("keeps the session and exposes a retry error when Save As fails", async () => {
    commands.createTempTarget.mockResolvedValue(session);
    commands.saveTempTargetAs.mockRejectedValue(new Error("destination is unavailable"));
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.create("left", { kind: "copyCurrent" }));
    await act(async () => result.current.saveAs("/tmp/merged.jar"));

    expect(result.current.session).toEqual(session);
    expect(result.current.error).toBe("Error: destination is unavailable");
    expect(result.current.retryOperation).toBe("saveAs");
    expect(result.current.busy).toBeUndefined();
  });

  it("clears the session only after a successful discard", async () => {
    commands.createTempTarget.mockResolvedValue(session);
    commands.discardTempTarget.mockResolvedValue({ kind: "discarded" });
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.create("left", { kind: "copyCurrent" }));
    await act(async () => result.current.discard());

    expect(result.current.session).toBeUndefined();
    expect(result.current.retryOperation).toBeUndefined();
  });

  it("removes the stale session and permits only discard retry for retry-only cleanup", async () => {
    commands.createTempTarget.mockResolvedValue(session);
    commands.discardTempTarget.mockResolvedValue({
      kind: "retryDiscardOnly",
      message: "cleanup recovery is pending",
    });
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.create("left", { kind: "copyCurrent" }));
    await act(async () => result.current.discard());

    expect(result.current.session).toBeUndefined();
    expect(result.current.conflictReview).toBeUndefined();
    expect(result.current.error).toBe("cleanup recovery is pending");
    expect(result.current.retryOperation).toBe("discard");
  });

  it("does not start a second operation while the current request is pending", async () => {
    let resolveApply: ((value: typeof appliedSession) => void) | undefined;
    commands.createTempTarget.mockResolvedValue(session);
    commands.applyTempMerge.mockReturnValue(new Promise<typeof appliedSession>((resolve) => {
      resolveApply = resolve;
    }));
    const { result } = renderHook(() => useTempMergeController());

    await act(async () => result.current.create("left", { kind: "copyCurrent" }));
    act(() => void result.current.apply());
    act(() => void result.current.saveAs("/tmp/merged.jar"));
    await act(async () => resolveApply?.(appliedSession));

    expect(commands.saveTempTargetAs).not.toHaveBeenCalled();
    expect(result.current.session).toEqual(appliedSession);
  });
});
