import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "@/features/preferences/update-client";
import { onboardingKeyForMode } from "@/features/shell/OnboardingTour";

// ---------------------------------------------------------------------------
// Tauri / Monaco mocks.
//
// This suite proves the File↔File merge wiring the running app exercises by
// clicking: the "Take all" and "Move hunk" toolbar buttons must call the
// backend with the correct args, and Save must commit every dirty side. The
// real backend and the real Monaco DiffEditor cannot run in jsdom, so both are
// mocked. Mocked invoke commands hit by the open→compare→inspect→merge→save
// path: platform_hints, validate_path, open_archive, compute_diff, read_entry,
// stage_write, commit_merge. (clear_staged / prefetch_siblings are never
// reached here but resolve defensively.)
// ---------------------------------------------------------------------------

const FILE_ENTRY = {
  path: "config.json",
  kind: "text" as const,
  uncompressedSize: 8,
  compressedSize: 8,
  crc32: 3_582_281_688,
};

// Source kind the open_archive mock reports. Default "file" (plain-file compare);
// tests can flip to "archive" to exercise hunk-merge on entries inside a jar.
let summarySourceKind: "file" | "archive" = "file";
let deepSearchBlock: { promise: Promise<void> } | undefined;
let deepSearchError: Error | undefined;
let deferredAppActionListen: Promise<() => void> | undefined;
let appActionHandler: ((event: { payload: { actionId: string } }) => void) | undefined;
let osOpenPathsHandler: ((event: { payload: { paths: string[] } }) => void) | undefined;
let dragDropHandler: ((event: { payload: { type: string; paths: string[]; position: { x: number; y: number } } }) => void) | undefined;
let closeRequestHandler: ((event: { preventDefault(): void }) => void) | undefined;
const destroyWindow = vi.fn(async () => undefined);
const viewRootEntries: Record<string, string[]> = {
  "view:/tmp/alpha.jar": ["Alpha.class", "alpha.json", "alpha-two.json"],
  "view:/tmp/beta.jar": ["beta.json"],
  "view:/tmp/from-finder.jar": ["finder.json"],
};
function fileSummary(side: "left" | "right", path?: string) {
  return {
    path: path ?? (side === "left" ? "/tmp/config.json" : "/tmp/other/config.json"),
    metadata: { sourceKind: summarySourceKind, signed: false, multiRelease: false, zip64: false },
    entries: [FILE_ENTRY],
  };
}

function viewSummary(path: string) {
  const name = path.split("/").pop() ?? path;
  return {
    id: `view:${path}`,
    path,
    name,
    kind: "archive" as const,
    signed: false,
    entryCount: viewRootEntries[`view:${path}`]?.length ?? 1,
  };
}

const onePairDiff = {
  pairs: [
    {
      path: "config.json",
      status: "different" as const,
      left: FILE_ENTRY,
      right: FILE_ENTRY,
    },
  ],
};

const tempSession = {
  id: "temp-merge-1",
  targetSide: "right" as const,
  workingName: "lcdiff-working.jar",
  entryCount: 1,
  appliedSourceCount: 0,
  exportedPath: null as string | null,
};

function entryPreview(side: "left" | "right") {
  return {
    path: "config.json",
    kind: "text" as const,
    language: "json",
    details: null,
    content: side === "left" ? '{\n  "v": 1\n}\n' : '{\n  "v": 2\n}\n',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sourceMarker(path: string) {
  return `from-${(path.split("/").pop() ?? path).replace(/[^a-z0-9]+/gi, "-")}.txt`;
}

function sourceAwareDiff(path: string) {
  const marker = sourceMarker(path);
  const entry = { ...FILE_ENTRY, path: marker };
  return {
    pairs: [{ path: marker, status: "different" as const, left: entry, right: entry }],
  };
}

function installSourceAwareTempFixture(targetSide: "left" | "right" = "right") {
  const sourceSide = targetSide === "left" ? "right" : "left";
  const paths: Partial<Record<"left" | "right", string>> = {};
  const queuedDiffs: Array<Promise<typeof onePairDiff>> = [];
  let computeCount = 0;

  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "open_archive") {
      const side = args?.side as "left" | "right";
      const path = args?.path as string;
      paths[side] = path;
      return {
        path,
        metadata: { sourceKind: "archive" as const, signed: false, multiRelease: false, zip64: false },
        entries: [{ ...FILE_ENTRY, path: sourceMarker(path) }],
      };
    }
    if (cmd === "create_temp_target") {
      paths[targetSide] = tempSession.workingName;
      return { ...tempSession, targetSide };
    }
    if (cmd === "compute_diff") {
      computeCount += 1;
      const queued = queuedDiffs.shift();
      if (queued) return queued;
      return sourceAwareDiff(paths[sourceSide] ?? `/tmp/${sourceSide}-missing.jar`);
    }
    if (cmd === "read_entry") {
      const side = args?.side as "left" | "right";
      return { ...entryPreview(side), path: args?.entryPath as string };
    }
    if (cmd === "apply_temp_merge") {
      return { ...tempSession, targetSide, entryCount: 2, appliedSourceCount: 1 };
    }
    if (cmd === "save_temp_target_as") {
      return { ...tempSession, targetSide, exportedPath: args?.path as string };
    }
    if (cmd === "discard_temp_target") {
      delete paths[targetSide];
      return { kind: "discarded" as const };
    }
    return defaultInvoke(cmd, args);
  });

  return {
    computeCount: () => computeCount,
    deferNextDiff: (promise: Promise<typeof onePairDiff>) => queuedDiffs.push(promise),
  };
}

function entryKind(path: string) {
  return path.endsWith(".class") ? "class" as const : "text" as const;
}

const defaultInvoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case "platform_hints":
      return {
        os: "linux",
        sessionType: null as string | null,
        wayland: false,
        dropHint: null as string | null,
      };
    case "pending_open_paths":
      return [];
    case "list_system_fonts":
      return [
        { family: "Menlo", monospaceLikely: true, localNames: ["Menlo"], fontFile: null },
        {
          family: "Helvetica Neue",
          monospaceLikely: false,
          localNames: ["Helvetica Neue"],
          fontFile: null,
        },
      ];
    case "validate_path":
      return (args?.raw as string) ?? "/tmp/config.json";
    case "open_archive":
      return fileSummary(args?.side as "left" | "right", args?.path as string);
    case "open_compare_sources":
      return {
        left: fileSummary("left", args?.leftPath as string),
        right: fileSummary("right", args?.rightPath as string),
        diff: onePairDiff,
      };
    case "open_view_source":
      return viewSummary(args?.path as string);
    case "read_text_file": {
      const path = args?.path as string;
      return { path, content: `contents:${path}` };
    }
    case "list_view_sources":
      return [];
    case "compute_diff":
      return onePairDiff;
    case "compute_view_nested_entries": {
      const sourceId = args?.sourceId as string;
      const paths = viewRootEntries[sourceId] ?? ["config.json"];
      return {
        pairs: paths.map((path) => ({
          path,
          status: "onlyLeft" as const,
          left: { path, kind: entryKind(path) },
        })),
      };
    }
    case "read_entry":
      return entryPreview(args?.side as "left" | "right");
    case "create_temp_target":
      return tempSession;
    case "preview_merge_all_conflicts":
      return { newEntries: ["new.txt"], conflicts: ["config.json"] };
    case "stage_temp_merge_all":
      return undefined;
    case "apply_temp_merge":
      return { ...tempSession, entryCount: 2, appliedSourceCount: 1 };
    case "save_temp_target_as":
      return { ...tempSession, exportedPath: args?.path as string };
    case "discard_temp_target":
      return { kind: "discarded" as const };
    case "read_view_entry": {
      const entryPath = args?.entryPath as string;
      return {
        path: entryPath,
        kind: entryKind(entryPath),
        language: entryPath.endsWith(".class") ? "java" : "json",
        content: `${args?.sourceId}:${entryPath}`,
      };
    }
    case "disassemble_view_entry":
      return `bytecode:${args?.sourceId}:${args?.entryPath}`;
    case "search_view_source":
      return [
        { entryPath: "alpha.json", kind: "path" as const },
        { entryPath: "Alpha.class", kind: "constantPool" as const, preview: "Alpha" },
      ];
    case "search":
      return [
        { entryPath: "config.json", kind: "path" as const },
        { entryPath: "config.json", kind: "text" as const, line: 2, preview: '"v": 2' },
      ];
    case "deep_search":
      if (deepSearchBlock) await deepSearchBlock.promise;
      if (deepSearchError) throw deepSearchError;
      return [{ entryPath: "config.json", kind: "source" as const, line: 3, preview: "class Config" }];
    case "deep_search_view_source":
      if (deepSearchBlock) await deepSearchBlock.promise;
      if (deepSearchError) throw deepSearchError;
      return [{ entryPath: "Alpha.class", kind: "source" as const, line: 3, preview: "class Alpha" }];
    case "cancel_deep_search":
      return undefined;
    case "stage_write":
    case "stage_view_write":
    case "unstage_view_write":
    case "prefetch_siblings":
    case "clear_staged":
    case "close_view_source":
      return undefined;
    case "commit_merge":
    case "commit_view":
      return {
        rewrittenPath: "/tmp/config.json",
        backupPath: null,
        signatureInvalidated: false,
        copiedEntries: 1,
      };
    default:
      return undefined;
  }
};
const invoke = vi.fn(defaultInvoke);

// Deferred arrow: vi.mock factories are hoisted above the `invoke`/`chooseFile`
// declarations, so reference them lazily to avoid a TDZ error at mock time.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    (args === undefined ? invoke(cmd) : invoke(cmd, args)),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler: typeof dragDropHandler) => {
      dragDropHandler = handler;
      return vi.fn();
    }),
    onCloseRequested: vi.fn(async (handler: typeof closeRequestHandler) => {
      closeRequestHandler = handler;
      return vi.fn();
    }),
    destroy: destroyWindow,
  }),
}));
const listen = vi.fn((eventName: string, handler: unknown) => {
  if (eventName === "app-action") {
    appActionHandler = handler as typeof appActionHandler;
  }
  if (eventName === "os-open-paths") {
    osOpenPathsHandler = handler as typeof osOpenPathsHandler;
  }
  if (eventName === "app-action" && deferredAppActionListen) {
    return deferredAppActionListen;
  }
  return Promise.resolve(vi.fn());
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: unknown) => listen(eventName, handler),
}));

type OpenDialogOptions = {
  multiple?: boolean;
  directory?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
};

const FILE_PICKER_OPTIONS: OpenDialogOptions = {
  multiple: false,
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
};

const DIRECTORY_PICKER_OPTIONS: OpenDialogOptions = {
  multiple: false,
  directory: true,
};

// chooseFile (plugin-dialog `open`) returns a fixed path; openPath then drives
// validate_path + open_archive.
const chooseFile = vi.fn(async (_options?: OpenDialogOptions): Promise<string | null> => "/tmp/config.json");
const chooseSave = vi.fn(async (_options?: unknown): Promise<string | null> => "/tmp/merged.jar");
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options?: OpenDialogOptions) => chooseFile(options),
  save: (options?: unknown) => chooseSave(options),
}));

const updateClientMocks = vi.hoisted(() => {
  const releaseUrl = "https://github.com/lyokha113/lcdiff/releases/latest";
  const state: { current: AppUpdateState } = {
    current: {
      status: "upToDate",
      releaseUrl,
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      message: "You are up to date.",
    },
  };
  return {
    releaseUrl,
    state,
    checkForAppUpdate: vi.fn(async () => state.current),
    downloadAndInstallAppUpdate: vi.fn(async (updateState) => ({
      ...updateState,
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
    })),
    restartToApplyUpdate: vi.fn(async () => undefined),
    openUpdateFallback: vi.fn(async () => undefined),
  };
});

vi.mock("@/features/preferences/update-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/preferences/update-client")>();
  return {
    ...actual,
    checkForAppUpdate: updateClientMocks.checkForAppUpdate,
    downloadAndInstallAppUpdate: updateClientMocks.downloadAndInstallAppUpdate,
    restartToApplyUpdate: updateClientMocks.restartToApplyUpdate,
    openUpdateFallback: updateClientMocks.openUpdateFallback,
  };
});

// Mutable buffers so setValue is observable and moveHunk has real text to chew.
const LEFT_TEXT = '{\n  "v": 1\n}\n';
const RIGHT_TEXT = '{\n  "v": 2\n}\n';
const buffers = { left: LEFT_TEXT, right: RIGHT_TEXT };
const setOriginal = vi.fn((v: string) => { buffers.left = v; });
const setModified = vi.fn((v: string) => { buffers.right = v; });
const revealOriginal = vi.fn();
const revealModified = vi.fn();
let focusOriginalEditor: (() => void) | undefined;

// Line changes the fake diff editor reports. Default: a modification on line 2
// of both sides. Tests can override before render to exercise other hunk shapes
// (e.g. a right-only addition, where the left side reports endLineNumber 0).
const MODIFY_LINE_2 = {
  originalStartLineNumber: 2,
  originalEndLineNumber: 2,
  modifiedStartLineNumber: 2,
  modifiedEndLineNumber: 2,
};
let lineChanges: Array<Record<string, number>> = [MODIFY_LINE_2];
let diffEditorMounted = false;
let diffEditorProps: { original?: string; modified?: string; options?: { readOnly?: boolean; originalEditable?: boolean } } = {};
type DiffModelChangeEvent = { isFlush: boolean };
const diffModelChangeHandlers: Partial<
  Record<"left" | "right", (event: DiffModelChangeEvent) => void>
