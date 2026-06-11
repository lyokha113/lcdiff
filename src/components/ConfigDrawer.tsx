import { Binary, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine, Mode, SearchScope, ViewMode } from "@/lib/types";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  searchScope: SearchScope;
  searching: boolean;
  engine: Engine;
  ignoreTrimWhitespace: boolean;
  backupEnabled: boolean;
  viewMode: ViewMode;
  canShowSource: boolean;
  canShowBytecode: boolean;
  onScopeChange: (scope: SearchScope) => void;
  onDeepSearch: () => void;
  onCancelDeepSearch: () => void;
  onClearSearch: () => void;
  onEngineChange: (engine: Engine) => void;
  onIgnoreWhitespaceChange: (value: boolean) => void;
  onBackupEnabledChange: (value: boolean) => void;
  onShowSource: () => void;
  onShowBytecode: () => void;
}

export function ConfigDrawer({
  open, mode, searchScope, searching, engine, ignoreTrimWhitespace, backupEnabled,
  viewMode, canShowSource, canShowBytecode,
  onScopeChange, onDeepSearch, onCancelDeepSearch, onClearSearch,
  onEngineChange, onIgnoreWhitespaceChange, onBackupEnabledChange,
  onShowSource, onShowBytecode,
}: ConfigDrawerProps) {
  if (!open) return <aside className="config-drawer closed" aria-hidden="true" />;
  return (
    <aside className="config-drawer open" aria-label="Configuration">
      <section className="drawer-group">
        <span className="zone-label">View</span>
        <div className="view-toggle" role="group" aria-label="Diff view mode">
          <Button variant={viewMode === "source" ? "secondary" : "ghost"} size="sm"
            aria-label="Show source" aria-pressed={viewMode === "source"}
            disabled={!canShowSource} onClick={onShowSource}>
            <Code /> Source
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant={viewMode === "bytecode" ? "secondary" : "ghost"} size="sm"
                  aria-label="Show bytecode" aria-pressed={viewMode === "bytecode"}
                  disabled={!canShowBytecode} onClick={onShowBytecode}>
                  <Binary /> Bytecode
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Open ASM bytecode for class entries; useful for metadata-only differences.</p></TooltipContent>
          </Tooltip>
        </div>
      </section>

      <section className="drawer-group">
        <span className="zone-label">Search</span>
        <Select value={searchScope} disabled={mode === "single"}
          onValueChange={(v) => onScopeChange(v as SearchScope)}>
          <SelectTrigger aria-label="Search scope"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="both">Search both</SelectItem>
            <SelectItem value="left">Search left</SelectItem>
            <SelectItem value="right">Search right</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <div className="row">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="secondary" disabled={searching} onClick={onDeepSearch}>Deep search</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Decompile classes in the background and stream source matches.</p></TooltipContent>
          </Tooltip>
          <Button variant="outline" disabled={!searching} onClick={onCancelDeepSearch}>Cancel search</Button>
          <Button variant="ghost" onClick={onClearSearch}>Clear search</Button>
        </div>
      </section>

      <section className="drawer-group">
        <span className="zone-label">Decompiler &amp; diff</span>
        <Select value={engine} onValueChange={(v) => onEngineChange(v as Engine)}>
          <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="cfr">CFR</SelectItem>
            <SelectItem value="vineflower">Vineflower</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <label className="check-label">
          <Checkbox checked={ignoreTrimWhitespace} onCheckedChange={(c) => onIgnoreWhitespaceChange(c === true)} />
          Ignore trim whitespace
        </label>
      </section>

      {mode === "compare" && (
        <section className="drawer-group">
          <span className="zone-label">Save</span>
          <label className="check-label">
            <Checkbox checked={backupEnabled} onCheckedChange={(c) => onBackupEnabledChange(c === true)} />
            Keep one overwritten .bak on save
          </label>
        </section>
      )}
    </aside>
  );
}
