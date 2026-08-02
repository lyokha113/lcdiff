import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

export type NativeDownloadEvent = DownloadEvent;
export type NativeDownloadListener = (event: NativeDownloadEvent) => void;

export type NativeUpdate = {
  version: string;
  body?: string;
  downloadAndInstall(onEvent?: NativeDownloadListener): Promise<void>;
};

export function getAppVersion(): Promise<string> {
  return getVersion();
}

export async function checkNativeUpdate(): Promise<NativeUpdate | null> {
  return check();
}

export function relaunchApp(): Promise<void> {
  return relaunch();
}

export function openExternalUrl(url: string): Promise<void> {
  return openUrl(url);
}
