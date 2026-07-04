import "@/lib/monaco";
import type { DiffOnMount, OnMount } from "@monaco-editor/react";
import {
  type ArchiveDiff,
  type ArchiveSummary,
  type BackendSearchHit,
  type CodeEditor,
  type CommitResult,
  type ComparePair,
  type DecorationRef,
  type DiffCodeEditor,
  type EntryKind,
  type EntryPreview,
  type Mode,
  type MonacoApi,
  type PairStatus,
  type PlatformHints,
  type SearchResult,
  type Side,
  type StagedEntry,
  type TreeFilter,
  type ViewEntryTab,
  type ViewMode,
  type ViewSource,
  type ViewSourceSummary,
  type ViewWorkspaceState,
} from "@/lib/types";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as chooseFile } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { MenuBar } from "@/components/MenuBar";
import { SourceChips } from "@/components/SourceChips";
import { SearchBar } from "@/components/SearchBar";
import { SearchResultsPanel } from "@/components/SearchResultsPanel";
import { DiffView, pairHasClass } from "@/components/DiffView";
import { FreeTextWorkspace } from "@/components/FreeTextWorkspace";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "@/lib/tabs";
import {
  applyPreferencesToRoot,
  effectiveColorPattern,
  loadUiPreferences,
  normalizeUiPreferences,
  saveUiPreferences,
} from "@/lib/preferences";
import {
  FALLBACK_SYSTEM_FONTS,
  fontFamilies,
  installedFontFacesCss,
  normalizeSystemFonts,
  type SystemFont,
} from "@/lib/system-fonts";
import { searchContextForActiveTab, searchResultKey } from "@/lib/search";
import { moveHunk, type Hunk } from "@/lib/textMerge";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { ViewSourceTabs } from "@/components/ViewSourceTabs";
import { FileTree } from "@/components/FileTree";
import { isDirectoryPair, pairPassesTreeFilter } from "@/lib/tree";
import { SplashScreen } from "@/components/SplashScreen";
import { StatusBar } from "@/components/StatusBar";
import {
  type HistoryEntry,
  clearHistory,
  loadHistory,
  recordSession,
} from "@/lib/history";
import {
  dispatchAppAction,
  getActionState,
  isAppActionId,
  shortcutBindings,
  type AppActionContext,
  type AppActionHandlers,
} from "@/lib/actions";
import { classifyFocusTarget, currentPlatform, matchShortcut } from "@/lib/shortcuts";
import {
  closeViewSource,
  createViewSource,
  focusViewEntryTab,
  openViewSource,
  upsertViewEntryTab,
} from "@/lib/view-workspace";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

const emptyPaths: Record<Side, string> = { left: "", right: "" };

const MAX_DIFF_TABS = 10;
const VIEW_ROOT_KEY = "";

const SIDE_PREFIX_RE = /^(left|right):/;
const stripSidePrefix = (key: string) => key.replace(SIDE_PREFIX_RE, "");

// Keep in sync with EDITABLE_EXTENSIONS in crates/lcdiff-core/src/edit.rs (Rust list is the authority; this list only controls the editor read-only affordance in the UI).
const EDIT_EXTENSIONS = ["xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf", "sh", "bash"];

type DiffLineChange = NonNullable<ReturnType<DiffCodeEditor["getLineChanges"]>>[number];

type DiffNavigatorState = {
  currentIndex: number;
  total: number;
};

type OsOpenPathsPayload = {
  paths: string[];
};

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

