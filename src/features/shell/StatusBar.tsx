import { Button } from "@/components/ui/button";
import type { TempMergeSessionSummary } from "@/ipc/types";
import { downloadPercent, type DownloadProgress } from "@/features/preferences/update-client";
import { formatByteRange } from "@/lib/format";

export interface StatusBarUpdatePrompt {
  status: "available" | "downloading" | "readyToRestart" | "fallback" | "error";
  message: string;
  primaryLabel?: string;
  fallbackLabel?: string;
  progress?: DownloadProgress;
  onPrimaryAction?: () => void;
  onFallbackAction?: () => void;
}

interface StatusBarProps {
  message: string;
  searching: boolean;
  pendingCount: number;
  tempSession?: TempMergeSessionSummary;
  tempStagedCount?: number;
  tempConflictCount?: number;
  updatePrompt?: StatusBarUpdatePrompt;
}

export function StatusBar({
  message,
  searching,
  pendingCount,
  tempSession,
  tempStagedCount = 0,
  tempConflictCount = 0,
  updatePrompt,
}: StatusBarProps) {
  const showPrimary = updatePrompt?.primaryLabel && updatePrompt.onPrimaryAction;
  const showFallback = updatePrompt?.status !== "readyToRestart" && updatePrompt?.fallbackLabel && updatePrompt.onFallbackAction;
  const progress = updatePrompt?.status === "downloading" ? updatePrompt.progress : undefined;
  const progressPercent = progress ? downloadPercent(progress) : null;
  const progressLabel =
    progress && progress.totalBytes != null && progress.totalBytes > 0
      ? `${progressPercent}% · ${formatByteRange(progress.downloadedBytes, progress.totalBytes)}`
      : null;

  return (
    <footer className="status-bar" data-tour="status">
      <p role="status" aria-live="polite">
        <span className={`status-bar__pulse${searching ? " active" : ""}`} aria-hidden="true" />
        {message}
      </p>
      <div className="status-bar__meta">
        {searching && <span>Searching sources</span>}
        {tempSession && (
          <span className="status-bar__temp" aria-label="Temporary merge status">
            Temp {tempSession.workingName}
            {` · ${tempSession.appliedSourceCount} source${tempSession.appliedSourceCount === 1 ? "" : "s"} applied`}
            {` · ${tempStagedCount} staged`}
            {` · ${tempConflictCount} conflict${tempConflictCount === 1 ? "" : "s"}`}
            {tempSession.exportedPath
              ? ` · Exported: ${tempSession.exportedPath}`
              : " · Not exported"}
          </span>
        )}
        {updatePrompt && (
          <span className={`status-bar__update status-bar__update--${updatePrompt.status}`} aria-live="polite">
            <span className="status-bar__update-text">{updatePrompt.message}</span>
            {progress && (
              <>
                <span
                  className="status-bar__progress"
                  role="progressbar"
                  aria-label="Update download progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent ?? undefined}
                >
                  <span
                    className={`status-bar__progress-fill${progressPercent === null ? " indeterminate" : ""}`}
                    style={progressPercent === null ? undefined : { width: `${progressPercent}%` }}
                  />
                </span>
                {progressLabel && <span className="status-bar__progress-text">{progressLabel}</span>}
              </>
            )}
            {showPrimary && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={updatePrompt.onPrimaryAction}
              >
                {updatePrompt.primaryLabel}
              </Button>
            )}
            {showFallback && (
              <Button type="button" variant="ghost" size="xs" onClick={updatePrompt.onFallbackAction}>
                {updatePrompt.fallbackLabel}
              </Button>
            )}
          </span>
        )}
        <span className="status-bar__pending">
          {pendingCount === 0 ? "No pending changes" : `${pendingCount} pending`}
        </span>
      </div>
    </footer>
  );
}
