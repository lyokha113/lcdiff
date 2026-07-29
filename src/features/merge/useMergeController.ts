import {
  clearStaged as clearStagedCommand,
  commitMerge,
  commitView,
  stageCopy,
  stageViewWrite,
  stageWrite,
  unstage as unstageCommand,
  unstageViewWrite,
} from "@/ipc/commands";
import {
  destroyCurrentWindow,
  isTauriRuntime,
  subscribeWindowCloseRequested,
} from "@/ipc/platform";
import type {
  ArchiveSummary,
  ComparePair,
  EntryPreview,
  Mode,
  Side,
  StagedEntry,
  ViewSource,
} from "@/lib/types";
import type { WorkspaceMergeEditorPort } from "@/features/workspace/useWorkspaceController";
import { moveHunk } from "./textMerge";
import {
  beginStagingOperation,
  fileStagingKey,
  invalidateStagingOperations,
  isCurrentStagingOperation,
  stagingEntryPath,
  viewStagingKey,
} from "./staging";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MergeControllerContext {
  mode: Mode;
  activeViewSource: ViewSource | undefined;
  selected: ComparePair | undefined;
  preview: Partial<Record<Side, EntryPreview>>;
  archives: Partial<Record<Side, ArchiveSummary>>;
  backupEnabled: boolean;
  isFileMerge: boolean;
  isTextMerge: boolean;
  openPath(side: Side, path: string, confirmed?: boolean): Promise<string | undefined>;
  loadViewPairs(sourceId: string): Promise<ComparePair[]>;
  inspectViewEntry(pair: ComparePair, force?: boolean): Promise<void>;
}

export interface MergeControllerOptions {
  getContext(): MergeControllerContext;
  editor: WorkspaceMergeEditorPort;
  onMessage(message: string): void;
}

