import { ArrowRightLeft, ChevronDown, Pencil, RefreshCw, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TempMergeSessionSummary } from "@/ipc/types";
import type { Mode, Side } from "@/lib/types";

interface PendingOperation {
  key: string;
  path: string;
  side: Side;
  kind: "copy" | "edit";
}

interface MenuBarProps {
  mode: Mode;
  stagedTarget?: Side;
  pendingOps: PendingOperation[];
  canRefresh: boolean;
  onSave: (side: Side) => void;
  onRefresh: () => void;
  onClearStaged: () => void;
  onUnstageOne: (entryPath: string) => void;
  tempSession?: TempMergeSessionSummary;
  tempBusy?: boolean;
  tempRetryOperation?: "apply" | "saveAs" | "discard";
  onApplyTemp?: () => void;
  onSaveTempAs?: () => void;
  onDiscardTemp?: () => void;
}

export function MenuBar({
  mode,
  stagedTarget,
  pendingOps,
  canRefresh,
  onSave,
  onRefresh,
  onClearStaged,
  onUnstageOne,
  tempSession,
  tempBusy = false,
  tempRetryOperation,
  onApplyTemp,
  onSaveTempAs,
  onDiscardTemp,
}: MenuBarProps) {
  const tempPendingOps = tempSession
    ? pendingOps.filter((operation) => operation.side === tempSession.targetSide)
    : [];
  const recovery = tempRetryOperation === "apply"
    ? { label: "Retry Apply", action: onApplyTemp }
    : tempRetryOperation === "saveAs"
      ? { label: "Retry Save As", action: onSaveTempAs }
      : tempRetryOperation === "discard"
        ? { label: "Retry Discard", action: onDiscardTemp }
        : undefined;

  function pendingChanges(operations: PendingOperation[], target?: Side) {
    return (
      <>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Show pending changes" disabled={operations.length === 0}>
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="pending-popover">
            <p className="pending-header">
              Pending changes{mode === "compare" ? ` → ${target ?? "—"}` : ""}
            </p>
            <ul>
              {operations.map((operation) => (
                <li key={operation.key}>
                  {operation.kind === "edit" ? <Pencil size={14} /> : <ArrowRightLeft size={14} />}
                  <span className="pending-path">{operation.path}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Unstage ${operation.path}`}
                    disabled={tempBusy}
                    onClick={() => onUnstageOne(operation.key)}
                  >
                    <X size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear staged"
                disabled={operations.length === 0 || tempBusy}
                onClick={onClearStaged}
              >
                <Trash2 />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>Discard all staged changes</p></TooltipContent>
        </Tooltip>
      </>
    );
  }

  return (
    <header className="command-bar" aria-label="Workspace commands" data-tour="merge-save">
      <div className="command-context">
        <span className="command-context__mode">{mode === "single" ? "View" : mode === "compare" ? "Compare" : "Text"}</span>
        <span className="command-context__detail">{mode === "single" ? "Source inspector" : mode === "compare" ? "Archive workbench" : "Draft comparison"}</span>
      </div>

      <div className="command-group command-group--refresh" role="group" aria-label="Source commands">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" aria-label="Refresh sources" disabled={!canRefresh} onClick={onRefresh}>
                <RefreshCw />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{mode === "compare" ? "Reload both compare sources from disk" : mode === "text" ? "Free text has no disk sources" : "Reload opened View sources from disk"}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="command-spacer" />
      {mode !== "text" && <div className="command-divider" aria-hidden="true" />}

      {mode !== "text" && (tempSession || recovery) && (
        <div className="command-group command-group--save" role="group" aria-label="Temporary merge session">
          {tempSession ? (
            <>
              {tempPendingOps.length > 0 && (
                <span className="pending-summary">{tempPendingOps.length} staged → temp</span>
              )}
              <Button
                variant="default"
                size="sm"
                aria-label={`Apply to temp (${tempPendingOps.length})`}
                disabled={tempBusy || tempPendingOps.length === 0}
                onClick={onApplyTemp}
              >
                <Save /> <span className="button-label">Apply</span>
              </Button>
              <Button variant="outline" size="sm" disabled={tempBusy} onClick={onSaveTempAs}>
                Save temp as
              </Button>
              <Button variant="ghost" size="sm" disabled={tempBusy} onClick={onDiscardTemp}>
                Discard temp
              </Button>
              {pendingChanges(tempPendingOps, tempSession.targetSide)}
            </>
          ) : (
            <Button variant="default" size="sm" disabled={!recovery?.action} onClick={recovery?.action}>
              {recovery?.label}
            </Button>
          )}
        </div>
      )}

      {mode !== "text" && !tempSession && !recovery && (
        <div className="command-group command-group--save" role="group" aria-label="Save changes">
          {stagedTarget && (
            <span className="pending-summary">
              {pendingOps.length} unsaved{mode === "compare" ? ` → ${stagedTarget}` : ""}
            </span>
          )}
          <Button
            variant="default"
            size="sm"
            aria-label={`Save to archive (${pendingOps.length})`}
            disabled={!stagedTarget}
            onClick={() => stagedTarget && onSave(stagedTarget)}
          >
            <Save /> <span className="button-label">Save {pendingOps.length > 0 ? pendingOps.length : ""}</span>
          </Button>
          {pendingChanges(pendingOps, stagedTarget)}
        </div>
      )}
    </header>
  );
}
