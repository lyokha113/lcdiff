import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  leftLabel?: string;
  rightLabel?: string;
  expandAllVersion?: number;
  collapseAllVersion?: number;
  onInspect: (pair: ComparePair) => void;
  onSelect: (pair: ComparePair) => void;
  onCopy: (from: Side, to: Side, pair: ComparePair) => void;
  onUnstage: (entryPath: string) => void;
  onExpandArchive: (fullPath: string) => void;
}

function collectExpandablePaths(
  nodes: TreeNode[],
  nestedPairs: Record<string, ComparePair[]>,
  treeFilter: TreeFilter,
  basePath = "",
  acc: Set<string> = new Set(),
): Set<string> {
  for (const node of nodes) {
    if (node.kind === "folder") {
      acc.add(fullPathOf(basePath, node.path));
      collectExpandablePaths(node.children, nestedPairs, treeFilter, basePath, acc);
      continue;
    }

    if (isArchiveKind(node.pair)) {
      const fullPath = fullPathOf(basePath, node.path);
      const children = nestedPairs[fullPath];
      if (children !== undefined) {
        acc.add(fullPath);
        collectExpandablePaths(
          buildTree(children.filter((child) => pairPassesTreeFilter(child, treeFilter))),
          nestedPairs,
          treeFilter,
          fullPath,
          acc,
        );
      }
    }
  }
  return acc;
}

