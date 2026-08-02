import {
  checkNativeUpdate,
  getAppVersion,
  openExternalUrl,
  relaunchApp,
  type NativeUpdate,
} from "@/ipc/updater";

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

export type DownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  finished: boolean;
};

export type AppUpdateState = {
  status: UpdateStatus;
  releaseUrl: string;
  source?: UpdateSource;
  checkedAt?: number;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
  update?: NativeUpdate;
  progress?: DownloadProgress;
};

export const IDLE_UPDATE_STATE: AppUpdateState = {
  status: "idle",
  releaseUrl: RELEASE_URL,
};

async function appVersion(): Promise<string | undefined> {
  try {
    return await getAppVersion();
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
    const update = await checkNativeUpdate();
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

export function downloadPercent(progress: DownloadProgress): number | null {
  if (progress.finished) return 100;
  if (progress.totalBytes == null || progress.totalBytes <= 0) return null;
  return Math.min(99, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100));
}

const PROGRESS_THROTTLE_MS = 200;

export async function downloadAndInstallAppUpdate(
  state: AppUpdateState,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<AppUpdateState> {
  if (state.status !== "available" || !state.update) {
    return {
      ...state,
      status: "fallback",
      message: "Native update is not available for this build.",
    };
  }

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  let finished = false;
  let lastEmitAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmitAt < PROGRESS_THROTTLE_MS) {
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = undefined;
          lastEmitAt = Date.now();
          onProgress({ downloadedBytes, totalBytes, finished });
        }, PROGRESS_THROTTLE_MS);
      }
      return;
    }
    lastEmitAt = now;
    onProgress({ downloadedBytes, totalBytes, finished });
  };

  try {
    await state.update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? null;
        downloadedBytes = 0;
        emit(true);
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        emit();
      } else {
        finished = true;
        emit(true);
      }
    });
    if (trailingTimer) clearTimeout(trailingTimer);
    return {
      ...state,
      status: "readyToRestart",
      message: "Update downloaded. Restart to finish.",
      progress: undefined,
    };
  } catch {
    if (trailingTimer) clearTimeout(trailingTimer);
    return {
      ...state,
      status: "fallback",
      message: "Could not install the update.",
      progress: undefined,
    };
  }
}

export async function restartToApplyUpdate(): Promise<void> {
  await relaunchApp();
}

export async function openUpdateFallback(url = RELEASE_URL): Promise<void> {
  await openExternalUrl(url);
}
