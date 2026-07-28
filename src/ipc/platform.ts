import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

export type Unlisten = () => void;
type ListenErrorHandler = (error: unknown) => void;

export type WindowDragDropEvent = {
  payload:
    | { type: "enter"; paths: string[]; position: { x: number; y: number } }
    | { type: "over"; position: { x: number; y: number } }
    | { type: "drop"; paths: string[]; position: { x: number; y: number } }
    | { type: "leave" };
};

export type WindowCloseRequestEvent = {
  preventDefault(): void;
};

function ownRegistration(
  register: () => Promise<Unlisten>,
  onError?: ListenErrorHandler,
): Unlisten {
  let disposed = false;
  let stop: Unlisten | undefined;

  void register()
    .then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stop = unlisten;
      }
    })
    .catch((error: unknown) => {
      if (!disposed) onError?.(error);
    });

  return () => {
    if (disposed) return;
    disposed = true;
    stop?.();
    stop = undefined;
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function assetUrl(path: string): string {
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

export function openPathDialog(
  options?: OpenDialogOptions & { multiple?: false },
): Promise<string | null>;
export function openPathDialog(
  options: OpenDialogOptions & { multiple: true },
): Promise<string[] | null>;
export function openPathDialog(
  options?: OpenDialogOptions,
): Promise<string | string[] | null> {
  return open(options);
}

export function subscribeWindowDragDrop(
  handler: (event: WindowDragDropEvent) => void,
  onError?: ListenErrorHandler,
): Unlisten {
  return ownRegistration(
    () => getCurrentWindow().onDragDropEvent((event) => handler(event as WindowDragDropEvent)),
    onError,
  );
}

export function subscribeWindowCloseRequested(
  handler: (event: WindowCloseRequestEvent) => void,
  onError?: ListenErrorHandler,
): Unlisten {
  return ownRegistration(
    () => getCurrentWindow().onCloseRequested(handler),
    onError,
  );
}

export function destroyCurrentWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}
