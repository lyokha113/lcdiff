import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen,
}));

import {
  subscribeAppAction,
  subscribeOsOpenPaths,
  subscribeSearchProgress,
  subscribeSearchResult,
} from "@/ipc/events";

describe("typed IPC event facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.listen.mockResolvedValue(vi.fn());
  });

  it("uses exact event names and forwards typed payloads", async () => {
    const progress = { searchId: 1, completed: 2, total: 3, entryPath: "pkg/Main.class" };
    const result = {
      searchId: 1,
      side: "right" as const,
      hit: { entryPath: "pkg/Main.class", kind: "source" as const, line: 4 },
    };
    const paths = { paths: ["/tmp/a.jar"] };
    const action = { actionId: "open-left-file" };
    const progressHandler = vi.fn();
    const resultHandler = vi.fn();
    const pathsHandler = vi.fn();
    const actionHandler = vi.fn();

    subscribeSearchProgress(progressHandler);
    subscribeSearchResult(resultHandler);
    subscribeOsOpenPaths(pathsHandler);
    subscribeAppAction(actionHandler);

    expect(tauri.listen.mock.calls.map(([name]) => name)).toEqual([
      "search-progress",
      "search-result",
      "os-open-paths",
      "app-action",
    ]);

    tauri.listen.mock.calls[0][1]({ payload: progress });
    tauri.listen.mock.calls[1][1]({ payload: result });
    tauri.listen.mock.calls[2][1]({ payload: paths });
    tauri.listen.mock.calls[3][1]({ payload: action });

    expect(progressHandler).toHaveBeenCalledWith(progress);
    expect(resultHandler).toHaveBeenCalledWith(result);
    expect(pathsHandler).toHaveBeenCalledWith(paths);
    expect(actionHandler).toHaveBeenCalledWith(action);
  });

  it("returns an unlisten handle that disposes a listener registered later", async () => {
    let resolveListen!: (unlisten: () => void) => void;
    tauri.listen.mockReturnValue(new Promise((resolve) => {
      resolveListen = resolve;
    }));
    const stop = vi.fn();

    const unlisten = subscribeAppAction(vi.fn());
    unlisten();
    resolveListen(stop);
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("routes asynchronous listener registration errors to the owner", async () => {
    const error = new Error("listener unavailable");
    tauri.listen.mockRejectedValue(error);
    const onError = vi.fn();

    subscribeOsOpenPaths(vi.fn(), onError);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
