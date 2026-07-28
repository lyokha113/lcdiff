import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => {
  const currentWindow = {
    onDragDropEvent: vi.fn(),
    onCloseRequested: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    convertFileSrc: vi.fn(),
    currentWindow,
    getCurrentWindow: vi.fn(() => currentWindow),
    open: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: tauri.convertFileSrc,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: tauri.getCurrentWindow,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: tauri.open,
}));

import {
  assetUrl,
  destroyCurrentWindow,
  isTauriRuntime,
  openPathDialog,
  subscribeWindowCloseRequested,
  subscribeWindowDragDrop,
} from "@/ipc/platform";

describe("platform adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    tauri.convertFileSrc.mockReturnValue("asset://font.ttf");
    tauri.currentWindow.onDragDropEvent.mockResolvedValue(vi.fn());
    tauri.currentWindow.onCloseRequested.mockResolvedValue(vi.fn());
    tauri.currentWindow.destroy.mockResolvedValue(undefined);
    tauri.open.mockResolvedValue("/tmp/a.jar");
  });

  it("forwards exact dialog options and returns the selected path", async () => {
    const options = {
      multiple: false as const,
      filters: [{ name: "Archives", extensions: ["jar", "zip"] }],
    };

    await expect(openPathDialog(options)).resolves.toBe("/tmp/a.jar");
    expect(tauri.open).toHaveBeenCalledWith(options);
  });

  it("keeps asset paths unchanged in a browser and converts them in Tauri", () => {
    expect(isTauriRuntime()).toBe(false);
    expect(assetUrl("/tmp/font.ttf")).toBe("/tmp/font.ttf");
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
    expect(assetUrl("/tmp/font.ttf")).toBe("asset://font.ttf");
    expect(tauri.convertFileSrc).toHaveBeenCalledWith("/tmp/font.ttf");
  });

  it("forwards drag/drop and close-request events", () => {
    const onDrop = vi.fn();
    const onClose = vi.fn();
    subscribeWindowDragDrop(onDrop);
    subscribeWindowCloseRequested(onClose);

    const dropEvent = {
      payload: { type: "drop" as const, paths: ["/tmp/a.jar"], position: { x: 10, y: 20 } },
    };
    const closeEvent = { preventDefault: vi.fn() };
    tauri.currentWindow.onDragDropEvent.mock.calls[0][0](dropEvent);
    tauri.currentWindow.onCloseRequested.mock.calls[0][0](closeEvent);

    expect(onDrop).toHaveBeenCalledWith(dropEvent);
    expect(onClose).toHaveBeenCalledWith(closeEvent);
  });

  it("disposes a delayed platform listener registration after unmount", async () => {
    let resolveListen!: (unlisten: () => void) => void;
    tauri.currentWindow.onDragDropEvent.mockReturnValue(new Promise((resolve) => {
      resolveListen = resolve;
    }));
    const stop = vi.fn();

    const unlisten = subscribeWindowDragDrop(vi.fn());
    unlisten();
    resolveListen(stop);
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("destroys the current native window through the adapter", async () => {
    await destroyCurrentWindow();

    expect(tauri.currentWindow.destroy).toHaveBeenCalledOnce();
  });
});
