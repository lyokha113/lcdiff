import { ChevronDown, Pencil, RefreshCw, Save, Trash2, X, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Mode, Side } from "@/lib/types";

interface MenuBarProps {
  mode: Mode;
  stagedTarget?: Side;
  pendingOps: Array<{ key: string; path: string; side: Side; kind: "copy" | "edit" }>;
  canRefresh: boolean;
  onSave: (side: Side) => void;
  onRefresh: () => void;
  onClearStaged: () => void;
  onUnstageOne: (entryPath: string) => void;
}

export function MenuBar({
  mode, stagedTarget, pendingOps, canRefresh,
  onSave, onRefresh, onClearStaged, onUnstageOne,
}: MenuBarProps) {
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

      {mode !== "text" && (
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Show pending changes" disabled={!stagedTarget}>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="pending-popover">
              <p className="pending-header">
                Pending changes{mode === "compare" ? ` → ${stagedTarget ?? "—"}` : ""}
              </p>
              <ul>
                {pendingOps.map((op) => (
                  <li key={op.key}>
                    {op.kind === "edit" ? <Pencil size={14} /> : <ArrowRightLeft size={14} />}
                    <span className="pending-path">{op.path}</span>
                    <Button variant="ghost" size="icon" aria-label={`Unstage ${op.path}`} onClick={() => onUnstageOne(op.key)}>
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
                <Button variant="ghost" size="icon" aria-label="Clear staged" disabled={pendingOps.length === 0} onClick={onClearStaged}>
                  <Trash2 />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Discard all staged changes</p></TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  );
}
