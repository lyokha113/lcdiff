# Hierarchical File Tree + Status Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 3-column file list with a VSCode/Finder-style hierarchical tree (expand/collapse folders, auto-expand on diffs) and a git-style status visual language (colored glyph pill + filename tint).

**Architecture:** Two new pure, unit-tested libs — `src/lib/tree.ts` (`buildTree(pairs)` → nested folder/file nodes with diff rollup) and `src/lib/status.ts` (`statusPresentation(status)` → glyph/label/className). `FileTree.tsx` is rewritten to render the tree recursively with local expand state; its **prop contract is unchanged**, so `src/App.tsx` needs NO edits. CSS adds tree/status styling. The Playwright e2e guard is updated for the new markup.

**Tech Stack:** React 19, TypeScript, lucide-react, shadcn ContextMenu, vitest + @testing-library/react, Playwright (e2e guard).

**Spec:** `docs/superpowers/specs/2026-06-07-file-tree-hierarchy-status-design.md`

---

## File Structure

```
src/lib/status.ts          # CREATE — PairStatus → {glyph,label,className}
src/lib/status.test.ts     # CREATE
src/lib/tree.ts            # CREATE — buildTree(pairs) → TreeNode[]
src/lib/tree.test.ts       # CREATE
src/components/FileTree.tsx # REWRITE — recursive tree + expand state (prop contract unchanged)
src/components/FileTree.test.tsx # REWRITE — tree behavior tests
src/styles.css             # MODIFY — tree/folder/file/status styling
scripts/verify-frontend-render.mjs # MODIFY — drive new tree markup
```

`src/App.tsx` is intentionally **not** modified — `FileTree`'s props (`visiblePairs`, `selected`, `stagedEntries`, `mode`, `onInspect`, `onSelect`, `onCopy`, `onUnstage`) stay identical.

## Invariant guard note

`scripts/verify-frontend-invariants.mjs` checks (combined source) for `ContextMenuTrigger asChild`, `ContextMenuContent`, `ContextMenuItem`, and ≥5 occurrences of `mode === "single"`. The rewritten FileTree **keeps** the shadcn `ContextMenu` on file rows with the same `disabled={mode === "single" || ...}` conditions, so these markers stay satisfied — **no guard change needed**. The `Badge` import marker is satisfied by FileTree (still used for the `pending →` badge).

---

## Task 1: status presentation lib

**Files:**
- Create: `src/lib/status.ts`
- Test: `src/lib/status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/status.test.ts
import { describe, expect, it } from "vitest";
import { statusPresentation } from "@/lib/status";
import type { PairStatus } from "@/lib/types";

describe("statusPresentation", () => {
  const cases: Array<[PairStatus, string, string, string]> = [
    ["different", "M", "modified", "status-different"],
    ["differentMetadataOnly", "M̃", "meta only", "status-meta"],
    ["onlyLeft", "+", "left only", "status-onlyLeft"],
    ["onlyRight", "−", "right only", "status-onlyRight"],
    ["identical", "≡", "identical", "status-identical"],
  ];
  it.each(cases)("maps %s", (status, glyph, label, className) => {
    const p = statusPresentation(status);
    expect(p.glyph).toBe(glyph);
    expect(p.label).toBe(label);
    expect(p.className).toBe(className);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/status.test.ts`
Expected: FAIL — cannot resolve `@/lib/status`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/status.ts
import type { PairStatus } from "@/lib/types";

export interface StatusPresentation {
  glyph: string;
  label: string;
  className: string;
}

const MAP: Record<PairStatus, StatusPresentation> = {
  different: { glyph: "M", label: "modified", className: "status-different" },
  differentMetadataOnly: { glyph: "M̃", label: "meta only", className: "status-meta" },
  onlyLeft: { glyph: "+", label: "left only", className: "status-onlyLeft" },
  onlyRight: { glyph: "−", label: "right only", className: "status-onlyRight" },
  identical: { glyph: "≡", label: "identical", className: "status-identical" },
};

export function statusPresentation(status: PairStatus): StatusPresentation {
  return MAP[status];
}
```

Note: the `onlyRight` glyph is the Unicode minus sign `−` (U+2212), matching the test. The `differentMetadataOnly` glyph is `M` followed by combining tilde `̃` (U+0303) → `M̃`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/status.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/status.ts src/lib/status.test.ts
git commit -m "feat: add status presentation map for file tree"
```

