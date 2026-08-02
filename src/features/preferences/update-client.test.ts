import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  openUrl: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: tauri.getVersion,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: tauri.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: tauri.relaunch,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: tauri.openUrl,
}));

import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  downloadPercent,
  IDLE_UPDATE_STATE,
  openUpdateFallback,
  RELEASE_URL,
  restartToApplyUpdate,
  type AppUpdateState,
  type DownloadProgress,
} from "./update-client";
import type { NativeDownloadEvent } from "@/ipc/updater";

type TestUpdate = NonNullable<AppUpdateState["update"]> & {
  downloadAndInstall: ReturnType<typeof vi.fn>;
};

function availableUpdate(version = "0.4.0", body = "Release notes"): TestUpdate {
  return {
    version,
    body,
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  } as unknown as TestUpdate;
}

describe("update client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.getVersion.mockResolvedValue("0.3.4");
    tauri.check.mockResolvedValue(null);
    tauri.openUrl.mockResolvedValue(undefined);
    tauri.relaunch.mockResolvedValue(undefined);
  });

  it("returns upToDate with the current version and release URL when no update exists", async () => {
    const state = await checkForAppUpdate("auto", () => 1000);

    expect(state).toEqual({
      ...IDLE_UPDATE_STATE,
      status: "upToDate",
      source: "auto",
      checkedAt: 1000,
      currentVersion: "0.3.4",
      message: "You are up to date.",
      releaseUrl: RELEASE_URL,
    });
  });

  it("returns available with the latest version, message, and update object", async () => {
    const update = availableUpdate("0.4.0");
    tauri.check.mockResolvedValue(update);

    const state = await checkForAppUpdate("manual", () => 2000);

    expect(state).toMatchObject({
      status: "available",
      source: "manual",
      checkedAt: 2000,
      currentVersion: "0.3.4",
      latestVersion: "0.4.0",
      message: "LCDiff v0.4.0 is available.",
      releaseUrl: RELEASE_URL,
    });
    expect(state.update).toBe(update);
  });

  it("returns fallback when the update check fails", async () => {
    tauri.check.mockRejectedValue(new Error("offline"));

    await expect(checkForAppUpdate("manual", () => 3000)).resolves.toMatchObject({
      status: "fallback",
      source: "manual",
      checkedAt: 3000,
      currentVersion: "0.3.4",
      message: "Could not check for updates.",
      releaseUrl: RELEASE_URL,
    });
  });

  it("transitions to readyToRestart after install succeeds", async () => {
    const update = availableUpdate();
    const state: AppUpdateState = {
      ...IDLE_UPDATE_STATE,
      status: "available",
      source: "manual",
      currentVersion: "0.3.4",
      latestVersion: "0.4.0",
      message: "LCDiff v0.4.0 is available.",
      update,
    };

    await expect(downloadAndInstallAppUpdate(state)).resolves.toEqual({
      ...state,
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
    });
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("returns fallback when install fails", async () => {
    const update = availableUpdate();
    update.downloadAndInstall.mockRejectedValue(new Error("disk full"));
    const state: AppUpdateState = {
      ...IDLE_UPDATE_STATE,
      status: "available",
      source: "manual",
      latestVersion: "0.4.0",
      message: "LCDiff v0.4.0 is available.",
      update,
    };

    await expect(downloadAndInstallAppUpdate(state)).resolves.toEqual({
      ...state,
      status: "fallback",
      message: "Could not install the update.",
    });
  });

  it("returns fallback when install is requested without an available update", async () => {
    await expect(downloadAndInstallAppUpdate(IDLE_UPDATE_STATE)).resolves.toEqual({
      ...IDLE_UPDATE_STATE,
      status: "fallback",
      message: "Native update is not available for this build.",
    });
  });

  it("restarts through the process plugin", async () => {
    await restartToApplyUpdate();

    expect(tauri.relaunch).toHaveBeenCalledOnce();
  });

  it("opens the GitHub release fallback URL", async () => {
    await openUpdateFallback();

    expect(tauri.openUrl).toHaveBeenCalledWith(RELEASE_URL);
  });
});