export function useMergeController({
  getContext,
  editor,
  onMessage,
}: MergeControllerOptions) {
  const [stagedTarget, setStagedTarget] = useState<Side>();
  const [stagedEntries, setStagedEntries] = useState<Record<string, StagedEntry>>({});
  const [signedSavePrompt, setSignedSavePrompt] = useState<Side>();
  const [suppressSignedWarningForFile, setSuppressSignedWarningForFile] = useState(false);
  const [signedWarningSuppressions, setSignedWarningSuppressions] = useState<
    Record<string, boolean>
  >({});
  const editStageGenerationRef = useRef(0);

  useEffect(() => {
    if (!stagedTarget || !isTauriRuntime()) return;
    return subscribeWindowCloseRequested((event) => {
      event.preventDefault();
      if (!globalThis.confirm("Discard unsaved changes and close LCDiff?")) return;
      void clearStagedCommand().then(destroyCurrentWindow);
    });
  }, [stagedTarget]);

  const copy = useCallback(async (
    from: Side,
    to: Side,
    pair = getContext().selected,
  ) => {
    if (!pair) return;
    try {
      await stageCopy(from, to, pair.path);
      setStagedTarget(to);
      setStagedEntries((current) => ({
        ...current,
        [pair.path]: { side: to, kind: "copy" },
      }));
      onMessage(`Staged ${pair.path}: ${from} -> ${to}`);
    } catch (error) {
      onMessage(String(error));
    }
  }, [getContext, onMessage]);

  const save = useCallback(async (targetSide: Side, signedConfirmed = false) => {
    const context = getContext();
    if (context.mode === "single") {
      if (!context.activeViewSource) return;
      try {
        const result = await commitView(
          context.activeViewSource.id,
          context.backupEnabled,
        );
        setStagedTarget(undefined);
        setStagedEntries({});
        await context.loadViewPairs(context.activeViewSource.id);
        if (context.selected) {
          await context.inspectViewEntry(context.selected, true);
        }
        onMessage(
          `Saved ${result.copiedEntries} entries to ${result.rewrittenPath}`,
        );
      } catch (error) {
        onMessage(String(error));
      }
      return;
    }
    if (context.isFileMerge) {
      const dirty = (["left", "right"] as Side[]).filter((side) =>
        Object.values(stagedEntries).some((entry) => entry.side === side),
      );
      try {
        for (const side of dirty) {
          await commitMerge(side, context.backupEnabled, false);
        }
        setStagedTarget(undefined);
        setStagedEntries({});
        for (const side of dirty) {
          const path = context.archives[side]?.path;
          if (path) await context.openPath(side, path, true);
        }
        onMessage(
          `Saved ${dirty.length} file change${dirty.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        onMessage(String(error));
      }
      return;
    }
    try {
      const signed = context.archives[targetSide]?.metadata.signed ?? false;
      const signedPath = context.archives[targetSide]?.path ?? "";
      if (
        signed &&
        !signedConfirmed &&
        !signedWarningSuppressions[signedPath]
      ) {
        setSuppressSignedWarningForFile(false);
        setSignedSavePrompt(targetSide);
        return;
      }
      const result = await commitMerge(
        targetSide,
        context.backupEnabled,
        signed,
      );
      setStagedTarget(undefined);
      setStagedEntries({});
      const saveMessage =
        `Saved ${result.copiedEntries} entries to ${result.rewrittenPath}` +
        (result.signatureInvalidated
          ? " (signed archive is now invalid)"
          : "");
      const reloadError = await context.openPath(
        targetSide,
        result.rewrittenPath,
        true,
      );
      onMessage(
        reloadError ? `${saveMessage}; reload failed: ${reloadError}` : saveMessage,
      );
    } catch (error) {
      onMessage(String(error));
    }
  }, [getContext, onMessage, signedWarningSuppressions, stagedEntries]);

  const confirmSignedSave = useCallback(() => {
    const targetSide = signedSavePrompt;
    if (!targetSide) return;
    const signedPath = getContext().archives[targetSide]?.path;
    if (suppressSignedWarningForFile && signedPath) {
      setSignedWarningSuppressions((current) => ({
        ...current,
        [signedPath]: true,
      }));
    }
    setSignedSavePrompt(undefined);
    void save(targetSide, true);
  }, [getContext, save, signedSavePrompt, suppressSignedWarningForFile]);

  const clearStaged = useCallback(async () => {
    invalidateStagingOperations(editStageGenerationRef);
    await clearStagedCommand();
    setStagedTarget(undefined);
    setStagedEntries({});
    editor.resetToLoadedPreview();
    onMessage("Cleared unsaved changes.");
  }, [editor, onMessage]);

  const unstage = useCallback(async (key: string) => {
    try {
      const context = getContext();
      const entry = stagedEntries[key];
      const bare = stagingEntryPath(key);
      if (context.mode === "single" && context.activeViewSource) {
        await unstageViewWrite(context.activeViewSource.id, bare);
      } else {
        await unstageCommand(bare, entry?.side);
      }
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[key];
        if (Object.keys(next).length === 0) setStagedTarget(undefined);
        return next;
      });
      onMessage(`Unstaged ${bare}.`);
    } catch (error) {
      onMessage(String(error));
    }
  }, [getContext, onMessage, stagedEntries]);

  const stageEdit = useCallback(async (
    entryPath: string,
    content: string,
    sourceId: string,
  ) => {
    const context = getContext();
    if (context.activeViewSource?.id !== sourceId) return;
    const generation = beginStagingOperation(editStageGenerationRef);
    const key = viewStagingKey(entryPath);
    const original = context.preview.left?.content ?? "";
    if (content === original) {
      if (
        stagedEntries[key]?.kind === "edit" &&
        context.activeViewSource
      ) {
        await unstageViewWrite(sourceId, entryPath);
        setStagedEntries((current) => {
          const next = { ...current };
          delete next[key];
          if (Object.keys(next).length === 0) setStagedTarget(undefined);
          return next;
        });
      }
      return;
    }
    try {
      setStagedEntries((current) => ({
        ...current,
        [key]: { side: "left", kind: "edit" },
      }));
      setStagedTarget("left");
      await stageViewWrite(sourceId, entryPath, content);
      if (!isCurrentStagingOperation(editStageGenerationRef, generation)) return;
      onMessage(`Edited ${entryPath} (unsaved)`);
    } catch (error) {
      if (!isCurrentStagingOperation(editStageGenerationRef, generation)) return;
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[key];
        if (Object.keys(next).length === 0) setStagedTarget(undefined);
        return next;
      });
      onMessage(String(error));
    }
  }, [getContext, onMessage, stagedEntries]);

  const stageFileSide = useCallback(async (side: Side, content: string) => {
    const context = getContext();
    if (!context.selected) return;
    const key = fileStagingKey(side, context.selected.path);
    const original =
      (side === "left"
        ? context.preview.left?.content
        : context.preview.right?.content) ?? "";
    if (content === original) {
      if (stagedEntries[key]?.kind === "edit") await unstage(key);
      return;
    }
    const generation = beginStagingOperation(editStageGenerationRef);
    try {
      setStagedEntries((current) => ({
        ...current,
        [key]: { side, kind: "edit" },
      }));
      setStagedTarget(side);
      await stageWrite(side, context.selected.path, content);
      if (!isCurrentStagingOperation(editStageGenerationRef, generation)) return;
      onMessage(`Edited ${context.selected.path} on ${side} (unsaved)`);
    } catch (error) {
      if (!isCurrentStagingOperation(editStageGenerationRef, generation)) return;
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[key];
        if (Object.keys(next).length === 0) setStagedTarget(undefined);
        return next;
      });
      onMessage(String(error));
    }
  }, [getContext, onMessage, stagedEntries, unstage]);

  const takeAllTo = useCallback(async (target: Side) => {
    const context = getContext();
    if (!context.isTextMerge || !context.selected) return;
    const source: Side = target === "left" ? "right" : "left";
    const content = editor.getSideContent(source);
    if (content === undefined || !editor.setSideContent(target, content)) return;
    await stageFileSide(target, content);
  }, [editor, getContext, stageFileSide]);

  const moveHunkTo = useCallback((target: Side) => {
    if (!getContext().isTextMerge) return;
    const hunk = editor.currentHunk();
    const left = editor.getSideContent("left");
    const right = editor.getSideContent("right");
    if (!hunk || left === undefined || right === undefined) return;
    const resolvedHunk =
      target === "left"
        ? {
            targetStart: hunk.sourceStart,
            targetEnd: hunk.sourceEnd,
            sourceStart: hunk.targetStart,
            sourceEnd: hunk.targetEnd,
          }
        : hunk;
    if (resolvedHunk.sourceEnd < resolvedHunk.sourceStart) {
      onMessage(
        "Nothing to move: the hunk at the cursor only exists on this side.",
      );
      return;
    }
    const targetContent = target === "left" ? left : right;
    const sourceContent = target === "left" ? right : left;
    const result = moveHunk(targetContent, sourceContent, resolvedHunk);
    const source: Side = target === "left" ? "right" : "left";
    editor.setSideContent(target, result.target);
    editor.setSideContent(source, result.source);
    void stageFileSide(target, result.target);
    void stageFileSide(source, result.source);
  }, [editor, getContext, onMessage, stageFileSide]);

  const pendingOps = useMemo(
    () =>
      Object.entries(stagedEntries).map(([key, entry]) => ({
        key,
        path: stagingEntryPath(key),
        side: entry.side,
        kind: entry.kind,
      })),
    [stagedEntries],
  );

  return {
    state: {
      stagedTarget,
      stagedEntries,
      signedSavePrompt,
      suppressSignedWarningForFile,
    },
    setters: {
      setSignedSavePrompt,
      setSuppressSignedWarningForFile,
    },
    actions: {
      copy,
      save,
      confirmSignedSave,
      clearStaged,
      unstage,
      stageEdit,
      stageFileSide,
      takeAllTo,
      moveHunkTo,
    },
    pendingOps,
  };
}
