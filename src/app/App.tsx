import {
  type ArchiveSummary,
  type BackendSearchHit,
  type ComparePair,
  type EntryKind,
  type EntryPreview,
  type Mode,
  type PairStatus,
  type SearchResult,
  type Side,
  type TreeFilter,
  type ViewSource,
  type ViewWorkspaceState,
} from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelDeepSearch as cancelDeepSearchCommand,
  closeViewSource as closeViewSourceCommand,
  computeDiff,
  computeNestedDiff,
  computeViewNestedEntries,
  deepSearch,
  deepSearchViewSource,
  listSystemFonts,
  openArchive,
  openCompareSources,
  openViewSource as openViewSourceCommand,
  pendingOpenPaths,
  platformHints,
  readTextFile,
  search as searchArchive,
  searchViewSource,
  setEngine,
  validatePath,
} from "@/ipc/commands";
import {
  subscribeAppAction,
  subscribeOsOpenPaths,
  subscribeSearchProgress,
  subscribeSearchResult,
} from "@/ipc/events";
import {
  assetUrl,
  destroyCurrentWindow,
  isTauriRuntime,
  openPathDialog,
  savePathDialog,
  subscribeWindowCloseRequested,
  subscribeWindowDragDrop,
} from "@/ipc/platform";
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
import { ConfigDrawer } from "@/features/preferences/ConfigDrawer";
import { MenuBar } from "@/features/shell/MenuBar";
import { WorkspaceRail } from "@/features/shell/WorkspaceRail";
import { SourceChips } from "@/features/sources/SourceChips";
import { hasSeenOnboarding, OnboardingTour } from "@/features/shell/OnboardingTour";
import { SearchBar } from "@/features/search/SearchBar";
import { SearchResultsPanel } from "@/features/search/SearchResultsPanel";
import { DiffView, pairHasClass } from "@/features/workspace/DiffView";
import { FreeTextWorkspace } from "@/features/free-text/FreeTextWorkspace";
import { useFreeTextController } from "@/features/free-text/useFreeTextController";
import { KeyboardShortcutsDialog } from "@/features/shell/KeyboardShortcutsDialog";
import { useWorkspaceController } from "@/features/workspace/useWorkspaceController";
import {
  applyPreferencesToRoot,
  effectiveColorPattern,
  loadUiPreferences,
  normalizeUiPreferences,
  saveUiPreferences,
} from "@/features/preferences/preferences";
import {
  FALLBACK_SYSTEM_FONTS,
  fontFamilies,
  installedFontFacesCss,
  normalizeSystemFonts,
  type SystemFont,
} from "@/features/preferences/system-fonts";
import { searchContextForActiveTab, searchResultKey } from "@/features/search/search";
import {
  type MergeControllerContext,
  useMergeController,
} from "@/features/merge/useMergeController";
import { useTempMergeController } from "@/features/merge/useTempMergeController";
import { CreateTempTargetDialog } from "@/features/merge/CreateTempTargetDialog";
import { MergeConflictDialog } from "@/features/merge/MergeConflictDialog";
import { WorkspaceTabs } from "@/features/workspace/WorkspaceTabs";
import { ViewSourceTabs } from "@/features/sources/ViewSourceTabs";
import { FileTree } from "@/features/sources/FileTree";
import { isDirectoryPair, pairPassesTreeFilter } from "@/lib/tree";
import { SplashScreen } from "@/features/shell/SplashScreen";
import { StatusBar, type StatusBarUpdatePrompt } from "@/features/shell/StatusBar";
import {
  type HistoryEntry,
  clearHistory,
  loadHistory,
  recordSession,
} from "@/features/shell/history";
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
  createViewSource,
  openViewSource,
} from "@/features/sources/view-workspace";
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  IDLE_UPDATE_STATE,
  openUpdateFallback,
  restartToApplyUpdate,
  type AppUpdateState,
} from "@/features/preferences/update-client";

const emptyPaths: Record<Side, string> = { left: "", right: "" };

const VIEW_ROOT_KEY = "";

type OpenViewPathOutcome =
  | { path: string; status: "opened" }
  | { path: string; status: "failed"; error: string }
  | { path: string; status: "blocked"; error: string }
  | { path: string; status: "cancelled" };

interface PendingTempSourceChange {
  side: Side;
  path: string;
  openTabsConfirmed: boolean;
}

interface TempOperationIntent {
  attemptId: number;
  settled: boolean;
}

interface TempStageIntent extends TempOperationIntent {
  targetSide: Side;
  paths: string[];
}

interface TempApplyIntent extends TempOperationIntent {
  pendingSourceChange?: PendingTempSourceChange;
}

interface TempSaveIntent extends TempOperationIntent {
  closeAfterSuccess: boolean;
}

interface TempDiscardIntent extends TempOperationIntent {
  closeAfterSuccess: boolean;
}

function tempRecoveryLabel(operation: "apply" | "saveAs" | "discard") {
  return operation === "saveAs" ? "Save As" : operation === "apply" ? "Apply" : "Discard";
}

// Keep in sync with EDITABLE_EXTENSIONS in crates/lcdiff-core/src/edit.rs (Rust list is the authority; this list only controls the editor read-only affordance in the UI).
const EDIT_EXTENSIONS = ["xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf", "sh", "bash"];