> = {};
type ViewEditorChangeEvent = { isFlush: boolean };
let viewEditorProps: {
  value?: string;
  onChange?: (value: string | undefined, event: ViewEditorChangeEvent) => void;
  options?: { ariaLabel?: string; readOnly?: boolean };
} = {};
function makeFakeDiffEditor() {
  // App's search-highlight effect calls deltaDecorations/revealLineInCenter on
  // each sub-editor whenever preview changes, so the fakes must expose them.
  const subEditor = (buf: "left" | "right", set: typeof setOriginal, reveal: typeof revealOriginal) => ({
    getValue: () => buffers[buf],
    setValue: set,
    onDidChangeModelContent: vi.fn((handler: (event: DiffModelChangeEvent) => void) => {
      diffModelChangeHandlers[buf] = handler;
      return {
        dispose: vi.fn(() => {
          if (diffModelChangeHandlers[buf] === handler) {
            delete diffModelChangeHandlers[buf];
          }
        }),
      };
    }),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onDidFocusEditorText: vi.fn((handler: () => void) => {
      if (buf === "left") focusOriginalEditor = handler;
      return { dispose: vi.fn() };
    }),
    setPosition: vi.fn(),
    getPosition: () => ({ lineNumber: 2 }),
    getModel: () => ({
      getLineCount: () => buffers[buf].split("\n").length,
      findMatches: vi.fn(() => [
        { range: { startLineNumber: 2 } },
      ]),
    }),
    deltaDecorations: vi.fn(() => []),
    revealLineInCenter: reveal,
  });
  const original = subEditor("left", setOriginal, revealOriginal);
  const modified = subEditor("right", setModified, revealModified);
  return {
    getOriginalEditor: () => original,
    getModifiedEditor: () => modified,
    getLineChanges: () => lineChanges,
    onDidUpdateDiff: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    setModel: vi.fn(),
  };
}

// App imports the workspace Monaco runtime purely for side effects; it pulls
// in `monaco-editor` and `?worker` modules vitest cannot resolve. Stub it.
vi.mock("@/features/workspace/monaco-runtime", () => ({}));

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: (props: typeof viewEditorProps) => {
    viewEditorProps = props;
    return (
      <textarea
        data-testid="editor"
        aria-label={props.options?.ariaLabel}
        readOnly={props.options?.readOnly}
        value={props.value}
        onChange={(event) => props.onChange?.(event.target.value, { isFlush: false })}
      />
    );
  },
  // DiffEditor fires onMount with a fake editor + monaco on render so App's
  // handleDiffMount captures it into diffEditorRef.
  DiffEditor: (props: {
    onMount?: (e: unknown, m: unknown) => void;
    original?: string;
    modified?: string;
    options?: { readOnly?: boolean; originalEditable?: boolean };
  }) => {
    diffEditorProps = props;
    if (!diffEditorMounted) {
      diffEditorMounted = true;
      queueMicrotask(() => props.onMount?.(makeFakeDiffEditor(), {}));
    }
    return (
      <div className="monaco-editor" data-testid="diff-editor">
        <span data-testid="diff-editor-cell" />
        <span data-testid="diff-original">{props.original}</span>
        <span data-testid="diff-modified">{props.modified}</span>
      </div>
    );
  },
}));

// App must be imported AFTER the mocks are registered.
import { App } from "./App";

function cmdOrCtrl(overrides: KeyboardEventInit = {}): KeyboardEventInit {
  const mac = navigator.platform.toLowerCase().includes("mac");
  return {
    metaKey: mac,
    ctrlKey: !mac,
    ...overrides,
  };
}

