import { ChevronDown, Pencil, RefreshCw, Save, Search, Settings, Trash2, X, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Mode, Side } from "@/lib/types";

interface MenuBarProps {
  mode: Mode;
  stagedTarget?: Side;
  pendingOps: Array<{ key: string; path: string; side: Side; kind: "copy" | "edit" }>;
  searchOpen: boolean;
  drawerOpen: boolean;
  canRefresh: boolean;
  onChangeMode: (mode: Mode) => void;
  onSave: (side: Side) => void;
  onRefresh: () => void;
  onClearStaged: () => void;
  onUnstageOne: (entryPath: string) => void;
  onToggleSearch: () => void;
  onToggleDrawer: () => void;
}

export function MenuBar({
  mode, stagedTarget, pendingOps, searchOpen, drawerOpen, canRefresh,
  onChangeMode, onSave, onRefresh, onClearStaged, onUnstageOne, onToggleSearch, onToggleDrawer,
}: MenuBarProps) {
  return (
    <header className="command-bar" aria-label="Workspace commands">
      <div className="command-brand" aria-label="LCDiff workspace">
        <span className="command-brand__mark">LD</span>
        <span className="command-brand__name">LCDiff</span>
      </div>

      <div className="command-group command-group--mode" role="group" aria-label="Workspace mode">
        <Select value={mode} onValueChange={(value) => onChangeMode(value as Mode)}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="single">View</SelectItem>
            <SelectItem value="compare">Compare</SelectItem>
            <SelectItem value="text">Text</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" aria-label="Refresh sources" disabled={!canRefresh} onClick={onRefresh}>
                <RefreshCw />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{mode === "compare" ? "Reload both sources from disk" : mode === "text" ? "Free text has no disk sources" : "Reload the source from disk"}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="command-spacer" />

      <div className="command-group command-group--tools" role="group" aria-label="Workspace tools">
        {mode !== "text" && (
          <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label="Toggle search" aria-pressed={searchOpen} onClick={onToggleSearch}>
            <Search />
          </Button>
        )}
        <Button variant={drawerOpen ? "secondary" : "ghost"} size="icon" aria-label="Preferences" aria-pressed={drawerOpen} onClick={onToggleDrawer}>
          <Settings />
        </Button>
      </div>

      {mode === "compare" && <div className="command-divider" aria-hidden="true" />}

      {mode === "compare" && (
        <div className="command-group command-group--save" role="group" aria-label="Save changes">
          {stagedTarget && <span className="pending-summary">{pendingOps.length} unsaved → {stagedTarget}</span>}
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
              <p className="pending-header">Pending changes → {stagedTarget ?? "—"}</p>
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