function summaryAsArchive(source: ViewSource | undefined): ArchiveSummary | undefined {
  if (!source) return undefined;
  return {
    path: source.path,
    metadata: { sourceKind: source.kind, signed: false, multiRelease: false, zip64: false },
    entries: [],
  };
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

function dropSideForPosition(mode: Mode, x: number, width: number): Side {
  if (mode === "single") return "left";
  return x < width / 2 ? "left" : "right";
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
  const { start, end } = lineChangeRangeForSide(change, side);
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

export function App() {
  const [paths, setPaths] = useState(emptyPaths);
  const [pathErrors, setPathErrors] = useState<Partial<Record<Side, string>>>({});
  const [archives, setArchives] = useState<Partial<Record<Side, ArchiveSummary>>>({});
  const [pairs, setPairs] = useState<ComparePair[]>([]);
  const [nestedPairs, setNestedPairs] = useState<Record<string, ComparePair[]>>({});
  const [viewWorkspace, setViewWorkspace] = useState<ViewWorkspaceState>({ sources: [] });
  const [selected, setSelected] = useState<ComparePair>();
  const [preview, setPreview] = useState<Partial<Record<Side, EntryPreview>>>({});
  const [message, setMessage] = useState("Open a JAR, ZIP, or folder on each side.");
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("diff");
  const [treeExpandAllVersion, setTreeExpandAllVersion] = useState(0);
  const [treeCollapseAllVersion, setTreeCollapseAllVersion] = useState(0);
  const [preferences, setPreferences] = useState(loadUiPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>(FALLBACK_SYSTEM_FONTS);
  const [fontStatus, setFontStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const engine = preferences.misc.decompiler.engine;
  const [query, setQuery] = useState("");
  const [includeSourceSearch, setIncludeSourceSearch] = useState(
    preferences.misc.search.includeSourceByDefault,
  );
  const [searchPaths, setSearchPaths] = useState<Set<string>>();
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult>();
  const [mode, setMode] = useState<Mode>("compare");
  const [view, setView] = useState<"splash" | "workspace">("splash");
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [viewMode, setViewMode] = useState<ViewMode>("source");
  const [stagedTarget, setStagedTarget] = useState<Side>();
  const [stagedEntries, setStagedEntries] = useState<Record<string, StagedEntry>>({});
  const [editBuffer, setEditBuffer] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [dropHint, setDropHint] = useState("");
  const [signedSavePrompt, setSignedSavePrompt] = useState<Side>();
  const [pendingOpen, setPendingOpen] = useState<{ side: Side; path: string }>();
  const [suppressSignedWarningForFile, setSuppressSignedWarningForFile] = useState(false);
  const [signedWarningSuppressions, setSignedWarningSuppressions] = useState<Record<string, boolean>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"files" | string>("files");
  const [openTabs, setOpenTabs] = useState<DiffTab[]>([]);
  const [diffNavigatorState, setDiffNavigatorState] = useState<DiffNavigatorState>({
    currentIndex: -1,
    total: 0,
  });
  const appShellRef = useRef<HTMLElement>(null);
  const focusCounter = useRef(0);
  const openTabsCountRef = useRef(0);
  const previewRequestId = useRef(0);
  const searchStreamId = useRef(0);
  const cancelableSearchActiveRef = useRef(false);
  const editorRef = useRef<CodeEditor | undefined>(undefined);
  const diffEditorRef = useRef<DiffCodeEditor | undefined>(undefined);
  const diffNavigatorFocusSideRef = useRef<Side>("right");
  const monacoRef = useRef<MonacoApi | undefined>(undefined);
  const actionContextRef = useRef<AppActionContext | undefined>(undefined);
  const actionHandlersRef = useRef<AppActionHandlers | undefined>(undefined);
  const shortcutDialogOpenRef = useRef(shortcutDialogOpen);
  const viewRef = useRef(view);
  const modeRef = useRef(mode);
  const activeViewSourceIdRef = useRef<string | undefined>(undefined);
  const viewRequestGenerationRef = useRef(0);
  const lastFocusKindRef = useRef(classifyFocusTarget(document.activeElement));
  const singleSearchDecorations = useRef<string[]>([]);
  const leftSearchDecorations = useRef<string[]>([]);
  const rightSearchDecorations = useRef<string[]>([]);
  const selectedRef = useRef<ComparePair | undefined>(selected);
  const inspectRef = useRef(inspect);
  const appliedEngineRef = useRef(engine);
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
    const side = diffNavigatorFocusSideRef.current ?? "right";
    const focusedEditor = side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const currentIndex = currentDiffBlockIndex(
      changes,
      side,
      focusedEditor.getPosition()?.lineNumber,
    );
    setDiffNavigatorState({ currentIndex, total: changes.length });
  }, [mode]);
  const handleEditorMount = useCallback<OnMount>((editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; }, []);
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
  const availableFontFamilies = useMemo(
    () => (fontStatus === "ready" ? fontFamilies(systemFonts) : undefined),
    [fontStatus, systemFonts],
  );
  useEffect(() => {
    const normalized = normalizeUiPreferences(preferences, availableFontFamilies);
    if (normalized !== preferences && JSON.stringify(normalized) !== JSON.stringify(preferences)) {
      setPreferences(normalized);
      return;
    }
    saveUiPreferences(normalized);
    applyPreferencesToRoot(document.documentElement, normalized, systemPrefersDark);
    if (appShellRef.current) applyPreferencesToRoot(appShellRef.current, normalized, systemPrefersDark);
  }, [preferences, availableFontFamilies, systemPrefersDark, view]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const updateSystemPreference = () => setSystemPrefersDark(query.matches);
    updateSystemPreference();
    query.addEventListener("change", updateSystemPreference);
    return () => query.removeEventListener("change", updateSystemPreference);
  }, []);
  useEffect(() => {
    const updateLastFocusKind = (event: FocusEvent) => {
      lastFocusKindRef.current = classifyFocusTarget(event.target);
    };
    document.addEventListener("focusin", updateLastFocusKind);
    return () => document.removeEventListener("focusin", updateLastFocusKind);
  }, []);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    inspectRef.current = inspect;
  }, [inspect]);
  useEffect(() => {
    setIncludeSourceSearch(preferences.misc.search.includeSourceByDefault);
  }, [preferences.misc.search.includeSourceByDefault]);
  useEffect(() => {
    const styleId = "lcdiff-installed-editor-fonts";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    const css = installedFontFacesCss(systemFonts, (path) =>
      isTauriRuntime() ? convertFileSrc(path) : path,
    );
    if (!css) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.append(style);
    }
    style.textContent = css;
    return () => {
      style?.remove();
    };
  }, [systemFonts]);
  useEffect(() => {
    monacoRef.current?.editor?.remeasureFonts?.();
    if (typeof editorRef.current?.layout === "function") editorRef.current.layout();
    if (typeof diffEditorRef.current?.layout === "function") diffEditorRef.current.layout();
  }, [preferences.editor.fontFamily, preferences.editor.fontSize, systemFonts]);
  useEffect(() => {
    let cancelled = false;
    const requestedEngine = engine;
    const previousEngine = appliedEngineRef.current;
    invoke("set_engine", { engine: requestedEngine })
      .then(() => {
        appliedEngineRef.current = requestedEngine;
        const currentSelected = selectedRef.current;
        if (!cancelled && currentSelected) void inspectRef.current(currentSelected, true);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : String(error));
        if (requestedEngine === previousEngine) return;
        setPreferences((current) => {
          if (current.misc.decompiler.engine !== requestedEngine) return current;
          return {
            ...current,
            misc: {
              ...current.misc,
              decompiler: {
                ...current.misc.decompiler,
                engine: previousEngine,
              },
            },
          };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [engine]);
  const loadSystemFonts = useCallback(async () => {
    if (fontStatus === "loading" || fontStatus === "ready") return;
    setFontStatus("loading");
    try {
      const fonts = normalizeSystemFonts(await invoke<SystemFont[]>("list_system_fonts"));
      setSystemFonts(fonts);
      setFontStatus("ready");
    } catch {
      setSystemFonts(FALLBACK_SYSTEM_FONTS);
      setFontStatus("fallback");
    }
  }, [fontStatus]);

  const updateShortcutDialogOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(shortcutDialogOpenRef.current) : next;
    shortcutDialogOpenRef.current = resolved;
    setShortcutDialogOpen(resolved);
  }, []);
  const activeViewSource = useMemo(
    () => viewWorkspace.sources.find((source) => source.id === viewWorkspace.activeSourceId),
    [viewWorkspace.activeSourceId, viewWorkspace.sources],
  );
  const activeViewEntryTab = useMemo(
    () => activeViewSource?.entryTabs.find((tab) => tab.entryPath === viewWorkspace.activeEntryPath),
    [activeViewSource?.entryTabs, viewWorkspace.activeEntryPath],
  );
  useEffect(() => {
    activeViewSourceIdRef.current = viewWorkspace.activeSourceId;
  }, [viewWorkspace.activeSourceId]);
  const activeViewRootPairs = useMemo(
    () => activeViewSource?.nestedPairs[VIEW_ROOT_KEY] ?? [],
    [activeViewSource?.nestedPairs],
  );
  const displayedPairs = useMemo<ComparePair[]>(
    () => (mode === "compare" ? pairs : activeViewRootPairs),
    [activeViewRootPairs, mode, pairs],
  );
  const visiblePairs = useMemo(
    () =>
      displayedPairs.filter(
        (pair) =>
          !isDirectoryPair(pair) &&
          (mode !== "compare" || pairPassesTreeFilter(pair, treeFilter)) &&
          (!searchPaths || searchPaths.has(pair.path)),
      ),
    [displayedPairs, mode, searchPaths, treeFilter],
  );

  function isCurrentViewRequest(generation: number, sourceId?: string) {
    return (
      viewRequestGenerationRef.current === generation &&
      modeRef.current === "single" &&
      (!sourceId || activeViewSourceIdRef.current === sourceId)
    );
  }

  function clearViewSearchState(cancelBackendSearch = false) {
    searchStreamId.current += 1;
    cancelableSearchActiveRef.current = false;
    setSearching(false);
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
    if (cancelBackendSearch) void invoke("cancel_deep_search").catch(() => undefined);
  }

  const refreshDiff = useCallback(async () => {
    try {
      const diff = await invoke<ArchiveDiff>("compute_diff");
      setPairs(diff.pairs);
      setNestedPairs({});
    } catch {
      setPairs([]);
      setNestedPairs({});
    }
  }, []);

  const loadViewPairs = useCallback(async (sourceId: string, nestedPath = VIEW_ROOT_KEY, generation?: number) => {
    const diff = await invoke<ArchiveDiff>("compute_view_nested_entries", { sourceId, nestedPath });
    if (generation !== undefined && !isCurrentViewRequest(generation, sourceId)) return diff.pairs;
    setViewWorkspace((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? { ...source, nestedPairs: { ...source.nestedPairs, [nestedPath]: diff.pairs } }
          : source,
      ),
    }));
    return diff.pairs;
  }, []);

  const expandArchive = useCallback(async (fullPath: string) => {
    try {
      if (mode === "single") {
        if (!activeViewSource) return;
        await loadViewPairs(activeViewSource.id, fullPath);
        return;
      }
      const diff = await invoke<ArchiveDiff>("compute_nested_diff", { nestedPath: fullPath });
      setNestedPairs((prev) => ({ ...prev, [fullPath]: diff.pairs }));
    } catch (error) {
      setMessage(String(error));
    }
  }, [activeViewSource, loadViewPairs, mode]);

  const openViewPath = useCallback(async (path: string) => {
    const generation = viewRequestGenerationRef.current + 1;
    viewRequestGenerationRef.current = generation;
    try {
      const validatedPath = await invoke<string>("validate_path", { raw: path });
      if (!isCurrentViewRequest(generation)) return undefined;
      const summary = await invoke<ViewSourceSummary>("open_view_source", { path: validatedPath });
      if (!isCurrentViewRequest(generation)) return undefined;
      previewRequestId.current += 1;
      clearViewSearchState(false);
      setPathErrors((current) => ({ ...current, left: undefined }));
      setPaths((current) => ({ ...current, left: summary.path }));
      setArchives({});
      setPairs([]);
      setNestedPairs({});
      setSelected(undefined);
      setActiveTab("files");
      setOpenTabs([]);
      setPreview({});
      setEditBuffer("");
      setViewMode("source");
      activeViewSourceIdRef.current = summary.id;
      setViewWorkspace((current) => openViewSource(current, createViewSource(summary)));
      await loadViewPairs(summary.id, VIEW_ROOT_KEY, generation);
      if (!isCurrentViewRequest(generation, summary.id)) return undefined;
      setMessage(`Opened ${summary.path}`);
      return undefined;
    } catch (error) {
      if (!isCurrentViewRequest(generation)) return undefined;
      const message = String(error);
      setPathErrors((current) => ({ ...current, left: message }));
      setMessage(message);
      return message;
    }
  }, [loadViewPairs]);

  const openPath = useCallback(async (side: Side, path: string, confirmed = false) => {
    try {
      if (!confirmed && openTabsCountRef.current > 0) {
        setPendingOpen({ side, path });
        return undefined;
      }
      const validatedPath = await invoke<string>("validate_path", { raw: path });
      const archive = await invoke<ArchiveSummary>("open_archive", { path: validatedPath, side });
      previewRequestId.current += 1;
      searchStreamId.current += 1;
      setSearching(false);
      setPaths((current) => ({ ...current, [side]: archive.path }));
      setPathErrors((current) => ({ ...current, [side]: undefined }));
      setArchives((current) => ({ ...current, [side]: archive }));
      setSelected(undefined);
      setActiveTab("files");
      setOpenTabs([]);
      setPreview({});
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
      setMessage(`Opened ${archive.path}`);
      await refreshDiff();
      return undefined;
    } catch (error) {
      const message = String(error);
      setPathErrors((current) => ({ ...current, [side]: message }));
      setMessage(message);
      return message;
    }
  }, [refreshDiff]);

  const openTextMode = useCallback(() => {
    if (stagedTarget) {
      setMessage("Save or clear unsaved changes before switching to Free text.");
      return;
    }
    modeRef.current = "text";
    viewRequestGenerationRef.current += 1;
    previewRequestId.current += 1;
    searchStreamId.current += 1;
    cancelableSearchActiveRef.current = false;
    setSearching(false);
    setSearchOpen(false);
    setMode("text");
    setView("workspace");
    setPaths(emptyPaths);
    setPathErrors({});
    setArchives({});
    setPairs([]);
    setNestedPairs({});
    setSelected(undefined);
    setActiveTab("files");
    setViewMode("source");
    setPreview({});
    setOpenTabs([]);
    setQuery("");
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
    void invoke("cancel_deep_search").catch(() => undefined);
    setMessage("Free text is ready. Edit both sides, then compare when you want a result.");
  }, [stagedTarget]);

  const openFromOs = useCallback((path: string) => {
    if (!path) return;
    if (modeRef.current === "text") {
      setMessage("File opens are not available in Free text mode.");
      return;
    }
    modeRef.current = "single";
    setMode("single");
    setView("workspace");
    void openViewPath(path);
  }, [openViewPath]);

  useEffect(() => {
    openTabsCountRef.current = openTabs.length;
  }, [openTabs]);

  useEffect(() => {
    if (view !== "workspace") return;
    if (mode === "text") return;
    if (archives.left?.metadata.sourceKind === "text" || archives.right?.metadata.sourceKind === "text") return;
    if (mode === "single" && activeViewSource) {
      setHistory(recordSession("single", [activeViewSource.path], Date.now()));
      return;
    }
    const left = archives.left?.path;
    const right = archives.right?.path;
    if (mode === "compare" && left && right) {
      setHistory(recordSession("compare", [left, right], Date.now()));
    }
  }, [view, mode, activeViewSource, archives.left?.path, archives.right?.path]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: undefined | (() => void);
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
        if (mode === "text") {
          setMessage("File drops are not available in Free text mode.");
          return;
        }
        const side = dropSideForPosition(mode, event.payload.position.x, window.innerWidth);
        if (mode === "single") void openViewPath(event.payload.paths[0]);
        else void openPath(side, event.payload.paths[0]);
      })
      .then((stop) => {
        unlisten = stop;
      });
    return () => unlisten?.();
  }, [mode, openPath, openViewPath]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: undefined | (() => void);
    void invoke<string[]>("pending_open_paths")
      .then((paths) => {
        if (!disposed && paths.length > 0) openFromOs(paths[0]);
      })
      .catch((error) => {
        if (!disposed) setMessage(`Open-with handoff failed: ${String(error)}`);
      });
    listen<OsOpenPathsPayload>("os-open-paths", (event) => {
      const [path] = event.payload.paths;
      if (path) openFromOs(path);
      void invoke<string[]>("pending_open_paths").catch(() => undefined);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) setMessage(`Open-with listener failed: ${String(error)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openFromOs]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<PlatformHints>("platform_hints")
      .then((hints) => setDropHint(hints.dropHint ?? ""))
      .catch(() => setDropHint(""));
  }, []);

  useEffect(() => {
    if (!stagedTarget || !isTauriRuntime()) return;
    let unlisten: undefined | (() => void);
    const window = getCurrentWindow();
    window
      .onCloseRequested((event) => {
        event.preventDefault();
        if (!globalThis.confirm("Discard unsaved changes and close LCDiff?")) return;
        void invoke("clear_staged").then(() => window.destroy());
      })
      .then((stop) => {
        unlisten = stop;
      });
    return () => unlisten?.();
  }, [stagedTarget]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenProgress: undefined | (() => void);
    let unlistenResult: undefined | (() => void);
    listen<{ searchId: number; completed: number; total: number; entryPath: string }>("search-progress", (event) => {
      if (event.payload.searchId !== searchStreamId.current) return;
      setMessage(
        `Deep search ${event.payload.completed}/${event.payload.total}: ${event.payload.entryPath}`,
      );
    }).then((stop) => {
      unlistenProgress = stop;
    });
    listen<{ searchId: number; side: Side; hit: BackendSearchHit }>("search-result", (event) => {
      if (event.payload.searchId !== searchStreamId.current) return;
      const result: SearchResult = {
        side: event.payload.side,
        tier: "T3",
        path: event.payload.hit.entryPath,
        kind: event.payload.hit.kind,
        line: event.payload.hit.line,
        preview: event.payload.hit.preview,
      };
      setSearchPaths((current) => new Set([...(current ?? []), result.path]));
      setSearchResults((current) =>
        current.some((candidate) => searchResultKey(candidate) === searchResultKey(result))
          ? current
          : [...current, result],
      );
    }).then((stop) => {
      unlistenResult = stop;
    });
    return () => {
      unlistenProgress?.();
      unlistenResult?.();
    };
  }, []);

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
    if (activeTab === "files" || !selected) return;
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === activeTab ? { ...t, pair: selected, preview, viewMode } : t)),
    );
  }, [activeTab, selected, preview, viewMode]);

  async function browse(side: Side) {
    try {
      const path = await chooseFile({
        multiple: false,
        // "All files" is the default so any file is selectable — the backend
        // opens any file and auto-detects text vs binary. The other entries are
        // convenience filters that narrow the dialog, not gates.
        filters: [
          { name: "All files", extensions: ["*"] },
          {
            name: "Text file",
            extensions: [
              "json", "xml", "properties", "toml", "sql", "txt", "text", "yaml", "yml",
              "ini", "cfg", "conf", "config", "env", "md", "markdown", "rst", "csv", "tsv", "log",
              "js", "jsx", "mjs", "cjs", "ts", "tsx", "html", "htm", "xhtml",
              "css", "scss", "sass", "less", "java", "kt", "kts", "groovy", "gradle",
              "rs", "go", "py", "rb", "php", "pl", "lua", "c", "h", "cpp", "hpp", "cc",
              "cs", "swift", "scala", "dart", "sh", "bash", "zsh", "fish", "bat", "ps1",
              "svg", "graphql", "gql", "proto", "mf", "plist", "tex", "vue", "svelte", "astro",
            ],
          },
          { name: "JAR or ZIP archive", extensions: ["jar", "zip", "war", "ear"] },
        ],
      });
      if (path) {
        if (mode === "single") await openViewPath(path);
        else await openPath(side, path);
      }
    } catch (error) {
      setMessage(`Open file picker failed: ${String(error)}`);
    }
  }

  async function browseFolder(side: Side) {
    try {
      const path = await chooseFile({
        multiple: false,
        directory: true,
      });
      if (path) {
        if (mode === "single") await openViewPath(path);
        else await openPath(side, path);
      }
    } catch (error) {
      setMessage(`Open directory picker failed: ${String(error)}`);
    }
  }

  function refreshSources() {
    if (mode === "single") {
      if (activeViewSource) void openViewPath(activeViewSource.path);
      return;
    }
    const sides: Side[] = mode === "compare" ? ["left", "right"] : ["left"];
    for (const side of sides) {
      if (archives[side]?.metadata.sourceKind === "text") continue;
      const current = archives[side]?.path;
      if (current) void openPath(side, current, true);
    }
  }

  function focusViewTab(path: string) {
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
  }

  function selectViewSource(sourceId: string) {
    viewRequestGenerationRef.current += 1;
    activeViewSourceIdRef.current = sourceId;
    clearViewSearchState(cancelableSearchActiveRef.current);
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
    setSelectedSearchResult(undefined);
  }

  function closeViewEntryTab(path: string) {
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
  }

  function closeViewSourceTab(sourceId: string) {
    viewRequestGenerationRef.current += 1;
    void invoke("close_view_source", { sourceId }).catch(() => undefined);
    const remainingSources = viewWorkspace.sources.filter((source) => source.id !== sourceId);
    const closedActive = viewWorkspace.activeSourceId === sourceId;
    const sourceIndex = viewWorkspace.sources.findIndex((source) => source.id === sourceId);
    const nextSource = closedActive ? remainingSources[sourceIndex] ?? remainingSources[sourceIndex - 1] : activeViewSource;
    activeViewSourceIdRef.current = nextSource?.id;
    if (closedActive) clearViewSearchState(cancelableSearchActiveRef.current);
    const nextTab = closedActive ? latestViewEntryTab(nextSource) : activeViewEntryTab;
    setViewWorkspace((current) => ({
      ...closeViewSource(current, sourceId),
      activeEntryPath: nextTab?.entryPath,
    }));
    if (!closedActive) return;
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

  function focusTab(path: string) {
    if (mode === "single") {
      focusViewTab(path);
      return;
    }
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setSelected(tab.pair);
    setPreview(tab.preview);
    setEditBuffer(tab.preview.left?.content ?? "");
    setViewMode(tab.viewMode);
    setActiveTab(path);
    setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, lastFocus: stamp } : t)));
  }

  async function inspectViewEntry(pair: ComparePair, force = false) {
    const source = activeViewSource;
    if (!source) return;
    const existing = source.entryTabs.find((tab) => tab.entryPath === pair.path);
    if (existing && !force) {
      focusViewTab(pair.path);
      return;
    }
    const sourceId = source.id;
    const requestId = previewRequestId.current + 1;
    const generation = viewRequestGenerationRef.current;
    previewRequestId.current = requestId;
    setSelected(pair);
    setActiveTab(pair.path);
    setViewMode("source");
    const nextPreview = await invoke<EntryPreview>("read_view_entry", {
      sourceId: source.id,
      entryPath: pair.path,
    });
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
  }

  async function inspect(pair: ComparePair, force = false) {
    if (mode === "single") {
      await inspectViewEntry(pair, force);
      return;
    }
    const existing = openTabs.find((t) => t.path === pair.path);
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
      if (pair[side]) {
        next[side] = await invoke<EntryPreview>("read_entry", { side, entryPath: pair.path });
      }
    }
    if (previewRequestId.current !== requestId) return;
    setPreview(next);
    setEditBuffer(next.left?.content ?? "");
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setOpenTabs((prev) =>
      evictLru(
        upsertTab(prev, { path: pair.path, pair, preview: next, viewMode: "source", lastFocus: stamp }),
        MAX_DIFF_TABS,
      ),
    );
    for (const side of ["left", "right"] as const) {
      if (pair[side]?.kind === "class" && !pair.path.includes("!/")) {
        void invoke("prefetch_siblings", { side, entryPath: pair.path });
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
  }

  function closeTab(path: string) {
    if (mode === "single") {
      closeViewEntryTab(path);
      return;
    }
    if (activeTab === path) {
      const next = pickNeighbor(openTabs, path);
      if (next === "files") {
        setActiveTab("files");
      } else {
        focusTab(next);
      }
    }
    setOpenTabs((prev) => prev.filter((t) => t.path !== path));
  }

  function focusRelativeTab(direction: 1 | -1) {
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
  }

  function closeActiveTab() {
    if (activeTab !== "files") closeTab(activeTab);
  }

  async function showBytecode() {
    const pair = selected;
    if (!pair) return;
    if (!pairHasClass(pair)) {
      setMessage("Bytecode view is only available for class entries.");
      return;
    }
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    if (mode === "single") {
      const source = activeViewSource;
      if (!source) return;
      const sourceId = source.id;
      const generation = viewRequestGenerationRef.current;
      try {
        const nextPreview: EntryPreview = {
          path: pair.path,
          kind: "class",
          language: "plaintext",
          content: await invoke<string>("disassemble_view_entry", {
            sourceId,
            entryPath: pair.path,
          }),
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
            { entryPath: pair.path, preview: nextPreview, viewMode: "bytecode", lastFocus: focusCounter.current },
            MAX_DIFF_TABS,
          );
        });
      } catch (error) {
        if (!isCurrentViewRequest(generation, sourceId)) return;
        setMessage(String(error));
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
            content: await invoke<string>("disassemble", { side, entryPath: pair.path }),
          };
        }
      }
      if (previewRequestId.current !== requestId) return;
      setPreview(next);
      setViewMode("bytecode");
    } catch (error) {
      setMessage(String(error));
    }
  }

  function pickMode(next: Mode) {
    if (next === "text") {
      openTextMode();
      return;
    }
    modeRef.current = next;
    if (next !== "single") viewRequestGenerationRef.current += 1;
    setMode(next);
    setView("workspace");
  }

  function openEntry(entry: HistoryEntry) {
    modeRef.current = entry.mode;
    viewRequestGenerationRef.current += 1;
    setMode(entry.mode);
    setView("workspace");
    if (entry.mode === "single") {
      void openViewPath(entry.paths[0]);
    } else {
      void openPath("left", entry.paths[0], true).then(() =>
        openPath("right", entry.paths[1], true),
      );
    }
  }

  function clearRecent() {
    clearHistory();
    setHistory([]);
  }

  function changeMode(next: Mode) {
    if (next === "text") {
      openTextMode();
      return;
    }
    if (next !== mode && stagedTarget) {
      setMessage(`Save or clear unsaved changes before switching to ${next === "single" ? "View" : "Compare"} mode.`);
      return;
    }
    modeRef.current = next;
    viewRequestGenerationRef.current += 1;
    if (mode === "single" || next === "single") clearViewSearchState(cancelableSearchActiveRef.current);
    if ((mode === "compare" || mode === "text") && next === "single") {
      diffEditorRef.current?.setModel(null);
      diffEditorRef.current = undefined;
      setSelected(undefined);
      setPreview({});
      setEditBuffer("");
      setOpenTabs([]);
      setActiveTab("files");
      setViewMode("source");
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    if (mode === "single" && next === "compare") {
      diffEditorRef.current?.setModel(null);
      diffEditorRef.current = undefined;
      setPaths(emptyPaths);
      setPathErrors({});
      setArchives({});
      setPairs([]);
      setNestedPairs({});
      setSelected(undefined);
      setActiveTab("files");
      setOpenTabs([]);
      setPreview({});
      setEditBuffer("");
      setViewMode("source");
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    if (mode === "text") {
      setPaths(emptyPaths);
      setPathErrors({});
      setArchives({});
      setPairs([]);
      setNestedPairs({});
      setSelected(undefined);
      setActiveTab("files");
      setOpenTabs([]);
      setPreview({});
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    setMode(next);
  }

  async function copy(from: Side, to: Side, pair = selected) {
    if (!pair) return;
    try {
      await invoke("stage_copy", { from, to, entryPath: pair.path });
      setStagedTarget(to);
      setStagedEntries((current) => ({ ...current, [pair.path]: { side: to, kind: "copy" } }));
      setMessage(`Staged ${pair.path}: ${from} -> ${to}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function save(targetSide: Side, signedConfirmed = false) {
    if (isFileMerge) {
      const dirty = (["left", "right"] as Side[]).filter((s) =>
        Object.values(stagedEntries).some((e) => e.side === s),
      );
      try {
        // Commit all dirty sides first: open_archive/openPath rejects a reopen
        // while the other side still has pending ops.
        for (const side of dirty) {
          await invoke<CommitResult>("commit_merge", {
            targetSide: side,
            backup: backupEnabled,
            confirmSigned: false,
          });
        }
        setStagedTarget(undefined);
        setStagedEntries({});
        // Refresh each saved side's preview/state from disk.
        for (const side of dirty) {
          const path = archives[side]?.path;
          if (path) await openPath(side, path, true);
        }
        setMessage(`Saved ${dirty.length} file change${dirty.length === 1 ? "" : "s"}.`);
      } catch (error) {
        setMessage(String(error));
      }
      return;
    }
    try {
      const signed = archives[targetSide]?.metadata.signed ?? false;
      const signedPath = archives[targetSide]?.path ?? "";
      if (signed && !signedConfirmed && !signedWarningSuppressions[signedPath]) {
        setSuppressSignedWarningForFile(false);
        setSignedSavePrompt(targetSide);
        return;
      }
      const result = await invoke<CommitResult>("commit_merge", {
        targetSide,
        backup: backupEnabled,
        confirmSigned: signed,
      });
      setStagedTarget(undefined);
      setStagedEntries({});
      const saveMessage =
        `Saved ${result.copiedEntries} entries to ${result.rewrittenPath}` +
        (result.signatureInvalidated ? " (signed archive is now invalid)" : "");
      const reloadError = await openPath(targetSide, result.rewrittenPath, true);
      setMessage(reloadError ? `${saveMessage}; reload failed: ${reloadError}` : saveMessage);
    } catch (error) {
      setMessage(String(error));
    }
  }

  function confirmSignedSave() {
    const targetSide = signedSavePrompt;
    if (!targetSide) return;
    const signedPath = archives[targetSide]?.path;
    if (suppressSignedWarningForFile && signedPath) {
      setSignedWarningSuppressions((current) => ({ ...current, [signedPath]: true }));
    }
    setSignedSavePrompt(undefined);
    void save(targetSide, true);
  }

  async function clearStaged() {
    await invoke("clear_staged");
    setStagedTarget(undefined);
    setStagedEntries({});
    // Revert the visible editor buffers to the originally loaded content so the
    // discard takes effect immediately, without needing a reload. `preview`
    // holds the on-disk content captured when the entry was opened; edits live
    // only in the Monaco models until staged, so resetting the models discards
    // them. Compare/file-merge uses the diff editor; single mode uses editBuffer.
    const ed = diffEditorRef.current;
    if (ed) {
      ed.getOriginalEditor().setValue(preview.left?.content ?? "");
      ed.getModifiedEditor().setValue(preview.right?.content ?? "");
    }
    setEditBuffer(preview.left?.content ?? "");
    setMessage("Cleared unsaved changes.");
  }

  async function unstage(key: string) {
    // File-merge staging uses side-prefixed keys ("left:<path>"/"right:<path>");
    // archive/folder staging uses bare path keys (a bare key has no prefix, so
    // stripSidePrefix is a no-op there). The backend `unstage` takes a bare
    // entryPath plus an optional side, so resolve the side from the stored entry
    // and remove exactly the one matching local key. This keeps two versions of
    // the same basename (left:config.json / right:config.json) independent.
    try {
      const entry = stagedEntries[key];
      const bare = stripSidePrefix(key);
      await invoke("unstage", { entryPath: bare, side: entry?.side });
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[key];
        if (Object.keys(next).length === 0) setStagedTarget(undefined);
        return next;
      });
      setMessage(`Unstaged ${bare}.`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function stageEdit(entryPath: string, content: string) {
    const original = preview.left?.content ?? "";
    if (content === original) {
      if (stagedEntries[entryPath]?.kind === "edit") {
        await invoke("unstage", { entryPath });
        setStagedEntries((current) => {
          const next = { ...current };
          delete next[entryPath];
          if (Object.keys(next).length === 0) setStagedTarget(undefined);
          return next;
        });
      }
      return;
    }
    try {
      await invoke("stage_write", { side: "left", entryPath, content });
      setStagedEntries((current) => ({ ...current, [entryPath]: { side: "left", kind: "edit" } }));
      setStagedTarget("left");
      setMessage(`Edited ${entryPath} (unsaved)`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function stageFileSide(side: Side, content: string) {
    if (!selected) return;
    const key = `${side}:${selected.path}`;
    const original = (side === "left" ? preview.left?.content : preview.right?.content) ?? "";
    if (content === original) {
      if (stagedEntries[key]?.kind === "edit") await unstage(key);
      return;
    }
    try {
      await invoke("stage_write", { side, entryPath: selected.path, content });
      setStagedEntries((current) => ({ ...current, [key]: { side, kind: "edit" } }));
      setStagedTarget(side);
      setMessage(`Edited ${selected.path} on ${side} (unsaved)`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  function currentHunkAtCursor(): Hunk | undefined {
    const ed = diffEditorRef.current;
    if (!ed) return undefined;
    const changes = ed.getLineChanges() ?? [];
    // Hunk under cursor is detected from the modified (right) editor's cursor;
    // when focus is in the left pane we fall back to the first change.
    const line = ed.getModifiedEditor().getPosition()?.lineNumber ?? 1;
    const c =
      changes.find(
        (ch) =>
          line >= ch.modifiedStartLineNumber &&
          line <= Math.max(ch.modifiedEndLineNumber, ch.modifiedStartLineNumber),
      ) ?? changes[0];
    if (!c) return undefined;
    // Monaco: *EndLineNumber === 0 means "no lines on that side" (insertion point).
    return {
      targetStart: c.modifiedStartLineNumber,
      targetEnd: c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber - 1 : c.modifiedEndLineNumber,
      sourceStart: c.originalStartLineNumber,
      sourceEnd: c.originalEndLineNumber === 0 ? c.originalStartLineNumber - 1 : c.originalEndLineNumber,
    };
  }

  function navigateDiffBlock(direction: 1 | -1) {
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
    const side = diffNavigatorFocusSideRef.current ?? "right";
    const focusedEditor = side === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const currentIndex =
      diffNavigatorState.currentIndex >= 0 && diffNavigatorState.currentIndex < changes.length
        ? diffNavigatorState.currentIndex
        : currentDiffBlockIndex(changes, side, focusedEditor.getPosition()?.lineNumber);
    const targetIndex = (currentIndex + direction + changes.length) % changes.length;
    const targetSide = resolveDiffNavigationSide(changes[targetIndex], side);
    const targetEditor = targetSide === "left" ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const targetLine = revealLineForChange(changes[targetIndex], targetSide, targetEditor);
    if (targetLine !== undefined) {
      targetEditor.setPosition({ lineNumber: targetLine, column: 1 });
      targetEditor.revealLineInCenter(targetLine);
    }
    setDiffNavigatorState({ currentIndex: targetIndex, total: changes.length });
  }

  async function takeAllTo(target: Side) {
    if (!isTextMerge || !selected) return;
    const ed = diffEditorRef.current;
    if (!ed) return;
    const source: Side = target === "left" ? "right" : "left";
    const sourceEditor = source === "left" ? ed.getOriginalEditor() : ed.getModifiedEditor();
    const targetEditor = target === "left" ? ed.getOriginalEditor() : ed.getModifiedEditor();
    const content = sourceEditor.getValue();
    targetEditor.setValue(content);
    await stageFileSide(target, content);
  }

  function moveHunkTo(target: Side) {
    if (!isTextMerge) return;
    const ed = diffEditorRef.current;
    const hunk = currentHunkAtCursor();
    if (!ed || !hunk) return;
    // Monaco: left = original, right = modified. moveHunk works in target-space;
    // for "move right→left" we invert the hunk's target/source coordinates.
    let tEditor: CodeEditor;
    let sEditor: CodeEditor;
    let resolvedHunk: Hunk;
    if (target === "left") {
      tEditor = ed.getOriginalEditor();
      sEditor = ed.getModifiedEditor();
      resolvedHunk = {
        targetStart: hunk.sourceStart,
        targetEnd: hunk.sourceEnd,
        sourceStart: hunk.targetStart,
        sourceEnd: hunk.targetEnd,
      };
    } else {
      tEditor = ed.getModifiedEditor();
      sEditor = ed.getOriginalEditor();
      resolvedHunk = hunk;
    }
    // A move pulls the hunk's lines from the source side into the target side.
    // When the source side has no lines for this hunk (the content already lives
    // only on the target side, e.g. a target-only addition), there is nothing to
    // move — applying anyway would overwrite the target's real lines with the
    // empty source range and delete them outright. Skip to avoid data loss.
    if (resolvedHunk.sourceEnd < resolvedHunk.sourceStart) {
      setMessage("Nothing to move: the hunk at the cursor only exists on this side.");
      return;
    }
    const res = moveHunk(tEditor.getValue(), sEditor.getValue(), resolvedHunk);
    tEditor.setValue(res.target);
    sEditor.setValue(res.source);
    void stageFileSide(target, res.target);
    void stageFileSide(target === "left" ? "right" : "left", res.source);
  }

  async function runSearch() {
    const searchId = searchStreamId.current + 1;
    const sourceTierEnabled = includeSourceSearch;
    searchStreamId.current = searchId;
    cancelableSearchActiveRef.current = sourceTierEnabled;
    setSearching(sourceTierEnabled);
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
    try {
      const matches = new Set<string>();
      const results: SearchResult[] = [];
      const options = { includePath: true, includeText: true, includeConstants: true };
      const appendHit = (hit: BackendSearchHit, side: Side, tier: "T2" | "T3") => {
        matches.add(hit.entryPath);
        results.push({
          side,
          tier,
          path: hit.entryPath,
          kind: hit.kind,
          line: hit.line,
          preview: hit.preview,
        });
      };

      if (mode === "single") {
        const sourceId = activeViewSource?.id;
        const generation = viewRequestGenerationRef.current;
        if (!sourceId) {
          setMessage("Open a source before searching View mode.");
          return;
        }
        for (const hit of await invoke<BackendSearchHit[]>("search_view_source", {
          sourceId,
          query,
          options,
        })) {
          if (searchStreamId.current !== searchId || !isCurrentViewRequest(generation, sourceId)) return;
          appendHit(hit, "left", "T2");
        }
      } else {
        for (const side of searchSides()) {
          if (!archives[side] || archives[side]?.metadata.sourceKind === "text") continue;
          for (const hit of await invoke<BackendSearchHit[]>("search", { side, query, options })) {
            if (searchStreamId.current !== searchId) return;
            appendHit(hit, side, "T2");
          }
        }
      }
      if (sourceTierEnabled) {
        if (mode === "single") {
          const sourceId = activeViewSource?.id;
          if (!sourceId || !isCurrentViewRequest(viewRequestGenerationRef.current, sourceId)) return;
        }
        setSearchPaths(new Set(matches));
        setSearchResults([...results]);
        try {
          if (mode === "single") {
            const sourceId = activeViewSource?.id;
            const generation = viewRequestGenerationRef.current;
            if (!sourceId) return;
            for (const hit of await invoke<BackendSearchHit[]>("deep_search_view_source", {
              sourceId,
              query,
              searchId,
            })) {
              if (searchStreamId.current !== searchId || !isCurrentViewRequest(generation, sourceId)) return;
              appendHit(hit, "left", "T3");
            }
          } else {
            for (const side of searchSides()) {
              if (!archives[side] || archives[side]?.metadata.sourceKind === "text") continue;
              for (const hit of await invoke<BackendSearchHit[]>("deep_search", { side, query, searchId })) {
                if (searchStreamId.current !== searchId) return;
                appendHit(hit, side, "T3");
              }
            }
          }
        } catch (error) {
          if (searchStreamId.current !== searchId) return;
          setSearchPaths(new Set(matches));
          setSearchResults([...results]);
          setMessage(`Source search failed: ${String(error)}`);
          return;
        }
      }
      if (searchStreamId.current !== searchId) return;
      if (mode === "single") {
        const sourceId = activeViewSource?.id;
        if (!sourceId || !isCurrentViewRequest(viewRequestGenerationRef.current, sourceId)) return;
      }
      setSearchPaths(matches);
      setSearchResults(results);
      setMessage(`${sourceTierEnabled ? "Search with decompiled source" : "Search"} matched ${matches.size} entries.`);
    } catch (error) {
      if (searchStreamId.current !== searchId) return;
      setSearchPaths(undefined);
      setSearchResults([]);
      setMessage(String(error));
    } finally {
      if (searchStreamId.current === searchId) {
        cancelableSearchActiveRef.current = false;
        setSearching(false);
      }
    }
  }

  async function cancelDeepSearch() {
    searchStreamId.current += 1;
    cancelableSearchActiveRef.current = false;
    setSearching(false);
    await invoke("cancel_deep_search");
    setMessage("Cancelling decompiled source search...");
  }

  function findInCurrentDiff() {
    const trimmed = query.trim();
    if (!trimmed) {
      setMessage("Search query is empty");
      return;
    }
    const searchInEditor = (editor?: CodeEditor) => {
      const matches = editor?.getModel()?.findMatches(trimmed, true, false, false, null, true) ?? [];
      const line = matches[0]?.range.startLineNumber;
      if (line !== undefined) editor?.revealLineInCenter(line);
      return line;
    };
    const diffEditor = diffEditorRef.current;
    const line =
      mode === "compare"
        ? searchInEditor(diffEditor?.getModifiedEditor()) ?? searchInEditor(diffEditor?.getOriginalEditor())
        : searchInEditor(editorRef.current);
    if (line === undefined) {
      setMessage("Current diff found no matches.");
      return;
    }
    setMessage(`Current diff matched line ${line}.`);
  }

  function searchSides(): Side[] {
    if (mode === "single") return ["left"];
    return ["left", "right"];
  }

  async function clearSearchResults() {
    const shouldCancelBackendSearch = cancelableSearchActiveRef.current;
    searchStreamId.current += 1;
    cancelableSearchActiveRef.current = false;
    setSearching(false);
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
    if (shouldCancelBackendSearch) await invoke("cancel_deep_search");
  }

  function clearFind() {
    void clearSearchResults();
    setQuery("");
  }

  function inspectSearchResult(result: SearchResult) {
    const pair = displayedPairs.find((candidate) => candidate.path === result.path);
    if (!pair) return;
    if (!pairPassesTreeFilter(pair, treeFilter)) setTreeFilter("all");
    setSelectedSearchResult(result);
    setSearchOpen(false);
    void inspect(pair);
  }

  const isFileMerge =
    mode === "compare" &&
    archives.left?.metadata.sourceKind === "file" &&
    archives.right?.metadata.sourceKind === "file";
  const backupEnabled = preferences.misc.save.backupEnabled;
  const ignoreTrimWhitespace = preferences.misc.decompiler.ignoreTrimWhitespace;
  const activeColorPattern = effectiveColorPattern(
    preferences.appearance.colorPattern,
    systemPrefersDark,
  );

  // Per-hunk merge (Take all / Move hunk, editable diff) applies to ANY compare
  // where both sides show the same entry as editable text — standalone plain
  // files AND text entries inside jar/zip archives. `isFileMerge` (sourceKind
  // file) only changes the copy-arrow wording now.
  const sideEditableText = (p?: EntryPreview) =>
    !!p &&
    p.kind !== "class" &&
    p.kind !== "directory" &&
    (p.kind === "text" ||
      EDIT_EXTENSIONS.includes(p.path.split(".").pop()?.toLowerCase() ?? ""));
  const isTextMerge =
    mode === "compare" && sideEditableText(preview.left) && sideEditableText(preview.right);
  const isDiffEditable = isTextMerge;

  const isEditableEntry = false;

  const baseName = (p?: string) => (p ? p.split("/").pop() || undefined : undefined);
  const leftLabel = mode === "single"
      ? activeViewSource?.name ?? "Source"
      : baseName(archives.left?.path ?? paths.left) ?? "Left";
  const rightLabel = baseName(archives.right?.path ?? paths.right) ?? "Right";
  const searchContext = searchContextForActiveTab(activeTab);
  const hunkMerge = isTextMerge;
  const sourceChipArchives = mode === "single"
    ? { left: summaryAsArchive(activeViewSource) }
    : archives;
  const loadedSourceCount = mode === "single"
    ? viewWorkspace.sources.length
    : Number(Boolean(archives.left)) + Number(Boolean(archives.right));
  const actionOpenTabs = mode === "single"
    ? (activeViewSource?.entryTabs ?? []).map((tab) => tab.entryPath)
    : openTabs.map((tab) => tab.path);

  const actionContext = useMemo<AppActionContext>(() => ({
    mode,
    activeTab,
    openTabs: actionOpenTabs,
    selectedPath: selected?.path,
    selectedCanCopyLeft: mode === "compare" && !!selected?.right && selected.right.kind !== "directory",
    selectedCanCopyRight: mode === "compare" && !!selected?.left && selected.left.kind !== "directory",
    stagedTarget,
    stagedCount: Object.keys(stagedEntries).length,
    loadedSourceCount,
    hunkMerge: activeTab !== "files" && hunkMerge,
    focusKind: classifyFocusTarget(document.activeElement),
    shortcutDialogOpen,
  }), [actionOpenTabs, activeTab, hunkMerge, loadedSourceCount, mode, selected, shortcutDialogOpen, stagedEntries, stagedTarget]);

  const actionHandlers = useMemo<AppActionHandlers>(() => ({
    openLeftFile: () => void browse("left"),
    openLeftDirectory: () => void browseFolder("left"),
    openRightFile: () => void browse("right"),
    openRightDirectory: () => void browseFolder("right"),
    refresh: refreshSources,
    save: () => stagedTarget && void save(stagedTarget),
    clearStaged: () => void clearStaged(),
    toggleSearch: () => {
      if (mode === "text") {
        setMessage("Search is not available in Free text mode.");
        return;
      }
      setSearchOpen((open) => !open);
    },
    runContextualSearch: () => {
      if (mode === "text") {
        setMessage("Search is not available in Free text mode.");
        return;
      }
      void (searchContext === "files" ? runSearch() : findInCurrentDiff());
    },
    togglePreferences: () => setDrawerOpen((open) => !open),
    toggleShortcutDialog: () => updateShortcutDialogOpen((open) => !open),
    focusFiles: () => setActiveTab("files"),
    nextTab: () => focusRelativeTab(1),
    previousTab: () => focusRelativeTab(-1),
    closeActiveTab,
    copyToLeft: () => void copy("right", "left"),
    copyToRight: () => void copy("left", "right"),
    takeAllToLeft: () => void takeAllTo("left"),
    takeAllToRight: () => void takeAllTo("right"),
    moveHunkToLeft: () => void moveHunkTo("left"),
    moveHunkToRight: () => void moveHunkTo("right"),
    reportBlocked: setMessage,
  }), [
    browse,
    browseFolder,
    clearStaged,
    closeActiveTab,
    copy,
    findInCurrentDiff,
    focusRelativeTab,
    moveHunkTo,
    mode,
    refreshSources,
    runSearch,
    save,
    searchContext,
    stagedTarget,
    takeAllTo,
    updateShortcutDialogOpen,
  ]);

  useEffect(() => {
    actionContextRef.current = actionContext;
  }, [actionContext]);

  useEffect(() => {
    actionHandlersRef.current = actionHandlers;
  }, [actionHandlers]);

  const dispatchRegisteredAction = useCallback(async (
    actionId: Parameters<typeof dispatchAppAction>[0],
    focusTarget: EventTarget | null | undefined,
    focusKind = classifyFocusTarget(focusTarget),
  ) => {
    if (viewRef.current === "splash") return false;
    const context = actionContextRef.current;
    const handlers = actionHandlersRef.current;
    if (!context || !handlers) return false;
    return dispatchAppAction(actionId, {
      ...context,
      focusKind,
      shortcutDialogOpen: shortcutDialogOpenRef.current,
    }, handlers);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const actionId = matchShortcut(event, shortcutBindings());
      if (!actionId) return;

      if (viewRef.current === "splash") return;
      const context = actionContextRef.current;
      const handlers = actionHandlersRef.current;
      if (!context || !handlers) return;
      const focusedContext = {
        ...context,
        focusKind: classifyFocusTarget(event.target),
        shortcutDialogOpen: shortcutDialogOpenRef.current,
      };
      const state = getActionState(actionId, focusedContext);
      if (state.enabled || focusedContext.shortcutDialogOpen) {
        event.preventDefault();
      }
      void dispatchAppAction(actionId, focusedContext, handlers);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatchRegisteredAction]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ actionId: string }>("app-action", (event) => {
      const { actionId } = event.payload;
      if (!isAppActionId(actionId)) return;
      void dispatchRegisteredAction(actionId, document.activeElement, lastFocusKindRef.current);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      if (!disposed) setMessage(`Hotkey listener failed: ${String(error)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dispatchRegisteredAction]);

  const diffNavigator = {
    current: diffNavigatorState.total === 0 ? 0 : diffNavigatorState.currentIndex + 1,
    total: diffNavigatorState.total,
    canGoPrevious: diffNavigatorState.total > 0,
    canGoNext: diffNavigatorState.total > 0,
    onPrevious: () => navigateDiffBlock(-1),
    onNext: () => navigateDiffBlock(1),
  };

  const diffView = (
    <DiffView
      mode={mode}
      selected={selected}
      preview={preview}
      preferences={preferences}
      effectiveColorPattern={activeColorPattern}
      ignoreTrimWhitespace={ignoreTrimWhitespace}
      onCopy={(from, to) => void copy(from, to)}
      onEditorMount={handleEditorMount}
      onDiffMount={handleDiffMount}
      editable={isEditableEntry}
      editValue={editBuffer}
      onEditChange={(value) => setEditBuffer(value ?? "")}
      onEditBlur={(content) => selected && void stageEdit(selected.path, content)}
      fileMerge={isFileMerge}
      entryCopyEnabled={mode === "compare"}
      diffEditable={isDiffEditable}
      hunkMerge={mode === "compare" && isTextMerge}
      onDiffEditEither={(side, content) => void stageFileSide(side, content)}
      onTakeAll={(t) => void takeAllTo(t)}
      onMoveHunk={(t) => void moveHunkTo(t)}
      diffNavigator={diffNavigator}
    />
  );

  if (view === "splash") {
    return (
      <SplashScreen
        history={history}
        now={Date.now()}
        onPickMode={pickMode}
        onOpenEntry={openEntry}
        onClear={clearRecent}
        motion="standard"
      />
    );
  }

  return (
    <TooltipProvider>
    <main
      className="app-shell"
      ref={appShellRef}
      aria-label={mode === "compare" ? "Comparison workspace" : mode === "text" ? "Free text workspace" : "Source workspace"}
    >
      <a className="skip-link" href="#workspace-canvas">Skip to workspace</a>
      <MenuBar
        mode={mode}
        stagedTarget={stagedTarget}
        pendingOps={Object.entries(stagedEntries).map(([key, entry]) => ({ key, path: stripSidePrefix(key), side: entry.side, kind: entry.kind }))}
        onUnstageOne={(entryPath) => void unstage(entryPath)}
        searchOpen={searchOpen}
        drawerOpen={drawerOpen}
        canRefresh={Boolean(
          mode === "single"
            ? activeViewSource
            : (archives.left && archives.left.metadata.sourceKind !== "text") ||
              (archives.right && archives.right.metadata.sourceKind !== "text"),
        )}
        onChangeMode={changeMode}
        onSave={(side) => void save(side)}
        onRefresh={refreshSources}
        onClearStaged={clearStaged}
        onToggleSearch={() => {
          if (mode !== "text") setSearchOpen((o) => !o);
        }}
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
      />

      {mode !== "text" && (
        <SourceChips
          mode={mode}
          archives={sourceChipArchives}
          paths={paths}
          pathErrors={pathErrors}
          onPathChange={(side, value) => setPaths((current) => ({ ...current, [side]: value }))}
          onOpenPath={(side, path) => void (mode === "single" ? openViewPath(path) : openPath(side, path))}
          onBrowse={(side) => void browse(side)}
          onBrowseFolder={(side) => void browseFolder(side)}
        />
      )}

      {mode !== "text" && searchOpen && (
        <aside className="search-surface" aria-label="Search workspace">
          <SearchBar
            open
            context={searchContext}
            query={query}
            includeSource={includeSourceSearch}
            searching={searching}
            onQueryChange={setQuery}
            onSearch={searchContext === "files" ? runSearch : findInCurrentDiff}
            onCancel={cancelDeepSearch}
            onClear={() => void (searchContext === "files" ? clearSearchResults() : clearFind())}
            onClose={() => setSearchOpen(false)}
            onIncludeSourceChange={setIncludeSourceSearch}
          />
          <SearchResultsPanel
            results={searchResults}
            grouping={preferences.misc.search.resultGrouping}
            onInspect={inspectSearchResult}
          />
        </aside>
      )}
      {dropHint && <p className="platform-hint">{dropHint}</p>}
      <div className="work-area">
        <section className="workspace">
          {mode === "single" && (
            <ViewSourceTabs
              sources={viewWorkspace.sources}
              activeSourceId={viewWorkspace.activeSourceId}
              onSelect={selectViewSource}
              onClose={closeViewSourceTab}
            />
          )}
          {mode !== "text" && (
            <WorkspaceTabs
              fileCount={visiblePairs.length}
              activeId={activeTab}
              mode={mode}
              tabs={
                mode === "single"
                  ? (activeViewSource?.entryTabs ?? []).map((tab) => ({
                      path: tab.entryPath,
                      status: "onlyLeft" as const,
                    }))
                  : openTabs.map((t) => ({ path: t.path, status: t.pair.status }))
              }
              treeFilter={treeFilter}
              viewMode={viewMode}
              canShowSource={!!selected}
              canShowBytecode={pairHasClass(selected)}
              onSelectFiles={() => setActiveTab("files")}
              onSelectTab={(path) => focusTab(path)}
              onCloseTab={(path) => closeTab(path)}
              onFilterChange={setTreeFilter}
              onExpandTree={() => setTreeExpandAllVersion((version) => version + 1)}
              onCollapseTree={() => setTreeCollapseAllVersion((version) => version + 1)}
              onShowSource={() => selected && void inspect(selected, true)}
              onShowBytecode={showBytecode}
            />
          )}
          <div
            className="workspace-tabpanels"
            id="workspace-canvas"
            role="region"
            aria-label="Workspace canvas"
          >
            {mode === "text" ? (
              <div className="workspace-tabpanel" role="tabpanel">
                <FreeTextWorkspace
                  preferences={preferences}
                  effectiveColorPattern={activeColorPattern}
                  ignoreTrimWhitespace={ignoreTrimWhitespace}
                  onMessage={setMessage}
                />
              </div>
            ) : mode === "single" ? (
              <div className="view-workspace-split" role="tabpanel" aria-label="View source browser">
                <div className="view-workspace-pane view-workspace-pane--tree">
                  <FileTree
                    visiblePairs={visiblePairs}
                    selected={selected}
                    stagedEntries={stagedEntries}
                    mode={mode}
                    treeFilter={treeFilter}
                    nestedPairs={activeViewSource?.nestedPairs ?? {}}
                    leftLabel={leftLabel}
                    rightLabel={rightLabel}
                    expandAllVersion={treeExpandAllVersion}
                    collapseAllVersion={treeCollapseAllVersion}
                    onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                    onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
                    onCopy={(from, to, pair) => void copy(from, to, pair)}
                    onUnstage={(entryPath) => void unstage(entryPath)}
                    onExpandArchive={(fullPath) => void expandArchive(fullPath)}
                  />
                </div>
                <div className="view-workspace-pane view-workspace-pane--content">
                  {diffView}
                </div>
              </div>
            ) : (
              <>
                <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab !== "files"}>
                  <FileTree
                    visiblePairs={visiblePairs}
                    selected={selected}
                    stagedEntries={stagedEntries}
                    mode={mode}
                    treeFilter={treeFilter}
                    nestedPairs={nestedPairs}
                    leftLabel={leftLabel}
                    rightLabel={rightLabel}
                    expandAllVersion={treeExpandAllVersion}
                    collapseAllVersion={treeCollapseAllVersion}
                    onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                    onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
                    onCopy={(from, to, pair) => void copy(from, to, pair)}
                    onUnstage={(entryPath) => void unstage(entryPath)}
                    onExpandArchive={(fullPath) => void expandArchive(fullPath)}
                  />
                </div>
                <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab === "files"}>
                  {diffView}
                </div>
              </>
            )}
          </div>
        </section>
        <ConfigDrawer
          open={drawerOpen}
          mode={mode}
          preferences={preferences}
          systemFonts={systemFonts}
          fontStatus={fontStatus}
          onLoadSystemFonts={loadSystemFonts}
          onPreferencesChange={setPreferences}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
      <StatusBar
        message={message}
        searching={searching}
        pendingCount={Object.keys(stagedEntries).length}
      />
      <KeyboardShortcutsDialog
        open={shortcutDialogOpen}
        onOpenChange={updateShortcutDialogOpen}
        platform={currentPlatform()}
      />
      <Dialog open={pendingOpen !== undefined} onOpenChange={(open) => !open && setPendingOpen(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close open diffs?</DialogTitle>
            <DialogDescription>
              Opening a new archive will close your {openTabs.length} open diff{openTabs.length === 1 ? "" : "s"} and reset the comparison.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingOpen(undefined)}>Cancel</Button>
            <Button
              onClick={() => {
                const target = pendingOpen;
                setPendingOpen(undefined);
                if (target) void openPath(target.side, target.path, true);
              }}
            >
              Open anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={signedSavePrompt !== undefined} onOpenChange={(open) => !open && setSignedSavePrompt(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signed JAR warning</DialogTitle>
            <DialogDescription>
              This JAR is signed. Modifying it will invalidate the signature and may break verification where signatures are enforced.
            </DialogDescription>
          </DialogHeader>
          <label className="check-label">
            <Checkbox
              checked={suppressSignedWarningForFile}
              onCheckedChange={(checked) => setSuppressSignedWarningForFile(checked === true)}
            />
            Do not ask again for this file this session
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignedSavePrompt(undefined)}>Cancel</Button>
            <Button onClick={confirmSignedSave}>Save anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
    </TooltipProvider>
  );
}
