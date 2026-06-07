import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine, Mode, SearchScope, TreeFilter } from "@/lib/types";

interface ConfigDrawerProps {
  open: boolean;
  mode: Mode;
  searchScope: SearchScope;
  searching: boolean;
  treeFilter: TreeFilter;
  engine: Engine;
  ignoreTrimWhitespace: boolean;
  backupEnabled: boolean;
  onScopeChange: (scope: SearchScope) => void;
  onDeepSearch: () => void;
  onCancelDeepSearch: () => void;
  onClearSearch: () => void;
  onFilterChange: (filter: TreeFilter) => void;
  onEngineChange: (engine: Engine) => void;
  onIgnoreWsChange: (value: boolean) => void;
  onBackupChange: (value: boolean) => void;
}

export function ConfigDrawer({
  open, mode, searchScope, searching, treeFilter, engine, ignoreTrimWhitespace, backupEnabled,
  onScopeChange, onDeepSearch, onCancelDeepSearch, onClearSearch,
  onFilterChange, onEngineChange, onIgnoreWsChange, onBackupChange,
}: ConfigDrawerProps) {
  if (!open) return <aside className="config-drawer closed" aria-hidden="true" />;
  return (
    <aside className="config-drawer open" aria-label="Configuration">
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
        <span className="zone-label">View</span>
        <Select value={treeFilter} onValueChange={(v) => onFilterChange(v as TreeFilter)}>
          <SelectTrigger aria-label="Tree filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">Show all</SelectItem>
            <SelectItem value="differences">Differences only</SelectItem>
            <SelectItem value="onlyLeft">Only left</SelectItem>
            <SelectItem value="onlyRight">Only right</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
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
          <Checkbox checked={ignoreTrimWhitespace} onCheckedChange={(c) => onIgnoreWsChange(c === true)} />
          Ignore trim whitespace
        </label>
      </section>

      {mode === "compare" && (
        <section className="drawer-group">
          <span className="zone-label">Save</span>
          <label className="check-label">
            <Checkbox checked={backupEnabled} onCheckedChange={(c) => onBackupChange(c === true)} />
            Keep one overwritten .bak on save
          </label>
        </section>
      )}
    </aside>
  );
}