export function FileTree(props: FileTreeProps) {
  const {
    visiblePairs,
    mode,
    leftLabel,
    rightLabel,
    nestedPairs,
    treeFilter,
    expandAllVersion = 0,
    collapseAllVersion = 0,
  } = props;
  const tree = useMemo(() => buildTree(visiblePairs), [visiblePairs]);
  const pathsKey = useMemo(() => visiblePairs.map((p) => p.path).join("|"), [visiblePairs]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lastExpandAllVersion = useRef(expandAllVersion);
  const lastCollapseAllVersion = useRef(collapseAllVersion);
  useEffect(() => {
    setExpanded(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);
  useEffect(() => {
    if (expandAllVersion !== lastExpandAllVersion.current) {
      lastExpandAllVersion.current = expandAllVersion;
      setExpanded(collectExpandablePaths(tree, nestedPairs, treeFilter));
    }
  }, [expandAllVersion, nestedPairs, tree, treeFilter]);
  useEffect(() => {
    if (collapseAllVersion !== lastCollapseAllVersion.current) {
      lastCollapseAllVersion.current = collapseAllVersion;
      setExpanded(new Set());
    }
  }, [collapseAllVersion]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const twoPane = mode !== "single";

  return (
    <div className={`tree ${twoPane ? "tree-two-pane" : ""}`}>
      {twoPane && (
        <div className="tree-header" aria-hidden="true">
          <span className="tree-half tree-half-left">{leftLabel ?? "Left"}</span>
          <span className="tree-mid" />
          <span className="tree-half tree-half-right">{rightLabel ?? "Right"}</span>
        </div>
      )}
      {tree.length === 0 && (
        <div className="tree-empty" role="status">
          <span className="tree-empty__icon"><FileArchive aria-hidden="true" /></span>
          <strong>{twoPane ? "Nothing to compare yet" : "No source entries yet"}</strong>
          <p>
            {twoPane
              ? "Choose a JAR, ZIP, folder, or text file above on each side, or adjust the Files filter."
              : "Choose a JAR, ZIP, folder, or text file above to start browsing."}
          </p>
        </div>
      )}
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

// One side of a row. Renders the icon + name when the entry exists on that
// side, or a muted gap when it does not.
function SideCell({ present, icon, name, chevron }: {
  present: boolean;
  icon: ReactNode;
  name: string;
  chevron?: ReactNode;
}) {
  if (!present) return <span className="tree-cell tree-gap" aria-hidden="true" />;
  return (
    <span className="tree-cell">
      {chevron}
      {icon}
      <span className="tree-name">{name}</span>
    </span>
  );
}

const fileChevronSpacer = (
  <span className="tree-chevron tree-chevron-spacer tree-file-chevron-spacer" aria-hidden="true" />
);

function FileTreeNode({ node, depth, basePath, expanded, onToggle, ...props }: NodeProps) {
  const { mode } = props;
  const twoPane = mode !== "single";
  const indent = { paddingLeft: `${depth * 14 + 8}px` };
  const halfIndent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === "folder") {
    const fullPath = fullPathOf(basePath, node.path);
    const open = expanded.has(fullPath);
    const chevron = open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />;
    const folderIcon = open ? <FolderOpen className="tree-icon" /> : <Folder className="tree-icon" />;
    return (
      <>
        <button
          type="button"
          className="tree-row tree-folder"
          aria-expanded={open}
          onClick={() => onToggle(fullPath)}
        >
          <span className="tree-half tree-half-left" style={halfIndent}>
            {chevron}
            {folderIcon}
            <span className="tree-name">{node.name}</span>
          </span>
          {twoPane && (
            <span className="tree-mid">
              {node.diffCount > 0 && <span className="folder-rollup">● {node.diffCount}</span>}
            </span>
          )}
          {twoPane && (
            <span className="tree-half tree-half-right" style={halfIndent}>
              <span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />
              {folderIcon}
              <span className="tree-name">{node.name}</span>
            </span>
          )}
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
  const { selected, stagedEntries, treeFilter, nestedPairs, onInspect, onSelect, onCopy, onUnstage, onExpandArchive } = props;
  const pres = statusPresentation(pair.status);
  const staged = stagedEntries[fullPath];
  const stagedBadge = staged && (
    <Badge variant={staged.kind === "edit" ? "default" : "secondary"}>
      {staged.kind === "edit" ? "edited" : "copy"} → {staged.side}
    </Badge>
  );
  const statusGlyph = twoPane && (
    <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>
  );

  if (isArchiveKind(pair)) {
    const open = expanded.has(fullPath);
    const children = nestedPairs[fullPath];
    const chevron = open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />;
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              className={`tree-row tree-folder ${pair.status}`}
              aria-expanded={open}
              onClick={() => {
                if (!open && children === undefined) onExpandArchive(fullPath);
                onToggle(fullPath);
              }}
            >
              <span className="tree-half tree-half-left" style={halfIndent}>
                <SideCell
                  present={twoPane ? !!pair.left : true}
                  chevron={chevron}
                  icon={<FileArchive className="tree-icon" />}
                  name={node.name}
                />
                {stagedBadge}
              </span>
              {statusGlyph}
              {twoPane && (
                <span className="tree-half tree-half-right" style={halfIndent}>
                  <SideCell
                    present={!!pair.right}
                    chevron={<span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />}
                    icon={<FileArchive className="tree-icon" />}
                    name={node.name}
                  />
                </span>
              )}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={mode === "single" || !pair.right} onSelect={() => onCopy("right", "left", fullPair)}>
              Copy to left
            </ContextMenuItem>
            <ContextMenuItem disabled={mode === "single" || !pair.left} onSelect={() => onCopy("left", "right", fullPair)}>
              Copy to right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!staged} onSelect={() => onUnstage(fullPath)}>
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
          style={twoPane ? undefined : indent}
          className={`tree-row tree-file ${pair.status} ${selected?.path === fullPath ? "selected" : ""}`}
          onClick={() => onInspect(fullPair)}
          onContextMenu={() => onSelect(fullPair)}
        >
          <span className="tree-half tree-half-left" style={twoPane ? halfIndent : undefined}>
            <SideCell
              present={twoPane ? !!pair.left : true}
              chevron={fileChevronSpacer}
              icon={<File className="tree-icon" />}
              name={node.name}
            />
            {stagedBadge}
          </span>
          {statusGlyph}
          {twoPane && (
            <span className="tree-half tree-half-right" style={halfIndent}>
              <SideCell
                present={!!pair.right}
                chevron={fileChevronSpacer}
                icon={<File className="tree-icon" />}
                name={node.name}
              />
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={mode === "single" || !pair.right || pair.right.kind === "directory"} onSelect={() => onCopy("right", "left", fullPair)}>
          Copy to left
        </ContextMenuItem>
        <ContextMenuItem disabled={mode === "single" || !pair.left || pair.left.kind === "directory"} onSelect={() => onCopy("left", "right", fullPair)}>
          Copy to right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!staged} onSelect={() => onUnstage(fullPath)}>
          Unstage
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
