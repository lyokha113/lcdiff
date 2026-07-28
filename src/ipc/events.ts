import { listen } from "@tauri-apps/api/event";
import type {
  AppActionPayload,
  DeepSearchMatch,
  OsOpenPathsPayload,
  SearchProgress,
} from "@/ipc/types";

export type Unlisten = () => void;
type EventHandler<T> = (payload: T) => void;
type ListenErrorHandler = (error: unknown) => void;

function subscribe<T>(
  eventName: string,
  handler: EventHandler<T>,
  onError?: ListenErrorHandler,
): Unlisten {
  let disposed = false;
  let stop: Unlisten | undefined;

  void listen<T>(eventName, (event) => handler(event.payload))
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

export function subscribeSearchProgress(
  handler: EventHandler<SearchProgress>,
  onError?: ListenErrorHandler,
): Unlisten {
  return subscribe("search-progress", handler, onError);
}

export function subscribeSearchResult(
  handler: EventHandler<DeepSearchMatch>,
  onError?: ListenErrorHandler,
): Unlisten {
  return subscribe("search-result", handler, onError);
}

export function subscribeOsOpenPaths(
  handler: EventHandler<OsOpenPathsPayload>,
  onError?: ListenErrorHandler,
): Unlisten {
  return subscribe("os-open-paths", handler, onError);
}

export function subscribeAppAction(
  handler: EventHandler<AppActionPayload>,
  onError?: ListenErrorHandler,
): Unlisten {
  return subscribe("app-action", handler, onError);
}
