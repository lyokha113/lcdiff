import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, FileArchive, Folder, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { statusPresentation } from "@/lib/status";
import { buildTree, isArchiveKind, pairPassesTreeFilter, type TreeNode } from "@/lib/tree";
import type { ComparePair, Mode, Side, StagedEntry, TreeFilter } from "@/lib/types";

interface FileTreeProps {
  visiblePairs: ComparePair[];
  selected?: ComparePair;
  stagedEntries: Record<string, StagedEntry>;
  mode: Mode;
  treeFilter: TreeFilter;
  nestedPairs: Record<string, ComparePair[]>;
  onInspect: (pair: ComparePair) => void;
  onSelect: (pair: ComparePair) => void;
  onCopy: (from: Side, to: Side, pair: ComparePair) => void;
  onUnstage: (entryPath: string) => void;
  onExpandArchive: (fullPath: string) => void;
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
        <FileTreeNode {...props} key={node.path} node={node} depth={0} basePath="" expanded={expanded} onToggle={toggle} />
      ))}
    </div>
  );
}

interface NodeProps extends FileTreeProps {
  node: TreeNode;
  depth: number;
  basePath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function fullPathOf(basePath: string, nodePath: string): string {
  return basePath ? `${basePath}!/${nodePath}` : nodePath;
}

function FileTreeNode({ node, depth, basePath, expanded, onToggle, ...props }: NodeProps) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === "folder") {
    const fullPath = fullPathOf(basePath, node.path);
    const open = expanded.has(fullPath);
    return (
      <>
        <button
          type="button"
          className="tree-row tree-folder"
          style={indent}
          aria-expanded={open}
          onClick={() => onToggle(fullPath)}
        >
          {open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />}
          {open ? <FolderOpen className="tree-icon" /> : <Folder className="tree-icon" />}
          <span className="tree-name">{node.name}</span>
          {props.mode !== "single" && node.diffCount > 0 && <span className="folder-rollup">● {node.diffCount}</span>}
        </button>
        {open && node.children.map((child) => (
          <FileTreeNode {...props} key={child.path} node={child} depth={depth + 1} basePath={basePath} expanded={expanded} onToggle={onToggle} />
        ))}
      </>
    );
  }

  const { pair } = node;
  const fullPath = fullPathOf(basePath, node.path);
  const fullPair: ComparePair = basePath ? { ...pair, path: fullPath } : pair;
  const { selected, stagedEntries, mode, treeFilter, nestedPairs, onInspect, onSelect, onCopy, onUnstage, onExpandArchive } = props;
  const pres = statusPresentation(pair.status);

  if (isArchiveKind(pair)) {
    const open = expanded.has(fullPath);
    const children = nestedPairs[fullPath];
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              style={indent}
              className={`tree-row tree-folder ${pair.status}`}
              aria-expanded={open}
              onClick={() => {
                if (!open && children === undefined) onExpandArchive(fullPath);
                onToggle(fullPath);
              }}
            >
              {open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />}
              <FileArchive className="tree-icon" />
              <span className="tree-name">{node.name}</span>
              {stagedEntries[fullPath] && (
                <Badge variant={stagedEntries[fullPath].kind === "edit" ? "default" : "secondary"}>
                  {stagedEntries[fullPath].kind === "edit" ? "edited" : "copy"} → {stagedEntries[fullPath].side}
                </Badge>
              )}
              {mode !== "single" && <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={mode === "single" || !pair.right}
              onSelect={() => onCopy("right", "left", fullPair)}
            >
              Copy to left
            </ContextMenuItem>
            <ContextMenuItem
              disabled={mode === "single" || !pair.left}
              onSelect={() => onCopy("left", "right", fullPair)}
            >
              Copy to right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!stagedEntries[fullPath]} onSelect={() => onUnstage(fullPath)}>
              Unstage
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {open && children === undefined && (
          <div className="tree-row" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>Loading…</div>
        )}
        {open && children !== undefined && buildTree(children.filter((child) => pairPassesTreeFilter(child, treeFilter))).map((child) => (
          <FileTreeNode {...props} key={child.path} node={child} depth={depth + 1} basePath={fullPath} expanded={expanded} onToggle={onToggle} />
        ))}
      </>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          style={indent}
          className={`tree-row tree-file ${pair.status} ${selected?.path === fullPath ? "selected" : ""}`}
          onClick={() => onInspect(fullPair)}
          onContextMenu={() => onSelect(fullPair)}
        >
          <File className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          {stagedEntries[fullPath] && (
            <Badge variant={stagedEntries[fullPath].kind === "edit" ? "default" : "secondary"}>
              {stagedEntries[fullPath].kind === "edit" ? "edited" : "copy"} → {stagedEntries[fullPath].side}
            </Badge>
          )}
          {mode !== "single" && <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={mode === "single" || !pair.right || pair.right.kind === "directory"}
          onSelect={() => onCopy("right", "left", fullPair)}
        >
          Copy to left
        </ContextMenuItem>
        <ContextMenuItem
          disabled={mode === "single" || !pair.left || pair.left.kind === "directory"}
          onSelect={() => onCopy("left", "right", fullPair)}
        >
          Copy to right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!stagedEntries[fullPath]} onSelect={() => onUnstage(fullPath)}>
          Unstage
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
