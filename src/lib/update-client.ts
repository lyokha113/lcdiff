import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export const RELEASE_URL = "https://github.com/lyokha113/lcdiff/releases/latest";

export type UpdateSource = "auto" | "manual";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "readyToRestart"
  | "fallback"
  | "error";

export type AppUpdateState = {
  status: UpdateStatus;
  releaseUrl: string;
  source?: UpdateSource;
  checkedAt?: number;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
  update?: Update;
};

export const IDLE_UPDATE_STATE: AppUpdateState = {
  status: "idle",
  releaseUrl: RELEASE_URL,
};

async function appVersion(): Promise<string | undefined> {
  try {
    return await getVersion();
  } catch {
    return undefined;
  }
}

export async function checkForAppUpdate(
  source: UpdateSource,
  now: () => number = Date.now,
): Promise<AppUpdateState> {
  const checkedAt = now();
  const currentVersion = await appVersion();

  try {
    const update = await check();
    if (!update) {
      return {
        ...IDLE_UPDATE_STATE,
        status: "upToDate",
        source,
        checkedAt,
        currentVersion,
        message: "You are up to date.",
      };
    }

    return {
      ...IDLE_UPDATE_STATE,
      status: "available",
      source,
      checkedAt,
      currentVersion,
      latestVersion: update.version,
      message: `LCDiff v${update.version} is available.`,
      update,
    };
  } catch {
    return {
      ...IDLE_UPDATE_STATE,
      status: "fallback",
      source,
      checkedAt,
      currentVersion,
      message: "Could not check for updates.",
    };
  }
}

export async function downloadAndInstallAppUpdate(state: AppUpdateState): Promise<AppUpdateState> {
  if (state.status !== "available" || !state.update) {
    return {
      ...state,
      status: "fallback",
      message: "Native update is not available for this build.",
    };
  }

  try {
    await state.update.downloadAndInstall();
    return {
      ...state,
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
    };
  } catch {
    return {
      ...state,
      status: "fallback",
      message: "Could not install the update.",
    };
  }
}

export async function restartToApplyUpdate(): Promise<void> {
  await relaunch();
}

export async function openUpdateFallback(url = RELEASE_URL): Promise<void> {
  await openUrl(url);
}