---

## Task 2: tree-building lib

**Files:**
- Create: `src/lib/tree.ts`
- Test: `src/lib/tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tree.test.ts
import { describe, expect, it } from "vitest";
import { buildTree, type TreeFolder, type TreeFile } from "@/lib/tree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "com/example/App.class", status: "different", left: { path: "com/example/App.class", kind: "class" }, right: { path: "com/example/App.class", kind: "class" } },
  { path: "com/example/Meta.class", status: "identical", left: { path: "com/example/Meta.class", kind: "class" }, right: { path: "com/example/Meta.class", kind: "class" } },
  { path: "assets/blob.bin", status: "different", left: { path: "assets/blob.bin", kind: "binary" } },
  { path: "top.txt", status: "onlyLeft", left: { path: "top.txt", kind: "text" } },
];

describe("buildTree", () => {
  it("nests folders and files from path segments", () => {
    const tree = buildTree(pairs);
    // sorted: folders first (assets, com) then files (top.txt)
    expect(tree.map((n) => n.name)).toEqual(["assets", "com", "top.txt"]);
    expect(tree[0].kind).toBe("folder");
    expect(tree[2].kind).toBe("file");
  });

  it("rolls up diffCount per folder (non-identical descendants)", () => {
    const tree = buildTree(pairs);
    const com = tree.find((n) => n.name === "com") as TreeFolder;
    expect(com.kind).toBe("folder");
    expect(com.diffCount).toBe(1); // App different, Meta identical
    const example = com.children.find((n) => n.name === "example") as TreeFolder;
    expect(example.diffCount).toBe(1);
    const assets = tree.find((n) => n.name === "assets") as TreeFolder;
    expect(assets.diffCount).toBe(1);
  });

  it("places leaf files with their pair and full path", () => {
    const tree = buildTree(pairs);
    const com = tree.find((n) => n.name === "com") as TreeFolder;
    const example = com.children[0] as TreeFolder;
    const app = example.children.find((n) => n.name === "App.class") as TreeFile;
    expect(app.kind).toBe("file");
    expect(app.path).toBe("com/example/App.class");
    expect(app.pair.status).toBe("different");
  });

  it("keeps top-level files at the root", () => {
    const tree = buildTree(pairs);
    const top = tree.find((n) => n.name === "top.txt") as TreeFile;
    expect(top.kind).toBe("file");
    expect(top.path).toBe("top.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tree.test.ts`
Expected: FAIL — cannot resolve `@/lib/tree`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/tree.ts
import type { ComparePair } from "@/lib/types";

export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  diffCount: number;
}
export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  pair: ComparePair;
}
export type TreeNode = TreeFolder | TreeFile;

interface MutableFolder extends TreeFolder {
  childMap: Map<string, MutableFolder>;
}

function newFolder(name: string, path: string): MutableFolder {
  return { kind: "folder", name, path, children: [], diffCount: 0, childMap: new Map() };
}

export function buildTree(pairs: ComparePair[]): TreeNode[] {
  const root = newFolder("", "");
  const fileLists = new Map<MutableFolder, TreeFile[]>();

  for (const pair of pairs) {
    const segments = pair.path.split("/").filter(Boolean);
    let folder = root;
    // walk/create intermediate folders for all but the last segment
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      const path = segments.slice(0, i + 1).join("/");
      let next = folder.childMap.get(name);
      if (!next) {
        next = newFolder(name, path);
        folder.childMap.set(name, next);
      }
      folder = next;
    }
    const leafName = segments[segments.length - 1] ?? pair.path;
    const file: TreeFile = { kind: "file", name: leafName, path: pair.path, pair };
    const list = fileLists.get(folder) ?? [];
    list.push(file);
    fileLists.set(folder, list);
    // roll up diff count to this folder and every ancestor
    if (pair.status !== "identical") {
      let cursor: MutableFolder | undefined = folder;
      while (cursor) {
        cursor.diffCount += 1;
        cursor = cursor.path === "" ? undefined : ancestorOf(root, cursor.path);
      }
    }
  }

  return finalize(root, fileLists);
}

