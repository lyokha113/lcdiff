import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const FILE_ENTRY = { path: "config.json", kind: "text" as const, uncompressedSize: 8 };

// Source kind the open_archive mock reports. Default "file" (plain-file compare);
// tests can flip to "archive" to exercise hunk-merge on entries inside a jar.
let summarySourceKind: "file" | "archive" = "file";
let deepSearchBlock: { promise: Promise<void> } | undefined;
let deepSearchError: Error | undefined;
let deferredAppActionListen: Promise<() => void> | undefined;
let appActionHandler: ((event: { payload: { actionId: string } }) => void) | undefined;
let osOpenPathsHandler: ((event: { payload: { paths: string[] } }) => void) | undefined;
const viewRootEntries: Record<string, string[]> = {
  "view:/tmp/alpha.jar": ["Alpha.class", "alpha.json"],
  "view:/tmp/beta.jar": ["beta.json"],
  "view:/tmp/from-finder.jar": ["finder.json"],
};
function fileSummary(side: "left" | "right") {
  return {
    path: side === "left" ? "/tmp/config.json" : "/tmp/other/config.json",
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
    entryCount: viewRootEntries[`view:${path}`]?.length ?? 1,
  };
}

const onePairDiff = {
  pairs: [
    {
      path: "config.json",
      status: "different" as const,
      left: { path: "config.json", kind: "text" as const },
      right: { path: "config.json", kind: "text" as const },
    },
  ],
};

function entryPreview(side: "left" | "right") {
  return {
    path: "config.json",
    kind: "text" as const,
    language: "json",
    content: side === "left" ? '{\n  "v": 1\n}\n' : '{\n  "v": 2\n}\n',
  };
}

function entryKind(path: string) {
  return path.endsWith(".class") ? "class" as const : "text" as const;
}

const defaultInvoke = async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "platform_hints":
      return { os: "linux", sessionType: null, wayland: false, dropHint: null };
    case "pending_open_paths":
      return [];
    case "list_system_fonts":
      return [
        { family: "Menlo", monospaceLikely: true },
        { family: "Helvetica Neue", monospaceLikely: false },
      ];
    case "validate_path":
      return (args?.raw as string) ?? "/tmp/config.json";
    case "open_archive":
      return fileSummary(args?.side as "left" | "right");
    case "open_view_source":
      return viewSummary(args?.path as string);
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
    case "prefetch_siblings":
    case "clear_staged":
    case "close_view_source":
      return undefined;
    case "commit_merge":
      return {
        rewrittenPath: "/tmp/config.json",
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
    onDragDropEvent: vi.fn(async () => vi.fn()),
    onCloseRequested: vi.fn(async () => vi.fn()),
    destroy: vi.fn(),
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
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (options?: OpenDialogOptions) => chooseFile(options) }));

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
let blurOriginalEditor: (() => void) | undefined;
let blurModifiedEditor: (() => void) | undefined;

