import "@/lib/monaco";
import type { DiffOnMount, OnMount } from "@monaco-editor/react";
import type {
  ArchiveDiff,
  ArchiveSummary,
  CodeEditor,
  CommitResult,
  ComparePair,
  DecorationRef,
  DiffCodeEditor,
  Engine,
  EntryKind,
  EntryPreview,
  Mode,
  MonacoApi,
  PairStatus,
  PlatformHints,
  SearchHit,
  SearchResult,
  SearchScope,
  SearchTier,
  Side,
  StagedEntry,
  TreeFilter,
  ViewMode,
} from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
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
import { DiffView, pairHasClass } from "@/components/DiffView";
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "@/lib/tabs";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { FileTree } from "@/components/FileTree";
import { isDirectoryPair, pairPassesTreeFilter } from "@/lib/tree";
import { SplashScreen } from "@/components/SplashScreen";
import {
  type HistoryEntry,
  clearHistory,
  loadHistory,
  recordSession,
} from "@/lib/history";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

const emptyPaths: Record<Side, string> = { left: "", right: "" };

const MAX_DIFF_TABS = 10;

const EDIT_EXTENSIONS = ["xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf"];

function searchResultKey(result: SearchResult) {
  return `${result.tier}:${result.side}:${result.path}:${result.matchKind}:${result.line ?? ""}`;
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

export function App() {
  const [paths, setPaths] = useState(emptyPaths);
  const [pathErrors, setPathErrors] = useState<Partial<Record<Side, string>>>({});
  const [archives, setArchives] = useState<Partial<Record<Side, ArchiveSummary>>>({});
  const [pairs, setPairs] = useState<ComparePair[]>([]);
  const [nestedPairs, setNestedPairs] = useState<Record<string, ComparePair[]>>({});
  const [selected, setSelected] = useState<ComparePair>();
  const [preview, setPreview] = useState<Partial<Record<Side, EntryPreview>>>({});
  const [message, setMessage] = useState("Open a JAR, ZIP, or folder on each side.");
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("differences");
  const [engine, setEngine] = useState<Engine>("cfr");
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("both");
  const [searchPaths, setSearchPaths] = useState<Set<string>>();
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult>();
  const [mode, setMode] = useState<Mode>("compare");
  const [view, setView] = useState<"splash" | "workspace">("splash");
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(true);
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
  const [searchOpen, setSearchOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"files" | string>("files");
  const [openTabs, setOpenTabs] = useState<DiffTab[]>([]);
  const focusCounter = useRef(0);
  const openTabsCountRef = useRef(0);
  const previewRequestId = useRef(0);
  const searchStreamId = useRef(0);
  const editorRef = useRef<CodeEditor | undefined>(undefined);
  const diffEditorRef = useRef<DiffCodeEditor | undefined>(undefined);
  const monacoRef = useRef<MonacoApi | undefined>(undefined);
  const singleSearchDecorations = useRef<string[]>([]);
  const leftSearchDecorations = useRef<string[]>([]);
  const rightSearchDecorations = useRef<string[]>([]);
  const handleEditorMount = useCallback<OnMount>((editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; }, []);
  const handleDiffMount = useCallback<DiffOnMount>((editor, monaco) => { diffEditorRef.current = editor; monacoRef.current = monaco; }, []);
  const displayedPairs = useMemo<ComparePair[]>(
    () =>
      mode === "compare"
        ? pairs
        : (archives.left?.entries ?? []).map((entry) => ({
            path: entry.path,
            status: "onlyLeft" as const,
            left: entry,
            right: undefined,
          })),
    [archives.left?.entries, mode, pairs],
  );
  const visiblePairs = useMemo(
    () =>
      displayedPairs.filter(
        (pair) =>
          !isDirectoryPair(pair) &&
          pairPassesTreeFilter(pair, treeFilter) &&
          (!searchPaths || searchPaths.has(pair.path)),
      ),
    [displayedPairs, searchPaths, treeFilter],
  );

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

  const expandArchive = useCallback(async (fullPath: string) => {
    try {
      const diff = await invoke<ArchiveDiff>("compute_nested_diff", { nestedPath: fullPath });
      setNestedPairs((prev) => ({ ...prev, [fullPath]: diff.pairs }));
    } catch (error) {
      setMessage(String(error));
    }
  }, []);

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

  useEffect(() => {
    openTabsCountRef.current = openTabs.length;
  }, [openTabs]);

  useEffect(() => {
    if (view !== "workspace") return;
    const left = archives.left?.path;
    const right = archives.right?.path;
    if (mode === "single" && left) {
      setHistory(recordSession("single", [left], Date.now()));
    } else if (mode === "compare" && left && right) {
      setHistory(recordSession("compare", [left, right], Date.now()));
    }
  }, [view, mode, archives.left?.path, archives.right?.path]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: undefined | (() => void);
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
        const side = dropSideForPosition(mode, event.payload.position.x, window.innerWidth);
        void openPath(side, event.payload.paths[0]);
      })
      .then((stop) => {
        unlisten = stop;
      });
    return () => unlisten?.();
  }, [mode, openPath]);

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
        if (!globalThis.confirm("Discard staged archive copies and close jdiff?")) return;
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
    listen<{ searchId: number; side: Side; hit: SearchHit }>("search-result", (event) => {
      if (event.payload.searchId !== searchStreamId.current) return;
      const result = { side: event.payload.side, tier: "T3" as const, ...event.payload.hit };
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
    if (activeTab === "files" || !selected) return;
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === activeTab ? { ...t, pair: selected, preview, viewMode } : t)),
    );
  }, [activeTab, selected, preview, viewMode]);

  async function browse(side: Side) {
    const path = await chooseFile({
      multiple: false,
      filters: [{ name: "JAR or ZIP archive", extensions: ["jar", "zip"] }],
    });
    if (path) await openPath(side, path);
  }

  async function browseFolder(side: Side) {
    const path = await chooseFile({
      multiple: false,
      directory: true,
    });
    if (path) await openPath(side, path);
  }

  function refreshSources() {
    const sides: Side[] = mode === "compare" ? ["left", "right"] : ["left"];
    for (const side of sides) {
      const current = archives[side]?.path;
      if (current) void openPath(side, current, true);
    }
  }

  function focusTab(path: string) {
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setSelected(tab.pair);
    setPreview(tab.preview);
    setViewMode(tab.viewMode);
    setActiveTab(path);
    setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, lastFocus: stamp } : t)));
  }

  async function inspect(pair: ComparePair, force = false) {
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

  async function showBytecode() {
    const pair = selected;
    if (!pair) return;
    if (!pairHasClass(pair)) {
      setMessage("Bytecode view is only available for class entries.");
      return;
    }
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
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

  async function changeEngine(next: Engine) {
    await invoke("set_engine", { engine: next });
    setEngine(next);
    if (selected) await inspect(selected, true);
  }

  function pickMode(next: Mode) {
    setMode(next);
    setView("workspace");
  }

  function openEntry(entry: HistoryEntry) {
    setMode(entry.mode);
    setView("workspace");
    if (entry.mode === "single") {
      void openPath("left", entry.paths[0], true);
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
    if (next === "single" && stagedTarget) {
      setMessage("Save or clear staged copies before switching to Single mode.");
      return;
    }
    if (mode === "compare" && next === "single") {
      diffEditorRef.current?.setModel(null);
      diffEditorRef.current = undefined;
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
    setMessage("Cleared staged copies.");
  }

  async function unstage(entryPath: string) {
    try {
      await invoke("unstage", { entryPath });
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[entryPath];
        if (Object.keys(next).length === 0) setStagedTarget(undefined);
        return next;
      });
      setMessage(`Unstaged ${entryPath}.`);
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

  async function runSearch() {
    const searchId = searchStreamId.current + 1;
    searchStreamId.current = searchId;
    setSearching(false);
    try {
      const matches = new Set<string>();
      const results: SearchResult[] = [];
      for (const side of searchSides()) {
        if (!archives[side]) continue;
        for (const hit of await invoke<SearchHit[]>("search", { side, query })) {
          if (searchStreamId.current !== searchId) return;
          matches.add(hit.path);
          results.push({ side, tier: "T2", ...hit });
        }
      }
      if (searchStreamId.current !== searchId) return;
      setSearchPaths(matches);
      setSearchResults(results);
      setMessage(`Search matched ${matches.size} entries.`);
    } catch (error) {
      if (searchStreamId.current !== searchId) return;
      setSearchPaths(undefined);
      setSearchResults([]);
      setMessage(String(error));
    }
  }

  async function runDeepSearch() {
    const searchId = searchStreamId.current + 1;
    searchStreamId.current = searchId;
    setSearching(true);
    setSearchPaths(new Set());
    setSearchResults([]);
    try {
      const matches = new Set<string>();
      const results: SearchResult[] = [];
      for (const side of searchSides()) {
        if (!archives[side]) continue;
        for (const hit of await invoke<SearchHit[]>("deep_search", { side, query, searchId })) {
          if (searchStreamId.current !== searchId) return;
          matches.add(hit.path);
          results.push({ side, tier: "T3", ...hit });
        }
      }
      if (searchStreamId.current !== searchId) return;
      setSearchPaths(matches);
      setSearchResults(results);
      setMessage(`Deep search matched ${matches.size} entries.`);
    } catch (error) {
      if (searchStreamId.current !== searchId) return;
      setMessage(String(error));
    } finally {
      if (searchStreamId.current === searchId) setSearching(false);
    }
  }

  async function cancelDeepSearch() {
    searchStreamId.current += 1;
    setSearching(false);
    await invoke("cancel_deep_search");
    setMessage("Cancelling deep search...");
  }

  function searchSides(): Side[] {
    if (mode === "single") return ["left"];
    return searchScope === "both" ? ["left", "right"] : [searchScope];
  }

  function clearSearch() {
    searchStreamId.current += 1;
    setSearching(false);
    setSearchPaths(undefined);
    setSearchResults([]);
    setSelectedSearchResult(undefined);
  }

  function inspectSearchResult(result: SearchResult) {
    const pair = displayedPairs.find((candidate) => candidate.path === result.path);
    if (!pair) return;
    if (!pairPassesTreeFilter(pair, treeFilter)) setTreeFilter("all");
    setSelectedSearchResult(result);
    void inspect(pair);
  }

  if (view === "splash") {
    return (
      <SplashScreen
        history={history}
        now={Date.now()}
        onPickMode={pickMode}
        onOpenEntry={openEntry}
        onClear={clearRecent}
      />
    );
  }

  const isEditableEntry =
    mode === "single" &&
    !!preview.left &&
    (preview.left.kind === "text" ||
      EDIT_EXTENSIONS.includes(preview.left.path.split(".").pop()?.toLowerCase() ?? ""));

  return (
    <TooltipProvider>
    <main className="app-shell">
      <MenuBar
        mode={mode}
        stagedTarget={stagedTarget}
        stagedCount={Object.keys(stagedEntries).length}
        searchOpen={searchOpen}
        drawerOpen={drawerOpen}
        canRefresh={Boolean(archives.left || archives.right)}
        onChangeMode={changeMode}
        onSave={(side) => void save(side)}
        onRefresh={refreshSources}
        onClearStaged={clearStaged}
        onToggleSearch={() => setSearchOpen((o) => !o)}
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
      />

      <SourceChips
        mode={mode}
        archives={archives}
        paths={paths}
        pathErrors={pathErrors}
        onPathChange={(side, value) => setPaths((current) => ({ ...current, [side]: value }))}
        onOpenPath={(side, path) => void openPath(side, path)}
        onBrowse={(side) => void browse(side)}
        onBrowseFolder={(side) => void browseFolder(side)}
      />

      <SearchBar
        open={searchOpen}
        query={query}
        treeFilter={treeFilter}
        onQueryChange={setQuery}
        onSearch={runSearch}
        onFilterChange={setTreeFilter}
      />
      {dropHint && <p className="platform-hint">{dropHint}</p>}
      <div className="work-area">
        <section className="workspace">
          <WorkspaceTabs
            fileCount={visiblePairs.length}
            activeId={activeTab}
            tabs={openTabs.map((t) => ({ path: t.path, status: t.pair.status }))}
            onSelectFiles={() => setActiveTab("files")}
            onSelectTab={(path) => focusTab(path)}
            onCloseTab={(path) => closeTab(path)}
          />
          <div className="workspace-tabpanels">
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab !== "files"}>
              <FileTree
                visiblePairs={visiblePairs}
                selected={selected}
                stagedEntries={stagedEntries}
                mode={mode}
                treeFilter={treeFilter}
                nestedPairs={nestedPairs}
                onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
                onCopy={(from, to, pair) => void copy(from, to, pair)}
                onUnstage={(entryPath) => void unstage(entryPath)}
                onExpandArchive={(fullPath) => void expandArchive(fullPath)}
              />
            </div>
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab === "files"}>
              <DiffView
                mode={mode}
                selected={selected}
                preview={preview}
                viewMode={viewMode}
                ignoreTrimWhitespace={ignoreTrimWhitespace}
                onCopy={(from, to) => void copy(from, to)}
                onShowSource={() => selected && void inspect(selected, true)}
                onShowBytecode={showBytecode}
                onEditorMount={handleEditorMount}
                onDiffMount={handleDiffMount}
                editable={isEditableEntry}
                editValue={editBuffer}
                onEditChange={(value) => setEditBuffer(value ?? "")}
                onEditBlur={(content) => selected && void stageEdit(selected.path, content)}
              />
            </div>
          </div>
        </section>
        <ConfigDrawer
          open={drawerOpen}
          mode={mode}
          searchScope={searchScope}
          searching={searching}
          engine={engine}
          ignoreTrimWhitespace={ignoreTrimWhitespace}
          backupEnabled={backupEnabled}
          onScopeChange={setSearchScope}
          onDeepSearch={runDeepSearch}
          onCancelDeepSearch={cancelDeepSearch}
          onClearSearch={clearSearch}
          onEngineChange={(next) => void changeEngine(next)}
          onIgnoreWhitespaceChange={setIgnoreTrimWhitespace}
          onBackupEnabledChange={setBackupEnabled}
        />
      </div>
      <p className="message">{message}</p>
      {searchResults.length > 0 && (
        <section className="search-results">
          {searchResults.map((result) => (
            <Button
              variant="outline"
              key={searchResultKey(result)}
              onClick={() => inspectSearchResult(result)}
            >
              {result.path} · {result.matchKind}
              {result.line !== undefined && `:${result.line}`} · {result.tier} · {result.side.toUpperCase()}
            </Button>
          ))}
        </section>
      )}
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
