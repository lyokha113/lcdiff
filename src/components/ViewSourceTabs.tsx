import { FileText, Folder, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewSource } from "@/lib/types";

interface ViewSourceTabsProps {
  sources: ViewSource[];
  activeSourceId?: string;
  onSelect: (sourceId: string) => void;
  onClose: (sourceId: string) => void;
}

function sourceIcon(source: ViewSource) {
  if (source.kind === "directory") return <Folder />;
  if (source.kind === "file") return <FileText />;
  return <Package />;
}

export function ViewSourceTabs({ sources, activeSourceId, onSelect, onClose }: ViewSourceTabsProps) {
  if (sources.length === 0) return null;

  return (
    <nav className="view-source-tabs" aria-label="View sources">
      <div className="view-source-tabs__scroll" role="tablist" aria-label="Open View sources">
        {sources.map((source) => (
          <div
            key={source.id}
            role="tab"
            aria-selected={source.id === activeSourceId}
            tabIndex={0}
            className={`view-source-tab${source.id === activeSourceId ? " active" : ""}`}
            title={source.path}
            onClick={() => onSelect(source.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(source.id);
              }
            }}
          >
            <span className="view-source-tab__icon" aria-hidden="true">{sourceIcon(source)}</span>
            <span className="view-source-tab__label">{source.name}</span>
            <span className="view-source-tab__count">{source.entryCount}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Close ${source.path}`}
              className="view-source-tab__close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(source.id);
              }}
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
    </nav>
  );
}
