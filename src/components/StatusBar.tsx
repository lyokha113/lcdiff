import { Button } from "@/components/ui/button";

export interface StatusBarUpdatePrompt {
  status: "available" | "readyToRestart" | "fallback" | "error";
  message: string;
  primaryLabel?: string;
  fallbackLabel?: string;
  onPrimaryAction?: () => void;
  onFallbackAction?: () => void;
}

interface StatusBarProps {
  message: string;
  searching: boolean;
  pendingCount: number;
  updatePrompt?: StatusBarUpdatePrompt;
}

export function StatusBar({ message, searching, pendingCount, updatePrompt }: StatusBarProps) {
  const showPrimary = updatePrompt?.primaryLabel && updatePrompt.onPrimaryAction;
  const showFallback = updatePrompt?.status !== "readyToRestart" && updatePrompt?.fallbackLabel && updatePrompt.onFallbackAction;

  return (
    <footer className="status-bar" data-tour="status">
      <p role="status" aria-live="polite">
        <span className={`status-bar__pulse${searching ? " active" : ""}`} aria-hidden="true" />
        {message}
      </p>
      <div className="status-bar__meta">
        {searching && <span>Searching sources</span>}
        {updatePrompt && (
          <span className={`status-bar__update status-bar__update--${updatePrompt.status}`} aria-live="polite">
            <span className="status-bar__update-text">{updatePrompt.message}</span>
            {showPrimary && (
              <Button type="button" variant="secondary" size="xs" onClick={updatePrompt.onPrimaryAction}>
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