function makeFakeDiffEditor() {
  // App's search-highlight effect calls deltaDecorations/revealLineInCenter on
  // each sub-editor whenever preview changes, so the fakes must expose them.
  const subEditor = (buf: "left" | "right", set: typeof setOriginal, reveal: typeof revealOriginal) => ({
    getValue: () => buffers[buf],
    setValue: set,
    onDidBlurEditorText: vi.fn((handler: () => void) => {
      if (buf === "left") blurOriginalEditor = handler;
      else blurModifiedEditor = handler;
      return { dispose: vi.fn() };
    }),
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

// App imports "@/lib/monaco" purely for side effects (worker wiring); it pulls
// in `monaco-editor` and `?worker` modules vitest cannot resolve. Stub it.
vi.mock("@/lib/monaco", () => ({}));

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  // Single editor (single mode) — never reached here, stub it out.
  default: () => <div data-testid="editor" />,
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
import { App } from "@/App";

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
  // Splash → Compare / Merge workspace.
  await user.click(screen.getByText("Compare / Merge"));
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
  await user.click(screen.getByText("Compare / Merge"));
}

async function browseViewSource(user: ReturnType<typeof userEvent.setup>) {
  let browseButton = screen.queryByRole("button", { name: /Browse file/i });
  if (!browseButton) {
    await user.click(screen.getByLabelText("Change left source"));
    browseButton = await screen.findByRole("button", { name: /Browse file/i });
  }
  await user.click(browseButton);
}

describe("App file-merge wiring", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation(defaultInvoke);
    chooseFile.mockReset();
    chooseFile.mockImplementation(async () => "/tmp/config.json");
    setOriginal.mockClear();
    setModified.mockClear();
    revealOriginal.mockClear();
    revealModified.mockClear();
    focusOriginalEditor = undefined;
    blurOriginalEditor = undefined;
    blurModifiedEditor = undefined;
    diffEditorProps = {};
    buffers.left = LEFT_TEXT;
    buffers.right = RIGHT_TEXT;
    lineChanges = [MODIFY_LINE_2];
    diffEditorMounted = false;
    summarySourceKind = "file";
    deepSearchBlock = undefined;
    deepSearchError = undefined;
    deferredAppActionListen = undefined;
    appActionHandler = undefined;
    osOpenPathsHandler = undefined;
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
  });

  it("renders a landmark-based comparison workspace", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Compare two sources" }));

    expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Open files" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Workspace canvas" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("opens editable Text mode without source pickers, tree controls, merge controls, or staging", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(invoke.mock.calls.some(([cmd]) => cmd === "open_archive")).toBe(false);
    expect(screen.getByRole("main", { name: "Text comparison workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Left File/Folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Open files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tree expansion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Diff block navigation" })).not.toBeInTheDocument();
    expect(screen.queryByText(/LEFT: Left free text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/RIGHT: Right free text/)).not.toBeInTheDocument();
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
    expect(diffEditorProps.options?.readOnly).toBe(false);
    expect(diffEditorProps.options?.originalEditable).toBe(true);
    await waitFor(() => expect(blurOriginalEditor).toBeDefined());
    await waitFor(() => expect(blurModifiedEditor).toBeDefined());

    buffers.left = "left pasted text";
    buffers.right = "right typed text";
    act(() => blurOriginalEditor?.());
    act(() => blurModifiedEditor?.());

    await waitFor(() => expect(screen.getByTestId("diff-original")).toHaveTextContent("left pasted text"));
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("right typed text");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "stage_write")).toBe(false);
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

  it("opens multiple View sources and switches the active source tree", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open one source" }));
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

    await user.click(screen.getByRole("button", { name: "Open one source" }));
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

  it("hides compare-only controls in multi-source View mode", async () => {
    const user = userEvent.setup();
    chooseFile
      .mockResolvedValueOnce("/tmp/alpha.jar")
      .mockResolvedValueOnce("/tmp/beta.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open one source" }));
    await browseViewSource(user);
    await browseViewSource(user);

    expect(screen.getByRole("main", { name: "Source workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tree filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tree expansion" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save to archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show pending changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear staged" })).not.toBeInTheDocument();
  });

  it("enables bytecode for class entries in View mode", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open one source" }));
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

    await user.click(screen.getByRole("button", { name: "Open one source" }));
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

  it("runs decompiled source search against the active View source", async () => {
    const user = userEvent.setup();
    chooseFile.mockResolvedValueOnce("/tmp/alpha.jar");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open one source" }));
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

  it("renders pane-specific actions in Compare mode and removes them in View mode", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(screen.getByRole("group", { name: "Actions into left pane" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Actions into right pane" })).toBeInTheDocument();

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    try {
      const modeSelect = screen.getByRole("combobox", { name: "Mode" });
      fireEvent.keyDown(modeSelect, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("option", { name: "View" }));
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }

    expect(screen.queryByRole("group", { name: "Actions into left pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions into right pane" })).not.toBeInTheDocument();
  });

  it("clears stale Compare tabs when switching to View mode", async () => {
    const user = userEvent.setup();
    await driveIntoFileCompare(user);

    expect(screen.getByRole("tab", { name: /config\.json/ })).toHaveAttribute("aria-selected", "true");

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    try {
      const modeSelect = screen.getByRole("combobox", { name: "Mode" });
      fireEvent.keyDown(modeSelect, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("option", { name: "View" }));
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }

    expect(screen.getByRole("tab", { name: /Files/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();
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

  it("applies persisted Appearance preferences to the app shell", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lcdiff.uiPreferences.v1", JSON.stringify({
      appearance: { colorPattern: "light" },
      editor: { fontFamily: "Menlo", fontSize: 15 },
    }));

    render(<App />);
    await user.click(screen.getByText("Compare / Merge"));

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
    await user.click(screen.getByText("Compare / Merge"));

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
    await user.click(screen.getByText("Compare / Merge"));
    await user.click(screen.getByLabelText("Preferences"));
    await user.click(screen.getByRole("button", { name: "Editor" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_system_fonts"));
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
    await user.click(screen.getByText("Compare / Merge"));
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
    await user.click(screen.getByText("Compare / Merge"));

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

  it("blocks the right-directory shortcut in Decompile/View mode with the Compare-only message", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("Decompile"));

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
    await user.click(screen.getByText("Compare / Merge"));

    expect(screen.queryByPlaceholderText(/Search paths, text, constants/)).not.toBeInTheDocument();
  });

  it("Cmd/Ctrl+, toggles Preferences open", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("Compare / Merge"));

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
    await user.click(screen.getByText("Compare / Merge"));

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
    await user.click(screen.getByText("Compare / Merge"));
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
});