async function driveIntoFileCompare(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  // Splash → Compare workspace.
  await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
  await user.click(screen.getByLabelText("Toggle search"));

  // Open the left source via its repick popover → Browse file.
  await user.click(screen.getByLabelText("Change left source"));
  await user.click(await screen.findByText("Browse file"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_archive", { path: "/tmp/config.json", side: "left" }));

  // Open the right source the same way.
  await user.click(screen.getByLabelText("Change right source"));
  await user.click(await screen.findByText("Browse file"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_archive", { path: "/tmp/config.json", side: "right" }));

  // Inspect the lone pair so `selected` is set and read_entry populates preview.
  // Paired entries render once per side in the two-pane tree (and again in the
  // column header labels); click the actual file row, not a header label.
  const cells = await screen.findAllByText("config.json");
  const row = cells.find((el) => el.closest("button.tree-file"))!;
  await user.click(row);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("read_entry", { side: "left", entryPath: "config.json" }));
}

async function openCompareWorkspace(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
}

async function openLeftAndCreateRightTemp(user: ReturnType<typeof userEvent.setup>) {
  await openCompareWorkspace(user);
  await user.click(screen.getByLabelText("Change left source"));
  await user.click(await screen.findByText("Browse file"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith(
    "open_archive",
    { path: "/tmp/config.json", side: "left" },
  ));

  await user.click(screen.getByLabelText("Change right source"));
  await user.click(await screen.findByRole("button", { name: "Create temp target..." }));
  await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
  await user.click(await screen.findByRole("option", { name: "Copy current source" }));
  await user.click(screen.getByRole("button", { name: "Create temp target" }));

  await waitFor(() => expect(invoke).toHaveBeenCalledWith(
    "create_temp_target",
    { sourceSide: "left", creation: { kind: "copyCurrent" } },
  ));
  expect(await screen.findByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
}

async function switchMode(mode: "View" | "Compare" | "Text") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `${mode} mode` }));
}

async function browseViewSource(user: ReturnType<typeof userEvent.setup>) {
  let browseButton = screen.queryByRole("button", { name: /Browse file/i });
  if (!browseButton) {
    await user.click(screen.getByLabelText("Change left source"));
    browseButton = await screen.findByRole("button", { name: /Browse file/i });
  }
  await user.click(browseButton);
}

async function clickBrowseFileForSide(
  user: ReturnType<typeof userEvent.setup>,
  side: "left" | "right",
) {
  const label = `${side === "left" ? "Left" : "Right"} File/Folder path`;
  let input = screen.queryByLabelText(label);
  if (!input) {
    await user.click(screen.getByLabelText(`Change ${side} source`));
    input = await screen.findByLabelText(label);
  }
  const picker = input.closest(".source-picker");
  if (!(picker instanceof HTMLElement)) throw new Error(`No ${side} source picker is available`);
  await user.click(within(picker).getByRole("button", { name: /Browse file/i }));
}

describe("App file-merge wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation(defaultInvoke);
    chooseFile.mockReset();
    chooseFile.mockImplementation(async () => "/tmp/config.json");
    chooseSave.mockReset();
    chooseSave.mockImplementation(async () => "/tmp/merged.jar");
    destroyWindow.mockClear();
    setOriginal.mockClear();
    setModified.mockClear();
    revealOriginal.mockClear();
    revealModified.mockClear();
    focusOriginalEditor = undefined;
    diffEditorProps = {};
    viewEditorProps = {};
    delete diffModelChangeHandlers.left;
    delete diffModelChangeHandlers.right;
    buffers.left = LEFT_TEXT;
    buffers.right = RIGHT_TEXT;
    lineChanges = [MODIFY_LINE_2];
    diffEditorMounted = false;
    summarySourceKind = "file";
    deepSearchBlock = undefined;
    deepSearchError = undefined;
    updateClientMocks.state.current = {
      status: "upToDate",
      releaseUrl: updateClientMocks.releaseUrl,
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      message: "You are up to date.",
    };
    updateClientMocks.checkForAppUpdate.mockClear();
    updateClientMocks.downloadAndInstallAppUpdate.mockClear();
    updateClientMocks.restartToApplyUpdate.mockClear();
    updateClientMocks.openUpdateFallback.mockClear();
    deferredAppActionListen = undefined;
    appActionHandler = undefined;
    osOpenPathsHandler = undefined;
    dragDropHandler = undefined;
    closeRequestHandler = undefined;
    listen.mockClear();
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      writable: true,
      value: () => false,
    });
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    localStorage.clear();
    for (const mode of ["single", "compare", "text"] as const) {
      localStorage.setItem(onboardingKeyForMode(mode), "seen");
    }
  });

  it("shows the Wayland hint as a dismissible temporary notice", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "platform_hints") {
        return Promise.resolve({
          os: "linux",
          sessionType: "wayland",
          wayland: true,
          dropHint: "Wayland drop hint",
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    const hint = await screen.findByText("Wayland drop hint");
    expect(hint.closest("[role=status]")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss platform notice" }));

    expect(screen.queryByText("Wayland drop hint")).not.toBeInTheDocument();
  });

  it("offers the LCFiBe-style tour on first launch and remembers dismissal", async () => {
    localStorage.removeItem(onboardingKeyForMode("compare"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(await screen.findByRole("dialog", { name: "Choose the right workspace" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Workspace mode" })).toHaveAttribute("data-tour-active", "true");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Load files and folders" })).toBeInTheDocument();
    expect(document.querySelector("[data-tour=source-open]")).toHaveAttribute("data-tour-active", "true");
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.queryByRole("dialog", { name: "Load files and folders" })).not.toBeInTheDocument();
    expect(localStorage.getItem(onboardingKeyForMode("compare"))).toBe("seen");
  });

  it("tracks first-run tour completion independently for each workspace mode", async () => {
    localStorage.removeItem(onboardingKeyForMode("text"));
    localStorage.removeItem(onboardingKeyForMode("single"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    expect(screen.queryByRole("dialog", { name: "Choose the right workspace" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text mode" }));
    expect(await screen.findByRole("dialog", { name: "Choose the right workspace" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await user.click(screen.getByRole("button", { name: "Compare mode" }));
    expect(screen.queryByRole("dialog", { name: "Choose the right workspace" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View mode" }));
    expect(await screen.findByRole("dialog", { name: "Choose the right workspace" })).toBeInTheDocument();
  });

  it("keeps onboarding non-blocking when localStorage reads are unavailable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });

    expect(() => render(<App />)).not.toThrow();
    getItem.mockRestore();
  });

  it("closes onboarding when localStorage writes are unavailable", async () => {
    localStorage.removeItem(onboardingKeyForMode("compare"));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    expect(await screen.findByRole("dialog", { name: "Choose the right workspace" })).toBeInTheDocument();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(screen.queryByRole("dialog", { name: "Choose the right workspace" })).not.toBeInTheDocument();
    setItem.mockRestore();
  });

  it("skips tour topics that are unavailable in the current workspace", async () => {
    localStorage.removeItem(onboardingKeyForMode("text"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Text mode" }));
    await user.click(await screen.findByRole("button", { name: "Next" }));

    expect(screen.getByRole("dialog", { name: "Read the useful representation" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Load files and folders" })).not.toBeInTheDocument();
  });

  it("resets a late tour step when switching modes instead of closing on Next", async () => {
    localStorage.removeItem(onboardingKeyForMode("compare"));
    localStorage.removeItem(onboardingKeyForMode("text"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    for (let step = 0; step < 9; step += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text mode" }));
    expect(await screen.findByRole("dialog", { name: "Choose the right workspace" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("dialog", { name: "Read the useful representation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  });

  it("renders a landmark-based comparison workspace", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Open files" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Workspace canvas" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("auto-checks for updates after leaving the splash when enabled", async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Preferences"));

    await waitFor(() => expect(updateClientMocks.checkForAppUpdate).toHaveBeenCalledWith("auto"));
    expect(updateClientMocks.checkForAppUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("You are up to date.")).not.toBeInTheDocument();
  });

  it("shows available update prompt from auto-check", async () => {
    const user = userEvent.setup();
    updateClientMocks.state.current = {
      status: "available",
      releaseUrl: updateClientMocks.releaseUrl,
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      latestVersion: "0.3.5",
      message: "LCDiff v0.3.5 is available.",
    } as AppUpdateState;

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(await screen.findByText("LCDiff v0.3.5 is available.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download and install" }));

    await waitFor(() => expect(updateClientMocks.downloadAndInstallAppUpdate).toHaveBeenCalledOnce());
    expect(updateClientMocks.downloadAndInstallAppUpdate.mock.calls[0]?.[0].status).toBe("available");
    expect(await screen.findAllByText("Update downloaded. Restart to finish.")).not.toHaveLength(0);
  });

  it("keeps update feedback visible while downloading", async () => {
    const user = userEvent.setup();
    let resolveDownload!: (state: AppUpdateState) => void;
    updateClientMocks.state.current = {
      status: "available",
      releaseUrl: updateClientMocks.releaseUrl,
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      latestVersion: "0.3.5",
      message: "LCDiff v0.3.5 is available.",
    } as AppUpdateState;
    updateClientMocks.downloadAndInstallAppUpdate.mockImplementationOnce(
      () => new Promise<AppUpdateState>((resolve) => {
        resolveDownload = resolve;
      }),
    );

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(await screen.findByRole("button", { name: "Download and install" }));

    const downloadingButton = await screen.findByRole("button", { name: "Downloading..." });
    expect(downloadingButton).toBeDisabled();

    resolveDownload({
      ...updateClientMocks.state.current,
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
    });
    expect(await screen.findAllByText("Update downloaded. Restart to finish.")).not.toHaveLength(0);
  });

  it("keeps the update release fallback actionable when install fails", async () => {
    const user = userEvent.setup();
    updateClientMocks.state.current = {
      status: "available",
      releaseUrl: updateClientMocks.releaseUrl,
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      latestVersion: "0.3.5",
      message: "LCDiff v0.3.5 is available.",
    } as AppUpdateState;
    updateClientMocks.downloadAndInstallAppUpdate.mockImplementationOnce(async (state: AppUpdateState) => ({
      ...state,
      status: "fallback",
      message: "Could not install the update.",
    }));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(await screen.findByRole("button", { name: "Download and install" }));

    expect(await screen.findAllByText("Could not install the update.")).not.toHaveLength(0);
    const releaseButton = screen.getByRole("button", { name: "Open release page" });
    expect(releaseButton).toBeEnabled();
    await user.click(releaseButton);
    expect(updateClientMocks.openUpdateFallback).toHaveBeenCalledOnce();
  });

  it("runs manual update check from Preferences", async () => {
    const user = userEvent.setup();
    updateClientMocks.state.current = {
      status: "fallback",
      releaseUrl: updateClientMocks.releaseUrl,
      source: "manual",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      message: "Could not check for updates.",
    } as AppUpdateState;

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Preferences"));
    await user.click(screen.getByRole("button", { name: "Misc" }));
    await user.click(screen.getByRole("button", { name: "Updates" }));
    updateClientMocks.checkForAppUpdate.mockClear();

    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => expect(updateClientMocks.checkForAppUpdate).toHaveBeenCalledWith("manual"));
    expect(await screen.findAllByText("Could not check for updates.")).not.toHaveLength(0);
    await user.click(screen.getAllByRole("button", { name: "Open release page" })[0]);
    expect(updateClientMocks.openUpdateFallback).toHaveBeenCalledOnce();
  });

  it("opens Free text with draft editors and no diff result until confirm", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Text mode" }));

    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
    expect(screen.getByRole("main", { name: "Free text workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Left File/Folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Open files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tree expansion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Diff block navigation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending changes")).not.toBeInTheDocument();
    expect(screen.getByText("Confirm a comparison to create a temporary diff result.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Left free text input"), "left pasted text");
    await user.type(screen.getByLabelText("Right free text input"), "right typed text");

    expect(screen.queryByTestId("diff-original")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(await screen.findByTestId("diff-original")).toHaveTextContent("left pasted text");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("right typed text");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_write")).toBe(false);
  });

  it("preserves Free text drafts and selected history result across mode switches", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Text mode" }));

    await user.type(screen.getByLabelText("Left free text input"), "old");
    await user.type(screen.getByLabelText("Right free text input"), "first right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.clear(screen.getByLabelText("Left free text input"));
    await user.clear(screen.getByLabelText("Right free text input"));
    await user.type(screen.getByLabelText("Left free text input"), "newer left");
    await user.type(screen.getByLabelText("Right free text input"), "newer right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.click(screen.getAllByRole("button", { name: /characters/ })[1]);

    await switchMode("Compare");
    await switchMode("Text");

    expect(screen.getByLabelText("Left free text input")).toHaveValue("newer left");
    expect(screen.getByLabelText("Right free text input")).toHaveValue("newer right");
    expect(screen.getByTestId("diff-original")).toHaveTextContent("old");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("first right");
  });

  it("preserves independent Compare, View, and Free text workspaces through a full mode cycle", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/left.jar")
      .mockResolvedValueOnce("/tmp/right.jar")
      .mockResolvedValueOnce("/tmp/alpha.jar");
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "open_archive") {
        return Promise.resolve({
          ...fileSummary(args?.side as "left" | "right"),
          path: args?.path as string,
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Change left source"));
    await user.click(await screen.findByText("Browse file"));
    await user.click(screen.getByLabelText("Change right source"));
    await user.click(await screen.findByText("Browse file"));
    const compareCells = await screen.findAllByText("config.json");
    await user.click(compareCells.find((cell) => cell.closest("button.tree-file"))!);
    expect(await screen.findByRole("tab", { name: /config\.json/ })).toBeInTheDocument();

    await switchMode("View");
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    expect(await screen.findByRole("tab", { name: /alpha\.json/ })).toBeInTheDocument();

    await switchMode("Text");
    await user.type(screen.getByLabelText("Left free text input"), "left draft");
    await user.type(screen.getByLabelText("Right free text input"), "right draft");

    await switchMode("Compare");
    expect(screen.getAllByText(/left\.jar/).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /config\.json/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("diff-original")).toHaveTextContent('"v": 1');

    await switchMode("View");
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /alpha\.json/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("editor")).toHaveValue("view:/tmp/alpha.jar:alpha.json");

    await switchMode("Text");
    expect(screen.getByLabelText("Left free text input")).toHaveValue("left draft");
    expect(screen.getByLabelText("Right free text input")).toHaveValue("right draft");
  });

  it("preserves manually expanded Compare folders across a mode cycle", async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "manual/child.json",
              status: "different" as const,
              left: { ...FILE_ENTRY, path: "manual/child.json" },
              right: { ...FILE_ENTRY, path: "manual/child.json" },
            },
          ],
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.click(screen.getAllByText("manual")[0].closest("button")!);
    expect(screen.getAllByText("child.json")).toHaveLength(2);

    await switchMode("Text");
    await switchMode("Compare");

    expect(screen.getAllByText("child.json")).toHaveLength(2);
    expect(screen.getAllByText("manual")[0].closest("button"))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("preserves Expand-all per mode without expanding the other mode", async () => {
    chooseFile
      .mockResolvedValueOnce("/tmp/config.json")
      .mockResolvedValueOnce("/tmp/config.json")
      .mockResolvedValueOnce("/tmp/alpha.jar");
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "compare-only/child.json",
              status: "different" as const,
              left: { ...FILE_ENTRY, path: "compare-only/child.json" },
              right: { ...FILE_ENTRY, path: "compare-only/child.json" },
            },
          ],
        });
      }
      if (
        cmd === "compute_view_nested_entries" &&
        args?.nestedPath === ""
      ) {
        return Promise.resolve({
          pairs: [{
            path: "view-only/entry.json",
            status: "onlyLeft" as const,
            left: { path: "view-only/entry.json", kind: "text" as const },
          }],
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.click(screen.getByRole("button", { name: "Expand all folders" }));
    expect(screen.getAllByText("child.json")).toHaveLength(2);

    await switchMode("View");
    await browseViewSource(user);
    expect(screen.queryByText("entry.json")).not.toBeInTheDocument();

    await switchMode("Compare");
    expect(screen.getAllByText("child.json")).toHaveLength(2);
    await switchMode("View");
    expect(screen.queryByText("entry.json")).not.toBeInTheDocument();
  });

  it("ignores a pending Compare preview after switching to Free text", async () => {
    let resolveLeftPreview:
      | ((preview: ReturnType<typeof entryPreview>) => void)
      | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "read_entry" && args?.side === "left") {
        return new Promise((resolve) => {
          resolveLeftPreview = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await switchMode("Text");
    await act(async () => {
      resolveLeftPreview?.({
        ...entryPreview("left"),
        content: "late Compare preview",
      });
      await Promise.resolve();
    });
    await switchMode("Compare");

    expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();
    expect(screen.queryByText("late Compare preview")).not.toBeInTheDocument();
  });

  it("ignores a pending Compare preview after switching to View", async () => {
    let resolveLeftPreview:
      | ((preview: ReturnType<typeof entryPreview>) => void)
      | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "read_entry" && args?.side === "left") {
        return new Promise((resolve) => {
          resolveLeftPreview = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await switchMode("View");
    await act(async () => {
      resolveLeftPreview?.({
        ...entryPreview("left"),
        content: "late Compare preview",
      });
      await Promise.resolve();
    });
    await switchMode("Compare");

    expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();
    expect(screen.queryByText("late Compare preview")).not.toBeInTheDocument();
  });

  it("keeps retained Compare sources inert while Free text is active", async () => {
    summarySourceKind = "archive";
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await switchMode("Text");
    const refresh = screen.getByRole("button", { name: "Refresh sources" });
    expect(refresh).toBeDisabled();
    invoke.mockClear();

    fireEvent.keyDown(window, { key: "r", ...cmdOrCtrl() });

    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "compute_diff")).toBe(false);
  });

  it("keeps Free text tab shortcuts inert without closing retained Compare tabs", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await switchMode("Text");
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    fireEvent.keyDown(window, { key: "w", ...cmdOrCtrl() });
    await switchMode("Compare");

    expect(screen.getByRole("tab", { name: /config\.json/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("diff-original")).toHaveTextContent('"v": 1');
  });

  it("closes Compare search and makes search inert when switching to Free text", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Toggle search"));
    expect(screen.getByRole("complementary", { name: "Search workspace" })).toBeInTheDocument();

    await switchMode("Text");

    expect(screen.getByRole("main", { name: "Free text workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Search workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle search")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "f", ...cmdOrCtrl() });

    expect(screen.queryByRole("complementary", { name: "Search workspace" })).not.toBeInTheDocument();
    expect(screen.getByText("Search is not available in Free text mode.")).toBeInTheDocument();
  });

  it("closes View search when switching to Free text", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await user.click(screen.getByLabelText("Toggle search"));
    expect(screen.getByRole("complementary", { name: "Search workspace" })).toBeInTheDocument();

    await switchMode("Text");

    expect(screen.getByRole("main", { name: "Free text workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Search workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle search")).not.toBeInTheDocument();
  });

  it("opens exactly two dropped Compare sources through the atomic pair command", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/left.jar", "/tmp/right.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    expect(invoke).toHaveBeenCalledWith("open_compare_sources", {
      leftPath: "/tmp/left.jar",
      rightPath: "/tmp/right.jar",
    });
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
  });

  it("preserves Compare sources when the atomic dropped pair fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/existing.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Change left source" })).toHaveTextContent("existing.jar"),
    );

    invoke.mockClear();
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "open_compare_sources") throw new Error("pair failed");
      return defaultInvoke(cmd, args);
    });
    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/new-left.jar", "/tmp/new-right.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    await waitFor(() => expect(screen.getByText("Error: pair failed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Change left source" })).toHaveTextContent("existing.jar");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
  });

  it("confirms before replacing open Compare diffs with a dropped pair", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Change left source"));
    await user.click(await screen.findByText("Browse file"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/config.json", side: "left" },
    ));
    await user.click(screen.getByLabelText("Change right source"));
    await user.click(await screen.findByText("Browse file"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/config.json", side: "right" },
    ));
    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    invoke.mockClear();
    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/new-left.jar", "/tmp/new-right.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    expect(await screen.findByRole("dialog", { name: "Close open diffs?" })).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_compare_sources")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Open anyway" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_compare_sources", {
      leftPath: "/tmp/new-left.jar",
      rightPath: "/tmp/new-right.jar",
    }));
  });

  it("routes one dropped Compare source by position and rejects larger drops", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/right.jar"],
          position: { x: window.innerWidth, y: 10 },
        },
      });
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_archive", { path: "/tmp/right.jar", side: "right" }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("compute_diff"));

    invoke.mockClear();
    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/one.jar", "/tmp/two.jar", "/tmp/three.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens dropped View sources sequentially and reports partial failures", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "open_view_source" && args?.path === "/tmp/b.jar") {
        throw new Error("unreadable");
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open View mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/a.jar", "/tmp/b.jar", "/tmp/c.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByText(
        "2 opened, 1 failed — /tmp/b.jar: Error: unreadable",
      )).toBeInTheDocument(),
    );
    expect(
      invoke.mock.calls
        .filter(([cmd]) => cmd === "open_view_source")
        .map(([, args]) => args),
    ).toEqual([
      { path: "/tmp/a.jar" },
      { path: "/tmp/b.jar" },
      { path: "/tmp/c.jar" },
    ]);
    expect(screen.getByRole("tab", { name: /a\.jar/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /c\.jar/ })).toBeInTheDocument();
  });

  it("reports a blocked View drop without counting a staged edit as opened", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    fireEvent.change(await screen.findByTestId("editor"), {
      target: { value: "staged View edit" },
    });
    expect(await screen.findByText("1 pending")).toBeInTheDocument();
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    invoke.mockClear();
    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/blocked.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });

    expect(await screen.findByText(
      "0 opened, 0 failed, 1 blocked — /tmp/blocked.jar: Save or clear unsaved changes before opening another View source.",
    )).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_view_source")).toBe(false);
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument();
  });

  it("stops a cancelled View drop instead of opening its remaining paths", async () => {
    let resolveFirstOpen: ((value: ReturnType<typeof viewSummary>) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "open_view_source" && args?.path === "/tmp/slow-a.jar") {
        return new Promise((resolve) => {
          resolveFirstOpen = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open View mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/slow-a.jar", "/tmp/never-open.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() => expect(resolveFirstOpen).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/newest-b.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() => expect(screen.getByText("1 opened, 0 failed")).toBeInTheDocument());

    await act(async () => {
      resolveFirstOpen?.(viewSummary("/tmp/slow-a.jar"));
    });

    await waitFor(() =>
      expect(invoke.mock.calls.some(([, args]) => args?.path === "/tmp/never-open.jar")).toBe(false),
    );
    expect(screen.getByRole("tab", { name: /newest-b\.jar/ })).toBeInTheDocument();
    expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument();
  });

  it("does not let a cancelled View drop overwrite a newer OS-open result", async () => {
    let resolveFirstOpen: ((value: ReturnType<typeof viewSummary>) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "open_view_source" && args?.path === "/tmp/slow-drop.jar") {
        return new Promise((resolve) => {
          resolveFirstOpen = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open View mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());
    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/slow-drop.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() => expect(resolveFirstOpen).toBeDefined());

    act(() => osOpenPathsHandler?.({ payload: { paths: ["/tmp/from-os.jar"] } }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_view_source",
      { path: "/tmp/from-os.jar" },
    ));
    await waitFor(() => expect(screen.getByText("Opened /tmp/from-os.jar")).toBeInTheDocument());

    await act(async () => {
      resolveFirstOpen?.(viewSummary("/tmp/slow-drop.jar"));
    });

    await waitFor(() => expect(screen.getByText("Opened /tmp/from-os.jar")).toBeInTheDocument());
    expect(screen.queryByText("0 opened, 0 failed")).not.toBeInTheDocument();
  });

  it("does not let a cancelled View drop overwrite Free text mode", async () => {
    let resolveFirstOpen: ((value: ReturnType<typeof viewSummary>) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "open_view_source" && args?.path === "/tmp/slow-drop.jar") {
        return new Promise((resolve) => {
          resolveFirstOpen = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/slow-drop.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() => expect(resolveFirstOpen).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Text mode" }));
    expect(screen.getByText("Free text is ready. Edit both sides, then compare when you want a result.")).toBeInTheDocument();

    await act(async () => {
      resolveFirstOpen?.(viewSummary("/tmp/slow-drop.jar"));
    });

    expect(screen.queryByText("0 opened, 0 failed")).not.toBeInTheDocument();
  });

  it("does not let a cancelled View drop overwrite Compare mode", async () => {
    let resolveFirstOpen: ((value: ReturnType<typeof viewSummary>) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "open_view_source" && args?.path === "/tmp/slow-drop.jar") {
        return new Promise((resolve) => {
          resolveFirstOpen = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/slow-drop.jar"],
          position: { x: 10, y: 10 },
        },
      });
    });
    await waitFor(() => expect(resolveFirstOpen).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Compare mode" }));
    expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();

    await act(async () => {
      resolveFirstOpen?.(viewSummary("/tmp/slow-drop.jar"));
    });

    expect(screen.queryByText("0 opened, 0 failed")).not.toBeInTheDocument();
  });

  it("loads one dropped text file into its positioned Free text draft", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Text mode" }));
    await waitFor(() => expect(appActionHandler).toBeDefined());
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    invoke.mockClear();

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/dropped.txt"],
          position: { x: window.innerWidth, y: 10 },
        },
      });
    });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_text_file", { path: "/tmp/dropped.txt" }),
    );
    expect(screen.getByLabelText("Left free text input")).toHaveValue("");
    expect(screen.getByLabelText("Right free text input")).toHaveValue("contents:/tmp/dropped.txt");
  });

  it("publishes two dropped text files atomically and preserves drafts when either read fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Text mode" }));
    await user.type(screen.getByLabelText("Left free text input"), "kept left");
    await user.type(screen.getByLabelText("Right free text input"), "kept right");
    await waitFor(() => expect(dragDropHandler).toBeDefined());

    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/left.txt", "/tmp/right.txt"],
          position: { x: 10, y: 10 },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Left free text input")).toHaveValue("contents:/tmp/left.txt"),
    );
    expect(screen.getByLabelText("Right free text input")).toHaveValue("contents:/tmp/right.txt");

    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "read_text_file" && args?.path === "/tmp/fail.txt") {
        throw new Error("invalid UTF-8");
      }
      return defaultInvoke(cmd, args);
    });
    await act(async () => {
      dragDropHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/replace-left.txt", "/tmp/fail.txt"],
          position: { x: 10, y: 10 },
        },
      });
    });

    await waitFor(() =>
      expect(screen.getByText(
        "Unable to load dropped text files: Error: /tmp/fail.txt: invalid UTF-8",
      )).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Left free text input")).toHaveValue("contents:/tmp/left.txt");
    expect(screen.getByLabelText("Right free text input")).toHaveValue("contents:/tmp/right.txt");
  });

  it("opens OS-launched files through the View workspace", async () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    render(<App />);

    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());
    act(() => osOpenPathsHandler?.({ payload: { paths: ["/tmp/from-finder.jar"] } }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_view_source", { path: "/tmp/from-finder.jar" }),
    );
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
    expect(screen.getByRole("main", { name: "Source workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "File/Folder" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Right File/Folder" })).not.toBeInTheDocument();
  });

  it("preserves the Compare workspace when an OS-open activates View", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());

    act(() => {
      osOpenPathsHandler?.({ payload: { paths: ["/tmp/alpha.jar"] } });
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument(),
    );

    await switchMode("Compare");

    expect(screen.getByRole("tab", { name: /config\.json/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("diff-original")).toHaveTextContent('"v": 1');
  });

  it("invalidates a pending Compare preview before OS-open validation resolves", async () => {
    let resolveLeftPreview:
      | ((preview: ReturnType<typeof entryPreview>) => void)
      | undefined;
    let resolveOsValidation: ((path: string) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "read_entry" && args?.side === "left") {
        return new Promise((resolve) => {
          resolveLeftPreview = resolve;
        });
      }
      if (cmd === "validate_path" && args?.raw === "/tmp/from-finder.jar") {
        return new Promise((resolve) => {
          resolveOsValidation = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());

    act(() => {
      osOpenPathsHandler?.({ payload: { paths: ["/tmp/from-finder.jar"] } });
    });
    await waitFor(() => expect(resolveOsValidation).toBeDefined());
    await act(async () => {
      resolveLeftPreview?.({
        ...entryPreview("left"),
        content: "late Compare preview during OS validation",
      });
      await Promise.resolve();
    });
    await act(async () => {
      resolveOsValidation?.("/tmp/from-finder.jar");
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /from-finder\.jar/ })).toBeInTheDocument(),
    );

    await switchMode("Compare");

    expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();
    expect(screen.queryByText("late Compare preview during OS validation"))
      .not.toBeInTheDocument();
  });

  it("ignores OS-launched files while Free text is active", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Text mode" }));
    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());

    invoke.mockClear();
    act(() => osOpenPathsHandler?.({ payload: { paths: ["/tmp/from-finder.jar"] } }));

    expect(invoke.mock.calls.some(([cmd]) => cmd === "validate_path")).toBe(false);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_view_source")).toBe(false);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
    expect(screen.getByRole("main", { name: "Free text workspace" })).toBeInTheDocument();
  });

  it("opens multiple View sources and switches the active source tree", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_view_source", { path: "/tmp/alpha.jar" }),
    );
    expect(await screen.findByText("alpha.json")).toBeInTheDocument();

    await browseViewSource(user);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_view_source", { path: "/tmp/beta.jar" }),
    );

    expect(screen.getByRole("navigation", { name: "View sources" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("alpha.json")).not.toBeInTheDocument();
    expect(screen.getByText("beta.json")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /alpha\.jar/ }));
    expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("alpha.json")).toBeInTheDocument();
    expect(screen.queryByText("beta.json")).not.toBeInTheDocument();
  });

  it("opens View entry tabs per source using read_view_entry", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_view_entry", {
        sourceId: "view:/tmp/alpha.jar",
        entryPath: "alpha.json",
      }),
    );
    expect(screen.getByRole("tab", { name: /alpha\.json/ })).toBeInTheDocument();

    await browseViewSource(user);
    expect(screen.queryByRole("tab", { name: /alpha\.json/ })).not.toBeInTheDocument();

    await user.click(await screen.findByText("beta.json"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_view_entry", {
        sourceId: "view:/tmp/beta.jar",
        entryPath: "beta.json",
      }),
    );
    expect(screen.getByRole("tab", { name: /beta\.json/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /alpha\.json/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /alpha\.jar/ }));
    expect(screen.getByRole("tab", { name: /alpha\.json/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /beta\.json/ })).not.toBeInTheDocument();
  });

  it("keeps the active View tree visible beside inspected entry content", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));

    expect(await screen.findByRole("tab", { name: /alpha\.json/ })).toBeInTheDocument();
    expect(screen.getAllByText("alpha.json")).toHaveLength(2);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("opens editable View text entries in a writable editor", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));

    expect(await screen.findByTestId("editor")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("group", { name: "Save changes" })).toBeInTheDocument();
  });

  it("does not stage a View write when Monaco flushes the old model during a source switch", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const lateOnChange = viewEditorProps.onChange;
    const unchangedContent = viewEditorProps.value;

    await browseViewSource(user);
    await user.click(await screen.findByText("beta.json"));
    expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true");
    invoke.mockClear();

    await act(async () => {
      lateOnChange?.(unchangedContent, { isFlush: true });
      await Promise.resolve();
    });

    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_view_write")).toBe(false);
    expect(screen.queryByText("1 pending")).not.toBeInTheDocument();
  });

  it("ignores a late unchanged View callback after its source is no longer active", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const lateOnChange = viewEditorProps.onChange;
    const unchangedContent = viewEditorProps.value;

    await browseViewSource(user);
    await user.click(await screen.findByText("beta.json"));
    expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("editor")).toHaveValue("view:/tmp/beta.jar:beta.json");
    invoke.mockClear();

    await act(async () => {
      lateOnChange?.(unchangedContent, { isFlush: false });
      await Promise.resolve();
    });

    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_view_write")).toBe(false);
    expect(screen.queryByText("1 pending")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor")).toHaveValue("view:/tmp/beta.jar:beta.json");
  });

  it("does not stage a stale View edit callback for another entry in the active source", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const staleOnChange = viewEditorProps.onChange;
    const staleContent = viewEditorProps.value;

    await user.click(await screen.findByText("alpha-two.json"));
    expect(await screen.findByTestId("editor"))
      .toHaveValue("view:/tmp/alpha.jar:alpha-two.json");
    invoke.mockClear();

    await act(async () => {
      staleOnChange?.(staleContent, { isFlush: false });
      await Promise.resolve();
    });

    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_view_write")).toBe(false);
    expect(screen.queryByText("1 pending")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor"))
      .toHaveValue("view:/tmp/alpha.jar:alpha-two.json");
  });

  it("does not let a stale callback unstage legitimate work from another View entry", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    fireEvent.change(await screen.findByTestId("editor"), {
      target: { value: "legitimate alpha edit" },
    });
    expect(await screen.findByText("1 pending")).toBeInTheDocument();
    const staleOnChange = viewEditorProps.onChange;

    await user.click(await screen.findByText("alpha-two.json"));
    const currentContent = viewEditorProps.value;
    expect(currentContent).toBe("view:/tmp/alpha.jar:alpha-two.json");
    invoke.mockClear();

    await act(async () => {
      staleOnChange?.(currentContent, { isFlush: false });
      await Promise.resolve();
    });

    expect(invoke.mock.calls.some(([cmd]) => cmd === "unstage_view_write")).toBe(false);
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("does not edit or stage the old View model while a new entry preview is loading", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    let resolveNextPreview:
      | ((preview: ReturnType<typeof entryPreview>) => void)
      | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "read_view_entry" && args?.entryPath === "alpha-two.json") {
        return new Promise((resolve) => {
          resolveNextPreview = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const installedContent = viewEditorProps.value;

    await user.click(await screen.findByText("alpha-two.json"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_view_entry", {
        sourceId: "view:/tmp/alpha.jar",
        entryPath: "alpha-two.json",
      }),
    );
    const transitionOnChange = viewEditorProps.onChange;
    invoke.mockClear();

    await act(async () => {
      transitionOnChange?.("stale transitional edit", { isFlush: false });
      await Promise.resolve();
    });

    expect(screen.getByTestId("editor")).toHaveValue(installedContent);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_view_write")).toBe(false);
    expect(screen.queryByText("1 pending")).not.toBeInTheDocument();

    await act(async () => {
      resolveNextPreview?.({
        path: "alpha-two.json",
        kind: "text",
        language: "json",
        details: null,
        content: "loaded alpha-two",
      });
      await Promise.resolve();
    });
    expect(await screen.findByTestId("editor")).toHaveValue("loaded alpha-two");
  });

  it("does not stage the previous Compare model into a newly selected entry while its preview loads", async () => {
    const user = userEvent.setup();
    let resolveNextPreview:
      | ((preview: ReturnType<typeof entryPreview>) => void)
      | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "second.json",
              status: "different" as const,
              left: { ...FILE_ENTRY, path: "second.json" },
              right: { ...FILE_ENTRY, path: "second.json" },
            },
          ],
        });
      }
      if (
        cmd === "read_entry" &&
        args?.entryPath === "second.json" &&
        args?.side === "left"
      ) {
        return new Promise((resolve) => {
          resolveNextPreview = resolve;
        });
      }
      if (cmd === "read_entry" && args?.entryPath === "second.json") {
        return Promise.resolve({
          path: "second.json",
          kind: "text" as const,
          language: "json",
          details: null,
          content: "loaded second right",
        });
      }
      return defaultInvoke(cmd, args);
    });
    await driveIntoFileCompare(user);
    await waitFor(() => expect(diffModelChangeHandlers.left).toBeDefined());

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.click(
      (await screen.findAllByText("second.json"))
        .find((cell) => cell.closest("button.tree-file"))!,
    );
    await waitFor(() => expect(resolveNextPreview).toBeDefined());
    await waitFor(() =>
      expect(diffEditorProps.options).toMatchObject({
        originalEditable: false,
        readOnly: true,
      }),
    );
    expect(screen.getByTestId("diff-original")).toBeEmptyDOMElement();
    invoke.mockClear();

    buffers.left = "stale config edit";
    await act(async () => {
      diffModelChangeHandlers.left?.({ isFlush: false });
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalledWith("stage_write", {
      side: "left",
      entryPath: "second.json",
      content: "stale config edit",
    });
    expect(screen.queryByText("1 pending")).not.toBeInTheDocument();

    await act(async () => {
      resolveNextPreview?.({
        path: "second.json",
        kind: "text",
        language: "json",
        details: null,
        content: "loaded second left",
      });
      await Promise.resolve();
    });
    expect(await screen.findByTestId("diff-original"))
      .toHaveTextContent("loaded second left");
  });

  it("ignores stale stage_view_write failure after a newer edit succeeds", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    let rejectFirstWrite: ((error: Error) => void) | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "stage_view_write" && args?.content === "first edit") {
        return new Promise((_, reject) => {
          rejectFirstWrite = reject;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const editor = await screen.findByTestId("editor");

    fireEvent.change(editor, { target: { value: "first edit" } });
    await waitFor(() => expect(rejectFirstWrite).toBeDefined());
    fireEvent.change(editor, { target: { value: "latest edit" } });
    expect(await screen.findByText("Edited alpha.json (unsaved)")).toBeInTheDocument();

    act(() => rejectFirstWrite?.(new Error("stale view stage failure")));

    await waitFor(() => expect(screen.getByText("1 pending")).toBeInTheDocument());
    expect(screen.queryByText("Error: stale view stage failure")).not.toBeInTheDocument();
  });

  it("keeps the prior View pending projection when a replacement write fails", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    let writeCount = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "stage_view_write") {
        writeCount += 1;
        if (writeCount === 2) throw new Error("replacement view write failed");
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const editor = await screen.findByTestId("editor");

    fireEvent.change(editor, { target: { value: "first staged view edit" } });
    expect(await screen.findByText("Edited alpha.json (unsaved)")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "failed replacement view edit" } });

    expect(await screen.findByText("Error: replacement view write failed"))
      .toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.getByLabelText("Save to archive (1)")).toBeEnabled();
  });

  it("keeps the prior Compare pending projection when a replacement write fails", async () => {
    const user = userEvent.setup();
    let writeCount = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "stage_write") {
        writeCount += 1;
        if (writeCount === 2) throw new Error("replacement compare write failed");
      }
      return defaultInvoke(cmd, args);
    });
    await driveIntoFileCompare(user);
    await waitFor(() => expect(diffModelChangeHandlers.left).toBeDefined());

    buffers.left = "first staged compare edit";
    await act(async () => {
      diffModelChangeHandlers.left?.({ isFlush: false });
      await Promise.resolve();
    });
    expect(await screen.findByText("Edited config.json on left (unsaved)"))
      .toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();

    buffers.left = "failed replacement compare edit";
    await act(async () => {
      diffModelChangeHandlers.left?.({ isFlush: false });
      await Promise.resolve();
    });

    expect(await screen.findByText("Error: replacement compare write failed"))
      .toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.getByLabelText("Save to archive (1)")).toBeEnabled();
  });

  it("surfaces a failed View unstage while retaining the pending edit", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    const editor = await screen.findByTestId("editor");
    fireEvent.change(editor, { target: { value: "staged before failed unstage" } });
    expect(await screen.findByText("Edited alpha.json (unsaved)")).toBeInTheDocument();

    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "unstage_view_write") {
        throw new Error("view unstage failed");
      }
      return defaultInvoke(cmd, args);
    });
    fireEvent.change(editor, {
      target: { value: "view:/tmp/alpha.jar:alpha.json" },
    });

    expect(await screen.findByText("Error: view unstage failed")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("unstages View edits with a bare entry path", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    fireEvent.change(await screen.findByTestId("editor"), { target: { value: "changed" } });
    await screen.findByText("Edited alpha.json (unsaved)");

    await user.click(screen.getByLabelText("Show pending changes"));
    await user.click(screen.getByLabelText("Unstage alpha.json"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("unstage_view_write", {
        sourceId: "view:/tmp/alpha.jar",
        entryPath: "alpha.json",
      }),
    );
  });

  it("clears inspected View preview state when switching to Compare and Merge", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));

    expect(await screen.findByRole("tab", { name: /alpha\.json/ })).toBeInTheDocument();
    expect(await screen.findByTestId("editor")).toHaveValue("view:/tmp/alpha.jar:alpha.json");

    await user.click(screen.getByRole("button", { name: "Compare mode" }));

    expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();
    expect(await screen.findByText("Nothing to compare yet")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    expect(screen.queryByText("view:/tmp/alpha.jar:alpha.json")).not.toBeInTheDocument();
  });

  it("filters Compare files by differences and identical status", async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "same.txt",
              status: "identical" as const,
              left: { path: "same.txt", kind: "text" as const },
              right: { path: "same.txt", kind: "text" as const },
            },
          ],
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("tab", { name: /files/i }));

    expect(screen.getAllByText("config.json").length).toBeGreaterThan(0);
    expect(screen.queryByText("same.txt")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Identical" }));
    expect(await screen.findAllByText("same.txt")).toHaveLength(2);
    expect(
      Array.from(document.querySelectorAll(".tree-file"))
        .some((row) => row.textContent?.includes("config.json")),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect((await screen.findAllByText("same.txt")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("config.json").length).toBeGreaterThan(0);
  });

  it("allows editing the existing text pane in a one-sided Compare preview", async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [{
            path: "config.json",
            status: "onlyLeft" as const,
            left: FILE_ENTRY,
          }],
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();

    await driveIntoFileCompare(user);

    expect(diffEditorProps.options).toMatchObject({
      originalEditable: true,
      readOnly: true,
    });
  });

  it("ignores a stale View entry read after switching sources", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    let resolveRead: ((preview: {
      path: string;
      kind: "text";
      language: string;
      content: string;
    }) => void) | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "read_view_entry" && args?.sourceId === "view:/tmp/alpha.jar") {
        return new Promise((resolve) => {
          resolveRead = resolve as typeof resolveRead;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await browseViewSource(user);
    await user.click(screen.getByRole("tab", { name: /alpha\.jar/ }));
    await user.click(await screen.findByText("alpha.json"));
    await waitFor(() => expect(resolveRead).toBeDefined());

    await user.click(screen.getByRole("tab", { name: /beta\.jar/ }));
    act(() => resolveRead?.({
      path: "alpha.json",
      kind: "text",
      language: "json",
      content: "stale alpha",
    }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("tab", { name: /alpha\.json/ })).not.toBeInTheDocument();
    expect(screen.queryByText("stale alpha")).not.toBeInTheDocument();
  });

  it("keeps tree expansion controls while hiding compare-only controls in multi-source View mode", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await browseViewSource(user);

    expect(screen.getByRole("main", { name: "Source workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tree filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tree expansion" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save to archive/i })).toBeDisabled();
  });

  it("enables bytecode for class entries in View mode", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("Alpha.class"));

    const bytecodeButton = await screen.findByRole("button", { name: "Show bytecode" });
    expect(bytecodeButton).toBeEnabled();
    await user.click(bytecodeButton);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("disassemble_view_entry", {
        sourceId: "view:/tmp/alpha.jar",
        entryPath: "Alpha.class",
      }),
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("runs Files search against the active View source", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(screen.getByLabelText("Toggle search"));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "alpha");
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("search_view_source", {
        sourceId: "view:/tmp/alpha.jar",
        query: "alpha",
        options: { includePath: true, includeText: true, includeConstants: true },
      }),
    );
    expect(invoke.mock.calls.some(([cmd]) => cmd === "search")).toBe(false);
    await waitFor(() => expect(screen.getAllByText("Alpha.class").length).toBeGreaterThan(1));
  });

  it("clears View search filtering when switching sources", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await browseViewSource(user);
    await user.click(screen.getByRole("tab", { name: /alpha\.jar/ }));
    await user.click(screen.getByLabelText("Toggle search"));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "alpha");
    await user.click(screen.getByRole("button", { name: /search files/i }));
    await waitFor(() => expect(screen.getAllByText("alpha.json").length).toBeGreaterThan(1));

    await user.click(screen.getByRole("tab", { name: /beta\.jar/ }));

    expect(screen.getByText("beta.json")).toBeInTheDocument();
  });

  it("ignores stale View search results after switching sources", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    let resolveSearch: ((hits: Array<{ entryPath: string; kind: "path" }>) => void) | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "search_view_source" && args?.sourceId === "view:/tmp/alpha.jar") {
        return new Promise((resolve) => {
          resolveSearch = resolve as typeof resolveSearch;
        });
      }
      return defaultInvoke(cmd, args);
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await browseViewSource(user);
    await user.click(screen.getByRole("tab", { name: /alpha\.jar/ }));
    await user.click(screen.getByLabelText("Toggle search"));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "alpha");
    await user.click(screen.getByRole("button", { name: /search files/i }));
    await waitFor(() => expect(resolveSearch).toBeDefined());

    await user.click(screen.getByRole("tab", { name: /beta\.jar/ }));
    act(() => resolveSearch?.([{ entryPath: "alpha.json", kind: "path" }]));

    await waitFor(() => expect(screen.getByRole("tab", { name: /beta\.jar/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByText("alpha.json")).not.toBeInTheDocument();
    expect(screen.getByText("beta.json")).toBeInTheDocument();
  });

  it("runs decompiled source search against the active View source", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(screen.getByLabelText("Toggle search"));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "alpha");
    await user.click(screen.getByLabelText("Include decompiled source search"));
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("deep_search_view_source", {
        sourceId: "view:/tmp/alpha.jar",
        query: "alpha",
        searchId: expect.any(Number),
      }),
    );
    expect(invoke.mock.calls.some(([cmd]) => cmd === "deep_search")).toBe(false);
  });

  it("switches View entry tabs with action hotkeys", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open View mode" }));
    await browseViewSource(user);
    await user.click(await screen.findByText("alpha.json"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /alpha\.json/ })).toHaveAttribute("aria-selected", "true"));
    await user.click(screen.getByText("Alpha.class"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Alpha\.class/ })).toHaveAttribute("aria-selected", "true"));

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true, ctrlKey: true });

    await waitFor(() => expect(screen.getByRole("tab", { name: /alpha\.json/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("shows the Source/Bytecode switch only on the active Diff tab", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(invoke.mock.calls.filter(([cmd]) => cmd === "set_engine")).toHaveLength(1);

    const viewSwitch = screen.getByRole("group", { name: "Diff view mode" });
    expect(viewSwitch).toBeInTheDocument();
    expect(viewSwitch).toContainElement(screen.getByRole("button", { name: "Show source" }));
    expect(viewSwitch).toContainElement(screen.getByRole("button", { name: "Show bytecode" }));

    await user.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.queryByRole("group", { name: "Diff view mode" })).not.toBeInTheDocument();
  });

  it("keeps the content line filter across Compare tabs and source/bytecode views", async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "App.class",
              status: "different" as const,
              left: { path: "App.class", kind: "class" as const },
              right: { path: "App.class", kind: "class" as const },
            },
          ],
        });
      }
      if (cmd === "read_entry" && args?.entryPath === "App.class") {
        const side = args.side as "left" | "right";
        return Promise.resolve({
          path: "App.class",
          kind: "class" as const,
          language: "java",
          content: side === "left" ? "class App { int v = 1; }" : "class App { int v = 2; }",
        });
      }
      if (cmd === "disassemble") {
        return Promise.resolve(`${args?.side}: bytecode`);
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    const filter = screen.getByRole("group", { name: "Content line filter" });
    expect(within(filter).getByRole("button", { name: "Show all content lines" }))
      .toHaveAttribute("aria-pressed", "true");
    await user.click(within(filter).getByRole("button", { name: "Show differences only" }));

    await user.click(screen.getByRole("tab", { name: /files/i }));
    const classCells = await screen.findAllByText("App.class");
    const classRow = classCells.find((element) => element.closest("button.tree-file"));
    expect(classRow).toBeDefined();
    await user.click(classRow!);

    expect(screen.getByRole("button", { name: "Show differences only" }))
      .toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Show bytecode" }));
    expect(screen.getByRole("button", { name: "Show differences only" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("tab", { name: /config\.json/ }));
    expect(screen.getByRole("button", { name: "Show differences only" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("ignores pending Compare disassembly after switching to View", async () => {
    let resolveLeftBytecode: ((content: string) => void) | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "App.class",
              status: "different" as const,
              left: { path: "App.class", kind: "class" as const },
              right: { path: "App.class", kind: "class" as const },
            },
          ],
        });
      }
      if (cmd === "read_entry" && args?.entryPath === "App.class") {
        return Promise.resolve({
          path: "App.class",
          kind: "class" as const,
          language: "java",
          content: `${args?.side}: source`,
        });
      }
      if (cmd === "disassemble" && args?.side === "left") {
        return new Promise((resolve) => {
          resolveLeftBytecode = resolve;
        });
      }
      if (cmd === "disassemble" && args?.side === "right") {
        return Promise.resolve("right: bytecode");
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("tab", { name: /files/i }));
    const classCells = await screen.findAllByText("App.class");
    await user.click(classCells.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Show bytecode" }));
    await waitFor(() => expect(resolveLeftBytecode).toBeDefined());

    await switchMode("View");
    await act(async () => {
      resolveLeftBytecode?.("left: late bytecode");
      await Promise.resolve();
    });
    await switchMode("Compare");

    expect(screen.getByRole("button", { name: "Show source" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("diff-original")).toHaveTextContent("left: source");
    expect(screen.queryByText("left: late bytecode")).not.toBeInTheDocument();
  });

  it("invalidates pending Compare disassembly before OS-open validation resolves", async () => {
    let resolveLeftBytecode: ((content: string) => void) | undefined;
    let resolveOsValidation: ((path: string) => void) | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "compute_diff") {
        return Promise.resolve({
          pairs: [
            ...onePairDiff.pairs,
            {
              path: "App.class",
              status: "different" as const,
              left: { path: "App.class", kind: "class" as const },
              right: { path: "App.class", kind: "class" as const },
            },
          ],
        });
      }
      if (cmd === "read_entry" && args?.entryPath === "App.class") {
        return Promise.resolve({
          path: "App.class",
          kind: "class" as const,
          language: "java",
          content: `${args?.side}: source`,
        });
      }
      if (cmd === "disassemble" && args?.side === "left") {
        return new Promise((resolve) => {
          resolveLeftBytecode = resolve;
        });
      }
      if (cmd === "disassemble" && args?.side === "right") {
        return Promise.resolve("right: bytecode");
      }
      if (cmd === "validate_path" && args?.raw === "/tmp/from-finder.jar") {
        return new Promise((resolve) => {
          resolveOsValidation = resolve;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("tab", { name: /files/i }));
    const classCells = await screen.findAllByText("App.class");
    await user.click(classCells.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Show bytecode" }));
    await waitFor(() => expect(resolveLeftBytecode).toBeDefined());
    await waitFor(() => expect(osOpenPathsHandler).toBeDefined());

    act(() => {
      osOpenPathsHandler?.({ payload: { paths: ["/tmp/from-finder.jar"] } });
    });
    await waitFor(() => expect(resolveOsValidation).toBeDefined());
    await act(async () => {
      resolveLeftBytecode?.("left: late bytecode during OS validation");
      await Promise.resolve();
    });
    await act(async () => {
      resolveOsValidation?.("/tmp/from-finder.jar");
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /from-finder\.jar/ })).toBeInTheDocument(),
    );

    await switchMode("Compare");

    expect(screen.getByRole("button", { name: "Show source" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("diff-original")).toHaveTextContent("left: source");
    expect(screen.queryByText("left: late bytecode during OS validation"))
      .not.toBeInTheDocument();
  });

  it("shows the content line filter only on an active Compare diff tab", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(screen.getByRole("group", { name: "Content line filter" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.queryByRole("group", { name: "Content line filter" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Text mode" }));
    expect(screen.queryByRole("group", { name: "Content line filter" }))
      .not.toBeInTheDocument();
  });

  it("keeps the content line filter after replacing a Compare source", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByRole("button", { name: "Show differences only" }));

    await user.click(screen.getByRole("button", { name: "Change left source" }));
    await user.click(await screen.findByText("Browse file"));
    await user.click(await screen.findByRole("button", { name: "Open anyway" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/config.json", side: "left" },
    ));

    const cells = await screen.findAllByText("config.json");
    const row = cells.find((element) => element.closest("button.tree-file"));
    expect(row).toBeDefined();
    await user.click(row!.closest("button.tree-file")!);

    expect(screen.getByRole("button", { name: "Show differences only" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("renders pane-specific actions in Compare mode and removes them in View mode", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(screen.getByRole("group", { name: "Actions into left pane" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Actions into right pane" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View mode" }));

    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
  });

  it("hides retained Compare tabs while View is active", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(screen.getByRole("tab", { name: /config\.json/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "View mode" }));

    expect(screen.getByRole("tab", { name: /Files/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compare mode" }));
    expect(screen.getByRole("tab", { name: /config\.json/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("wires diff navigator state from Monaco line changes and reveals the next block", async () => {
    const user = userEvent.setup();
    lineChanges = [
      MODIFY_LINE_2,
      {
        originalStartLineNumber: 3,
        originalEndLineNumber: 3,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 3,
      },
    ];
    await driveIntoFileCompare(user);

    const navigator = await screen.findByRole("group", { name: "Diff block navigation" });
    expect(navigator).toHaveTextContent("1/2");

    revealModified.mockClear();
    await user.click(screen.getByRole("button", { name: "Next diff block" }));

    await waitFor(() => expect(revealModified).toHaveBeenCalledWith(3));
    expect(navigator).toHaveTextContent("2/2");
  });

  it("reveals the original side for a left-only deletion with default right focus", async () => {
    const user = userEvent.setup();
    lineChanges = [
      {
        originalStartLineNumber: 2,
        originalEndLineNumber: 2,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 0,
      },
    ];
    await driveIntoFileCompare(user);

    await screen.findByRole("group", { name: "Diff block navigation" });
    revealOriginal.mockClear();
    revealModified.mockClear();
    await user.click(screen.getByRole("button", { name: "Next diff block" }));

    await waitFor(() => expect(revealOriginal).toHaveBeenCalledWith(2));
    expect(revealModified).not.toHaveBeenCalled();
  });

  it("reveals the modified side for a right-only insertion with left focus", async () => {
    const user = userEvent.setup();
    lineChanges = [
      {
        originalStartLineNumber: 2,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      },
    ];
    await driveIntoFileCompare(user);
    await waitFor(() => expect(focusOriginalEditor).toBeDefined());
    act(() => focusOriginalEditor?.());

    await screen.findByRole("group", { name: "Diff block navigation" });
    revealOriginal.mockClear();
    revealModified.mockClear();
    await user.click(screen.getByRole("button", { name: "Next diff block" }));

    await waitFor(() => expect(revealModified).toHaveBeenCalledWith(2));
    expect(revealOriginal).not.toHaveBeenCalled();
  });

  it("Take all into right stages the left buffer onto the right", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(diffEditorProps.options).toMatchObject({
      readOnly: false,
      originalEditable: true,
    });
    await user.click(screen.getByLabelText("Take all into right"));

    // Right buffer is replaced with left's value, then staged to the right side.
    expect(setModified).toHaveBeenCalledWith(LEFT_TEXT);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stage_write", {
        side: "right",
        entryPath: "config.json",
        content: LEFT_TEXT,
      }),
    );
  });

  it("ignores stale stage_write failure after newer staged state is cleared", async () => {
    let rejectStageWrite: ((error: Error) => void) | undefined;
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "stage_write") {
        return new Promise((_, reject) => {
          rejectStageWrite = reject;
        });
      }
      return defaultInvoke(cmd, args);
    });
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByLabelText("Take all into right"));
    await waitFor(() => expect(rejectStageWrite).toBeDefined());
    await user.click(screen.getByLabelText("Clear staged"));
    expect(await screen.findByText("Cleared unsaved changes.")).toBeInTheDocument();

    act(() => rejectStageWrite?.(new Error("stale stage failure")));

    await waitFor(() => expect(screen.getByText("No pending changes")).toBeInTheDocument());
    expect(screen.queryByText("Error: stale stage failure")).not.toBeInTheDocument();
  });

  it("applies persisted Appearance preferences to the app shell", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lcdiff.uiPreferences.v1", JSON.stringify({
      appearance: { colorPattern: "light" },
      editor: { fontFamily: "Menlo", fontSize: 15 },
    }));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    const shell = await screen.findByRole("main");
    await waitFor(() => expect(shell.dataset.colorPattern).toBe("light"));
    expect(shell.dataset.effectiveColorPattern).toBe("light");
    expect(document.documentElement.dataset.effectiveColorPattern).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#edf2f7");
    expect(shell.style.getPropertyValue("--lcdiff-editor-font-size")).toBe("");
  });

  it("preserves a persisted installed font before fonts are loaded", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lcdiff.uiPreferences.v1", JSON.stringify({
      editor: { fontFamily: "Menlo", fontSize: 15 },
    }));

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "set_engine")).toHaveLength(1));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("lcdiff.uiPreferences.v1") ?? "{}").editor.fontFamily).toBe("Menlo"),
    );

    await user.click(screen.getByLabelText("Preferences"));
    await user.click(screen.getByRole("button", { name: "Editor" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_system_fonts"));
    await waitFor(() => expect(screen.getByLabelText("Editor font family")).toHaveTextContent("Menlo"));
    await user.click(screen.getByLabelText("Close preferences"));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "set_engine")).toHaveLength(1);
  });

  it("loads installed fonts when Editor preferences open", async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await user.click(screen.getByLabelText("Preferences"));
    expect(invoke).not.toHaveBeenCalledWith("list_system_fonts");
    await user.click(screen.getByRole("button", { name: "Editor" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_system_fonts"));
    expect(screen.getByLabelText("Editor font family")).toHaveTextContent("JetBrains Mono · default");
    await user.click(screen.getByLabelText("Editor font family"));
    expect(await screen.findByText(/Menlo/)).toBeInTheDocument();
  });

  it("rolls back the persisted decompiler engine when backend sync fails", async () => {
    const user = userEvent.setup();
    const engineError = new Error("CFR unavailable");
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "set_engine" && args?.engine === "cfr") throw engineError;
      return undefined;
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_engine", { engine: "vineflower" }));

    await user.click(screen.getByLabelText("Preferences"));
    await user.click(screen.getByRole("button", { name: "Misc" }));
    await user.click(screen.getByRole("button", { name: "Decompiler" }));
    fireEvent.keyDown(screen.getByLabelText("Decompiler engine"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "CFR" }));

    await screen.findByText("CFR unavailable");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("lcdiff.uiPreferences.v1") ?? "{}").misc.decompiler.engine).toBe(
        "vineflower",
      ),
    );
    expect(screen.getByLabelText("Decompiler engine")).toHaveTextContent("Vineflower");
  });

  it("runs Files index search with typed backend options on both compare sides", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.clear(screen.getByPlaceholderText(/Search paths, text, constants/));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("search", {
        side: "left",
        query: "config",
        options: { includePath: true, includeText: true, includeConstants: true },
      }),
    );
    expect(invoke).toHaveBeenCalledWith("search", {
      side: "right",
      query: "config",
      options: { includePath: true, includeText: true, includeConstants: true },
    });
    expect((await screen.findAllByText("Path")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Text")).length).toBeGreaterThan(0);
  });

  it("finds inside the current diff without invoking archive search", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    invoke.mockClear();
    await user.click(screen.getByRole("tab", { name: /config.json/i }));
    await user.type(screen.getByPlaceholderText(/Find in current diff/), "v");
    await user.click(screen.getByRole("button", { name: /^find$/i }));

    expect(invoke).not.toHaveBeenCalledWith("search", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("deep_search", expect.anything());
    expect(await screen.findByText("Current diff matched line 2.")).toBeInTheDocument();
  });

  it("keeps Current diff Find enabled during background source search", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    let unblockDeepSearch: () => void = () => undefined;
    deepSearchBlock = {
      promise: new Promise<void>((resolve) => { unblockDeepSearch = resolve; }),
    };
    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByLabelText("Include decompiled source search"));
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("deep_search", {
        side: "left",
        query: "config",
        searchId: expect.any(Number),
      }),
    );

    await user.click(screen.getByRole("tab", { name: /config.json/i }));
    const findButton = screen.getByRole("button", { name: /^find$/i });
    expect(findButton).not.toBeDisabled();
    await user.click(findButton);
    expect(await screen.findByText("Current diff matched line 2.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.click(screen.getByRole("button", { name: /clear results/i }));
    await waitFor(() =>
      expect(invoke.mock.calls.some(([cmd]) => cmd === "cancel_deep_search")).toBe(true),
    );
    unblockDeepSearch();
  });

  it("runs source search when Include source is enabled on both compare sides", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByLabelText("Include decompiled source search"));
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("deep_search", {
        side: "left",
        query: "config",
        searchId: expect.any(Number),
      }),
    );
    expect(invoke).toHaveBeenCalledWith("deep_search", {
      side: "right",
      query: "config",
      searchId: expect.any(Number),
    });
  });

  it("keeps base search results when decompiled source search fails", async () => {
    const user = userEvent.setup();
    deepSearchError = new Error("sidecar unavailable");
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByLabelText("Include decompiled source search"));
    await user.click(screen.getByRole("button", { name: /search files/i }));

    expect((await screen.findAllByText("Path")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Text")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Source search failed: Error: sidecar unavailable")).toBeInTheDocument();
  });

  it("clears stale results and cancels active decompiled source search", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
    await user.click(screen.getByRole("button", { name: /search files/i }));
    expect((await screen.findAllByText("Path")).length).toBeGreaterThan(0);

    let unblockDeepSearch: () => void = () => undefined;
    deepSearchBlock = {
      promise: new Promise<void>((resolve) => { unblockDeepSearch = resolve; }),
    };
    await user.click(screen.getByLabelText("Include decompiled source search"));
    await user.click(screen.getByRole("button", { name: /search files/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("deep_search", {
        side: "left",
        query: "config",
        searchId: expect.any(Number),
      }),
    );
    expect((await screen.findAllByText("Path")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /clear results/i }));

    await waitFor(() =>
      expect(invoke.mock.calls.some(([cmd]) => cmd === "cancel_deep_search")).toBe(true),
    );
    expect(screen.queryAllByText("Path")).toHaveLength(0);
    unblockDeepSearch();
  });

  it("labels search as Current diff on opened diff tabs", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /config.json/i }));

    expect(screen.getByText("Current diff")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^find$/i })).toBeInTheDocument();
  });

  it("Cmd/Ctrl+F toggles search open and closed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(screen.queryByPlaceholderText(/Search paths, text, constants/)).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "f", ...cmdOrCtrl() });
    expect(await screen.findByPlaceholderText(/Search paths, text, constants/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "f", ...cmdOrCtrl() });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Search paths, text, constants/)).not.toBeInTheDocument(),
    );
  });

  it.each([
    ["Cmd/Ctrl+O opens the left file picker", { key: "o", ...cmdOrCtrl() }, FILE_PICKER_OPTIONS, "left"],
    ["Cmd/Ctrl+Alt+O opens the left directory picker", { key: "o", altKey: true, ...cmdOrCtrl() }, DIRECTORY_PICKER_OPTIONS, "left"],
    ["Cmd/Ctrl+Shift+O opens the right file picker", { key: "o", shiftKey: true, ...cmdOrCtrl() }, FILE_PICKER_OPTIONS, "right"],
    ["Cmd/Ctrl+Alt+Shift+O opens the right directory picker", { key: "o", altKey: true, shiftKey: true, ...cmdOrCtrl() }, DIRECTORY_PICKER_OPTIONS, "right"],
  ] as const)("%s", async (_label, keyboardEvent, expectedOptions, expectedSide) => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    chooseFile.mockClear();
    invoke.mockClear();

    fireEvent.keyDown(window, keyboardEvent);

    await waitFor(() => expect(chooseFile).toHaveBeenCalledTimes(1));
    expect(chooseFile.mock.calls).toEqual([[expectedOptions]]);
    await waitFor(() =>
      expect(invoke.mock.calls.filter(([cmd]) => cmd === "open_archive")).toEqual([
        ["open_archive", { path: "/tmp/config.json", side: expectedSide }],
      ]),
    );
  });

  it("blocks the right-directory shortcut in View mode with the Compare-only message", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open View mode" }));

    chooseFile.mockClear();
    fireEvent.keyDown(window, { key: "o", altKey: true, shiftKey: true, ...cmdOrCtrl() });

    expect(await screen.findByText("Open right source is available only in Compare mode.")).toBeInTheDocument();
    expect(chooseFile).not.toHaveBeenCalled();
  });

  it("does not open an archive when the picker is cancelled", async () => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    chooseFile.mockResolvedValueOnce(null);
    invoke.mockClear();
    fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl() });

    await waitFor(() => expect(chooseFile).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
  });

  it("shows a stable message when the file picker rejects", async () => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    chooseFile.mockRejectedValueOnce(new Error("dialog unavailable"));
    invoke.mockClear();
    fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl() });

    expect(await screen.findByText("Open file picker failed: Error: dialog unavailable")).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
  });

  it("shows a stable message when the directory picker rejects", async () => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    chooseFile.mockRejectedValueOnce(new Error("dialog unavailable"));
    invoke.mockClear();
    fireEvent.keyDown(window, { key: "o", altKey: true, ...cmdOrCtrl() });

    expect(await screen.findByText("Open directory picker failed: Error: dialog unavailable")).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
  });

  it("Cmd/Ctrl+/ toggles the Keyboard Shortcuts dialog and Escape closes it", async () => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument(),
    );
  });

  it("opens the Keyboard Shortcuts dialog from the native help action", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    await openCompareWorkspace(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());

    await act(async () => {
      appActionHandler?.({ payload: { actionId: "help.showShortcuts" } });
    });

    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
  });

  it("blocks a same-tick native picker action after native help.showShortcuts opens the dialog", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    await openCompareWorkspace(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());

    chooseFile.mockClear();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "help.showShortcuts" } });
      appActionHandler?.({ payload: { actionId: "file.openLeftFile" } });
    });

    expect(chooseFile).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    expect(await screen.findByText("Close Keyboard Shortcuts before running another command.")).toBeInTheDocument();
  });

  it("prevents matching DOM shortcuts from opening pickers while the shortcut dialog is open", async () => {
    const user = userEvent.setup();
    await openCompareWorkspace(user);

    fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

    chooseFile.mockClear();
    const allowed = fireEvent.keyDown(window, { key: "o", ...cmdOrCtrl() });

    expect(await screen.findByText("Close Keyboard Shortcuts before running another command.")).toBeInTheDocument();
    expect(allowed).toBe(false);
    expect(chooseFile).not.toHaveBeenCalled();
  });

  it("blocks native open-left-file actions while the shortcut dialog is open", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    await openCompareWorkspace(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());

    fireEvent.keyDown(window, { key: "/", ...cmdOrCtrl() });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();

    chooseFile.mockClear();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "file.openLeftFile" } });
    });

    expect(await screen.findByText("Close Keyboard Shortcuts before running another command.")).toBeInTheDocument();
    expect(chooseFile).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
  });

  it("ignores app shortcuts while the splash screen is active", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.keyDown(window, { key: "f", ...cmdOrCtrl() });
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(screen.queryByPlaceholderText(/Search paths, text, constants/)).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl+, toggles Preferences open", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    expect(screen.queryByLabelText("Preference categories")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: ",", ...cmdOrCtrl() });
    expect(await screen.findByLabelText("Preference categories")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: ",", ...cmdOrCtrl() });
    await waitFor(() =>
      expect(screen.queryByLabelText("Preference categories")).not.toBeInTheDocument(),
    );
  });

  it("Cmd/Ctrl+S reports no staged changes when nothing is staged", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));

    fireEvent.keyDown(window, { key: "s", ...cmdOrCtrl() });

    expect(await screen.findByText("No staged changes to save.")).toBeInTheDocument();
  });

  it("blocks merge shortcuts while focus is inside Monaco", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    const allowed = fireEvent.keyDown(screen.getByTestId("diff-editor-cell"), {
      key: "[",
      altKey: true,
      ...cmdOrCtrl(),
    });

    expect(await screen.findByText("Finish editing or leave the editor before running this shortcut.")).toBeInTheDocument();
    expect(allowed).toBe(true);
  });

  it("navigates from Files to the open diff tab with keyboard shortcuts", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.getByText("Files index")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(await screen.findByText("Current diff")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1", ...cmdOrCtrl() });
    expect(await screen.findByText("Files index")).toBeInTheDocument();
  });

  it("blocks hunk shortcuts while the Files tab is active", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    setModified.mockClear();

    await user.click(screen.getByRole("tab", { name: /files/i }));
    fireEvent.keyDown(window, { key: "}", altKey: true, shiftKey: true });

    expect(await screen.findByText("Open an editable diff before taking all changes.")).toBeInTheDocument();
    expect(setModified).not.toHaveBeenCalled();
  });

  it("blocks native merge actions using the last webview focus kind", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    await driveIntoFileCompare(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());

    fireEvent.focusIn(screen.getByTestId("diff-editor-cell"));
    invoke.mockClear();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "merge.copyToRight" } });
    });

    expect(await screen.findByText("Finish editing or leave the editor before running this shortcut.")).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_copy")).toBe(false);
  });

  it("disposes native app-action listener when listen resolves after unmount", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    let resolveAppActionListen!: (stop: () => void) => void;
    deferredAppActionListen = new Promise<() => void>((resolve) => { resolveAppActionListen = resolve; });
    const stop = vi.fn();

    const { unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Open Compare mode" }));
    await waitFor(() => expect(listen).toHaveBeenCalledWith("app-action", expect.any(Function)));

    unmount();
    resolveAppActionListen(stop);

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it("Move hunk into left copies into left and removes from right (copy+delete)", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    await user.click(screen.getByLabelText("Move hunk into left"));

    // move = copy into target + delete from source: both editors get setValue,
    // and both sides receive a stage_write.
    expect(setOriginal).toHaveBeenCalled();
    expect(setModified).toHaveBeenCalled();
    const stageCalls = invoke.mock.calls.filter(([cmd]) => cmd === "stage_write");
    const sides = stageCalls.map(([, args]) => (args as { side: string }).side);
    expect(sides).toContain("left");
    expect(sides).toContain("right");
  });

  it("unstages same-path file edits independently with their side-prefixed keys", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);
    await user.click(screen.getByLabelText("Move hunk into left"));
    await waitFor(() => expect(screen.getByText("2 pending")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Show pending changes"));
    const unstageButtons = screen.getAllByLabelText("Unstage config.json");
    await user.click(unstageButtons[0]);
    await user.click(screen.getByLabelText("Unstage config.json"));

    await waitFor(() => {
      const unstageCalls = invoke.mock.calls
        .filter(([cmd]) => cmd === "unstage")
        .map(([, args]) => args);
      expect(unstageCalls).toEqual(expect.arrayContaining([
        { entryPath: "config.json", side: "left" },
        { entryPath: "config.json", side: "right" },
      ]));
    });
  });

  it("Hunk-merge buttons appear for a text entry inside archives, not just plain files", async () => {
    const user = userEvent.setup();
    summarySourceKind = "archive"; // both sides are jar/zip, entry is text
    await driveIntoFileCompare(user);

    // The per-hunk controls gate on the entry being editable text in compare
    // mode, independent of whether the source is a standalone file or an archive.
    expect(screen.getByLabelText("Move hunk into left")).toBeInTheDocument();
    expect(screen.getByLabelText("Move hunk into right")).toBeInTheDocument();
    expect(screen.getByLabelText("Take all into left")).toBeInTheDocument();
    expect(screen.getByLabelText("Take all into right")).toBeInTheDocument();
  });

  it("Move hunk toward the side that already owns the hunk does not delete it", async () => {
    const user = userEvent.setup();
    // Right-only addition: the line exists on the right, the left side reports an
    // empty range (endLineNumber 0). Moving it "into right" has nothing to bring
    // over and previously wiped the line off the right entirely.
    lineChanges = [
      {
        originalStartLineNumber: 2,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 2,
      },
    ];
    await driveIntoFileCompare(user);

    await user.click(screen.getByLabelText("Move hunk into right"));

    // No buffer is touched and nothing is staged — the content survives.
    expect(setModified).not.toHaveBeenCalled();
    expect(setOriginal).not.toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "stage_write")).toHaveLength(0);
  });

  it("Discard reverts both editor buffers to the originally loaded preview content", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    // Stage an edit so there is something to discard, and sanity-check it fired.
    await user.click(screen.getByLabelText("Take all into right"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stage_write", {
        side: "right",
        entryPath: "config.json",
        content: LEFT_TEXT,
      }),
    );

    // Forget the setValue calls made by staging so the next assertions only see
    // the revert. The sub-editor spies are stable (created once in onMount), so
    // clearing them here still observes the discard's setValue calls.
    setOriginal.mockClear();
    setModified.mockClear();

    // Discard = MenuBar "Clear staged" → clearStaged().
    await user.click(screen.getByLabelText("Clear staged"));

    // Backend told to drop staged copies...
    await waitFor(() =>
      expect(invoke.mock.calls.some(([cmd]) => cmd === "clear_staged")).toBe(true),
    );
    // ...and the visible buffers reverted to the originally loaded preview
    // (left/right preview content from read_entry == LEFT_TEXT / RIGHT_TEXT).
    await waitFor(() => expect(setOriginal).toHaveBeenCalledWith(LEFT_TEXT));
    expect(setModified).toHaveBeenCalledWith(RIGHT_TEXT);
  });

  it("Save commits every dirty side via commit_merge", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    // Dirty BOTH sides through a move-hunk (stages left + right).
    await user.click(screen.getByLabelText("Move hunk into left"));
    await waitFor(() => {
      const sides = invoke.mock.calls
        .filter(([cmd]) => cmd === "stage_write")
        .map(([, args]) => (args as { side: string }).side);
      expect(sides).toContain("left");
      expect(sides).toContain("right");
    });

    // Save is enabled once something is staged.
    await user.click(await screen.findByLabelText(/^Save to archive/));

    await waitFor(() => {
      const commits = invoke.mock.calls.filter(([cmd]) => cmd === "commit_merge");
      const committedSides = commits.map(([, args]) => (args as { targetSide: string }).targetSide);
      expect(committedSides).toContain("left");
      expect(committedSides).toContain("right");
    });
  });

  it("creates a right copy-current target, stages Merge all, applies, and replaces only the left source", async () => {
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);

    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);
    await user.click(screen.getByRole("button", { name: "Merge all -> temp" }));
    expect(await screen.findByRole("dialog", { name: "Resolve merge conflicts" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Overwrite all" }));
    await user.click(screen.getByRole("button", { name: "Stage merge decisions" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_temp_merge_all", {
      sourceSide: "left",
      decisions: [{ entryPath: "config.json", action: "overwrite" }],
    }));
    await user.click(await screen.findByRole("button", { name: "Apply to temp (2)" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("apply_temp_merge"));
    expect(await screen.findByText(/1 sources applied/)).toBeInTheDocument();
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Apply to temp (0)" }),
    ).toBeDisabled());

    chooseFile.mockResolvedValueOnce("/tmp/second.jar");
    await clickBrowseFileForSide(user, "left");
    expect(chooseFile).toHaveBeenCalledTimes(2);
    await user.click(await screen.findByRole("button", { name: "Open anyway" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/second.jar", side: "left" },
    ));
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/second.jar", side: "right" },
    );
  });

  it("dismisses conflict review without ending the temp session and can preview again", async () => {
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);
    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);

    await user.click(screen.getByRole("button", { name: "Merge all -> temp" }));
    const review = await screen.findByRole("dialog", { name: "Resolve merge conflicts" });
    await user.click(within(review).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(
      screen.queryByRole("dialog", { name: "Resolve merge conflicts" }),
    ).not.toBeInTheDocument());
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Merge all -> temp" }));
    expect(await screen.findByRole("dialog", { name: "Resolve merge conflicts" })).toBeInTheDocument();
  });

  it("offers Apply, Discard staged, and Cancel before replacing a source with target work", async () => {
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);

    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_copy", {
      from: "left",
      to: "right",
      entryPath: "config.json",
    }));

    chooseFile.mockResolvedValue("/tmp/replacement.jar");
    await clickBrowseFileForSide(user, "left");
    const prompt = await screen.findByRole("dialog", { name: "Apply staged changes before changing source?" });
    expect(within(prompt).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(within(prompt).getByRole("button", { name: "Discard staged" })).toBeInTheDocument();
    await user.click(within(prompt).getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/replacement.jar", side: "left" },
    );

    await clickBrowseFileForSide(user, "left");
    const retryPrompt = await screen.findByRole("dialog", { name: "Apply staged changes before changing source?" });
    await user.click(within(retryPrompt).getByRole("button", { name: "Discard staged" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("unstage", {
      entryPath: "config.json",
      side: "right",
    }));
    await user.click(await screen.findByRole("button", { name: "Open anyway" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/replacement.jar", side: "left" },
    ));
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
  });

  it("applies staged target work before continuing a source replacement", async () => {
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);

    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_copy", {
      from: "left",
      to: "right",
      entryPath: "config.json",
    }));

    chooseFile.mockResolvedValueOnce("/tmp/applied-source.jar");
    await clickBrowseFileForSide(user, "left");
    const prompt = await screen.findByRole("dialog", { name: "Apply staged changes before changing source?" });
    await user.click(within(prompt).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("apply_temp_merge"));
    await user.click(await screen.findByRole("button", { name: "Open anyway" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/applied-source.jar", side: "left" },
    ));
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
  });

  it.each([
    { targetSide: "right" as const, sourceSide: "left" as const },
    { targetSide: "left" as const, sourceSide: "right" as const },
  ])("keeps the $targetSide temporary target while rendering three distinct $sourceSide replacements", async ({ targetSide, sourceSide }) => {
    const user = userEvent.setup();
    installSourceAwareTempFixture(targetSide);
    await openCompareWorkspace(user);
    await clickBrowseFileForSide(user, sourceSide);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/config.json", side: sourceSide },
    ));

    await user.click(screen.getByLabelText(`Change ${targetSide} source`));
    await user.click(await screen.findByRole("button", { name: "Create temp target..." }));
    await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
    await user.click(await screen.findByRole("option", { name: "Copy current source" }));
    await user.click(screen.getByRole("button", { name: "Create temp target" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "create_temp_target",
      { sourceSide, creation: { kind: "copyCurrent" } },
    ));

    for (const path of ["/tmp/second.zip", "/tmp/third.jar", "/tmp/fourth.zip"]) {
      chooseFile.mockResolvedValueOnce(path);
      await clickBrowseFileForSide(user, sourceSide);
      await waitFor(() => expect(invoke).toHaveBeenCalledWith(
        "open_archive",
        { path, side: sourceSide },
      ));
      expect((await screen.findAllByText(sourceMarker(path))).length).toBeGreaterThan(0);
      expect(screen.getByLabelText(`Change ${targetSide} source`)).toHaveTextContent("lcdiff-working.jar");
    }

    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
    expect(invoke.mock.calls.some(([cmd, args]) => (
      cmd === "open_archive" && (args as { side?: "left" | "right" })?.side === targetSide
    ))).toBe(false);
  });

  it.each(["success", "error"] as const)(
    "does not let a delayed Apply diff %s overwrite a newer source replacement",
    async (settlement) => {
      const user = userEvent.setup();
      const fixture = installSourceAwareTempFixture("right");
      await openLeftAndCreateRightTemp(user);

      const initialMarker = sourceMarker("/tmp/config.json");
      const rows = await screen.findAllByText(initialMarker);
      await user.click(rows.find((element) => element.closest("button.tree-file"))!);
      await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_copy", {
        from: "left",
        to: "right",
        entryPath: initialMarker,
      }));

      const staleDiff = deferred<typeof onePairDiff>();
      fixture.deferNextDiff(staleDiff.promise);
      const computeCountBeforeApply = fixture.computeCount();
      await user.click(await screen.findByRole("button", { name: "Apply to temp (1)" }));
      await waitFor(() => expect(fixture.computeCount()).toBe(computeCountBeforeApply + 1));

      const replacementPath = `/tmp/newer-${settlement}.jar`;
      chooseFile.mockResolvedValueOnce(replacementPath);
      await clickBrowseFileForSide(user, "left");
      await user.click(await screen.findByRole("button", { name: "Open anyway" }));
      const replacementMarker = sourceMarker(replacementPath);
      expect((await screen.findAllByText(replacementMarker)).length).toBeGreaterThan(0);

      await act(async () => {
        if (settlement === "success") staleDiff.resolve(sourceAwareDiff("/tmp/stale-apply.jar"));
        else staleDiff.reject(new Error("stale Apply diff failed"));
        await staleDiff.promise.catch(() => undefined);
      });

      await waitFor(() => expect(screen.getAllByText(replacementMarker).length).toBeGreaterThan(0));
      expect(screen.queryByText(sourceMarker("/tmp/stale-apply.jar"))).not.toBeInTheDocument();
    },
  );

  it("never records the app-owned working target in recent Compare history", async () => {
    const seededHistory = [{
      id: JSON.stringify(["compare", ["/tmp/seed-left.jar", "/tmp/seed-right.jar"]]),
      mode: "compare",
      paths: ["/tmp/seed-left.jar", "/tmp/seed-right.jar"],
      openedAt: 1,
    }];
    localStorage.setItem("lcdiff.history", JSON.stringify(seededHistory));
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);

    await waitFor(() => expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument());
    const history = JSON.parse(localStorage.getItem("lcdiff.history") ?? "[]") as Array<{
      mode: string;
      paths: string[];
    }>;
    expect(history.some((entry) => entry.paths.includes(tempSession.workingName))).toBe(false);
    expect(history).toEqual(seededHistory);
  });

  it("blocks legacy Move hunk UI and native actions for the entire temp-owned workspace", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    installSourceAwareTempFixture("right");
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());

    const marker = sourceMarker("/tmp/config.json");
    const rows = await screen.findAllByText(marker);
    await user.click(rows.find((element) => element.closest("button.tree-file"))!);
    expect(screen.queryByRole("button", { name: "Move hunk into right" })).not.toBeInTheDocument();

    const before = { ...buffers };
    invoke.mockClear();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "merge.moveHunkToRight" } });
      await Promise.resolve();
    });
    expect(buffers).toEqual(before);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_write")).toBe(false);
  });

  it("routes native file.save to Apply while a temporary target owns the staged side", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());
    const rows = await screen.findAllByText("config.json");
    await user.click(rows.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_copy", {
      from: "left",
      to: "right",
      entryPath: "config.json",
    }));

    invoke.mockClear();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "file.save" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("apply_temp_merge"));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "commit_merge")).toBe(false);
  });

  it("does not create a false Apply intent when native file.save races an active Save As", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    const saveResult = deferred<typeof tempSession>();
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "save_temp_target_as") return saveResult.promise;
      return defaultInvoke(cmd, args);
    });
    chooseSave.mockResolvedValue("/tmp/in-flight-save.jar");
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());
    const rows = await screen.findAllByText("config.json");
    await user.click(rows.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stage_copy", {
      from: "left",
      to: "right",
      entryPath: "config.json",
    }));

    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "save_temp_target_as",
      { path: "/tmp/in-flight-save.jar" },
    ));
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "file.save" } });
      await Promise.resolve();
    });
    expect(invoke.mock.calls.some(([cmd]) => cmd === "apply_temp_merge")).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(/wait for the temporary merge operation/i);

    await act(async () => {
      saveResult.resolve({ ...tempSession, exportedPath: "/tmp/in-flight-save.jar" });
      await saveResult.promise;
    });
    expect(await screen.findByRole("button", { name: "Apply to temp (1)" })).toBeEnabled();
  });

  it("ignores a stale target-side failure after temp creation takes ownership", async () => {
    const user = userEvent.setup();
    let rejectLateValidation!: (error: Error) => void;
    const lateValidation = new Promise<string>((_resolve, reject) => { rejectLateValidation = reject; });
    invoke.mockImplementation((cmd, args) => {
      if (cmd === "validate_path" && args?.raw === "/tmp/late-right.jar") {
        return lateValidation;
      }
      return defaultInvoke(cmd, args);
    });
    await openCompareWorkspace(user);
    await user.click(screen.getByLabelText("Change left source"));
    await user.click(await screen.findByText("Browse file"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/config.json", side: "left" },
    ));

    chooseFile.mockResolvedValueOnce("/tmp/late-right.jar");
    await user.click(screen.getByLabelText("Change right source"));
    await user.click(await screen.findByText("Browse file"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "validate_path",
      { raw: "/tmp/late-right.jar" },
    ));

    await user.click(await screen.findByRole("button", { name: "Create temp target..." }));
    await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
    await user.click(await screen.findByRole("option", { name: "Copy current source" }));
    await user.click(screen.getByRole("button", { name: "Create temp target" }));
    expect(await screen.findByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();

    rejectLateValidation(new Error("late target validation failed"));
    await act(async () => { await lateValidation.catch(() => undefined); });
    await waitFor(() => expect(invoke).not.toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/late-right.jar", side: "right" },
    ));
    expect(screen.queryByText("Error: late target validation failed")).not.toBeInTheDocument();
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
  });

  it("keeps Apply recovery retry-only across the same repeated failure and then continues source replacement", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    let applyAttempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "apply_temp_merge") {
        applyAttempts += 1;
        if (applyAttempts <= 2) {
          throw new Error("temporary merge Apply recovery is pending; retry Apply");
        }
        return { ...tempSession, appliedSourceCount: 1 };
      }
      return defaultInvoke(cmd, args);
    });
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(appActionHandler).toBeDefined());
    const cells = await screen.findAllByText("config.json");
    await user.click(cells.find((element) => element.closest("button.tree-file"))!);
    await user.click(await screen.findByRole("button", { name: "Copy selected -> temp" }));

    chooseFile.mockResolvedValueOnce("/tmp/after-apply-recovery.jar");
    await clickBrowseFileForSide(user, "left");
    const prompt = await screen.findByRole("dialog", { name: "Apply staged changes before changing source?" });
    await user.click(within(prompt).getByRole("button", { name: "Apply" }));

    const firstRetry = await screen.findByRole("button", { name: "Retry Apply" });
    expect(screen.queryByRole("button", { name: "Save temp as" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard temp" })).not.toBeInTheDocument();
    expect(screen.queryByText(/TEMP TARGET - SESSION ONLY/)).not.toBeInTheDocument();
    await act(async () => {
      appActionHandler?.({ payload: { actionId: "file.save" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(applyAttempts).toBe(2));

    await user.click(firstRetry);
    await waitFor(() => expect(applyAttempts).toBe(3));
    await user.click(await screen.findByRole("button", { name: "Open anyway" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "open_archive",
      { path: "/tmp/after-apply-recovery.jar", side: "left" },
    ));
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
  });

  it("uses the selected Save As path for retry but trusts the backend export path", async () => {
    const user = userEvent.setup();
    let saveAttempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "save_temp_target_as") {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          throw new Error("temporary merge export recovery is pending; retry Save As");
        }
        return { ...tempSession, exportedPath: "/backend/canonical-output.jar" };
      }
      return defaultInvoke(cmd, args);
    });
    chooseSave.mockResolvedValue("/dialog/chosen-output.jar");
    await openLeftAndCreateRightTemp(user);

    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    expect(await screen.findByRole("button", { name: "Retry Save As" })).toBeEnabled();
    expect(screen.queryByText(/TEMP TARGET - SESSION ONLY/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry Save As" }));

    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_temp_target_as")).toEqual([
      ["save_temp_target_as", { path: "/dialog/chosen-output.jar" }],
      ["save_temp_target_as", { path: "/dialog/chosen-output.jar" }],
    ]));
    expect(chooseSave).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText("Temporary merge status")).toHaveTextContent(
      "Exported: /backend/canonical-output.jar",
    );
  });

  it("reserves a single Save As picker while the first picker is unresolved", async () => {
    const user = userEvent.setup();
    const selection = deferred<string | null>();
    chooseSave.mockImplementation(() => selection.promise);
    await openLeftAndCreateRightTemp(user);

    const saveButton = screen.getByRole("button", { name: "Save temp as" });
    await user.click(saveButton);
    await user.click(saveButton);
    expect(chooseSave).toHaveBeenCalledOnce();

    await act(async () => {
      selection.resolve(null);
      await selection.promise;
    });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_temp_target_as")).toHaveLength(0);
  });

  it("ignores an old Save As picker that resolves after a new temp session picker", async () => {
    const user = userEvent.setup();
    const oldSelection = deferred<string | null>();
    const newSelection = deferred<string | null>();
    chooseSave
      .mockImplementationOnce(() => oldSelection.promise)
      .mockImplementationOnce(() => newSelection.promise);
    await openLeftAndCreateRightTemp(user);

    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    await user.click(screen.getByRole("button", { name: "Discard temp" }));
    await user.click(await screen.findByRole("button", { name: "Confirm discard temp" }));
    await waitFor(() => expect(screen.queryByText(/TEMP TARGET - SESSION ONLY/)).not.toBeInTheDocument());

    await user.click(screen.getByLabelText("Change right source"));
    await user.click(await screen.findByRole("button", { name: "Create temp target..." }));
    await user.click(screen.getByRole("combobox", { name: "Temporary target type" }));
    await user.click(await screen.findByRole("option", { name: "Copy current source" }));
    await user.click(screen.getByRole("button", { name: "Create temp target" }));
    expect(await screen.findByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    await act(async () => {
      newSelection.resolve("/tmp/new-session.jar");
      await newSelection.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "save_temp_target_as",
      { path: "/tmp/new-session.jar" },
    ));

    await act(async () => {
      oldSelection.resolve("/tmp/stale-session.jar");
      await oldSelection.promise;
    });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_temp_target_as")).toEqual([
      ["save_temp_target_as", { path: "/tmp/new-session.jar" }],
    ]);
  });

  it("cancels Save As without backend mutation and retries an ordinary failure with the session intact", async () => {
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);
    chooseSave.mockResolvedValueOnce(null);

    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_temp_target_as")).toHaveLength(0);
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();

    let attempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "save_temp_target_as") {
        attempts += 1;
        if (attempts === 1) throw new Error("destination unavailable");
        return { ...tempSession, exportedPath: args?.path as string };
      }
      return defaultInvoke(cmd, args);
    });
    chooseSave.mockResolvedValue("/tmp/retry.jar");
    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    expect(await screen.findByRole("status")).toHaveTextContent("destination unavailable");
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save temp as" }));
    expect(await screen.findByLabelText("Temporary merge status")).toHaveTextContent(
      "Exported: /tmp/retry.jar",
    );
  });

  it("keeps only retry Discard after cleanup failure and converges without exposing the stale target", async () => {
    const user = userEvent.setup();
    let discardAttempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "discard_temp_target") {
        discardAttempts += 1;
        return discardAttempts === 1
          ? { kind: "retryDiscardOnly", message: "cleanup recovery is pending" }
          : { kind: "discarded" };
      }
      return defaultInvoke(cmd, args);
    });
    await openLeftAndCreateRightTemp(user);

    await user.click(screen.getByRole("button", { name: "Discard temp" }));
    await user.click(await screen.findByRole("button", { name: "Confirm discard temp" }));
    expect(await screen.findByRole("button", { name: "Retry Discard" })).toBeEnabled();
    expect(screen.queryByText(/TEMP TARGET - SESSION ONLY/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save temp as" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry Discard" }));
    await waitFor(() => expect(discardAttempts).toBe(2));
    expect(screen.queryByRole("button", { name: "Retry Discard" })).not.toBeInTheDocument();
    expect(screen.queryByText("lcdiff-working.jar")).not.toBeInTheDocument();
  });

  it("blocks temp-owned target drops and navigation before IPC", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(dragDropHandler).toBeDefined());
    invoke.mockClear();

    act(() => dragDropHandler?.({
      payload: { type: "drop", paths: ["/tmp/onto-target.jar"], position: { x: window.innerWidth, y: 20 } },
    }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/temporary target/i));
    expect(invoke).not.toHaveBeenCalledWith("validate_path", { raw: "/tmp/onto-target.jar" });
    expect(invoke).not.toHaveBeenCalledWith("open_archive", expect.objectContaining({ side: "right" }));

    await user.click(screen.getByRole("button", { name: "View mode" }));
    expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();
    expect(screen.getByText(/TEMP TARGET - SESSION ONLY/)).toBeInTheDocument();
  });

  it("keeps close recovery modal with the matching Save As retry and reuses the same path", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    let attempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "save_temp_target_as") {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary merge export recovery is pending; retry Save As");
        }
        return { ...tempSession, exportedPath: args?.path as string };
      }
      return defaultInvoke(cmd, args);
    });
    chooseSave.mockResolvedValue("/tmp/close-recovery.jar");
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(closeRequestHandler).toBeDefined());

    act(() => closeRequestHandler?.({ preventDefault: vi.fn() }));
    const closePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(within(closePrompt).getByRole("button", { name: "Save As" }));
    const recoveryPrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(await within(recoveryPrompt).findByRole("button", { name: "Retry Save As" }));

    await waitFor(() => expect(destroyWindow).toHaveBeenCalledOnce());
    expect(chooseSave).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_temp_target_as")).toEqual([
      ["save_temp_target_as", { path: "/tmp/close-recovery.jar" }],
      ["save_temp_target_as", { path: "/tmp/close-recovery.jar" }],
    ]);
  });

  it("does not retain close-after-success when closing is cancelled while the Save As picker is pending", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    const selection = deferred<string | null>();
    chooseSave.mockImplementation(() => selection.promise);
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(closeRequestHandler).toBeDefined());

    act(() => closeRequestHandler?.({ preventDefault: vi.fn() }));
    const closePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(within(closePrompt).getByRole("button", { name: "Save As" }));
    await user.click(within(closePrompt).getByRole("button", { name: "Cancel" }));

    await act(async () => {
      selection.resolve("/tmp/pending-picker.jar");
      await selection.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "save_temp_target_as",
      { path: "/tmp/pending-picker.jar" },
    ));
    expect(destroyWindow).not.toHaveBeenCalled();
  });

  it("cancels only the close intent during Save As recovery and keeps matching retry available", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    let attempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "save_temp_target_as") {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary merge export recovery is pending; retry Save As");
        }
        return { ...tempSession, exportedPath: args?.path as string };
      }
      return defaultInvoke(cmd, args);
    });
    chooseSave.mockResolvedValue("/tmp/cancel-close.jar");
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(closeRequestHandler).toBeDefined());

    act(() => closeRequestHandler?.({ preventDefault: vi.fn() }));
    let closePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(within(closePrompt).getByRole("button", { name: "Save As" }));
    closePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(await within(closePrompt).findByRole("button", { name: "Cancel closing" }));
    await waitFor(() => expect(
      screen.queryByRole("dialog", { name: "Save temporary target before closing?" }),
    ).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Retry Save As" }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(destroyWindow).not.toHaveBeenCalled();
    expect(chooseSave).toHaveBeenCalledOnce();
  });

  it("guards window close with Save As, Discard, and Cancel and does not bypass discard recovery", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const user = userEvent.setup();
    let discardAttempts = 0;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "discard_temp_target") {
        discardAttempts += 1;
        return discardAttempts === 1
          ? { kind: "retryDiscardOnly", message: "cleanup recovery is pending" }
          : { kind: "discarded" };
      }
      return defaultInvoke(cmd, args);
    });
    await openLeftAndCreateRightTemp(user);
    await waitFor(() => expect(closeRequestHandler).toBeDefined());
    const preventDefault = vi.fn();

    act(() => closeRequestHandler?.({ preventDefault }));
    const closePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(within(closePrompt).getByRole("button", { name: "Save As" })).toBeInTheDocument();
    expect(within(closePrompt).getByRole("button", { name: "Discard" })).toBeInTheDocument();
    await user.click(within(closePrompt).getByRole("button", { name: "Cancel" }));
    expect(destroyWindow).not.toHaveBeenCalled();

    act(() => closeRequestHandler?.({ preventDefault }));
    const retryClosePrompt = await screen.findByRole("dialog", { name: "Save temporary target before closing?" });
    await user.click(within(retryClosePrompt).getByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("button", { name: "Retry Discard" })).toBeEnabled();
    expect(destroyWindow).not.toHaveBeenCalled();

    act(() => closeRequestHandler?.({ preventDefault }));
    const discardRecoveryPrompt = await screen.findByRole("dialog", {
      name: "Save temporary target before closing?",
    });
    expect(screen.getByRole("status")).toHaveTextContent(/retry Discard before closing/i);
    await user.click(within(discardRecoveryPrompt).getByRole("button", { name: "Retry Discard" }));
    await waitFor(() => expect(destroyWindow).toHaveBeenCalledOnce());
  });
});
