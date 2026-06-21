import { Binary, Code, FileDiff, ListTree, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Mode, PairStatus, TreeFilter, ViewMode } from "@/lib/types";
import { statusPresentation } from "@/lib/status";

const noopFilterChange = () => undefined;

function basename(path: string) {
  const clean = path.endsWith("/") ? path.slice(0, -1) : path;
  const tail = clean.split("/").pop() ?? clean;
  return tail.split("!/").pop() ?? tail;
}

export interface WorkspaceTabDescriptor {
  path: string;
  status: PairStatus;
}

export interface WorkspaceTabsProps {
  fileCount: number;
  activeId: "files" | string;
  mode: Mode;
  tabs: WorkspaceTabDescriptor[];
  treeFilter?: TreeFilter;
  viewMode: ViewMode;
  canShowSource: boolean;
  canShowBytecode: boolean;
  onSelectFiles: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onFilterChange?: (filter: TreeFilter) => void;
  onShowSource: () => void;
  onShowBytecode: () => void;
}

export function WorkspaceTabs({
  fileCount,
  activeId,
  mode,
  tabs,
  treeFilter = "diff",
  viewMode,
  canShowSource,
  canShowBytecode,
  onSelectFiles,
  onSelectTab,
  onCloseTab,
  onFilterChange = noopFilterChange,
  onShowSource,
  onShowBytecode,
}: WorkspaceTabsProps) {
  return (
    <nav className="workspace-tabs" aria-label="Open files">
      <div className="workspace-tabs-files" role="tablist" aria-label="Files workspace view">
        <button
          type="button"
          role="tab"
          aria-selected={activeId === "files"}
          className={`workspace-tab workspace-tab-files${activeId === "files" ? " active" : ""}`}
          onClick={onSelectFiles}
        >
          <ListTree /> Files
          {fileCount > 0 && <span className="workspace-tab-count">{fileCount}</span>}
        </button>
      </div>
      {mode === "compare" && (
        <Select value={treeFilter} onValueChange={(v) => onFilterChange(v as TreeFilter)}>
          <SelectTrigger className="workspace-tree-filter" aria-label="Tree filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Show all</SelectItem>
              <SelectItem value="diff">Differences</SelectItem>
              <SelectItem value="same">Identical</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      <div className="workspace-tabs-scroll" role="tablist" aria-label="Open diff tabs">
        {tabs.map((tab) => {
          const status = statusPresentation(tab.status);
          return (
            <div
              key={tab.path}
              role="tab"
              aria-selected={activeId === tab.path}
              tabIndex={0}
              className={`workspace-tab workspace-tab-diff${activeId === tab.path ? " active" : ""}`}
              title={tab.path}
              onClick={() => onSelectTab(tab.path)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTab(tab.path); } }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.path); } }}
            >
              <FileDiff />
              <span className={`workspace-tab-dot ${status.className}`} aria-hidden="true" />
              <span className="workspace-tab-label">{basename(tab.path)}</span>
              <button
                type="button"
                className="workspace-tab-close"
                aria-label={`Close ${tab.path}`}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}
              >
                <X />
              </button>
            </div>
          );
        })}
      </div>
      {activeId !== "files" && (
        <div className="workspace-view-toggle" role="group" aria-label="Diff view mode">
          <Button
            variant={viewMode === "source" ? "secondary" : "ghost"}
            size="sm"
            aria-label="Show source"
            aria-pressed={viewMode === "source"}
            disabled={!canShowSource}
            onClick={onShowSource}
          >
            <Code /> Source
          </Button>
          <Button
            variant={viewMode === "bytecode" ? "secondary" : "ghost"}
            size="sm"
            aria-label="Show bytecode"
            aria-pressed={viewMode === "bytecode"}
            disabled={!canShowBytecode}
            onClick={onShowBytecode}
          >
            <Binary /> Bytecode
          </Button>
        </div>
      )}
    </nav>
  );
}
