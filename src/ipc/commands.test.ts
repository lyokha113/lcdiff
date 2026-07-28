import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
}));

import {
  cancelDeepSearch,
  clearStaged,
  closeViewSource,
  commitMerge,
  commitView,
  computeDiff,
  computeNestedDiff,
  computeViewNestedEntries,
  deepSearch,
  deepSearchViewSource,
  disassemble,
  disassembleViewEntry,
  listSystemFonts,
  listViewSources,
  openArchive,
  openViewSource,
  pendingOpenPaths,
  platformHints,
  prefetchSiblings,
  readEntry,
  readViewEntry,
  search,
  searchViewSource,
  setEngine,
  stageCopy,
  stageViewWrite,
  stageWrite,
  unstage,
  unstageViewWrite,
  validatePath,
} from "@/ipc/commands";
import type {
  AppActionPayload,
  ArchiveEntry,
  ArchiveSourceKind,
  CommitResult,
  DeepSearchMatch,
  EntryPreview,
  OsOpenPathsPayload,
  PairStatus,
  PlatformHints,
  SearchHit,
  SearchProgress,
  ViewSourceSummary,
} from "@/ipc/types";

const options = {
  includePath: true,
  includeText: false,
  includeConstants: true,
};

describe("typed IPC command facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.invoke.mockResolvedValue("wire-result");
  });

  const cases: Array<{
    name: string;
    call: () => Promise<unknown>;
    args?: Record<string, unknown>;
  }> = [
    { name: "validate_path", call: () => validatePath("/tmp/a.jar"), args: { raw: "/tmp/a.jar" } },
    { name: "platform_hints", call: () => platformHints() },
    { name: "list_system_fonts", call: () => listSystemFonts() },
    {
      name: "open_archive",
      call: () => openArchive("/tmp/a.jar", "left"),
      args: { path: "/tmp/a.jar", side: "left" },
    },
    { name: "compute_diff", call: () => computeDiff() },
    {
      name: "compute_nested_diff",
      call: () => computeNestedDiff("lib/inner.jar"),
      args: { nestedPath: "lib/inner.jar" },
    },
    {
      name: "open_view_source",
      call: () => openViewSource("/tmp/view.jar"),
      args: { path: "/tmp/view.jar" },
    },
    { name: "list_view_sources", call: () => listViewSources() },
    {
      name: "read_entry",
      call: () => readEntry("right", "pkg/Main.class"),
      args: { side: "right", entryPath: "pkg/Main.class" },
    },
    {
      name: "read_view_entry",
      call: () => readViewEntry("view-1", "pkg/Main.class"),
      args: { sourceId: "view-1", entryPath: "pkg/Main.class" },
    },
    {
      name: "compute_view_nested_entries",
      call: () => computeViewNestedEntries("view-1", "lib/inner.jar"),
      args: { sourceId: "view-1", nestedPath: "lib/inner.jar" },
    },
    {
      name: "close_view_source",
      call: () => closeViewSource("view-1"),
      args: { sourceId: "view-1" },
    },
    { name: "set_engine", call: () => setEngine("jdCoreV0"), args: { engine: "jdCoreV0" } },
    {
      name: "disassemble",
      call: () => disassemble("left", "pkg/Main.class"),
      args: { side: "left", entryPath: "pkg/Main.class" },
    },
    {
      name: "disassemble_view_entry",
      call: () => disassembleViewEntry("view-1", "pkg/Main.class"),
      args: { sourceId: "view-1", entryPath: "pkg/Main.class" },
    },
    {
      name: "stage_copy",
      call: () => stageCopy("left", "right", "config.json"),
      args: { from: "left", to: "right", entryPath: "config.json" },
    },
    {
      name: "stage_write",
      call: () => stageWrite("right", "config.json", "{\"v\":2}"),
      args: { side: "right", entryPath: "config.json", content: "{\"v\":2}" },
    },
    {
      name: "stage_view_write",
      call: () => stageViewWrite("view-1", "config.json", "{\"v\":3}"),
      args: { sourceId: "view-1", entryPath: "config.json", content: "{\"v\":3}" },
    },
    {
      name: "unstage_view_write",
      call: () => unstageViewWrite("view-1", "config.json"),
      args: { sourceId: "view-1", entryPath: "config.json" },
    },
    {
      name: "commit_view",
      call: () => commitView("view-1", true),
      args: { sourceId: "view-1", backup: true },
    },
    {
      name: "commit_merge",
      call: () => commitMerge("right", false, true),
      args: { targetSide: "right", backup: false, confirmSigned: true },
    },
    { name: "clear_staged", call: () => clearStaged() },
    {
      name: "unstage",
      call: () => unstage("config.json", undefined),
      args: { entryPath: "config.json", side: undefined },
    },
    {
      name: "search",
      call: () => search("left", "Main", options),
      args: { side: "left", query: "Main", options },
    },
    {
      name: "search_view_source",
      call: () => searchViewSource("view-1", "Main", options),
      args: { sourceId: "view-1", query: "Main", options },
    },
    {
      name: "deep_search",
      call: () => deepSearch("right", "Main", 17),
      args: { side: "right", query: "Main", searchId: 17 },
    },
    {
      name: "deep_search_view_source",
      call: () => deepSearchViewSource("view-1", "Main", 18),
      args: { sourceId: "view-1", query: "Main", searchId: 18 },
    },
    { name: "cancel_deep_search", call: () => cancelDeepSearch() },
    {
      name: "prefetch_siblings",
      call: () => prefetchSiblings("left", "pkg/Main.class"),
      args: { side: "left", entryPath: "pkg/Main.class" },
    },
    { name: "pending_open_paths", call: () => pendingOpenPaths() },
  ];

  for (const { name, call, args } of cases) {
    it(`invokes ${name} with its exact wire arguments`, async () => {
      await expect(call()).resolves.toBe("wire-result");
      expect(tauri.invoke).toHaveBeenCalledTimes(1);
      if (args === undefined) {
        expect(tauri.invoke).toHaveBeenCalledWith(name);
      } else {
        expect(tauri.invoke).toHaveBeenCalledWith(name, args);
      }
    });
  }
});

