import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { statusPresentation } from "@/lib/status";
import { buildTree, type TreeNode } from "@/lib/tree";
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

function defaultExpanded(nodes: TreeNode[], acc: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.diffCount > 0) acc.add(node.path);
      defaultExpanded(node.children, acc);
    }
  }
  return acc;
}

export function FileTree(props: FileTreeProps) {
  const { visiblePairs } = props;
  const tree = useMemo(() => buildTree(visiblePairs), [visiblePairs]);
  const pathsKey = useMemo(() => visiblePairs.map((p) => p.path).join("|"), [visiblePairs]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(tree));
  useEffect(() => {
    setExpanded(defaultExpanded(tree));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="tree">
      {tree.map((node) => (
        <FileTreeNode {...props} key={node.path} node={node} depth={0} expanded={expanded} onToggle={toggle} />
      ))}
    </div>
  );
}

interface NodeProps extends FileTreeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function FileTreeNode({ node, depth, expanded, onToggle, ...props }: NodeProps) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === "folder") {
    const open = expanded.has(node.path);
    return (
      <>
        <button
          type="button"
          className="tree-row tree-folder"
          style={indent}
          aria-expanded={open}
          onClick={() => onToggle(node.path)}
        >
          {open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />}
          {open ? <FolderOpen className="tree-icon" /> : <Folder className="tree-icon" />}
          <span className="tree-name">{node.name}</span>
          {node.diffCount > 0 && <span className="folder-rollup">● {node.diffCount}</span>}
        </button>
        {open && node.children.map((child) => (
          <FileTreeNode {...props} key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
        ))}
      </>
    );
  }

  const { pair } = node;
  const { selected, stagedEntries, mode, onInspect, onSelect, onCopy, onUnstage } = props;
  const pres = statusPresentation(pair.status);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          style={indent}
          className={`tree-row tree-file ${pair.status} ${pres.className} ${selected?.path === pair.path ? "selected" : ""}`}
          onClick={() => onInspect(pair)}
          onContextMenu={() => onSelect(pair)}
        >
          <File className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          {stagedEntries[pair.path] && <Badge variant="secondary">pending → {stagedEntries[pair.path]}</Badge>}
          <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>
        </button>
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
  );
}
