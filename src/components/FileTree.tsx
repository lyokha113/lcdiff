import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ComparePair, Mode, Side } from "@/lib/types";

interface FileTreeProps {
  visiblePairs: ComparePair[];
  selected?: ComparePair;
  stagedEntries: Record<string, Side>;
  mode: Mode;
  onInspect: (pair: ComparePair) => void;
  onSelect: (pair: ComparePair) => void;
  onCopy: (from: Side, to: Side, pair: ComparePair) => void;
  onUnstage: (entryPath: string) => void;
}

export function FileTree({
  visiblePairs, selected, stagedEntries, mode, onInspect, onSelect, onCopy, onUnstage,
}: FileTreeProps) {
  return (
    <div className="tree">
      {visiblePairs.map((pair) => (
        <ContextMenu key={pair.path}>
          <ContextMenuTrigger asChild>
            <Button
              variant="ghost"
              className={`tree-row ${pair.status} ${selected?.path === pair.path ? "selected" : ""}`}
              onClick={() => onInspect(pair)}
              onContextMenu={() => onSelect(pair)}
            >
              <span>{pair.left ? pair.path : ""}</span>
              <b>
                <Badge variant="outline">{pair.status}</Badge>
                {stagedEntries[pair.path] && <Badge variant="secondary">pending → {stagedEntries[pair.path]}</Badge>}
              </b>
              <span>{pair.right ? pair.path : ""}</span>
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={mode === "single" || !pair.right || pair.right.kind === "directory"}
              onSelect={() => onCopy("right", "left", pair)}
            >
              Copy to left
            </ContextMenuItem>
            <ContextMenuItem
              disabled={mode === "single" || !pair.left || pair.left.kind === "directory"}
              onSelect={() => onCopy("left", "right", pair)}
            >
              Copy to right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!stagedEntries[pair.path]} onSelect={() => onUnstage(pair.path)}>
              Unstage
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
