import { FileDiff, ListTree, X } from "lucide-react";
import type { PairStatus } from "@/lib/types";
import { statusPresentation } from "@/lib/status";

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
  tabs: WorkspaceTabDescriptor[];
  onSelectFiles: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

export function WorkspaceTabs({ fileCount, activeId, tabs, onSelectFiles, onSelectTab, onCloseTab }: WorkspaceTabsProps) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
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
      <div className="workspace-tabs-scroll">
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
    </div>
  );
}
