import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ViewWorkspaceState } from "@/lib/types";

vi.mock("@/features/workspace/monaco-runtime", () => ({}));
vi.mock("@/ipc/commands", () => ({
  disassemble: vi.fn(),
  disassembleViewEntry: vi.fn(),
  prefetchSiblings: vi.fn(),
  readEntry: vi.fn(),
  readViewEntry: vi.fn(),
}));

import { useWorkspaceController } from "./useWorkspaceController";

const viewWorkspace: ViewWorkspaceState = { sources: [] };

function renderController(mode: "compare" | "single") {
  return renderHook(() =>
    useWorkspaceController({
      mode,
      setPairs: vi.fn(),
      viewWorkspace,
      setViewWorkspace: vi.fn(),
      selectedSearchResult: undefined,
      isCurrentViewRequest: () => true,
      currentViewRequestGeneration: () => 0,
      onMessage: vi.fn(),
      fontRemeasureKey: "initial",
    }),
  );
}

function disposable() {
  return { dispose: vi.fn() };
}

describe("workspace Monaco ownership", () => {
  it("does not access a disposed Compare editor through the merge port", () => {
    const { result } = renderController("compare");
    let disposed = false;
    let onDispose: (() => void) | undefined;
    const subEditor = {
      getValue: () => "",
      setValue: () => {
        if (disposed) throw new Error("disposed Compare editor accessed");
      },
      onDidDispose: (handler: () => void) => {
        onDispose = handler;
        return disposable();
      },
      onDidChangeCursorPosition: () => disposable(),
      onDidFocusEditorText: () => disposable(),
    };
    const editor = {
      getOriginalEditor: () => subEditor,
      getModifiedEditor: () => subEditor,
      getLineChanges: () => [],
      onDidUpdateDiff: () => disposable(),
      onDidDispose: () => disposable(),
    };

    act(() => {
      result.current.editor.handleDiffMount(editor as never, {} as never);
    });
    disposed = true;
    act(() => onDispose?.());

    act(() => {
      expect(() => result.current.editor.merge.resetToLoadedPreview()).not.toThrow();
    });
  });

  it("does not search a disposed View editor", () => {
    const { result } = renderController("single");
    let disposed = false;
    let onDispose: (() => void) | undefined;
    const editor = {
      onDidDispose: (handler: () => void) => {
        onDispose = handler;
        return disposable();
      },
      getModel: () => {
        if (disposed) throw new Error("disposed View editor accessed");
        return { findMatches: () => [] };
      },
    };

    act(() => {
      result.current.editor.handleEditorMount(editor as never, {} as never);
    });
    disposed = true;
    act(() => onDispose?.());

    expect(() => result.current.editor.findFirstMatch("needle")).not.toThrow();
  });
});
