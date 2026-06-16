import { render, screen, waitFor } from "@testing-library/react";
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
function fileSummary(side: "left" | "right") {
  return {
    path: side === "left" ? "/tmp/config.json" : "/tmp/other/config.json",
    metadata: { sourceKind: summarySourceKind, signed: false, multiRelease: false, zip64: false },
    entries: [FILE_ENTRY],
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

const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "platform_hints":
      return { os: "linux", sessionType: null, wayland: false, dropHint: null };
    case "validate_path":
      return (args?.raw as string) ?? "/tmp/config.json";
    case "open_archive":
      return fileSummary(args?.side as "left" | "right");
    case "compute_diff":
      return onePairDiff;
    case "read_entry":
      return entryPreview(args?.side as "left" | "right");
    case "search":
      return [
        { entryPath: "config.json", kind: "path" as const },
        { entryPath: "config.json", kind: "text" as const, line: 2, preview: '"v": 2' },
      ];
    case "deep_search":
      if (deepSearchBlock) await deepSearchBlock.promise;
      if (deepSearchError) throw deepSearchError;
      return [{ entryPath: "config.json", kind: "source" as const, line: 3, preview: "class Config" }];
    case "cancel_deep_search":
      return undefined;
    case "stage_write":
    case "prefetch_siblings":
    case "clear_staged":
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
});

// Deferred arrow: vi.mock factories are hoisted above the `invoke`/`chooseFile`
// declarations, so reference them lazily to avoid a TDZ error at mock time.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async () => vi.fn()),
    onCloseRequested: vi.fn(async () => vi.fn()),
    destroy: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));

// chooseFile (plugin-dialog `open`) returns a fixed path; openPath then drives
// validate_path + open_archive.
const chooseFile = vi.fn(async () => "/tmp/config.json");
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => chooseFile() }));

// Mutable buffers so setValue is observable and moveHunk has real text to chew.
const LEFT_TEXT = '{\n  "v": 1\n}\n';
const RIGHT_TEXT = '{\n  "v": 2\n}\n';
const buffers = { left: LEFT_TEXT, right: RIGHT_TEXT };
const setOriginal = vi.fn((v: string) => { buffers.left = v; });
const setModified = vi.fn((v: string) => { buffers.right = v; });

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

function makeFakeDiffEditor() {
  // App's search-highlight effect calls deltaDecorations/revealLineInCenter on
  // each sub-editor whenever preview changes, so the fakes must expose them.
  const subEditor = (buf: "left" | "right", set: typeof setOriginal) => ({
    getValue: () => buffers[buf],
    setValue: set,
    onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
    getPosition: () => ({ lineNumber: 2 }),
    getModel: () => ({
      findMatches: vi.fn(() => [
        { range: { startLineNumber: 2 } },
      ]),
    }),
    deltaDecorations: vi.fn(() => []),
    revealLineInCenter: vi.fn(),
  });
  const original = subEditor("left", setOriginal);
  const modified = subEditor("right", setModified);
  return {
    getOriginalEditor: () => original,
    getModifiedEditor: () => modified,
    getLineChanges: () => lineChanges,
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
  DiffEditor: ({ onMount }: { onMount?: (e: unknown, m: unknown) => void }) => {
    onMount?.(makeFakeDiffEditor(), {});
    return <div data-testid="diff-editor" />;
  },
}));

// App must be imported AFTER the mocks are registered.
import { App } from "@/App";

async function driveIntoFileCompare(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  // Splash → Compare / Merge workspace.
  await user.click(screen.getByText("Compare / Merge"));

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

describe("App file-merge wiring", () => {
  beforeEach(() => {
    invoke.mockClear();
    chooseFile.mockClear();
    setOriginal.mockClear();
    setModified.mockClear();
    buffers.left = LEFT_TEXT;
    buffers.right = RIGHT_TEXT;
    lineChanges = [MODIFY_LINE_2];
    summarySourceKind = "file";
    deepSearchBlock = undefined;
    deepSearchError = undefined;
    localStorage.clear();
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

  it("applies persisted UI preferences to the app shell", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ldiff.uiPreferences.v1", JSON.stringify({
      appearance: { density: "comfortable", radius: "soft", motion: "reduced" },
      typography: { editorScale: 15 },
    }));

    render(<App />);
    await user.click(screen.getByText("Compare / Merge"));

    const shell = await screen.findByRole("main");
    await waitFor(() => expect(shell.dataset.density).toBe("comfortable"));
    expect(shell.dataset.radius).toBe("soft");
    expect(shell.dataset.motion).toBe("reduced");
    expect(shell.style.getPropertyValue("--ldiff-editor-font-size")).toBe("15px");
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