type EventUpdate = TestUpdate & {
  listener?: (event: NativeDownloadEvent) => void;
  resolveInstall: () => void;
};

function pendingUpdate(): EventUpdate {
  const update = {
    version: "0.4.0",
    body: "Release notes",
    listener: undefined as ((event: NativeDownloadEvent) => void) | undefined,
    resolveInstall: () => undefined,
    downloadAndInstall: vi.fn(),
  } as unknown as EventUpdate;
  update.downloadAndInstall = vi.fn((listener?: (event: NativeDownloadEvent) => void) => {
    update.listener = listener;
    return new Promise<void>((resolve) => {
      update.resolveInstall = resolve;
    });
  }) as unknown as TestUpdate["downloadAndInstall"];
  return update;
}

function availableStateWith(update: TestUpdate): AppUpdateState {
  return {
    ...IDLE_UPDATE_STATE,
    status: "available",
    source: "manual",
    currentVersion: "0.3.4",
    latestVersion: "0.4.0",
    message: "LCDiff v0.4.0 is available.",
    update,
  };
}

describe("download progress reporting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams throttled progress snapshots while downloading", async () => {
    vi.useFakeTimers();
    const update = pendingUpdate();
    const snapshots: DownloadProgress[] = [];
    const promise = downloadAndInstallAppUpdate(availableStateWith(update), (progress) =>
      snapshots.push(progress),
    );

    update.listener?.({ event: "Started", data: { contentLength: 1000 } });
    expect(snapshots).toEqual([{ downloadedBytes: 0, totalBytes: 1000, finished: false }]);

    update.listener?.({ event: "Progress", data: { chunkLength: 100 } });
    update.listener?.({ event: "Progress", data: { chunkLength: 100 } });
    expect(snapshots).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(snapshots.at(-1)).toEqual({ downloadedBytes: 200, totalBytes: 1000, finished: false });

    update.listener?.({ event: "Finished" });
    expect(snapshots.at(-1)).toEqual({ downloadedBytes: 200, totalBytes: 1000, finished: true });

    update.resolveInstall();
    await expect(promise).resolves.toMatchObject({
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
    });
  });

  it("reports indeterminate progress when the content length is unknown", async () => {
    vi.useFakeTimers();
    const update = pendingUpdate();
    const snapshots: DownloadProgress[] = [];
    const promise = downloadAndInstallAppUpdate(availableStateWith(update), (progress) =>
      snapshots.push(progress),
    );

    update.listener?.({ event: "Started", data: {} });
    expect(snapshots.at(-1)).toEqual({ downloadedBytes: 0, totalBytes: null, finished: false });

    update.listener?.({ event: "Progress", data: { chunkLength: 512 } });
    await vi.advanceTimersByTimeAsync(200);
    expect(snapshots.at(-1)).toEqual({ downloadedBytes: 512, totalBytes: null, finished: false });

    update.resolveInstall();
    await expect(promise).resolves.toMatchObject({ status: "readyToRestart" });
  });

  it("clears progress from the terminal state", async () => {
    const update = availableUpdate();
    const state = availableStateWith(update);

    const next = await downloadAndInstallAppUpdate(state, () => undefined);

    expect(next.progress).toBeUndefined();
  });
});

describe("downloadPercent", () => {
  it("returns 100 once the download finishes", () => {
    expect(downloadPercent({ downloadedBytes: 50, totalBytes: 100, finished: true })).toBe(100);
  });

  it("returns null when the total is unknown", () => {
    expect(downloadPercent({ downloadedBytes: 50, totalBytes: null, finished: false })).toBeNull();
  });

  it("floors partial progress and caps at 99 while downloading", () => {
    expect(downloadPercent({ downloadedBytes: 50, totalBytes: 100, finished: false })).toBe(50);
    expect(downloadPercent({ downloadedBytes: 999, totalBytes: 1000, finished: false })).toBe(99);
  });
});
