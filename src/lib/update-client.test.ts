import { beforeEach, describe, expect, it, vi } from "vitest";

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
  IDLE_UPDATE_STATE,
  openUpdateFallback,
  RELEASE_URL,
  restartToApplyUpdate,
  type AppUpdateState,
} from "@/lib/update-client";

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