// Find the parent MutableFolder of a given folder path by walking from root.
function ancestorOf(root: MutableFolder, path: string): MutableFolder | undefined {
  const segments = path.split("/").filter(Boolean);
  segments.pop(); // drop self → parent path
  let folder: MutableFolder = root;
  for (const name of segments) {
    const next = folder.childMap.get(name);
    if (!next) return undefined;
    folder = next;
  }
  return folder;
}

function finalize(folder: MutableFolder, fileLists: Map<MutableFolder, TreeFile[]>): TreeNode[] {
  const folders = [...folder.childMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child): TreeFolder => ({
      kind: "folder",
      name: child.name,
      path: child.path,
      diffCount: child.diffCount,
      children: finalize(child, fileLists),
    }));
  const files = (fileLists.get(folder) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}
```

Note: the diff rollup walks each non-identical file's folder chain to the root via `ancestorOf`, incrementing `diffCount` on every ancestor folder. Folders before files at each level, alphabetical within each group.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts
git commit -m "feat: build hierarchical tree with diff rollup from compare pairs"
```

---

## Task 3: rewrite FileTree as a recursive tree

**Files:**
- Modify (rewrite): `src/components/FileTree.tsx`
- Modify (rewrite): `src/components/FileTree.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/FileTree.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/FileTree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "com/example/App.class", status: "different", left: { path: "com/example/App.class", kind: "class" }, right: { path: "com/example/App.class", kind: "class" } },
  { path: "top.txt", status: "onlyLeft", left: { path: "top.txt", kind: "text" } },
];

function setup(overrides = {}) {
  const props = {
    visiblePairs: pairs, selected: undefined, stagedEntries: {}, mode: "compare" as const,
    onInspect: vi.fn(), onSelect: vi.fn(), onCopy: vi.fn(), onUnstage: vi.fn(),
    ...overrides,
  };
  render(<FileTree {...props} />);
  return props;
}

describe("FileTree", () => {
  it("renders folders and files; diff folders auto-expand to show files", () => {
    setup();
    // com/example contains a diff → auto-expanded → App.class visible
    expect(screen.getByText("com")).toBeInTheDocument();
    expect(screen.getByText("App.class")).toBeInTheDocument();
    expect(screen.getByText("top.txt")).toBeInTheDocument();
  });

  it("collapsing a folder hides its files", async () => {
    setup();
    // click the 'com' folder row to collapse it
    await userEvent.click(screen.getByText("com"));
    expect(screen.queryByText("App.class")).not.toBeInTheDocument();
  });

  it("clicking a file calls onInspect with its pair", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("top.txt"));
    expect(props.onInspect).toHaveBeenCalledWith(pairs[1]);
  });

  it("shows the status glyph for a file", () => {
    setup();
    // onlyLeft → '+' ; different → 'M'
    expect(screen.getByLabelText("left only")).toBeInTheDocument();
    expect(screen.getByLabelText("modified")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/FileTree.test.tsx`
Expected: FAIL — new structure (`com`, `App.class` as separate rows, status glyph by label) not present in the old flat component.

- [ ] **Step 3: Rewrite `src/components/FileTree.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { statusPresentation } from "@/lib/status";
import { buildTree, type TreeFolder, type TreeNode } from "@/lib/tree";
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

// Folder paths whose subtree contains at least one diff — expanded by default.
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
  // recompute auto-expansion only when the SET of paths changes (not on status-only updates)
  const pathsKey = useMemo(() => visiblePairs.map((p) => p.path).join("|"), [visiblePairs]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(tree));
  useEffect(() => {
    setExpanded(defaultExpanded(buildTree(visiblePairs)));
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
        <FileTreeNode key={node.path} node={node} depth={0} expanded={expanded} onToggle={toggle} {...props} />
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
          <FileTreeNode key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} {...props} />
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
```

Notes: file rows keep the raw `pair.status` class (so existing CSS/e2e `.tree-row.different` selectors still resolve) plus `pres.className`. Copy-item `disabled={mode === "single" || ...}` conditions are byte-identical to the old component (satisfies the invariant guard). The `TreeFolder` import is used by the type of nodes; if tsc flags it unused, drop it from the import (only `TreeNode` is strictly required).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/FileTree.test.tsx && npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: FileTree tests PASS; full suite PASS; tsc clean; guard prints `frontend invariants passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileTree.tsx src/components/FileTree.test.tsx
git commit -m "refactor: render FileTree as hierarchical tree with git-style status"
```

---

## Task 4: tree + status CSS

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace the old flat-row tree CSS**

