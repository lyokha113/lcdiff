import { Button } from "@/components/ui/button";
import type { TempMergeSessionSummary } from "@/ipc/types";

export interface StatusBarUpdatePrompt {
  status: "available" | "downloading" | "readyToRestart" | "fallback" | "error";
  message: string;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  fallbackLabel?: string;
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
  const showPrimary = updatePrompt?.primaryLabel && (updatePrompt.onPrimaryAction || updatePrompt.primaryDisabled);
  const showFallback = updatePrompt?.status !== "readyToRestart" && updatePrompt?.fallbackLabel && updatePrompt.onFallbackAction;

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
            {showPrimary && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={updatePrompt.primaryDisabled}
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