function isEditableTextPreview(preview?: EntryPreview) {
  return (
    !!preview &&
    preview.kind !== "class" &&
    preview.kind !== "directory" &&
    (preview.kind === "text" ||
      EDIT_EXTENSIONS.includes(
        preview.path.split(".").pop()?.toLowerCase() ?? "",
      ))
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

function tempSummaryAsArchive(workingName: string): ArchiveSummary {
  return {
    path: workingName,
    metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
    entries: [],
  };
}

function dropSideForPosition(mode: Mode, x: number, width: number): Side {
  if (mode === "single") return "left";
  return x < width / 2 ? "left" : "right";
}

async function readDroppedTextFile(path: string) {
  try {
    return await readTextFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${detail}`);
  }
}

export function App() {
  const [paths, setPaths] = useState(emptyPaths);
  const [pathErrors, setPathErrors] = useState<Partial<Record<Side, string>>>({});
  const [archives, setArchives] = useState<Partial<Record<Side, ArchiveSummary>>>({});
  const [pairs, setPairs] = useState<ComparePair[]>([]);
  const [nestedPairs, setNestedPairs] = useState<Record<string, ComparePair[]>>({});
  const [viewWorkspace, setViewWorkspace] = useState<ViewWorkspaceState>({ sources: [] });
  const [message, setMessage] = useState("Open a JAR, ZIP, or folder on each side.");
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("diff");
  const [treeExpandAllVersion, setTreeExpandAllVersion] = useState(0);
  const [treeCollapseAllVersion, setTreeCollapseAllVersion] = useState(0);
  const [preferences, setPreferences] = useState(loadUiPreferences);
  const [updateState, setUpdateState] = useState<AppUpdateState>(IDLE_UPDATE_STATE);
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
  const [searching, setSearching] = useState(false);
  const [dropHint, setDropHint] = useState("");
  const [tourStep, setTourStep] = useState<number | null>(() =>
    hasSeenOnboarding("compare") ? null : 0,
  );
  const [pendingOpen, setPendingOpen] = useState<{ side: Side; path: string }>();
  const [pendingComparePair, setPendingComparePair] = useState<{
    leftPath: string;
    rightPath: string;
  }>();
  const [pendingTempSourceChange, setPendingTempSourceChange] = useState<PendingTempSourceChange>();
  const [discardTempOpen, setDiscardTempOpen] = useState(false);
  const [tempCloseOpen, setTempCloseOpen] = useState(false);
  const [tempConflictReviewDismissed, setTempConflictReviewDismissed] = useState(false);
  const [tempCompletionVersion, setTempCompletionVersion] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const appShellRef = useRef<HTMLElement>(null);
  const searchStreamId = useRef(0);
  const cancelableSearchActiveRef = useRef(false);
  const actionContextRef = useRef<AppActionContext | undefined>(undefined);
  const actionHandlersRef = useRef<AppActionHandlers | undefined>(undefined);
  const shortcutDialogOpenRef = useRef(shortcutDialogOpen);
  const updateStateRef = useRef<AppUpdateState>(IDLE_UPDATE_STATE);
  const updateAutoCheckStarted = useRef(false);
  const viewRef = useRef(view);
  const modeRef = useRef(mode);
  const activeViewSourceIdRef = useRef<string | undefined>(undefined);
  const viewRequestGenerationRef = useRef(0);
  const viewDropGenerationRef = useRef(0);
  const compareOpenGenerationRef = useRef<Record<Side, number>>({ left: 0, right: 0 });
  const compareDiffGenerationRef = useRef(0);
  const lastFocusKindRef = useRef(classifyFocusTarget(document.activeElement));
  const appliedEngineRef = useRef(engine);
  const mergeContextRef = useRef<MergeControllerContext | undefined>(undefined);
  const tempTargetSideRef = useRef<Side | undefined>(undefined);
  const tempCreateSourceSideRef = useRef<Side | undefined>(undefined);
  const tempSavePathRef = useRef<string | undefined>(undefined);
  const tempSavePickerGenerationRef = useRef(0);
  const tempSavePickerPendingRef = useRef(false);
  const tempSavePickerIdentityRef = useRef("none");
  const tempStageIntentRef = useRef<TempStageIntent | undefined>(undefined);
  const tempApplyIntentRef = useRef<TempApplyIntent | undefined>(undefined);
  const tempSaveIntentRef = useRef<TempSaveIntent | undefined>(undefined);
  const tempDiscardIntentRef = useRef<TempDiscardIntent | undefined>(undefined);
  const tempAttemptIdRef = useRef(0);
  const tempControllerCallPendingRef = useRef(false);
  const tempCloseRequestGenerationRef = useRef(0);
  const projectedTempSessionIdRef = useRef<string | undefined>(undefined);
  const freeText = useFreeTextController(setMessage);
  const tempMerge = useTempMergeController();
  const workspace = useWorkspaceController({
    mode,
    setPairs,
    viewWorkspace,
    setViewWorkspace,
    selectedSearchResult,
    isCurrentViewRequest,
    currentViewRequestGeneration: () => viewRequestGenerationRef.current,
    onMessage: setMessage,
    fontRemeasureKey: `${preferences.editor.fontFamily}\0${preferences.editor.fontSize}\0${systemFonts
      .map((font) => font.family)
      .join("\0")}`,
  });
  const {
    selected,
    preview,
    contentFilter,
    viewMode,
    editBuffer,
    activeTab,
    openTabs,
    activeViewSource,
    expandedPaths,
  } = workspace.state;
  const {
    selectPair,
    setContentFilter,
    setExpandedPaths,
    updateEditBuffer,
    focusFiles,
    focusTab,
    selectViewSource: selectWorkspaceViewSource,
    closeViewSourceTab: closeWorkspaceViewSourceTab,
    inspect,
    inspectViewEntry,
    closeTab,
    focusRelativeTab,
    closeActiveTab,
    showBytecode,
    reset: resetWorkspace,
  } = workspace.actions;
  const { handleEditorMount, handleDiffMount, diffNavigator } = workspace.editor;
  const merge = useMergeController({
    getContext: () => {
      if (!mergeContextRef.current) {
        throw new Error("Merge controller context is unavailable");
      }
      return mergeContextRef.current;
    },
    editor: workspace.editor.merge,
    onMessage: setMessage,
  });
  const {
    stagedTarget,
    stagedEntries,
    signedSavePrompt,
    suppressSignedWarningForFile,
  } = merge.state;
  const {
    setSignedSavePrompt,
    setSuppressSignedWarningForFile,
  } = merge.setters;
  const {
    copy,
    save,
    confirmSignedSave,
    clearStaged,
    clearStagedForSide,
    projectTempStaged,
    resetStagedProjection,
    unstage,
    stageEdit,
    stageFileSide,
    takeAllTo,
    moveHunkTo,
  } = merge.actions;
  const stagedEntriesRef = useRef(stagedEntries);
  const tempStateRef = useRef({
    session: tempMerge.session,
    retryOperation: tempMerge.retryOperation,
    busy: tempMerge.busy,
  });
  const pendingTempSourceChangeRef = useRef(pendingTempSourceChange);
  stagedEntriesRef.current = stagedEntries;
  tempStateRef.current = {
    session: tempMerge.session,
    retryOperation: tempMerge.retryOperation,
    busy: tempMerge.busy,
  };
  pendingTempSourceChangeRef.current = pendingTempSourceChange;
  if (tempMerge.session) tempTargetSideRef.current = tempMerge.session.targetSide;
  const tempSavePickerIdentity = tempMerge.session
    ? [
        "session",
        tempMerge.session.id,
        tempMerge.session.targetSide,
        tempMerge.session.workingName,
        tempMerge.session.entryCount,
        tempMerge.session.appliedSourceCount,
        tempMerge.session.exportedPath ?? "",
      ].join(":")
    : tempMerge.retryOperation
      ? `recovery:${tempMerge.retryOperation}:${tempTargetSideRef.current ?? "unknown"}`
      : "none";
  if (tempSavePickerIdentityRef.current !== tempSavePickerIdentity) {
    tempSavePickerIdentityRef.current = tempSavePickerIdentity;
    tempSavePickerGenerationRef.current += 1;
    tempSavePickerPendingRef.current = false;
    if (tempMerge.session || tempSavePickerIdentity === "none") {
      tempSavePathRef.current = undefined;
    }
  }
  const selectedRef = useRef<ComparePair | undefined>(selected);
  const inspectRef = useRef(inspect);
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
    const css = installedFontFacesCss(systemFonts, assetUrl);
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
    let cancelled = false;
    const requestedEngine = engine;
    const previousEngine = appliedEngineRef.current;
    setEngine(requestedEngine)
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
      const fonts = normalizeSystemFonts(await listSystemFonts());
      setSystemFonts(fonts);
      setFontStatus("ready");
    } catch {
      setSystemFonts(FALLBACK_SYSTEM_FONTS);
      setFontStatus("fallback");
    }
  }, [fontStatus]);

  const setCurrentUpdateState = useCallback((nextState: AppUpdateState) => {
    updateStateRef.current = nextState;
    setUpdateState(nextState);
  }, []);

  const checkUpdates = useCallback(async (source: "auto" | "manual") => {
    setCurrentUpdateState({
      ...updateStateRef.current,
      status: "checking",
      source,
      message: source === "manual" ? "Checking for updates..." : updateStateRef.current.message,
    });
    const nextState = await checkForAppUpdate(source);
    setCurrentUpdateState(nextState);
    if (source === "manual" && nextState.message) setMessage(nextState.message);
  }, [setCurrentUpdateState]);

  const installUpdate = useCallback(async () => {
    const currentState = updateStateRef.current;
    setCurrentUpdateState({
      ...currentState,
      status: "downloading",
      message: "Downloading update...",
    });
    const nextState = await downloadAndInstallAppUpdate(currentState);
    setCurrentUpdateState(nextState);
    if (nextState.message) setMessage(nextState.message);
  }, [setCurrentUpdateState]);

  const restartUpdate = useCallback(async () => {
    await restartToApplyUpdate();
  }, []);

  const openUpdateRelease = useCallback(async () => {
    await openUpdateFallback();
  }, []);

  useEffect(() => {
    if (view === "splash") return;
    if (!preferences.misc.updates.autoCheck) return;
    if (updateAutoCheckStarted.current) return;
    updateAutoCheckStarted.current = true;
    void checkUpdates("auto");
  }, [checkUpdates, preferences.misc.updates.autoCheck, view]);

  const updateShortcutDialogOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(shortcutDialogOpenRef.current) : next;
    shortcutDialogOpenRef.current = resolved;
    setShortcutDialogOpen(resolved);
  }, []);
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
    if (cancelBackendSearch) void cancelDeepSearchCommand().catch(() => undefined);
  }

  const refreshDiff = useCallback(async () => {
    const generation = compareDiffGenerationRef.current + 1;
    compareDiffGenerationRef.current = generation;
    const sourceGenerations = { ...compareOpenGenerationRef.current };
    const tempState = tempStateRef.current;
    const ownership = tempState.retryOperation
      ? `recovery:${tempState.retryOperation}:${tempTargetSideRef.current ?? "unknown"}`
      : tempState.session
        ? `session:${tempState.session.id}:${tempState.session.targetSide}`
        : "none";
    const isCurrent = () => {
      const currentTempState = tempStateRef.current;
      const currentOwnership = currentTempState.retryOperation
        ? `recovery:${currentTempState.retryOperation}:${tempTargetSideRef.current ?? "unknown"}`
        : currentTempState.session
          ? `session:${currentTempState.session.id}:${currentTempState.session.targetSide}`
          : "none";
      return compareDiffGenerationRef.current === generation
        && compareOpenGenerationRef.current.left === sourceGenerations.left
        && compareOpenGenerationRef.current.right === sourceGenerations.right
        && currentOwnership === ownership;
    };
    try {
      const diff = await computeDiff();
      if (!isCurrent()) return;
      setPairs(diff.pairs);
      setNestedPairs({});
    } catch {
      if (!isCurrent()) return;
      setPairs([]);
      setNestedPairs({});
    }
  }, []);

  const loadViewPairs = useCallback(async (sourceId: string, nestedPath = VIEW_ROOT_KEY, generation?: number) => {
    const diff = await computeViewNestedEntries(sourceId, nestedPath);
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
      const diff = await computeNestedDiff(fullPath);
      setNestedPairs((prev) => ({ ...prev, [fullPath]: diff.pairs }));
    } catch (error) {
      setMessage(String(error));
    }
  }, [activeViewSource, loadViewPairs, mode]);

  const openViewPath = useCallback(async (
    path: string,
    dropGeneration?: number,
  ): Promise<OpenViewPathOutcome> => {
    if (dropGeneration === undefined) {
      viewDropGenerationRef.current += 1;
    }
    if (stagedTarget) {
      const error = "Save or clear unsaved changes before opening another View source.";
      setMessage(error);
      return { path, status: "blocked", error };
    }
    const generation = viewRequestGenerationRef.current + 1;
    viewRequestGenerationRef.current = generation;
    try {
      const validatedPath = await validatePath(path);
      if (!isCurrentViewRequest(generation)) return { path, status: "cancelled" };
      const summary = await openViewSourceCommand(validatedPath);
      if (!isCurrentViewRequest(generation)) return { path, status: "cancelled" };
      clearViewSearchState(false);
      setPathErrors((current) => ({ ...current, left: undefined }));
      resetWorkspace({ target: "view" });
      activeViewSourceIdRef.current = summary.id;
      setViewWorkspace((current) => openViewSource(current, createViewSource(summary)));
      await loadViewPairs(summary.id, VIEW_ROOT_KEY, generation);
      if (!isCurrentViewRequest(generation, summary.id)) {
        return { path, status: "cancelled" };
      }
      setMessage(`Opened ${summary.path}`);
      return { path, status: "opened" };
    } catch (error) {
      if (!isCurrentViewRequest(generation)) return { path, status: "cancelled" };
      const message = String(error);
      setPathErrors((current) => ({ ...current, left: message }));
      setMessage(message);
      return { path, status: "failed", error: message };
    }
  }, [loadViewPairs, resetWorkspace, stagedTarget]);

  const tempSourceChangeBlockReason = useCallback((side: Side) => {
    const state = tempStateRef.current;
    if (state.retryOperation) {
      return `Retry ${tempRecoveryLabel(state.retryOperation)} before changing sources.`;
    }
    if (state.busy) return "Wait for the temporary merge operation to finish before changing sources.";
    if (state.session?.targetSide === side) {
      return "The temporary target is session-owned and cannot be replaced.";
    }
    return undefined;
  }, []);

  const openPath = useCallback(async (
    side: Side,
    path: string,
    confirmed = false,
    tempChangeConfirmed = false,
  ) => {
    const generation = compareOpenGenerationRef.current[side] + 1;
    compareOpenGenerationRef.current[side] = generation;
    const tempState = tempStateRef.current;
    const blocked = tempSourceChangeBlockReason(side);
    if (blocked) {
      setMessage(blocked);
      return blocked;
    }
    const ownedTargetSide = tempState.session?.targetSide;
    const hasPendingTargetChanges = ownedTargetSide !== undefined && Object.values(
      stagedEntriesRef.current,
    ).some((entry) => entry.side === ownedTargetSide);
    if (tempState.session && hasPendingTargetChanges && !tempChangeConfirmed) {
      setPendingTempSourceChange({ side, path, openTabsConfirmed: confirmed });
      return undefined;
    }
    const staleOrProtected = () => (
      compareOpenGenerationRef.current[side] !== generation
      || tempSourceChangeBlockReason(side) !== undefined
    );
    try {
      if (!confirmed && workspace.openTabsCount > 0) {
        setPendingComparePair(undefined);
        setPendingOpen({ side, path });
        return undefined;
      }
      const validatedPath = await validatePath(path);
      if (staleOrProtected()) return undefined;
      const archive = await openArchive(validatedPath, side);
      if (staleOrProtected()) return undefined;
      searchStreamId.current += 1;
      setSearching(false);
      setPaths((current) => ({ ...current, [side]: archive.path }));
      setPathErrors((current) => ({ ...current, [side]: undefined }));
      setArchives((current) => ({ ...current, [side]: archive }));
      resetWorkspace({ target: "compare" });
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
      setMessage(`Opened ${archive.path}`);
      await refreshDiff();
      return undefined;
    } catch (error) {
      if (staleOrProtected()) return undefined;
      const message = String(error);
      setPathErrors((current) => ({ ...current, [side]: message }));
      setMessage(message);
      return message;
    }
  }, [refreshDiff, resetWorkspace, tempSourceChangeBlockReason, workspace.openTabsCount]);

  const openDroppedComparePair = useCallback(async (
    leftPath: string,
    rightPath: string,
    confirmed = false,
  ) => {
    const generations = {
      left: compareOpenGenerationRef.current.left + 1,
      right: compareOpenGenerationRef.current.right + 1,
    };
    compareOpenGenerationRef.current = generations;
    const diffGeneration = compareDiffGenerationRef.current + 1;
    compareDiffGenerationRef.current = diffGeneration;
    if (tempStateRef.current.session || tempStateRef.current.retryOperation || tempStateRef.current.busy) {
      setMessage("Discard the temporary target before replacing both Compare sources.");
      return;
    }
    const staleOrProtected = () => (
      compareOpenGenerationRef.current.left !== generations.left
      || compareOpenGenerationRef.current.right !== generations.right
      || compareDiffGenerationRef.current !== diffGeneration
      || tempStateRef.current.session !== undefined
      || tempStateRef.current.retryOperation !== undefined
      || tempStateRef.current.busy !== undefined
    );
    if (!confirmed && workspace.openTabsCount > 0) {
      setPendingOpen(undefined);
      setPendingComparePair({ leftPath, rightPath });
      return;
    }
    try {
      const result = await openCompareSources(leftPath, rightPath);
      if (staleOrProtected()) return;
      searchStreamId.current += 1;
      setSearching(false);
      setPaths({ left: result.left.path, right: result.right.path });
      setPathErrors({});
      setArchives({ left: result.left, right: result.right });
      setPairs(result.diff.pairs);
      setNestedPairs({});
      resetWorkspace({ target: "compare" });
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
      setMessage(`Opened ${result.left.path} and ${result.right.path}`);
    } catch (error) {
      if (staleOrProtected()) return;
      setMessage(String(error));
    }
  }, [resetWorkspace, workspace.openTabsCount]);

  const openTextMode = useCallback(() => {
    if (tempStateRef.current.session || tempStateRef.current.retryOperation) {
      setMessage("Discard the temporary target before switching to Free text.");
      return;
    }
    if (stagedTarget) {
      setMessage("Save or clear unsaved changes before switching to Free text.");
      return;
    }
    modeRef.current = "text";
    viewRequestGenerationRef.current += 1;
    viewDropGenerationRef.current += 1;
    searchStreamId.current += 1;
    cancelableSearchActiveRef.current = false;
    setSearching(false);
    setSearchOpen(false);
    setMode("text");
    setTourStep(hasSeenOnboarding("text") ? null : 0);
    setView("workspace");
    resetWorkspace({ preserveState: true });
    setQuery("");
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
    void cancelDeepSearchCommand().catch(() => undefined);
    setMessage("Free text is ready. Edit both sides, then compare when you want a result.");
  }, [resetWorkspace, stagedTarget]);

  const openFromOs = useCallback((path: string) => {
    if (!path) return;
    if (tempStateRef.current.session || tempStateRef.current.retryOperation) {
      setMessage("Discard the temporary target before opening another workspace.");
      return;
    }
    if (modeRef.current === "text") {
      setMessage("File opens are not available in Free text mode.");
      return;
    }
    if (modeRef.current === "compare") {
      resetWorkspace({ preserveState: true });
    }
    modeRef.current = "single";
    setMode("single");
    setView("workspace");
    void openViewPath(path);
  }, [openViewPath, resetWorkspace]);

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
    if (
      mode === "compare"
      && (tempMerge.session || tempMerge.retryOperation || projectedTempSessionIdRef.current)
    ) return;
    if (mode === "compare" && left && right) {
      setHistory(recordSession("compare", [left, right], Date.now()));
    }
  }, [
    view,
    mode,
    activeViewSource,
    archives.left?.path,
    archives.right?.path,
    tempMerge.retryOperation,
    tempMerge.session,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    return subscribeWindowDragDrop((event) => {
      if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
      const { paths: droppedPaths, position } = event.payload;
      const openDroppedPaths = async () => {
        if (mode === "compare") {
          if (droppedPaths.length === 2) {
            await openDroppedComparePair(droppedPaths[0], droppedPaths[1]);
            return;
          }
          if (droppedPaths.length > 2) {
            setMessage("Drop one source or exactly two sources to compare.");
            return;
          }
          const side = dropSideForPosition(mode, position.x, window.innerWidth);
          await openPath(side, droppedPaths[0]);
          return;
        }

        if (mode === "single") {
          const dropGeneration = viewDropGenerationRef.current + 1;
          viewDropGenerationRef.current = dropGeneration;
          const outcomes: OpenViewPathOutcome[] = [];
          for (const path of droppedPaths) {
            const outcome = await openViewPath(path, dropGeneration);
            outcomes.push(outcome);
            if (outcome.status === "cancelled") break;
          }
          if (viewDropGenerationRef.current !== dropGeneration) return;
          const opened = outcomes.filter((outcome) => outcome.status === "opened").length;
          const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
          const blocked = outcomes.filter((outcome) => outcome.status === "blocked").length;
          const summary = [`${opened} opened`, `${failed} failed`];
          if (blocked > 0) {
            summary.push(`${blocked} blocked`);
          }
          const failures = outcomes.filter(
            (outcome): outcome is Extract<
              OpenViewPathOutcome,
              { status: "failed" | "blocked" }
            > => outcome.status === "failed" || outcome.status === "blocked",
          );
          const details = failures
            .map((outcome) => `${outcome.path}: ${outcome.error}`)
            .join("; ");
          setMessage(`${summary.join(", ")}${details ? ` — ${details}` : ""}`);
          return;
        }

        if (droppedPaths.length > 2) {
          setMessage("Drop one or two text files.");
          return;
        }

        try {
          if (droppedPaths.length === 1) {
            const file = await readDroppedTextFile(droppedPaths[0]);
            freeText.setDraft(
              dropSideForPosition(mode, position.x, window.innerWidth),
              file.content,
            );
          } else {
            const [left, right] = await Promise.all(
              droppedPaths.map(readDroppedTextFile),
            );
            freeText.setDrafts(left.content, right.content);
          }
        } catch (error) {
          setMessage(`Unable to load dropped text files: ${String(error)}`);
        }
      };
      void openDroppedPaths();
    });
  }, [freeText, mode, openDroppedComparePair, openPath, openViewPath]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    void pendingOpenPaths()
      .then((paths) => {
        if (!disposed && paths.length > 0) openFromOs(paths[0]);
      })
      .catch((error) => {
        if (!disposed) setMessage(`Open-with handoff failed: ${String(error)}`);
      });
    const unlisten = subscribeOsOpenPaths((payload) => {
      const [path] = payload.paths;
      if (path) openFromOs(path);
      void pendingOpenPaths().catch(() => undefined);
    }, (error) => {
      if (!disposed) setMessage(`Open-with listener failed: ${String(error)}`);
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [openFromOs]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void platformHints()
      .then((hints) => setDropHint(hints.dropHint ?? ""))
      .catch(() => setDropHint(""));
  }, []);

  useEffect(() => {
    if (!dropHint || view === "splash" || tourStep !== null) return;
    const timeout = window.setTimeout(() => setDropHint(""), 8_000);
    return () => window.clearTimeout(timeout);
  }, [dropHint, tourStep, view]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlistenProgress = subscribeSearchProgress((payload) => {
      if (payload.searchId !== searchStreamId.current) return;
      setMessage(
        `Deep search ${payload.completed}/${payload.total}: ${payload.entryPath}`,
      );
    });
    const unlistenResult = subscribeSearchResult((payload) => {
      if (payload.searchId !== searchStreamId.current) return;
      const result: SearchResult = {
        side: payload.side,
        tier: "T3",
        path: payload.hit.entryPath,
        kind: payload.hit.kind,
        line: payload.hit.line,
        preview: payload.hit.preview,
      };
      setSearchPaths((current) => new Set([...(current ?? []), result.path]));
      setSearchResults((current) =>
        current.some((candidate) => searchResultKey(candidate) === searchResultKey(result))
          ? current
          : [...current, result],
      );
    });
    return () => {
      unlistenProgress();
      unlistenResult();
    };
  }, []);

  async function browse(side: Side) {
    const blocked = tempSourceChangeBlockReason(side);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    try {
      const path = await openPathDialog({
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
    const blocked = tempSourceChangeBlockReason(side);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    try {
      const path = await openPathDialog({
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
    if (mode === "text") return;
    if (mode === "single") {
      if (activeViewSource) void openViewPath(activeViewSource.path);
      return;
    }
    const protectedTarget = tempStateRef.current.session?.targetSide
      ?? (tempStateRef.current.retryOperation ? tempTargetSideRef.current : undefined);
    const sides: Side[] = mode === "compare" ? ["left", "right"] : ["left"];
    for (const side of sides) {
      if (side === protectedTarget) continue;
      if (archives[side]?.metadata.sourceKind === "text") continue;
      const current = archives[side]?.path;
      if (current) void openPath(side, current, true);
    }
  }

  function selectViewSource(sourceId: string) {
    if (stagedTarget && sourceId !== activeViewSource?.id) {
      setMessage("Save or clear unsaved changes before switching View sources.");
      return;
    }
    viewRequestGenerationRef.current += 1;
    viewDropGenerationRef.current += 1;
    activeViewSourceIdRef.current = sourceId;
    clearViewSearchState(cancelableSearchActiveRef.current);
    selectWorkspaceViewSource(sourceId);
    setSelectedSearchResult(undefined);
  }

  function closeViewSourceTab(sourceId: string) {
    if (stagedTarget && sourceId === activeViewSource?.id) {
      setMessage("Save or clear unsaved changes before closing this View source.");
      return;
    }
    viewRequestGenerationRef.current += 1;
    viewDropGenerationRef.current += 1;
    void closeViewSourceCommand(sourceId).catch(() => undefined);
    const { closedActive, nextSourceId } = closeWorkspaceViewSourceTab(sourceId);
    activeViewSourceIdRef.current = nextSourceId;
    if (closedActive) clearViewSearchState(cancelableSearchActiveRef.current);
  }

  function pickMode(next: Mode) {
    if (tempStateRef.current.session || tempStateRef.current.retryOperation) {
      setMessage("Discard the temporary target before changing workspaces.");
      return;
    }
    if (next === "text") {
      openTextMode();
      return;
    }
    modeRef.current = next;
    if (next !== "single") {
      viewRequestGenerationRef.current += 1;
      viewDropGenerationRef.current += 1;
    }
    setMode(next);
    setView("workspace");
  }

  function openEntry(entry: HistoryEntry) {
    if (tempStateRef.current.session || tempStateRef.current.retryOperation) {
      setMessage("Discard the temporary target before reopening history.");
      return;
    }
    modeRef.current = entry.mode;
    viewRequestGenerationRef.current += 1;
    viewDropGenerationRef.current += 1;
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
    if (next !== mode && (tempStateRef.current.session || tempStateRef.current.retryOperation)) {
      setMessage("Discard the temporary target before changing workspaces.");
      return;
    }
    if (next === "text") {
      openTextMode();
      return;
    }
    if (next !== mode && stagedTarget) {
      setMessage(`Save or clear unsaved changes before switching to ${next === "single" ? "View" : "Compare"} mode.`);
      return;
    }
    if (mode === "compare" && next !== "compare") {
      resetWorkspace({ preserveState: true });
    }
    modeRef.current = next;
    viewRequestGenerationRef.current += 1;
    viewDropGenerationRef.current += 1;
    if (mode === "single" || next === "single") clearViewSearchState(cancelableSearchActiveRef.current);
    if ((mode === "compare" || mode === "text") && next === "single") {
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    if (mode === "single" && next === "compare") {
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    if (mode === "text") {
      setSearchPaths(undefined);
      setSearchResults([]);
      setSelectedSearchResult(undefined);
    }
    setMode(next);
    setTourStep(hasSeenOnboarding(next) ? null : 0);
  }

  const guardTempTargetMutation = useCallback((target: Side) => {
    const state = tempStateRef.current;
    if (state.retryOperation) {
      setMessage(`Retry ${tempRecoveryLabel(state.retryOperation)} before changing staged work.`);
      return false;
    }
    if (state.busy) {
      setMessage("Wait for the temporary merge operation to finish before changing staged work.");
      return false;
    }
    if (state.session && state.session.targetSide !== target) {
      setMessage("The replaceable source is protected during a temporary merge session.");
      return false;
    }
    return true;
  }, []);

  const guardedCopy = useCallback((from: Side, to: Side, pair?: ComparePair) => {
    if (!guardTempTargetMutation(to)) return Promise.resolve();
    return copy(from, to, pair);
  }, [copy, guardTempTargetMutation]);

  const guardedStageFileSide = useCallback((
    side: Side,
    entryPath: string,
    content: string,
    model: EntryPreview,
  ) => {
    if (!guardTempTargetMutation(side)) return Promise.resolve();
    return stageFileSide(side, entryPath, content, model);
  }, [guardTempTargetMutation, stageFileSide]);

  const guardedTakeAllTo = useCallback((target: Side) => {
    if (!guardTempTargetMutation(target)) return Promise.resolve();
    return takeAllTo(target);
  }, [guardTempTargetMutation, takeAllTo]);

  const guardedMoveHunkTo = useCallback((target: Side) => {
    const state = tempStateRef.current;
    if (state.session || state.retryOperation) {
      setMessage("Move hunk is unavailable while a temporary target owns the workspace.");
      return;
    }
    if (!guardTempTargetMutation(target)) return;
    moveHunkTo(target);
  }, [guardTempTargetMutation, moveHunkTo]);

  const guardedUnstage = useCallback((key: string) => {
    const entry = stagedEntriesRef.current[key];
    if (entry && !guardTempTargetMutation(entry.side)) return Promise.resolve();
    return unstage(key);
  }, [guardTempTargetMutation, unstage]);

  function openCreateTempTarget(sourceSide: Side) {
    if (tempStateRef.current.session || tempStateRef.current.retryOperation || tempStateRef.current.busy) return;
    tempCreateSourceSideRef.current = sourceSide;
    tempMerge.setCreateOpen(true);
  }

  function createTempTarget(creation: Parameters<typeof tempMerge.create>[1]) {
    const sourceSide = tempCreateSourceSideRef.current;
    if (!sourceSide || tempControllerCallPendingRef.current) return;
    const targetSide: Side = sourceSide === "left" ? "right" : "left";
    compareOpenGenerationRef.current[targetSide] += 1;
    tempControllerCallPendingRef.current = true;
    void tempMerge.create(sourceSide, creation).finally(() => {
      tempControllerCallPendingRef.current = false;
    });
  }

  function previewMergeAllToTemp(sourceSide: Side) {
    if (
      !tempStateRef.current.session
      || tempStateRef.current.retryOperation
      || tempControllerCallPendingRef.current
    ) return;
    setTempConflictReviewDismissed(false);
    tempControllerCallPendingRef.current = true;
    void tempMerge.previewMergeAll(sourceSide).finally(() => {
      tempControllerCallPendingRef.current = false;
    });
  }

  function runTempOperation<T extends TempOperationIntent>(
    intentRef: { current: T | undefined },
    intent: Omit<T, keyof TempOperationIntent>,
    operation: () => Promise<void>,
  ) {
    if (
      (intentRef.current && !intentRef.current.settled)
      || tempControllerCallPendingRef.current
    ) return;
    const attemptId = tempAttemptIdRef.current + 1;
    tempAttemptIdRef.current = attemptId;
    intentRef.current = { ...intent, attemptId, settled: false } as T;
    tempControllerCallPendingRef.current = true;
    void operation().finally(() => {
      tempControllerCallPendingRef.current = false;
      if (intentRef.current?.attemptId !== attemptId) return;
      intentRef.current.settled = true;
      setTempCompletionVersion((current) => current + 1);
    });
  }

  function stageMergeAllToTemp(decisions: Parameters<typeof tempMerge.stageMergeAll>[1]) {
    const session = tempStateRef.current.session;
    const preview = tempMerge.conflictReview;
    if (!session || !preview) return;
    const overwritten = decisions
      .filter((decision) => decision.action === "overwrite")
      .map((decision) => decision.entryPath);
    const intent = {
      targetSide: session.targetSide,
      paths: [...new Set([...preview.newEntries, ...overwritten])],
    };
    const sourceSide: Side = session.targetSide === "left" ? "right" : "left";
    runTempOperation(tempStageIntentRef, intent, () => tempMerge.stageMergeAll(sourceSide, decisions));
  }

  function applyTemp(pendingSourceChange?: PendingTempSourceChange) {
    const priorPending = tempApplyIntentRef.current?.pendingSourceChange;
    runTempOperation(
      tempApplyIntentRef,
      { pendingSourceChange: pendingSourceChange ?? priorPending },
      tempMerge.apply,
    );
  }

  const saveRegisteredAction = useCallback(() => {
    const state = tempStateRef.current;
    if (tempControllerCallPendingRef.current) {
      setMessage("Wait for the temporary merge operation to finish before saving staged work.");
      return;
    }
    if (state.retryOperation === "apply") {
      applyTemp();
      return;
    }
    if (state.retryOperation) {
      setMessage(`Retry ${tempRecoveryLabel(state.retryOperation)} before saving staged work.`);
      return;
    }
    if (state.busy) {
      setMessage("Wait for the temporary merge operation to finish before saving staged work.");
      return;
    }
    if (state.session) {
      applyTemp();
      return;
    }
    if (stagedTarget) void save(stagedTarget);
  }, [save, stagedTarget]);

  async function saveTempAs(closeAfterSuccess = false) {
    const closeRequestGeneration = closeAfterSuccess
      ? tempCloseRequestGenerationRef.current
      : undefined;
    const retrying = tempStateRef.current.retryOperation === "saveAs";
    let destination: string | null | undefined = retrying ? tempSavePathRef.current : undefined;
    if (!retrying) {
      const session = tempStateRef.current.session;
      if (
        !session
        || tempSavePickerPendingRef.current
        || tempControllerCallPendingRef.current
        || tempStateRef.current.busy !== undefined
      ) return;
      const pickerGeneration = tempSavePickerGenerationRef.current + 1;
      tempSavePickerGenerationRef.current = pickerGeneration;
      tempSavePickerPendingRef.current = true;
      const pickerIdentity = tempSavePickerIdentityRef.current;
      try {
        destination = await savePathDialog({
          defaultPath: session.workingName,
          filters: [{ name: "Archives", extensions: ["jar", "zip", "war", "ear"] }],
        });
      } catch (error) {
        if (tempSavePickerGenerationRef.current === pickerGeneration) {
          setMessage(`Save As picker failed: ${String(error)}`);
        }
        return;
      } finally {
        if (tempSavePickerGenerationRef.current === pickerGeneration) {
          tempSavePickerPendingRef.current = false;
        }
      }
      const currentSession = tempStateRef.current.session;
      if (
        tempSavePickerGenerationRef.current !== pickerGeneration
        || tempSavePickerIdentityRef.current !== pickerIdentity
        || !currentSession
        || currentSession.id !== session.id
        || currentSession.targetSide !== session.targetSide
        || tempControllerCallPendingRef.current
        || tempStateRef.current.busy !== undefined
        || tempStateRef.current.retryOperation !== undefined
      ) return;
    }
    if (!destination) return;
    const selectedDestination = destination;
    tempSavePathRef.current = selectedDestination;
    const priorCloseAfterSuccess = tempSaveIntentRef.current?.closeAfterSuccess ?? false;
    const currentCloseRequest = closeRequestGeneration !== undefined
      && closeRequestGeneration === tempCloseRequestGenerationRef.current;
    runTempOperation(
      tempSaveIntentRef,
      { closeAfterSuccess: currentCloseRequest || priorCloseAfterSuccess },
      () => tempMerge.saveAs(selectedDestination),
    );
  }

  function cancelTempClose() {
    tempCloseRequestGenerationRef.current += 1;
    setTempCloseOpen(false);
    if (tempSaveIntentRef.current?.closeAfterSuccess) {
      tempSaveIntentRef.current = { ...tempSaveIntentRef.current, closeAfterSuccess: false };
    }
    if (tempDiscardIntentRef.current?.closeAfterSuccess) {
      tempDiscardIntentRef.current = { ...tempDiscardIntentRef.current, closeAfterSuccess: false };
    }
  }

  function retryTempCloseOperation() {
    const operation = tempStateRef.current.retryOperation;
    if (operation === "saveAs") {
      void saveTempAs(true);
    } else if (operation === "discard") {
      discardTemp(true);
    } else if (operation === "apply") {
      applyTemp();
    }
  }

  function discardTemp(closeAfterSuccess = false) {
    const priorCloseAfterSuccess = tempDiscardIntentRef.current?.closeAfterSuccess ?? false;
    setDiscardTempOpen(false);
    if (closeAfterSuccess) setTempCloseOpen(false);
    runTempOperation(
      tempDiscardIntentRef,
      { closeAfterSuccess: closeAfterSuccess || priorCloseAfterSuccess },
      tempMerge.discard,
    );
  }

  async function discardStagedForSourceChange() {
    const pending = pendingTempSourceChangeRef.current;
    const targetSide = tempTargetSideRef.current;
    if (!pending || !targetSide) return;
    const cleared = await clearStagedForSide(targetSide);
    if (!cleared || pendingTempSourceChangeRef.current !== pending) return;
    setPendingTempSourceChange(undefined);
    void openPath(pending.side, pending.path, pending.openTabsConfirmed, true);
  }

  useEffect(() => {
    if (tempMerge.error) setMessage(tempMerge.error);
  }, [tempMerge.error]);

  useEffect(() => {
    const session = tempMerge.session;
    if (!session) return;
    tempTargetSideRef.current = session.targetSide;
    setPaths((current) => ({ ...current, [session.targetSide]: session.workingName }));
    setArchives((current) => ({
      ...current,
      [session.targetSide]: tempSummaryAsArchive(session.workingName),
    }));
    if (projectedTempSessionIdRef.current !== session.id) {
      projectedTempSessionIdRef.current = session.id;
      void refreshDiff();
    }
  }, [refreshDiff, tempMerge.session]);

  useEffect(() => {
    const stageIntent = tempStageIntentRef.current;
    if (stageIntent?.settled) {
      if (!tempMerge.error && tempMerge.conflictReview === undefined) {
        projectTempStaged(stageIntent.targetSide, stageIntent.paths);
        tempStageIntentRef.current = undefined;
      } else {
        tempStageIntentRef.current = undefined;
      }
    }

    const applyIntent = tempApplyIntentRef.current;
    if (applyIntent?.settled) {
      if (tempMerge.retryOperation === "apply") {
        setPendingTempSourceChange(undefined);
      } else if (tempMerge.session && !tempMerge.error) {
        resetStagedProjection();
        void refreshDiff();
        const pending = applyIntent.pendingSourceChange;
        if (pending) {
          setPendingTempSourceChange(undefined);
          void openPath(pending.side, pending.path, pending.openTabsConfirmed, true);
        }
        tempApplyIntentRef.current = undefined;
      } else {
        tempApplyIntentRef.current = undefined;
      }
    }

    const saveIntent = tempSaveIntentRef.current;
    if (saveIntent?.settled) {
      if (tempMerge.retryOperation !== "saveAs" && tempMerge.session && !tempMerge.error) {
        if (saveIntent.closeAfterSuccess) void destroyCurrentWindow();
        tempSaveIntentRef.current = undefined;
      } else if (tempMerge.retryOperation !== "saveAs") {
        tempSaveIntentRef.current = undefined;
      }
    }

    const discardIntent = tempDiscardIntentRef.current;
    if (discardIntent?.settled) {
      if (tempMerge.retryOperation !== "discard" && !tempMerge.session && !tempMerge.error) {
        const targetSide = tempTargetSideRef.current;
        if (targetSide) {
          setArchives((current) => {
            const next = { ...current };
            delete next[targetSide];
            return next;
          });
          setPaths((current) => ({ ...current, [targetSide]: "" }));
        }
        resetStagedProjection();
        projectedTempSessionIdRef.current = undefined;
        tempTargetSideRef.current = undefined;
        void refreshDiff();
        if (discardIntent.closeAfterSuccess) void destroyCurrentWindow();
        tempDiscardIntentRef.current = undefined;
      } else if (tempMerge.retryOperation !== "discard") {
        tempDiscardIntentRef.current = undefined;
      }
    }
  }, [
    openPath,
    projectTempStaged,
    refreshDiff,
    resetStagedProjection,
    tempCompletionVersion,
    tempMerge.busy,
    tempMerge.conflictReview,
    tempMerge.error,
    tempMerge.retryOperation,
    tempMerge.session,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    return subscribeWindowCloseRequested((event) => {
      const tempState = tempStateRef.current;
      if (tempState.retryOperation) {
        event.preventDefault();
        tempCloseRequestGenerationRef.current += 1;
        setTempCloseOpen(true);
        setMessage(`Retry ${tempRecoveryLabel(tempState.retryOperation)} before closing LCDiff.`);
        return;
      }
      if (tempState.session) {
        event.preventDefault();
        tempCloseRequestGenerationRef.current += 1;
        setTempCloseOpen(true);
        return;
      }
      if (!stagedTarget) return;
      event.preventDefault();
      if (!globalThis.confirm("Discard unsaved changes and close LCDiff?")) return;
      void clearStaged().then(destroyCurrentWindow);
    });
  }, [clearStaged, stagedTarget]);

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
        for (const hit of await searchViewSource(sourceId, query, options)) {
          if (searchStreamId.current !== searchId || !isCurrentViewRequest(generation, sourceId)) return;
          appendHit(hit, "left", "T2");
        }
      } else {
        for (const side of searchSides()) {
          if (!archives[side] || archives[side]?.metadata.sourceKind === "text") continue;
          for (const hit of await searchArchive(side, query, options)) {
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
            for (const hit of await deepSearchViewSource(sourceId, query, searchId)) {
              if (searchStreamId.current !== searchId || !isCurrentViewRequest(generation, sourceId)) return;
              appendHit(hit, "left", "T3");
            }
          } else {
            for (const side of searchSides()) {
              if (!archives[side] || archives[side]?.metadata.sourceKind === "text") continue;
              for (const hit of await deepSearch(side, query, searchId)) {
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
    await cancelDeepSearchCommand();
    setMessage("Cancelling decompiled source search...");
  }

  function findInCurrentDiff() {
    const trimmed = query.trim();
    if (!trimmed) {
      setMessage("Search query is empty");
      return;
    }
    const line = workspace.editor.findFirstMatch(trimmed);
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
    if (shouldCancelBackendSearch) await cancelDeepSearchCommand();
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
  const activeTempSession = tempMerge.retryOperation ? undefined : tempMerge.session;
  const tempOwnedTargetSide = activeTempSession?.targetSide
    ?? (tempMerge.retryOperation ? tempTargetSideRef.current : undefined);
  const tempTargetPendingOps = tempOwnedTargetSide
    ? merge.pendingOps.filter((operation) => operation.side === tempOwnedTargetSide)
    : [];
  const tempConflictCount = activeTempSession
    ? (tempMerge.conflictReview?.conflicts.length ?? 0)
    : 0;
  const ignoreTrimWhitespace = preferences.misc.decompiler.ignoreTrimWhitespace;
  const activeColorPattern = effectiveColorPattern(
    preferences.appearance.colorPattern,
    systemPrefersDark,
  );

  // Per-hunk merge (Take all / Move hunk, editable diff) applies to ANY compare
  // where both sides show the same entry as editable text — standalone plain
  // files AND text entries inside jar/zip archives. `isFileMerge` (sourceKind
  // file) only changes the copy-arrow wording now.
  const leftText = isEditableTextPreview(preview.left);
  const rightText = isEditableTextPreview(preview.right);
  const oneSided = Boolean(preview.left) !== Boolean(preview.right);
  const diffEditableSides = {
    left: mode === "compare"
      && !tempMerge.retryOperation
      && (!activeTempSession || activeTempSession.targetSide === "left")
      && leftText
      && (rightText || oneSided),
    right: mode === "compare"
      && !tempMerge.retryOperation
      && (!activeTempSession || activeTempSession.targetSide === "right")
      && rightText
      && (leftText || oneSided),
  };
  const isTextMerge = mode === "compare" && leftText && rightText;

  const isEditableEntry =
    mode === "single" &&
    viewMode === "source" &&
    !!preview.left &&
    activeViewSource?.signed !== true &&
    !preview.left.path.includes("!/") &&
    isEditableTextPreview(preview.left);

  mergeContextRef.current = {
    mode,
    activeViewSource,
    selected,
    preview,
    archives,
    backupEnabled: preferences.misc.save.backupEnabled,
    isFileMerge,
    isTextMerge,
    openPath,
    loadViewPairs,
    inspectViewEntry,
  };

  const baseName = (p?: string) => (p ? p.split("/").pop() || undefined : undefined);
  const leftLabel = mode === "single"
      ? activeViewSource?.name ?? "Source"
      : baseName(archives.left?.path ?? paths.left) ?? "Left";
  const rightLabel = baseName(archives.right?.path ?? paths.right) ?? "Right";
  const searchContext = searchContextForActiveTab(activeTab);
  const hunkMerge = isTextMerge;
  const sourceChipArchives = mode === "single"
    ? { left: summaryAsArchive(activeViewSource) }
    : tempMerge.retryOperation && tempOwnedTargetSide
      ? Object.fromEntries(
          Object.entries(archives).filter(([side]) => side !== tempOwnedTargetSide),
        )
      : archives;
  const loadedSourceCount =
    mode === "text"
      ? 0
      : mode === "single"
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
    selectedCanCopyLeft: mode === "compare"
      && !tempMerge.retryOperation
      && (!activeTempSession || activeTempSession.targetSide === "left")
      && !!selected?.right
      && selected.right.kind !== "directory",
    selectedCanCopyRight: mode === "compare"
      && !tempMerge.retryOperation
      && (!activeTempSession || activeTempSession.targetSide === "right")
      && !!selected?.left
      && selected.left.kind !== "directory",
    stagedTarget,
    stagedCount: Object.keys(stagedEntries).length,
    loadedSourceCount,
    hunkMerge: activeTab !== "files" && hunkMerge && !tempOwnedTargetSide,
    focusKind: classifyFocusTarget(document.activeElement),
    shortcutDialogOpen,
  }), [activeTempSession, actionOpenTabs, activeTab, hunkMerge, loadedSourceCount, mode, selected, shortcutDialogOpen, stagedEntries, stagedTarget, tempMerge.retryOperation, tempOwnedTargetSide]);

  const actionHandlers = useMemo<AppActionHandlers>(() => ({
    openLeftFile: () => void browse("left"),
    openLeftDirectory: () => void browseFolder("left"),
    openRightFile: () => void browse("right"),
    openRightDirectory: () => void browseFolder("right"),
    refresh: refreshSources,
    save: saveRegisteredAction,
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
    focusFiles,
    nextTab: () => focusRelativeTab(1),
    previousTab: () => focusRelativeTab(-1),
    closeActiveTab,
    copyToLeft: () => void guardedCopy("right", "left"),
    copyToRight: () => void guardedCopy("left", "right"),
    takeAllToLeft: () => void guardedTakeAllTo("left"),
    takeAllToRight: () => void guardedTakeAllTo("right"),
    moveHunkToLeft: () => guardedMoveHunkTo("left"),
    moveHunkToRight: () => guardedMoveHunkTo("right"),
    reportBlocked: setMessage,
  }), [
    browse,
    browseFolder,
    clearStaged,
    closeActiveTab,
    guardedCopy,
    guardedMoveHunkTo,
    guardedTakeAllTo,
    findInCurrentDiff,
    focusFiles,
    focusRelativeTab,
    mode,
    refreshSources,
    runSearch,
    saveRegisteredAction,
    searchContext,
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
    return subscribeAppAction((payload) => {
      const { actionId } = payload;
      if (!isAppActionId(actionId)) return;
      void dispatchRegisteredAction(actionId, document.activeElement, lastFocusKindRef.current);
    }, (error) => {
      setMessage(`Hotkey listener failed: ${String(error)}`);
    });
  }, [dispatchRegisteredAction]);

  const updatePrompt: StatusBarUpdatePrompt | undefined =
    updateState.status === "available"
      ? {
          status: "available",
          message: updateState.message ?? "Update available.",
          primaryLabel: "Download and install",
          fallbackLabel: "Open release page",
          onPrimaryAction: installUpdate,
          onFallbackAction: openUpdateRelease,
        }
      : updateState.status === "downloading"
        ? {
            status: "downloading",
            message: updateState.message ?? "Downloading update...",
            primaryLabel: "Downloading...",
            primaryDisabled: true,
          }
        : updateState.status === "readyToRestart"
        ? {
            status: "readyToRestart",
            message: updateState.message ?? "Update downloaded. Restart to finish.",
            primaryLabel: "Restart",
            onPrimaryAction: restartUpdate,
          }
        : updateState.status === "fallback" || updateState.status === "error"
          ? {
              status: updateState.status,
              message: updateState.message ?? "Could not install the update.",
              fallbackLabel: "Open release page",
              onFallbackAction: openUpdateRelease,
            }
          : undefined;

  const viewEditSourceId = activeViewSource?.id;
  const viewEditEntryPath = selected?.path;
  const viewEditModel = preview.left;

  function handleViewEdit(content: string, updateBuffer: boolean) {
    if (
      !viewEditSourceId ||
      !viewEditEntryPath ||
      !viewEditModel ||
      viewEditModel.path !== viewEditEntryPath
    ) {
      return;
    }
    const current = mergeContextRef.current;
    if (
      !current ||
      current.activeViewSource?.id !== viewEditSourceId ||
      current.selected?.path !== viewEditEntryPath ||
      current.preview.left !== viewEditModel
    ) {
      return;
    }
    if (updateBuffer) updateEditBuffer(content);
    void stageEdit(
      viewEditEntryPath,
      content,
      viewEditSourceId,
      viewEditModel,
    );
  }

  const diffView = (
    <DiffView
      mode={mode}
      selected={selected}
      preview={preview}
      preferences={preferences}
      effectiveColorPattern={activeColorPattern}
      ignoreTrimWhitespace={ignoreTrimWhitespace}
      contentFilter={contentFilter}
      onContentFilterChange={setContentFilter}
      onCopy={(from, to) => void guardedCopy(from, to)}
      onEditorMount={handleEditorMount}
      onDiffMount={handleDiffMount}
      editable={isEditableEntry}
      editValue={editBuffer}
      onEditChange={(value) => {
        handleViewEdit(value ?? "", true);
      }}
      onEditBlur={(content) => {
        handleViewEdit(content, false);
      }}
      fileMerge={isFileMerge}
      entryCopyEnabled={mode === "compare" && !tempMerge.retryOperation}
      diffEditableSides={diffEditableSides}
      hunkMerge={mode === "compare" && isTextMerge && !tempOwnedTargetSide}
      onDiffEditEither={(side, content) => {
        const entryPath = selected?.path;
        const model = preview[side];
        if (!entryPath || !model || model.path !== entryPath) return;
        void guardedStageFileSide(side, entryPath, content, model);
      }}
      onTakeAll={(target) => void guardedTakeAllTo(target)}
      onMoveHunk={guardedMoveHunkTo}
      tempSession={activeTempSession}
      tempBusy={tempMerge.busy !== undefined}
      onCopyToTemp={(sourceSide) => {
        const targetSide: Side = sourceSide === "left" ? "right" : "left";
        void guardedCopy(sourceSide, targetSide);
      }}
      onMergeAllToTemp={previewMergeAllToTemp}
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
      <WorkspaceRail
        mode={mode}
        searchOpen={searchOpen}
        drawerOpen={drawerOpen}
        onChangeMode={changeMode}
        onToggleSearch={() => {
          if (mode !== "text") setSearchOpen((open) => !open);
        }}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
      />
      <div className="app-workbench">
      <MenuBar
        mode={mode}
        stagedTarget={stagedTarget}
        pendingOps={merge.pendingOps}
        onUnstageOne={(entryPath) => void guardedUnstage(entryPath)}
        tempSession={activeTempSession}
        tempBusy={tempMerge.busy !== undefined}
        tempRetryOperation={tempMerge.retryOperation}
        onApplyTemp={() => applyTemp()}
        onSaveTempAs={() => void saveTempAs(false)}
        onDiscardTemp={() => {
          if (tempMerge.retryOperation === "discard") discardTemp(false);
          else setDiscardTempOpen(true);
        }}
        canRefresh={Boolean(
          mode !== "text" && (
            mode === "single"
              ? activeViewSource
              : (archives.left && archives.left.metadata.sourceKind !== "text") ||
                (archives.right && archives.right.metadata.sourceKind !== "text")
          ),
        )}
        onSave={(side) => void save(side)}
        onRefresh={refreshSources}
        onClearStaged={() => {
          if (activeTempSession) void clearStagedForSide(activeTempSession.targetSide);
          else void clearStaged();
        }}
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
          tempSession={activeTempSession}
          tempBusy={tempMerge.busy !== undefined}
          onCreateTempTarget={openCreateTempTarget}
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
      {dropHint && tourStep === null && (
        <aside className="platform-hint" role="status" aria-live="polite">
          <span>{dropHint}</span>
          <button type="button" aria-label="Dismiss platform notice" onClick={() => setDropHint("")}>
            ×
          </button>
        </aside>
      )}
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
              onSelectFiles={focusFiles}
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
            data-tour="workspace-canvas"
          >
            {mode === "text" ? (
              <div className="workspace-tabpanel" role="tabpanel">
                <FreeTextWorkspace
                  preferences={preferences}
                  effectiveColorPattern={activeColorPattern}
                  ignoreTrimWhitespace={ignoreTrimWhitespace}
                  draftLeft={freeText.draftLeft}
                  draftRight={freeText.draftRight}
                  history={freeText.history}
                  activeResultId={freeText.activeResultId}
                  onDraftChange={freeText.setDraft}
                  onClearDrafts={freeText.clearDrafts}
                  onConfirmDiff={freeText.confirmDiff}
                  onClearHistory={freeText.clearHistory}
                  onSelectResult={freeText.selectResult}
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
                    expandedPaths={expandedPaths}
                    onExpandedPathsChange={setExpandedPaths}
                    onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                    onSelect={(pair) => { setSelectedSearchResult(undefined); selectPair(pair); }}
                    onCopy={(from, to, pair) => void guardedCopy(from, to, pair)}
                    onUnstage={(entryPath) => void guardedUnstage(entryPath)}
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
                    expandedPaths={expandedPaths}
                    onExpandedPathsChange={setExpandedPaths}
                    onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                    onSelect={(pair) => { setSelectedSearchResult(undefined); selectPair(pair); }}
                    onCopy={(from, to, pair) => void guardedCopy(from, to, pair)}
                    onUnstage={(entryPath) => void guardedUnstage(entryPath)}
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
          updateState={updateState}
          onLoadSystemFonts={loadSystemFonts}
          onPreferencesChange={setPreferences}
          onCheckForUpdates={() => void checkUpdates("manual")}
          onDownloadAndInstallUpdate={installUpdate}
          onRestartToUpdate={restartUpdate}
          onOpenUpdateFallback={openUpdateRelease}
          onReplayTour={() => {
            setDrawerOpen(false);
            setTourStep(0);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
      <StatusBar
        message={message}
        searching={searching}
        pendingCount={Object.keys(stagedEntries).length}
        tempSession={activeTempSession}
        tempStagedCount={tempTargetPendingOps.length}
        tempConflictCount={tempConflictCount}
        updatePrompt={updatePrompt}
      />
      <KeyboardShortcutsDialog
        open={shortcutDialogOpen}
        onOpenChange={updateShortcutDialogOpen}
        platform={currentPlatform()}
      />
      <CreateTempTargetDialog
        open={tempMerge.createOpen}
        onOpenChange={tempMerge.setCreateOpen}
        onSubmit={createTempTarget}
        busy={tempMerge.busy === "create"}
      />
      {activeTempSession && tempMerge.conflictReview && !tempConflictReviewDismissed && (
        <MergeConflictDialog
          open
          preview={tempMerge.conflictReview}
          onOpenChange={(open) => {
            if (!open) setTempConflictReviewDismissed(true);
          }}
          onSubmit={stageMergeAllToTemp}
          busy={tempMerge.busy === "stageMergeAll"}
        />
      )}
      <Dialog
        open={pendingTempSourceChange !== undefined}
        onOpenChange={(open) => {
          if (!open && tempMerge.busy !== "apply") setPendingTempSourceChange(undefined);
        }}
      >
        <DialogContent showCloseButton={tempMerge.busy !== "apply"}>
          <DialogHeader>
            <DialogTitle>Apply staged changes before changing source?</DialogTitle>
            <DialogDescription>
              The temporary target has staged work. Apply it, discard only that target plan, or keep the current source.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={tempMerge.busy !== undefined}
              onClick={() => setPendingTempSourceChange(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={tempMerge.busy !== undefined}
              onClick={() => void discardStagedForSourceChange()}
            >
              Discard staged
            </Button>
            <Button
              disabled={tempMerge.busy !== undefined}
              onClick={() => {
                const pending = pendingTempSourceChangeRef.current;
                if (pending) applyTemp(pending);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={discardTempOpen} onOpenChange={setDiscardTempOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard temporary target?</DialogTitle>
            <DialogDescription>
              This removes the app-owned working target. User-selected Save As exports are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardTempOpen(false)}>Cancel</Button>
            <Button onClick={() => discardTemp(false)}>Confirm discard temp</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={tempCloseOpen}
        onOpenChange={(open) => {
          if (!open && (tempMerge.busy === undefined || tempMerge.retryOperation)) cancelTempClose();
        }}
      >
        <DialogContent showCloseButton={tempMerge.busy === undefined || tempMerge.retryOperation !== undefined}>
          <DialogHeader>
            <DialogTitle>Save temporary target before closing?</DialogTitle>
            <DialogDescription>
              {tempMerge.retryOperation
                ? `Retry ${tempRecoveryLabel(tempMerge.retryOperation)} to finish recovery, or cancel only this close request.`
                : "Save the current working result, discard the app-owned target, or cancel closing."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {tempMerge.retryOperation ? (
              <>
                <Button variant="outline" onClick={cancelTempClose}>Cancel closing</Button>
                <Button onClick={retryTempCloseOperation}>
                  Retry {tempRecoveryLabel(tempMerge.retryOperation)}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={tempMerge.busy !== undefined} onClick={cancelTempClose}>
                  Cancel
                </Button>
                <Button variant="outline" disabled={tempMerge.busy !== undefined} onClick={() => discardTemp(true)}>
                  Discard
                </Button>
                <Button disabled={tempMerge.busy !== undefined} onClick={() => void saveTempAs(true)}>
                  Save As
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingOpen !== undefined || pendingComparePair !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPendingOpen(undefined);
            setPendingComparePair(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close open diffs?</DialogTitle>
            <DialogDescription>
              Opening a new archive will close your {openTabs.length} open diff{openTabs.length === 1 ? "" : "s"} and reset the comparison.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingOpen(undefined);
                setPendingComparePair(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const target = pendingOpen;
                const pair = pendingComparePair;
                setPendingOpen(undefined);
                setPendingComparePair(undefined);
                if (pair) void openDroppedComparePair(pair.leftPath, pair.rightPath, true);
                else if (target) void openPath(target.side, target.path, true);
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
      {tourStep !== null && (
        <OnboardingTour mode={mode} step={tourStep} onStep={setTourStep} onClose={() => setTourStep(null)} />
      )}
      </div>
    </main>
    </TooltipProvider>
  );
}