Read the current tree rules in `src/styles.css` (around `.tree`, `.tree-row`, `.tree-row > span`, `.tree-row.different`, `.tree-row.selected`, `.tree-row [data-slot="badge"]`). Replace the row-internal rules (the 3-column `span`/`b` layout no longer exists) with tree rules. Keep `.tree` (scroll container) and `.tree-row.selected`/hover. Add:

```css
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 4px;
}
.tree-row:hover { background: rgba(255, 255, 255, 0.04); }
.tree-row.selected { background: rgba(217, 176, 102, 0.16); }
.tree-chevron { width: 14px; height: 14px; flex: 0 0 auto; opacity: 0.7; }
.tree-icon { width: 15px; height: 15px; flex: 0 0 auto; opacity: 0.85; }
.tree-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-rollup { font-size: 0.72rem; color: var(--st-diff, #e0a030); flex: 0 0 auto; }

/* status chip (glyph pill) at the right edge of file rows */
.status-chip {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.4;
  padding: 0 6px;
  border-radius: 3px;
  min-width: 1.4em;
  text-align: center;
}
/* filename tint + chip color per status (color AND glyph = colorblind-safe) */
.tree-file.different    .tree-name { color: #e0a030; }
.tree-file.different    .status-chip { background: #3a2f1a; color: #e0a030; }
.tree-file.differentMetadataOnly .tree-name { color: #8aabd0; }
.tree-file.differentMetadataOnly .status-chip { background: #23304a; color: #8aabd0; }
.tree-file.onlyLeft     .tree-name { color: #6cc99a; }
.tree-file.onlyLeft     .status-chip { background: #1f3320; color: #6cc99a; }
.tree-file.onlyRight    .tree-name { color: #d9997a; }
.tree-file.onlyRight    .status-chip { background: #33231f; color: #d9997a; }
.tree-file.identical    .tree-name { color: var(--text-2, #889); }
.tree-file.identical    .status-chip { background: transparent; color: var(--st-same, #567); }
```

If the old rules referenced CSS variables `--st-diff`/`--st-only`/`--st-same`, keep those variable definitions intact (they may be used elsewhere); the new rules fall back via `var(--x, #hex)`. Remove the now-dead `.tree-row > span`, `.tree-row > span:last-child`, `.tree-row b`, and `.tree-row.different b`/`.onlyLeft b`/`.identical b` rules (the `<span>`/`<b>` 3-column structure is gone) — only after confirming no other markup uses them (grep `tree-row b` / `tree-row > span`).

- [ ] **Step 2: Verify build + tests still green**

Run: `npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs && npm run build`
Expected: all pass; `npm run build` succeeds.

- [ ] **Step 3: Manual check (optional, dev preview)**

