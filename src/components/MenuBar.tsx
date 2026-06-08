import { RefreshCw, Save, Search, Settings, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Mode, Side } from "@/lib/types";

interface MenuBarProps {
  mode: Mode;
  stagedTarget?: Side;
  stagedCount: number;
  searchOpen: boolean;
  drawerOpen: boolean;
  canRefresh: boolean;
  onChangeMode: (mode: Mode) => void;
  onSave: (side: Side) => void;
  onRefresh: () => void;
  onClearStaged: () => void;
  onToggleSearch: () => void;
  onToggleDrawer: () => void;
}

export function MenuBar({
  mode, stagedTarget, stagedCount, searchOpen, drawerOpen, canRefresh,
  onChangeMode, onSave, onRefresh, onClearStaged, onToggleSearch, onToggleDrawer,
}: MenuBarProps) {
  return (
    <header className="menu-bar">
      <div className="brand">
        <h1>jdiff</h1>
        <span className="tagline">archive diff · merge</span>
      </div>
      <div className="topbar-controls">
        <Select value={mode} onValueChange={(value) => onChangeMode(value as Mode)}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="single">View</SelectItem>
            <SelectItem value="compare">Compare</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="icon" aria-label="Refresh sources"
                disabled={!canRefresh} onClick={onRefresh}>
                <RefreshCw />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{mode === "compare" ? "Reload both sources from disk" : "Reload the source from disk"}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="secondary" size="icon" aria-label="Save staged"
                disabled={!stagedTarget} onClick={() => stagedTarget && onSave(stagedTarget)}>
                <Save />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>Save staged copies to their target archive</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="icon" aria-label="Clear staged" onClick={onClearStaged}>
                <Trash2 />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>Discard all staged copies</p></TooltipContent>
        </Tooltip>
        {stagedTarget && <Badge variant="secondary">{stagedCount} → {stagedTarget}</Badge>}
        <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label="Toggle search" aria-pressed={searchOpen} onClick={onToggleSearch}>
          <Search />
        </Button>
        <Button variant={drawerOpen ? "secondary" : "ghost"} size="icon" aria-label="Settings" aria-pressed={drawerOpen} onClick={onToggleDrawer}>
          <Settings />
        </Button>
      </div>
    </header>
  );
}
