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
  TreeFilter,
  ViewMode,
} from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as chooseFile } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DiffView, pairHasClass } from "@/components/DiffView";
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

function searchResultKey(result: SearchResult) {
  return `${result.tier}:${result.side}:${result.path}:${result.matchKind}:${result.line ?? ""}`;
}

function pairPassesTreeFilter(pair: ComparePair, filter: TreeFilter) {
  return (
    filter === "all" ||
    (filter === "differences" && pair.status !== "identical") ||
    pair.status === filter
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

function dropSideForPosition(mode: Mode, x: number, width: number): Side {
  if (mode === "single") return "left";
  return x < width / 2 ? "left" : "right";
}

export function App() {
  const [paths, setPaths] = useState(emptyPaths);
  const [pathErrors, setPathErrors] = useState<Partial<Record<Side, string>>>({});
  const [archives, setArchives] = useState<Partial<Record<Side, ArchiveSummary>>>({});
  const [pairs, setPairs] = useState<ComparePair[]>([]);
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
  const [stagedEntries, setStagedEntries] = useState<Record<string, Side>>({});
  const [searching, setSearching] = useState(false);
  const [dropHint, setDropHint] = useState("");
  const [signedSavePrompt, setSignedSavePrompt] = useState<Side>();
  const [suppressSignedWarningForFile, setSuppressSignedWarningForFile] = useState(false);
  const [signedWarningSuppressions, setSignedWarningSuppressions] = useState<Record<string, boolean>>({});
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
          pairPassesTreeFilter(pair, treeFilter) &&
          (!searchPaths || searchPaths.has(pair.path)),
      ),
    [displayedPairs, searchPaths, treeFilter],
  );

  const refreshDiff = useCallback(async () => {
    try {
      const diff = await invoke<ArchiveDiff>("compute_diff");
      setPairs(diff.pairs);
    } catch {
      setPairs([]);
    }
  }, []);

  const openPath = useCallback(async (side: Side, path: string) => {
    try {
      const validatedPath = await invoke<string>("validate_path", { raw: path });
      const archive = await invoke<ArchiveSummary>("open_archive", { path: validatedPath, side });
      previewRequestId.current += 1;
      searchStreamId.current += 1;
      setSearching(false);
      setPaths((current) => ({ ...current, [side]: archive.path }));
      setPathErrors((current) => ({ ...current, [side]: undefined }));
      setArchives((current) => ({ ...current, [side]: archive }));
      setSelected(undefined);
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

  async function inspect(pair: ComparePair) {
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setSelected(pair);
    setViewMode("source");
    const next: Partial<Record<Side, EntryPreview>> = {};
    for (const side of ["left", "right"] as const) {
      if (pair[side]) {
        next[side] = await invoke<EntryPreview>("read_entry", { side, entryPath: pair.path });
      }
    }
    if (previewRequestId.current !== requestId) return;
    setPreview(next);
    for (const side of ["left", "right"] as const) {
      if (pair[side]?.kind === "class") {
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
    if (selected) await inspect(selected);
  }

  function pickMode(next: Mode) {
    setMode(next);
    setView("workspace");
  }

  function openEntry(entry: HistoryEntry) {
    setMode(entry.mode);
    setView("workspace");
    if (entry.mode === "single") {
      void openPath("left", entry.paths[0]);
    } else {
      void openPath("left", entry.paths[0]).then(() =>
        openPath("right", entry.paths[1]),
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
      setStagedEntries((current) => ({ ...current, [pair.path]: to }));
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
      const reloadError = await openPath(targetSide, result.rewrittenPath);
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

  return (
    <TooltipProvider>
    <main>
      <header>
        <div className="brand">
          <h1>jdiff</h1>
          <span className="tagline">archive diff · merge</span>
        </div>
        <div className="topbar-controls">
          <Select value={mode} onValueChange={(value) => changeMode(value as Mode)}>
            <SelectTrigger aria-label="Mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="compare">Compare</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={clearStaged}>Clear staged</Button>
        </div>
      </header>

      <section className="sources-zone">
        <span className="zone-label">Sources</span>
        <div className="open-grid">
          {(["left", ...(mode === "compare" ? (["right"] as const) : [])] as const).map((side) => (
            <div className="open-panel" key={side}>
              <strong>{side.toUpperCase()}</strong>
              <Input
                value={paths[side]}
                placeholder="~/path/to/archive.jar or folder"
                onChange={(event) => setPaths((current) => ({ ...current, [side]: event.target.value }))}
              />
              <Button onClick={() => openPath(side, paths[side])}>Open</Button>
              <div className="open-actions">
                <Button variant="outline" onClick={() => browse(side)}>Browse file</Button>
                <Button variant="outline" onClick={() => browseFolder(side)}>Browse folder</Button>
                <Button variant="secondary" disabled={mode === "single"} onClick={() => save(side)}>Save staged</Button>
              </div>
              <small>{archives[side] ? `${archives[side].metadata.sourceKind}: ${archives[side].path}` : "No source loaded"}</small>
              {pathErrors[side] && <small className="path-error">{pathErrors[side]}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="toolbar panel">
        <div className="toolbar-group find">
          <span className="zone-label">Find</span>
          <div className="row">
            <Input
              className="search-input"
              value={query}
              placeholder="Search paths, text, constants"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              value={searchScope}
              disabled={mode === "single"}
              onValueChange={(value) => setSearchScope(value as SearchScope)}
            >
              <SelectTrigger aria-label="Search scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="both">Search both</SelectItem>
                  <SelectItem value="left">Search left</SelectItem>
                  <SelectItem value="right">Search right</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button onClick={runSearch}>Search</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="secondary" disabled={searching} onClick={runDeepSearch}>Deep search</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Decompile classes in the background and stream source matches.</p>
              </TooltipContent>
            </Tooltip>
            <Button variant="outline" disabled={!searching} onClick={cancelDeepSearch}>Cancel search</Button>
            <Button variant="ghost" onClick={clearSearch}>Clear search</Button>
          </div>
        </div>
        <div className="toolbar-group view">
          <span className="zone-label">View</span>
          <div className="row">
            <Select
              value={treeFilter}
              onValueChange={(value) => setTreeFilter(value as TreeFilter)}
            >
              <SelectTrigger aria-label="Tree filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Show all</SelectItem>
                  <SelectItem value="differences">Differences only</SelectItem>
                  <SelectItem value="onlyLeft">Only left</SelectItem>
                  <SelectItem value="onlyRight">Only right</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="options-zone">
          <div className="options-group">
            <span className="zone-label">Decompiler &amp; diff</span>
            <div className="row">
              <Select value={engine} onValueChange={(value) => void changeEngine(value as Engine)}>
                <SelectTrigger aria-label="Decompiler engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="cfr">CFR</SelectItem>
                    <SelectItem value="vineflower">Vineflower</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <label className="check-label">
                <Checkbox
                  checked={ignoreTrimWhitespace}
                  onCheckedChange={(checked) => setIgnoreTrimWhitespace(checked === true)}
                />
                Ignore trim whitespace
              </label>
            </div>
          </div>
        </div>
      </section>
      {dropHint && <p className="platform-hint">{dropHint}</p>}
      {mode === "compare" && <section className="save-settings">
        <label className="check-label">
          <Checkbox
            checked={backupEnabled}
            onCheckedChange={(checked) => setBackupEnabled(checked === true)}
          />
          Keep one overwritten .bak on save
        </label>
        <span>{stagedTarget ? `Pending copies target: ${stagedTarget}` : "No staged copies"}</span>
      </section>}
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
      <section className="workspace">
        <ResizablePanelGroup orientation="vertical" className="workspace-panels">
          <ResizablePanel defaultSize={44} minSize={25}>
            <div className="tree">
              {visiblePairs.map((pair) => (
                <ContextMenu key={pair.path}>
                  <ContextMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`tree-row ${pair.status} ${selected?.path === pair.path ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedSearchResult(undefined);
                        void inspect(pair);
                      }}
                      onContextMenu={() => {
                        setSelectedSearchResult(undefined);
                        setSelected(pair);
                      }}
                    >
                      <span>{pair.left ? pair.path : ""}</span>
                      <b>
                        <Badge variant="outline">{pair.status}</Badge>
                        {stagedEntries[pair.path] && <Badge variant="secondary">pending → {stagedEntries[pair.path]}</Badge>}
                      </b>
                      <span>{pair.right ? pair.path : ""}</span>
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      disabled={mode === "single" || !pair.right || pair.right.kind === "directory"}
                      onSelect={() => void copy("right", "left", pair)}
                    >
                      Copy to left
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={mode === "single" || !pair.left || pair.left.kind === "directory"}
                      onSelect={() => void copy("left", "right", pair)}
                    >
                      Copy to right
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={!stagedEntries[pair.path]}
                      onSelect={() => void unstage(pair.path)}
                    >
                      Unstage
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={56} minSize={30}>
            <DiffView
              mode={mode}
              selected={selected}
              preview={preview}
              viewMode={viewMode}
              ignoreTrimWhitespace={ignoreTrimWhitespace}
              onCopy={(from, to) => void copy(from, to)}
              onShowSource={() => selected && void inspect(selected)}
              onShowBytecode={showBytecode}
              onEditorMount={handleEditorMount}
              onDiffMount={handleDiffMount}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </section>
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