describe("wire DTO declarations", () => {
  it("represent the complete serialized contracts without UI-only enum values", () => {
    const entry: ArchiveEntry = {
      path: "pkg/Main.class",
      kind: "class",
      uncompressedSize: 42,
      compressedSize: 21,
      crc32: 305_419_896,
    };
    const viewSource: ViewSourceSummary = {
      id: "view-1",
      path: "/tmp/a.jar",
      name: "a.jar",
      kind: "archive",
      signed: false,
      entryCount: 1,
    };
    const hints: PlatformHints = {
      os: "linux",
      sessionType: null,
      wayland: false,
      dropHint: null,
    };
    const preview: EntryPreview = {
      path: "pkg/Main.class",
      kind: "class",
      language: "java",
      details: null,
      content: "class Main {}",
    };
    const commit: CommitResult = {
      rewrittenPath: "/tmp/a.jar",
      backupPath: null,
      signatureInvalidated: false,
      copiedEntries: 1,
    };
    const hit: SearchHit = {
      entryPath: "pkg/Main.class",
      kind: "source",
    };
    const progress: SearchProgress = {
      searchId: 7,
      completed: 1,
      total: 3,
      entryPath: "pkg/Main.class",
    };
    const match: DeepSearchMatch = {
      searchId: 7,
      side: "left",
      hit,
    };
    const paths: OsOpenPathsPayload = { paths: ["/tmp/a.jar"] };
    const action: AppActionPayload = { actionId: "open-left-file" };

    expect({ entry, viewSource, hints, preview, commit, hit, progress, match, paths, action }).toBeDefined();
    expectTypeOf<ArchiveSourceKind>().toEqualTypeOf<"archive" | "directory" | "file">();
    expectTypeOf<PairStatus>().toEqualTypeOf<"onlyLeft" | "onlyRight" | "identical" | "different">();
    expectTypeOf<EntryPreview["details"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CommitResult["backupPath"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PlatformHints["sessionType"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PlatformHints["dropHint"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SearchHit["line"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SearchHit["preview"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ViewSourceSummary>().toMatchTypeOf<{ signed: boolean }>();
  });
});
