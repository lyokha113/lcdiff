import "@/features/workspace/monaco-runtime";

import {
  disassemble,
  disassembleViewEntry,
  prefetchSiblings,
  readEntry,
  readViewEntry,
} from "@/ipc/commands";
import type {
  ComparePair,
  ContentFilter,
  EntryPreview,
  Mode,
  SearchResult,
  Side,
  ViewEntryTab,
  ViewMode,
  ViewSource,
  ViewWorkspaceState,
} from "@/lib/types";
import {
  closeViewSource,
  focusViewEntryTab,
  upsertViewEntryTab,
} from "@/features/sources/view-workspace";
import {
  emptyCompareWorkspace,
  focusCompareWorkspaceTab,
  type CompareWorkspaceState,
} from "./compare-workspace";
import { pairHasClass } from "./DiffView";
import type {
  CodeEditor,
  DecorationRef,
  DiffCodeEditor,
  DiffOnMount,
  MonacoApi,
  OnMount,
} from "./editor-types";
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "./tabs";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MAX_DIFF_TABS = 10;

type DiffLineChange = NonNullable<ReturnType<DiffCodeEditor["getLineChanges"]>>[number];

type DiffNavigatorState = {
  currentIndex: number;
  total: number;
};

export type WorkspaceDiffHunk = {
  targetStart: number;
  targetEnd: number;
  sourceStart: number;
  sourceEnd: number;
};

export interface WorkspaceMergeEditorPort {
  resetToLoadedPreview(): void;
  getSideContent(side: Side): string | undefined;
  setSideContent(side: Side, content: string): boolean;
  currentHunk(): WorkspaceDiffHunk | undefined;
}

export interface WorkspaceControllerOptions {
  mode: Mode;
  setPairs: Dispatch<SetStateAction<ComparePair[]>>;
  viewWorkspace: ViewWorkspaceState;
  setViewWorkspace: Dispatch<SetStateAction<ViewWorkspaceState>>;
  selectedSearchResult: SearchResult | undefined;
  isCurrentViewRequest(generation: number, sourceId?: string): boolean;
  currentViewRequestGeneration(): number;
  onMessage(message: string): void;
  fontRemeasureKey: string;
}

type WorkspaceProjectionState = Pick<
  CompareWorkspaceState,
  "selected" | "preview" | "activeTab" | "editBuffer" | "viewMode"
>;

function emptyWorkspaceProjection(): WorkspaceProjectionState {
  const { selected, preview, activeTab, editBuffer, viewMode } = emptyCompareWorkspace();
  return { selected, preview, activeTab, editBuffer, viewMode };
}

const inertWorkspaceProjection = emptyWorkspaceProjection();

function viewPairFromPreview(tab: ViewEntryTab): ComparePair {
  return {
    path: tab.entryPath,
    status: "onlyLeft",
    left: { path: tab.entryPath, kind: tab.preview.kind },
  };
}

function latestViewEntryTab(source: ViewSource | undefined) {
  return source?.entryTabs.reduce<ViewEntryTab | undefined>(
    (latest, tab) => (!latest || tab.lastFocus > latest.lastFocus ? tab : latest),
    undefined,
  );
}

function applySearchLineHighlight(
  editor: CodeEditor | undefined,
  monaco: MonacoApi | undefined,
  line: number | undefined,
  decorations: DecorationRef,
) {
  if (!editor || !monaco || line === undefined || line < 1) {
    if (editor) decorations.current = editor.deltaDecorations(decorations.current, []);
    return;
  }
  const lineNumber = Math.min(line, editor.getModel()?.getLineCount() ?? line);
  decorations.current = editor.deltaDecorations(decorations.current, [
    {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: { isWholeLine: true, className: "search-line-highlight" },
    },
  ]);
  editor.setPosition({ lineNumber, column: 1 });
  editor.revealLineInCenter(lineNumber);
}

function lineChangeRangeForSide(change: DiffLineChange, side: Side) {
  const start =
    side === "left"
      ? change.originalStartLineNumber
      : change.modifiedStartLineNumber;
  const end =
    side === "left"
      ? change.originalEndLineNumber
      : change.modifiedEndLineNumber;
  return { start, end };
}

function hasChangedLinesForSide(change: DiffLineChange, side: Side) {
  const { start, end } = lineChangeRangeForSide(change, side);
  return start >= 1 && end >= start;
}

function oppositeSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function resolveDiffNavigationSide(change: DiffLineChange, preferredSide: Side): Side {
  if (hasChangedLinesForSide(change, preferredSide)) return preferredSide;
  const fallbackSide = oppositeSide(preferredSide);
  if (hasChangedLinesForSide(change, fallbackSide)) return fallbackSide;
  return preferredSide;
}

function revealLineForChange(change: DiffLineChange, side: Side, editor: CodeEditor) {
  const { start } = lineChangeRangeForSide(change, side);
  const modelLineCount = editor.getModel()?.getLineCount() ?? 0;
  if (modelLineCount < 1) return undefined;
  return Math.max(1, Math.min(start, modelLineCount));
}

function lineDistanceToChange(change: DiffLineChange, side: Side, line: number) {
  const { start, end } = lineChangeRangeForSide(change, side);
  const rangeStart = Math.max(1, start);
  const rangeEnd = Math.max(rangeStart, end === 0 ? start : end);
  if (line >= rangeStart && line <= rangeEnd) return 0;
  if (line < rangeStart) return rangeStart - line;
  return line - rangeEnd;
}

function currentDiffBlockIndex(
  changes: DiffLineChange[],
  side: Side,
  cursorLine: number | undefined,
) {
  if (changes.length === 0) return -1;
  if (cursorLine === undefined || cursorLine < 1) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  changes.forEach((change, index) => {
    const distance = lineDistanceToChange(change, side, cursorLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function useWorkspaceController({
  mode,
  setPairs,
  viewWorkspace,
  setViewWorkspace,
  selectedSearchResult,
  isCurrentViewRequest,
  currentViewRequestGeneration,
  onMessage,
  fontRemeasureKey,
}: WorkspaceControllerOptions) {
  const [compareWorkspace, setCompareWorkspace] = useState(emptyCompareWorkspace);
  const [viewProjection, setViewProjection] = useState(emptyWorkspaceProjection);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [diffNavigatorState, setDiffNavigatorState] = useState<DiffNavigatorState>({
    currentIndex: -1,
    total: 0,
  });
  const focusCounter = useRef(0);
  const previewRequestId = useRef(0);
  const editorRef = useRef<CodeEditor | undefined>(undefined);
  const diffEditorRef = useRef<DiffCodeEditor | undefined>(undefined);
  const diffNavigatorFocusSideRef = useRef<Side>("right");
  const monacoRef = useRef<MonacoApi | undefined>(undefined);
  const singleSearchDecorations = useRef<string[]>([]);
  const leftSearchDecorations = useRef<string[]>([]);
  const rightSearchDecorations = useRef<string[]>([]);

  const activeViewSource = useMemo(
    () => viewWorkspace.sources.find((source) => source.id === viewWorkspace.activeSourceId),
    [viewWorkspace.activeSourceId, viewWorkspace.sources],
  );
  const activeViewEntryTab = useMemo(
    () => activeViewSource?.entryTabs.find((tab) => tab.entryPath === viewWorkspace.activeEntryPath),
    [activeViewSource?.entryTabs, viewWorkspace.activeEntryPath],
  );
  const activeProjection =
    mode === "single"
      ? viewProjection
      : mode === "compare"
        ? compareWorkspace
        : inertWorkspaceProjection;
  const {
    selected,
    preview,
    activeTab,
    editBuffer,
    viewMode,
  } = activeProjection;
  const openTabs = mode === "compare" ? compareWorkspace.openTabs : [];

  const updateActiveProjection = useCallback(
    (update: (current: WorkspaceProjectionState) => WorkspaceProjectionState) => {
      if (mode === "text") return;
      if (mode === "single") {
        setViewProjection(update);
        return;
      }
      setCompareWorkspace((current) => ({
        ...current,
        ...update(current),
      }));
    },
    [mode],
  );

  const setSelected = useCallback((next: SetStateAction<ComparePair | undefined>) => {
    updateActiveProjection((current) => ({
      ...current,
      selected: typeof next === "function" ? next(current.selected) : next,
    }));
  }, [updateActiveProjection]);

  const setPreview = useCallback((
    next: SetStateAction<Partial<Record<Side, EntryPreview>>>,
  ) => {
    updateActiveProjection((current) => ({
      ...current,
      preview: typeof next === "function" ? next(current.preview) : next,
    }));
  }, [updateActiveProjection]);

  const setActiveTab = useCallback((next: SetStateAction<"files" | string>) => {
    updateActiveProjection((current) => ({
      ...current,
      activeTab: typeof next === "function" ? next(current.activeTab) : next,
    }));
  }, [updateActiveProjection]);

  const setEditBuffer = useCallback((next: SetStateAction<string>) => {
    updateActiveProjection((current) => ({
      ...current,
      editBuffer: typeof next === "function" ? next(current.editBuffer) : next,
    }));
  }, [updateActiveProjection]);

  const setViewMode = useCallback((next: SetStateAction<ViewMode>) => {
    updateActiveProjection((current) => ({
      ...current,
      viewMode: typeof next === "function" ? next(current.viewMode) : next,
    }));
  }, [updateActiveProjection]);

  const setOpenTabs = useCallback((next: SetStateAction<DiffTab[]>) => {
    setCompareWorkspace((current) => ({
      ...current,
      openTabs: typeof next === "function" ? next(current.openTabs) : next,
    }));
  }, []);

  const updateDiffNavigatorState = useCallback(() => {
    const editor = diffEditorRef.current;
    if (mode !== "compare" || !editor) {
      setDiffNavigatorState({ currentIndex: -1, total: 0 });
      return;
    }
    const changes = editor.getLineChanges() ?? [];
    if (changes.length === 0) {
      setDiffNavigatorState({ currentIndex: -1, total: 0 });
      return;
    }
    const side = diffNavigatorFocusSideRef.current;
    const focusedEditor = side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    setDiffNavigatorState({
      currentIndex: currentDiffBlockIndex(
        changes,
        side,
        focusedEditor.getPosition()?.lineNumber,
      ),
      total: changes.length,
    });
  }, [mode]);

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  const handleDiffMount = useCallback<DiffOnMount>((editor, monaco) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
    const original = editor.getOriginalEditor();
    const modified = editor.getModifiedEditor();
    const updateForSide = (side: Side) => {
      diffNavigatorFocusSideRef.current = side;
      updateDiffNavigatorState();
    };
    const disposables = [
      editor.onDidUpdateDiff(updateDiffNavigatorState),
      original.onDidChangeCursorPosition(() => updateForSide("left")),
      modified.onDidChangeCursorPosition(() => updateForSide("right")),
      original.onDidFocusEditorText(() => updateForSide("left")),
      modified.onDidFocusEditorText(() => updateForSide("right")),
    ];
    updateDiffNavigatorState();
    editor.onDidDispose(() => disposables.forEach((disposable) => disposable.dispose()));
  }, [updateDiffNavigatorState]);

  useEffect(() => {
    monacoRef.current?.editor?.remeasureFonts?.();
    if (typeof editorRef.current?.layout === "function") editorRef.current.layout();
    if (typeof diffEditorRef.current?.layout === "function") diffEditorRef.current.layout();
  }, [fontRemeasureKey]);

  useEffect(() => {
    const activeSearchResult = selectedSearchResult;
    const line =
      activeSearchResult && activeSearchResult.path === selected?.path
        ? activeSearchResult.line
        : undefined;
    if (mode === "compare") {
      const diffEditor = diffEditorRef.current;
      applySearchLineHighlight(
        diffEditor?.getOriginalEditor(),
        monacoRef.current,
        activeSearchResult?.side === "left" ? line : undefined,
        leftSearchDecorations,
      );
      applySearchLineHighlight(
        diffEditor?.getModifiedEditor(),
        monacoRef.current,
        activeSearchResult?.side === "right" ? line : undefined,
        rightSearchDecorations,
      );
      applySearchLineHighlight(editorRef.current, monacoRef.current, undefined, singleSearchDecorations);
    } else {
      applySearchLineHighlight(
        editorRef.current,
        monacoRef.current,
        activeSearchResult?.side === "left" ? line : undefined,
        singleSearchDecorations,
      );
      const diffEditor = diffEditorRef.current;
      applySearchLineHighlight(diffEditor?.getOriginalEditor(), monacoRef.current, undefined, leftSearchDecorations);
      applySearchLineHighlight(diffEditor?.getModifiedEditor(), monacoRef.current, undefined, rightSearchDecorations);
    }
  }, [mode, preview.left?.content, preview.right?.content, selected?.path, selectedSearchResult]);

  useEffect(() => {
    updateDiffNavigatorState();
  }, [
    activeTab,
    mode,
    preview.left?.content,
    preview.right?.content,
    selected?.path,
    updateDiffNavigatorState,
    viewMode,
  ]);

  useEffect(() => {
    if (mode !== "compare" || activeTab === "files" || !selected) return;
    setOpenTabs((current) =>
      current.map((tab) =>
        tab.path === activeTab ? { ...tab, pair: selected, preview, viewMode } : tab,
      ),
    );
  }, [activeTab, mode, preview, selected, setOpenTabs, viewMode]);

  const focusViewTab = useCallback((path: string) => {
    if (!activeViewSource) return;
    const tab = activeViewSource.entryTabs.find((candidate) => candidate.entryPath === path);
    if (!tab) return;
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setSelected(viewPairFromPreview(tab));
    setPreview({ left: tab.preview });
    setEditBuffer(tab.preview.content);
    setViewMode(tab.viewMode);
    setActiveTab(path);
    setViewWorkspace((current) => focusViewEntryTab(current, activeViewSource.id, path, stamp));
  }, [activeViewSource, setViewWorkspace]);

  const focusTab = useCallback((path: string) => {
    if (mode === "single") {
      focusViewTab(path);
      return;
    }
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setCompareWorkspace((current) => focusCompareWorkspaceTab(current, path, stamp));
  }, [focusViewTab, mode]);

  const selectViewSource = useCallback((sourceId: string) => {
    const source = viewWorkspace.sources.find((candidate) => candidate.id === sourceId);
    const tab = latestViewEntryTab(source);
    setViewWorkspace((current) => ({
      ...current,
      activeSourceId: sourceId,
      activeEntryPath: tab?.entryPath,
    }));
    setActiveTab(tab?.entryPath ?? "files");
    if (tab) {
      setSelected(viewPairFromPreview(tab));
      setPreview({ left: tab.preview });
      setEditBuffer(tab.preview.content);
      setViewMode(tab.viewMode);
    } else {
      setSelected(undefined);
      setPreview({});
      setEditBuffer("");
      setViewMode("source");
    }
  }, [setViewWorkspace, viewWorkspace.sources]);

  const closeViewEntryTab = useCallback((path: string) => {
    if (!activeViewSource) return;
    const remainingTabs = activeViewSource.entryTabs.filter((tab) => tab.entryPath !== path);
    const nextTab =
      activeTab === path
        ? remainingTabs.reduce<ViewEntryTab | undefined>(
            (latest, tab) => (!latest || tab.lastFocus > latest.lastFocus ? tab : latest),
            undefined,
          )
        : activeViewEntryTab;
    setViewWorkspace((current) => ({
      ...current,
      activeEntryPath: nextTab?.entryPath,
      sources: current.sources.map((source) =>
        source.id === activeViewSource.id ? { ...source, entryTabs: remainingTabs } : source,
      ),
    }));
    if (activeTab !== path) return;
    setActiveTab(nextTab?.entryPath ?? "files");
    if (nextTab) {
      setSelected(viewPairFromPreview(nextTab));
      setPreview({ left: nextTab.preview });
      setEditBuffer(nextTab.preview.content);
      setViewMode(nextTab.viewMode);
    } else {
      setSelected(undefined);
      setPreview({});
      setEditBuffer("");
      setViewMode("source");
    }
  }, [activeTab, activeViewEntryTab, activeViewSource, setViewWorkspace]);

  const closeViewSourceTab = useCallback((sourceId: string) => {
    const remainingSources = viewWorkspace.sources.filter((source) => source.id !== sourceId);
    const closedActive = viewWorkspace.activeSourceId === sourceId;
    const sourceIndex = viewWorkspace.sources.findIndex((source) => source.id === sourceId);
    const nextSource = closedActive
      ? remainingSources[sourceIndex] ?? remainingSources[sourceIndex - 1]
      : activeViewSource;
    const nextTab = closedActive ? latestViewEntryTab(nextSource) : activeViewEntryTab;
    setViewWorkspace((current) => ({
      ...closeViewSource(current, sourceId),
      activeEntryPath: nextTab?.entryPath,
    }));
    if (closedActive) {
      setActiveTab(nextTab?.entryPath ?? "files");
      if (nextTab) {
        setSelected(viewPairFromPreview(nextTab));
        setPreview({ left: nextTab.preview });
        setEditBuffer(nextTab.preview.content);
        setViewMode(nextTab.viewMode);
      } else {
        setSelected(undefined);
        setPreview({});
        setEditBuffer("");
        setViewMode("source");
      }
    }
    return { closedActive, nextSourceId: nextSource?.id };
  }, [activeViewEntryTab, activeViewSource, setViewWorkspace, viewWorkspace]);

  const inspectViewEntry = useCallback(async (pair: ComparePair, force = false) => {
    const source = activeViewSource;
    if (!source) return;
    const existing = source.entryTabs.find((tab) => tab.entryPath === pair.path);
    if (existing && !force) {
      focusViewTab(pair.path);
      return;
    }
    const sourceId = source.id;
    const requestId = previewRequestId.current + 1;
    const generation = currentViewRequestGeneration();
    previewRequestId.current = requestId;
    setSelected(pair);
    setActiveTab(pair.path);
    setViewMode("source");
    const nextPreview = await readViewEntry(source.id, pair.path);
    if (previewRequestId.current !== requestId || !isCurrentViewRequest(generation, sourceId)) return;
    setPreview({ left: nextPreview });
    setEditBuffer(nextPreview.content);
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setViewWorkspace((current) => {
      if (current.activeSourceId !== sourceId) return current;
      return upsertViewEntryTab(
        current,
        sourceId,
        { entryPath: pair.path, preview: nextPreview, viewMode: "source", lastFocus: stamp },
        MAX_DIFF_TABS,
      );
    });
  }, [
    activeViewSource,
    currentViewRequestGeneration,
    focusViewTab,
    isCurrentViewRequest,
    setViewWorkspace,
  ]);

  const inspect = useCallback(async (pair: ComparePair, force = false) => {
    if (mode === "single") {
      await inspectViewEntry(pair, force);
      return;
    }
    const existing = openTabs.find((tab) => tab.path === pair.path);
    if (existing && !force) {
      focusTab(pair.path);
      return;
    }
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setSelected(pair);
    setActiveTab(pair.path);
    setViewMode("source");
    const next: Partial<Record<Side, EntryPreview>> = {};
    for (const side of ["left", "right"] as const) {
      if (pair[side]) next[side] = await readEntry(side, pair.path);
    }
    if (previewRequestId.current !== requestId) return;
    setPreview(next);
    setEditBuffer(next.left?.content ?? "");
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setOpenTabs((current) =>
      evictLru(
        upsertTab(current, {
          path: pair.path,
          pair,
          preview: next,
          viewMode: "source",
          lastFocus: stamp,
        }),
        MAX_DIFF_TABS,
      ),
    );
    for (const side of ["left", "right"] as const) {
      if (pair[side]?.kind === "class" && !pair.path.includes("!/")) {
        void prefetchSiblings(side, pair.path);
      }
    }
    if (
      pair.status === "different" &&
      pair.left?.kind === "class" &&
      pair.right?.kind === "class" &&
      !next.left?.content.startsWith("Decompiler unavailable:") &&
      next.left?.content === next.right?.content
    ) {
      const metadataOnly = { ...pair, status: "differentMetadataOnly" as const };
      setSelected(metadataOnly);
      setPairs((current) =>
        current.map((candidate) => (candidate.path === pair.path ? metadataOnly : candidate)),
      );
    }
  }, [focusTab, inspectViewEntry, mode, openTabs, setPairs]);

  const closeTab = useCallback((path: string) => {
    if (mode === "single") {
      closeViewEntryTab(path);
      return;
    }
    if (activeTab === path) {
      const next = pickNeighbor(openTabs, path);
      if (next === "files") setActiveTab("files");
      else focusTab(next);
    }
    setOpenTabs((current) => current.filter((tab) => tab.path !== path));
  }, [activeTab, closeViewEntryTab, focusTab, mode, openTabs]);

  const focusRelativeTab = useCallback((direction: 1 | -1) => {
    if (mode === "single") {
      const tabs = activeViewSource?.entryTabs ?? [];
      if (tabs.length === 0) return;
      if (activeTab === "files") {
        const target = direction > 0 ? tabs[0] : tabs.at(-1);
        if (target) focusViewTab(target.entryPath);
        return;
      }
      const index = tabs.findIndex((tab) => tab.entryPath === activeTab);
      const nextIndex = index < 0 ? 0 : (index + direction + tabs.length) % tabs.length;
      focusViewTab(tabs[nextIndex].entryPath);
      return;
    }
    if (openTabs.length === 0) return;
    if (activeTab === "files") {
      const target = direction > 0 ? openTabs[0] : openTabs.at(-1);
      if (target) focusTab(target.path);
      return;
    }
    const index = openTabs.findIndex((tab) => tab.path === activeTab);
    const nextIndex = index < 0 ? 0 : (index + direction + openTabs.length) % openTabs.length;
    focusTab(openTabs[nextIndex].path);
  }, [activeTab, activeViewSource?.entryTabs, focusTab, focusViewTab, mode, openTabs]);

  const closeActiveTab = useCallback(() => {
    if (activeTab !== "files") closeTab(activeTab);
  }, [activeTab, closeTab]);

  const showBytecode = useCallback(async () => {
    const pair = selected;
    if (!pair) return;
    if (!pairHasClass(pair)) {
      onMessage("Bytecode view is only available for class entries.");
      return;
    }
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    if (mode === "single") {
      const source = activeViewSource;
      if (!source) return;
      const sourceId = source.id;
      const generation = currentViewRequestGeneration();
      try {
        const nextPreview: EntryPreview = {
          path: pair.path,
          kind: "class",
          language: "plaintext",
          content: await disassembleViewEntry(sourceId, pair.path),
        };
        if (previewRequestId.current !== requestId || !isCurrentViewRequest(generation, sourceId)) return;
        setPreview({ left: nextPreview });
        setViewMode("bytecode");
        focusCounter.current += 1;
        setViewWorkspace((current) => {
          if (current.activeSourceId !== sourceId) return current;
          return upsertViewEntryTab(
            current,
            sourceId,
            {
              entryPath: pair.path,
              preview: nextPreview,
              viewMode: "bytecode",
              lastFocus: focusCounter.current,
            },
            MAX_DIFF_TABS,
          );
        });
      } catch (error) {
        if (isCurrentViewRequest(generation, sourceId)) onMessage(String(error));
      }
      return;
    }
    const next: Partial<Record<Side, EntryPreview>> = {};
    try {
      for (const side of ["left", "right"] as const) {
        if (pair[side]?.kind === "class") {
          next[side] = {
            path: pair.path,
            kind: "class",
            language: "plaintext",
            content: await disassemble(side, pair.path),
          };
        }
      }
      if (previewRequestId.current !== requestId) return;
      setPreview(next);
      setViewMode("bytecode");
    } catch (error) {
      onMessage(String(error));
    }
  }, [
    activeViewSource,
    currentViewRequestGeneration,
    isCurrentViewRequest,
    mode,
    onMessage,
    selected,
    setViewWorkspace,
  ]);

  const navigateDiffBlock = useCallback((direction: 1 | -1) => {
    const editor = diffEditorRef.current;
    if (mode !== "compare" || !editor) {
      setDiffNavigatorState({ currentIndex: -1, total: 0 });
      return;
    }
    const changes = editor.getLineChanges() ?? [];
    if (changes.length === 0) {
      setDiffNavigatorState({ currentIndex: -1, total: 0 });
      return;
    }
    const side = diffNavigatorFocusSideRef.current;
    const focusedEditor = side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const currentIndex =
      diffNavigatorState.currentIndex >= 0 && diffNavigatorState.currentIndex < changes.length
        ? diffNavigatorState.currentIndex
        : currentDiffBlockIndex(changes, side, focusedEditor.getPosition()?.lineNumber);
    const targetIndex = (currentIndex + direction + changes.length) % changes.length;
    const targetSide = resolveDiffNavigationSide(changes[targetIndex], side);
    const targetEditor =
      targetSide === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const targetLine = revealLineForChange(changes[targetIndex], targetSide, targetEditor);
    if (targetLine !== undefined) {
      targetEditor.setPosition({ lineNumber: targetLine, column: 1 });
      targetEditor.revealLineInCenter(targetLine);
    }
    setDiffNavigatorState({ currentIndex: targetIndex, total: changes.length });
  }, [diffNavigatorState.currentIndex, mode]);

  const reset = useCallback((options?: {
    clearDiffModel?: boolean;
    invalidatePreviewRequest?: boolean;
    preserveState?: boolean;
    target?: "compare" | "view";
  }) => {
    if (options?.invalidatePreviewRequest !== false) {
      previewRequestId.current += 1;
    }
    if (options?.clearDiffModel) {
      diffEditorRef.current?.setModel(null);
      diffEditorRef.current = undefined;
    }
    if (options?.preserveState) return;
    const target = options?.target ?? (mode === "single" ? "view" : "compare");
    if (target === "view") {
      setViewProjection(emptyWorkspaceProjection());
      return;
    }
    setCompareWorkspace(emptyCompareWorkspace());
  }, [mode]);

  const mergeEditor = useMemo<WorkspaceMergeEditorPort>(() => ({
    resetToLoadedPreview() {
      const editor = diffEditorRef.current;
      if (editor) {
        editor.getOriginalEditor().setValue(preview.left?.content ?? "");
        editor.getModifiedEditor().setValue(preview.right?.content ?? "");
      }
      setEditBuffer(preview.left?.content ?? "");
    },
    getSideContent(side) {
      const editor = diffEditorRef.current;
      if (!editor) return undefined;
      return side === "left"
        ? editor.getOriginalEditor().getValue()
        : editor.getModifiedEditor().getValue();
    },
    setSideContent(side, content) {
      const editor = diffEditorRef.current;
      if (!editor) return false;
      const target = side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
      target.setValue(content);
      return true;
    },
    currentHunk() {
      const editor = diffEditorRef.current;
      if (!editor) return undefined;
      const changes = editor.getLineChanges() ?? [];
      const line = editor.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      const change =
        changes.find(
          (candidate) =>
            line >= candidate.modifiedStartLineNumber &&
            line <= Math.max(
              candidate.modifiedEndLineNumber,
              candidate.modifiedStartLineNumber,
            ),
        ) ?? changes[0];
      if (!change) return undefined;
      return {
        targetStart: change.modifiedStartLineNumber,
        targetEnd:
          change.modifiedEndLineNumber === 0
            ? change.modifiedStartLineNumber - 1
            : change.modifiedEndLineNumber,
        sourceStart: change.originalStartLineNumber,
        sourceEnd:
          change.originalEndLineNumber === 0
            ? change.originalStartLineNumber - 1
            : change.originalEndLineNumber,
      };
    },
  }), [preview.left?.content, preview.right?.content, setEditBuffer]);

  const findFirstMatch = useCallback((query: string) => {
    const searchInEditor = (editor?: CodeEditor) => {
      const matches =
        editor?.getModel()?.findMatches(query, true, false, false, null, true) ?? [];
      const line = matches[0]?.range.startLineNumber;
      if (line !== undefined) editor?.revealLineInCenter(line);
      return line;
    };
    const diffEditor = diffEditorRef.current;
    return mode === "compare"
      ? searchInEditor(diffEditor?.getModifiedEditor()) ??
          searchInEditor(diffEditor?.getOriginalEditor())
      : searchInEditor(editorRef.current);
  }, [mode]);

  const diffNavigator = {
    current: diffNavigatorState.total === 0 ? 0 : diffNavigatorState.currentIndex + 1,
    total: diffNavigatorState.total,
    canGoPrevious: diffNavigatorState.total > 0,
    canGoNext: diffNavigatorState.total > 0,
    onPrevious: () => navigateDiffBlock(-1),
    onNext: () => navigateDiffBlock(1),
  };

  return {
    state: {
      selected,
      preview,
      contentFilter,
      viewMode,
      editBuffer,
      activeTab,
      openTabs,
      activeViewSource,
    },
    actions: {
      selectPair: setSelected,
      setContentFilter,
      updateEditBuffer: setEditBuffer,
      focusFiles: () => setActiveTab("files"),
      focusTab,
      selectViewSource,
      closeViewSourceTab,
      inspect,
      inspectViewEntry,
      closeTab,
      focusRelativeTab,
      closeActiveTab,
      showBytecode,
      reset,
    },
    editor: {
      handleEditorMount,
      handleDiffMount,
      diffNavigator,
      merge: mergeEditor,
      findFirstMatch,
    },
    openTabsCount: openTabs.length,
  };
}