Run: `npm run dev`, open the printed URL. Confirm tree nests, diff folders are expanded, status glyphs/tints render, clicking a folder toggles, clicking a file selects. Stop dev (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style: hierarchical tree + git-style status visuals"
```

---

## Task 5: update the Playwright e2e render guard

**Files:**
- Modify: `scripts/verify-frontend-render.mjs`

The mocked-backend block (the `addInitScript`) stays unchanged. Only the tree-interaction assertions change: file rows now show the **leaf filename** (not the full path), diff folders auto-expand (so diff files are visible without manual expansion), and status is a glyph (the raw status class `tree-file.<status>` is still on the row).

- [ ] **Step 1: Re-point the tree locators**

In `scripts/verify-frontend-render.mjs`, apply these replacements (read the file first to confirm exact current lines):

- The "Only right" filter assertions (currently around lines 285-287):
  ```js
  await mockedPage.locator(".tree-file", { hasText: "right-only.txt" }).waitFor({ timeout: 5_000 });
  if (await mockedPage.locator(".tree-file", { hasText: "left-only.txt" }).count()) {
    throw new Error("Only right filter still showed left-only row");
  }
  ```
  (`right-only.txt`/`left-only.txt` are top-level files — no folder to expand.)

- The metadata-only row (currently around lines 306-310). The parent `com/example` auto-expands (it contains a diff), so `Meta.class` is visible. Replace with:
  ```js
  const metadataRow = mockedPage.locator(".tree-file", { hasText: "Meta.class" });
  await metadataRow.waitFor({ timeout: 5_000 });
  await metadataRow.click({ force: true });
  await mockedPage.locator("text=class MetaSameSource").first().waitFor({ timeout: 10_000 });
  await mockedPage.locator(".tree-file.differentMetadataOnly", { hasText: "Meta.class" }).waitFor({ timeout: 10_000 });
  ```

- The App.class row (currently around line 312): replace `.tree-row`/full path with the filename:
  ```js
  const appRow = mockedPage.locator(".tree-file", { hasText: "App.class" });
  ```

- The binary row (currently around line 350):
  ```js
  const binaryRow = mockedPage.locator(".tree-file", { hasText: "blob.bin" });
  ```

- The compare App row (currently around line 385):
  ```js
  const compareAppRow = mockedPage.locator(".tree-file.different", { hasText: "App.class" });
  ```

Leave the search-result button assertion (`right-only.txt · path · T2 · RIGHT`) and the `right text content for right-only.txt` content assertion unchanged — those are the search-results list and editor, not tree rows.

- [ ] **Step 2: Run the e2e guard, iterate until green**

Run: `npm run verify:frontend-render`
Expected: `frontend render passed` (exit 0). If a row isn't found, check whether its folder auto-expanded (only folders with `diffCount > 0` expand): in this fixture App.class (different), Meta.class (becomes differentMetadataOnly after inspect, but starts `different` per the mock pairs — diff), and blob.bin (different) are all under diff folders, so they auto-expand. If any assertion needs a collapsed folder opened, click the folder row (`.tree-folder` with the folder name) first. Iterate locators until green.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-frontend-render.mjs
git commit -m "test: drive hierarchical tree markup in e2e render guard"
```

---

## Task 6: full verification

**Files:** none.

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify:all`
Expected: EXIT 0 — build, release/packaging/CI invariants, `frontend invariants passed`, `frontend render passed`, `documentation invariants passed`.

- [ ] **Step 2: Manual parity check (optional)**

Run: `npm run tauri dev` (or `npm run dev` for browser preview). Confirm the tree behaves: nesting, auto-expand on diffs, folder toggle, status glyphs/tints, click-to-inspect, copy/unstage context menu, search reveals files, filter prunes. Behavior must match pre-change semantics — only the tree presentation changed.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: hierarchical file tree with git-style status (complete)" --allow-empty
```

Then use `superpowers:finishing-a-development-branch` to decide integration.

---

## Self-Review

**Spec coverage:**
- Hierarchical tree, expand/collapse → Task 2 (buildTree) + Task 3 (recursive render). ✓
- Git-style status glyph + tint, status map → Task 1 (status.ts) + Task 4 (CSS). ✓
- Folder rollup dot + count → `diffCount` in Task 2, rendered in Task 3, styled in Task 4. ✓
- Auto-expand folders with diffs, re-apply on filter change → `defaultExpanded` + the `pathsKey` effect in Task 3. ✓
- Search reveals ancestors / filter prunes → handled upstream in App (`visiblePairs` already filtered; search-result click calls `inspect`); tree builds from `visiblePairs`, so a filtered set yields a pruned tree, and a diff file's ancestors auto-expand. Search-result navigation behavior is unchanged (App owns it). ✓
- Single status chip per file (drop 3-column) → Task 3 markup + Task 4 removes `.tree-row > span`/`b` rules. ✓
- Custom recursion, no tree lib → Task 3. ✓
- Preserved inspect/copy/unstage/context-menu/pending badge → Task 3 keeps all. ✓
- App.tsx unchanged → confirmed (prop contract identical). ✓
- Invariant guard unaffected; e2e render guard updated → guard note + Task 5. ✓
- Tests for tree, status, FileTree → Tasks 1-3. ✓
- YAGNI: no keyboard nav, no folder bulk copy, no virtualization → omitted. ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. The CSS task references "read current rules and replace" but gives the full replacement block and exact selectors to remove.

**Type consistency:** `TreeNode`/`TreeFolder`/`TreeFile` defined in Task 2 and consumed in Task 3. `StatusPresentation`/`statusPresentation` defined in Task 1, consumed in Task 3. `buildTree` signature consistent. `FileTreeProps` matches the App call site (unchanged). Status raw-class names (`different`/`differentMetadataOnly`/`onlyLeft`/`onlyRight`/`identical`) match `PairStatus` and the CSS selectors in Task 4 and the e2e selectors in Task 5.
