# UI Refactor — Config Panel + Center-Focused Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the LDiff frontend so File Tree + Diff fill the center with no page scroll, move all configuration into a right-side push drawer, collapse file pickers to a compact chip bar, and replace text controls with lucide icons.

**Architecture:** Extract presentational components from the 957-line `src/App.tsx`. All state, Tauri `invoke` logic, the search-highlight effect, the signed-save `Dialog`, the editor `onMount` ref-assignment handlers, and the `ResizablePanelGroup`/`TooltipProvider` composition **stay in `App.tsx`** (single source of truth). New child components receive state + callbacks via props. Pure UI reorganization — no backend/Tauri command changes, no behavior changes.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, shadcn (radix-nova), lucide-react, @monaco-editor/react, react-resizable-panels, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-07-ui-refactor-config-panel-design.md`

---

## Critical Constraint: `scripts/verify-frontend-invariants.mjs`

This guard (run by `npm run verify:all`) asserts ~40 exact strings exist in `src/App.tsx`. They fall in two groups:

- **Logic/effect markers** (refs, effect bodies, `openPath`/`inspect`/`runSearch`/… function bodies, signed-save, `applySearchLineHighlight`, `dropSideForPosition`, editor ref onMount assignments). These code blocks **stay in `App.tsx` unchanged**, so their checks keep passing.
- **Markup markers** (shadcn imports, `ContextMenu*`, `Tooltip*`, `disabled={mode === "single"}`, the `mode === "single"` count ≥5, the Save-staged button JSX, the `save-settings` section, the mode `<Select>`). This markup **moves into child components**, so these checks must be re-pointed to read a *combined* source (App.tsx + `src/components/*.tsx`), and two intentionally-changed markers (Save-staged button text→icon; `save-settings` section→drawer) must be updated.

**Task 2 updates the guard first.** `npm test` (vitest) does NOT run this guard, so per-task commits stay green regardless; the guard only gates `verify:all` (final Task 11).

### Design rules that keep most invariant markers cheap

1. Keep `<ResizablePanelGroup orientation="vertical">` + `<ResizableHandle withHandle />` in `App.tsx`, composing `<FileTree/>` and `<DiffView/>`.
2. Keep `<TooltipProvider>` wrapping the main tree in `App.tsx`.
3. Keep the editor `onMount` handlers (containing `diffEditorRef.current = editor;` and `editorRef.current = editor;`) defined in `App.tsx`; pass them as props to `<DiffView/>`.
4. Keep the signed-save `<Dialog>` block in `App.tsx`.
5. Copy buttons keep their literal `disabled={mode === "single"}` attributes (now inside `<DiffView/>`); the mode `<Select>` keeps its literal JSX (now inside `<MenuBar/>`). The guard finds them via the combined source.

---

## File Structure

```
src/
  App.tsx                      # MODIFY — keeps all state/logic; renders new components
  styles.css                   # MODIFY — grid layout, center fills viewport, drawer push
  components/
    MenuBar.tsx                # CREATE — brand, mode toggle, save/clear staged, badge, search+drawer toggles
    SourceChips.tsx            # CREATE — compact filename chips + click-to-repick Popover
    SearchBar.tsx              # CREATE — inline collapsible query input + tree-filter quick select
    ConfigDrawer.tsx           # CREATE — push drawer: search scope/deep, view filter, engine, whitespace, backup
    FileTree.tsx               # CREATE — visible pairs list + ContextMenu (copy/unstage)
    DiffView.tsx               # CREATE — pro action toolbar (copy arrows + Source/Bytecode segmented) + Monaco
    ui/popover.tsx             # CREATE (shadcn add) — used by SourceChips
    MenuBar.test.tsx           # CREATE
    SourceChips.test.tsx       # CREATE
    SearchBar.test.tsx         # CREATE
    ConfigDrawer.test.tsx      # CREATE
    FileTree.test.tsx          # CREATE
    DiffView.test.tsx          # CREATE
scripts/
  verify-frontend-invariants.mjs  # MODIFY — read combined frontend source for markup markers
```

### Shared prop types

To avoid duplication, the existing domain types (`Side`, `PairStatus`, `EntryKind`, `Engine`, `Mode`, `SearchScope`, `TreeFilter`, `ComparePair`, `ArchiveSummary`, `EntryPreview`, `SearchResult`, `CodeEditor`, `DiffCodeEditor`, `MonacoApi`) move from `App.tsx` into a new `src/lib/types.ts` (re-exported), so components and App import them from one place.

---

## Task 1: Add lucide icon helper + shadcn Popover primitive

**Files:**
- Create: `src/components/ui/popover.tsx`
- Create: `src/lib/types.ts`
- Modify: `src/App.tsx` (replace inline `type`/`interface` decls with imports from `@/lib/types`)
- Test: `src/lib/types.test.ts`

- [ ] **Step 1: Add the shadcn Popover primitive**

Run: `npx shadcn@latest add popover`
Expected: creates `src/components/ui/popover.tsx` exporting `Popover`, `PopoverTrigger`, `PopoverContent`. If the CLI is unavailable offline, create the file manually:

```tsx
// src/components/ui/popover.tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
```

If `@radix-ui/react-popover` is not installed: `npm install @radix-ui/react-popover`.

- [ ] **Step 2: Create the shared types module**

Create `src/lib/types.ts` by moving the type/interface block from `src/App.tsx` lines 54-119 verbatim, adding `export` to each:

```ts
// src/lib/types.ts
import type { DiffOnMount, OnMount } from "@monaco-editor/react";

export type Side = "left" | "right";
export type PairStatus = "onlyLeft" | "onlyRight" | "identical" | "different" | "differentMetadataOnly";
export type EntryKind = "directory" | "class" | "text" | "binary";
export type Engine = "cfr" | "vineflower";
export type Mode = "single" | "compare";
export type SearchScope = Side | "both";
export type TreeFilter = "all" | "differences" | "onlyLeft" | "onlyRight";
export type SearchTier = "T2" | "T3";
export type CodeEditor = Parameters<OnMount>[0];
export type DiffCodeEditor = Parameters<DiffOnMount>[0];
export type MonacoApi = Parameters<OnMount>[1];
export type DecorationRef = { current: string[] };

export interface ArchiveSummary {
  path: string;
  metadata: { sourceKind: "archive" | "directory"; signed: boolean; multiRelease: boolean; zip64: boolean };
  entries: Array<{ path: string; kind: EntryKind; uncompressedSize: number }>;
}
export interface ComparePair {
  path: string;
  status: PairStatus;
  left?: { path: string; kind: EntryKind };
  right?: { path: string; kind: EntryKind };
}
export interface ArchiveDiff { pairs: ComparePair[]; }
export interface EntryPreview {
  path: string;
  kind: EntryKind;
  language: string;
  details?: string;
  content: string;
}
export interface CommitResult {
  rewrittenPath: string;
  backupPath?: string;
  signatureInvalidated: boolean;
  copiedEntries: number;
}
export interface SearchResult { side: Side; path: string; tier: SearchTier; matchKind: string; line?: number; }
export interface SearchHit { path: string; matchKind: string; line?: number; }
export interface PlatformHints { dropHint?: string; }
export type ViewMode = "source" | "bytecode";
```

- [ ] **Step 3: Re-point App.tsx to import the types**

In `src/App.tsx`, delete the inline `type`/`interface` declarations (current lines 54-119) and add at the top of the import block:

```tsx
import type {
  ArchiveDiff, ArchiveSummary, CodeEditor, CommitResult, ComparePair, DecorationRef,
  DiffCodeEditor, Engine, EntryPreview, Mode, MonacoApi, PlatformHints, SearchHit,
  SearchResult, SearchScope, Side, TreeFilter, ViewMode,
} from "@/lib/types";
```

Keep the local helpers (`isTauriRuntime`, `searchResultKey`, `pairPassesTreeFilter`, `applySearchLineHighlight`, `pairHasClass`, `dropSideForPosition`, `emptyPaths`) in `App.tsx` — the invariant guard checks them there.

- [ ] **Step 4: Write a trivial type-module smoke test**

```ts
// src/lib/types.test.ts
import { describe, expect, it } from "vitest";
import type { ComparePair } from "@/lib/types";

describe("types", () => {
  it("ComparePair shape compiles and is usable", () => {
    const pair: ComparePair = { path: "a", status: "different" };
    expect(pair.status).toBe("different");
  });
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS; tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/popover.tsx src/lib/types.ts src/lib/types.test.ts src/App.tsx package.json package-lock.json
git commit -m "refactor: extract shared frontend types and add Popover primitive"
```

(If the repo is not yet a git repo, initialize once: `git init && git add -A && git commit -m "chore: baseline before UI refactor"` before this commit. Confirm with the user first.)

---

## Task 2: Update the frontend-invariant guard for component extraction

**Files:**
- Modify: `scripts/verify-frontend-invariants.mjs`

**Rationale:** Markup markers must be found across `App.tsx` + `src/components/*.tsx`; logic markers stay bound to `App.tsx`. Two markers change meaning (Save-staged icon, save-settings→drawer).

- [ ] **Step 1: Read the whole repo's frontend source for markup checks**

At the top of the file, after the existing `readFileSync` calls, add a combined source reader:

```js
import { readdirSync } from "node:fs";

// Combined frontend source: App.tsx + every component (markup may live in either).
const componentDir = "src/components";
const componentFiles = readdirSync(componentDir, { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => readFileSync(`${componentDir}/${f}`, "utf8"));
const frontend = [app, ...componentFiles].join("\n");
```

- [ ] **Step 2: Re-point the markup-marker loops from `app` to `frontend`**

Change the following blocks to test `frontend` instead of `app` (logic blocks stay on `app`):

- The shadcn import loop (lines 59-72): replace `if (!app.includes(marker))` with `if (!frontend.includes(marker))` and update its failure message to `"frontend: must compose UI through shadcn component ${marker}"`.
- The composition-marker loop (lines 75-90): `if (!frontend.includes(marker))`, message `"frontend: missing shadcn composition marker ${marker}"`.
- Search scope disabled (line 284): `if (!frontend.includes('disabled={mode === "single"}'))`.
- Copy-action guard count (lines 288-290): `const copyActionGuards = frontend.match(/mode === "single"/g)?.length ?? 0;`
- Mode selector (line 311): `if (!frontend.includes('<Select value={mode} onValueChange={(value) => changeMode(value as Mode)}>'))`.

- [ ] **Step 3: Update the two intentionally-changed markup markers**

Replace the Save-staged button check (lines 293-295) with a structural check that survives the text→icon change:

```js
if (!frontend.includes('disabled={mode === "single"}') ||
    !/save\(side\)/.test(frontend) ||
    !frontend.includes('aria-label="Save staged"')) {
  failures.push('frontend: Save staged control must call save(side), be disabled in Single mode, and carry an aria-label');
}
```

Replace the save-settings section check (lines 297-299). Backup now lives in the drawer (Compare-only):

```js
if (!frontend.includes('{mode === "compare" &&') || !frontend.includes('Keep one overwritten .bak on save')) {
  failures.push('frontend: backup-on-save toggle must render only in Compare mode');
}
```

- [ ] **Step 4: Verify the guard still passes against current (unchanged) code**

Run: `node scripts/verify-frontend-invariants.mjs`
Expected: prints `frontend invariants passed` (no components exist yet, so `frontend` == `app` content plus existing SplashScreen; markers all present). If it fails, the only allowed cause is the two updated markers — add temporary matching `aria-label` is NOT needed yet because the old Save-staged button still matches `save(side)` + `disabled={mode === "single"}`; if the `aria-label` check fails, defer Step 3's aria-label clause until Task 7 by leaving the original button check and re-running. (Cleanest: do Step 3 now, and in this step temporarily relax the aria-label clause; re-tighten in Task 7.)

To keep this step green now, use this interim Save-staged check and tighten it in Task 7:

```js
if (!frontend.includes('disabled={mode === "single"}') || !/save\(side\)/.test(frontend)) {
  failures.push('frontend: Save staged control must call save(side) and be disabled in Single mode');
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-frontend-invariants.mjs
git commit -m "test: read combined frontend source in invariant guard for component extraction"
```

---

## Task 3: Extract DiffView (pro action toolbar + Monaco)

**Files:**
- Create: `src/components/DiffView.tsx`
- Create: `src/components/DiffView.test.tsx`
- Modify: `src/App.tsx` (add `viewMode` state; replace the `copy-actions` + `editors` JSX with `<DiffView/>`)

DiffView is presentational: it renders the action toolbar and the Monaco editor/diff. The `onMount` handlers (which assign refs) are passed from App so the ref-assignment text stays in App.tsx.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/DiffView.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DiffView } from "@/components/DiffView";
import type { ComparePair } from "@/lib/types";

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: () => <div data-testid="editor" />,
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

const classPair: ComparePair = {
  path: "A.class", status: "different",
  left: { path: "A.class", kind: "class" }, right: { path: "A.class", kind: "class" },
};

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, selected: classPair, preview: {},
    viewMode: "source" as const, ignoreTrimWhitespace: true,
    onCopy: vi.fn(), onShowSource: vi.fn(), onShowBytecode: vi.fn(),
    onEditorMount: vi.fn(), onDiffMount: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><DiffView {...props} /></TooltipProvider>);
  return props;
}

describe("DiffView", () => {
  it("renders the diff editor in compare mode", () => {
    setup();
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
  });
  it("disables copy buttons in single mode", () => {
    setup({ mode: "single" });
    expect(screen.getByLabelText("Copy to left")).toBeDisabled();
    expect(screen.getByLabelText("Copy to right")).toBeDisabled();
  });
  it("marks Bytecode toggle disabled when selection has no class entry", () => {
    setup({ selected: { path: "x.txt", status: "different", left: { path: "x.txt", kind: "text" } } });
    expect(screen.getByLabelText("Show bytecode")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — cannot resolve `@/components/DiffView`.

- [ ] **Step 3: Write DiffView**

```tsx
// src/components/DiffView.tsx
import Editor, { DiffEditor, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { ArrowLeft, ArrowRight, Binary, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComparePair, EntryPreview, Mode, Side, ViewMode } from "@/lib/types";

function pairHasClass(pair?: ComparePair) {
  return pair?.left?.kind === "class" || pair?.right?.kind === "class";
}

interface DiffViewProps {
  mode: Mode;
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  viewMode: ViewMode;
  ignoreTrimWhitespace: boolean;
  onCopy: (from: Side, to: Side) => void;
  onShowSource: () => void;
  onShowBytecode: () => void;
  onEditorMount: OnMount;
  onDiffMount: DiffOnMount;
}

export function DiffView({
  mode, selected, preview, viewMode, ignoreTrimWhitespace,
  onCopy, onShowSource, onShowBytecode, onEditorMount, onDiffMount,
}: DiffViewProps) {
  const canCopyLeft = !(mode === "single" || !selected?.right || selected.right.kind === "directory");
  const canCopyRight = !(mode === "single" || !selected?.left || selected.left.kind === "directory");
  return (
    <div className="editor-panel">
      <div className="copy-actions">
        <div className="copy-cluster">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" size="icon" aria-label="Copy to left"
                  disabled={mode === "single" || !selected?.right || selected.right.kind === "directory"}
                  onClick={() => onCopy("right", "left")}>
                  <ArrowLeft />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Copy right entry to left</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" size="icon" aria-label="Copy to right"
                  disabled={mode === "single" || !selected?.left || selected.left.kind === "directory"}
                  onClick={() => onCopy("left", "right")}>
                  <ArrowRight />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Copy left entry to right</p></TooltipContent>
          </Tooltip>
        </div>
        <div className="view-toggle" role="group" aria-label="Diff view mode">
          <Button variant={viewMode === "source" ? "secondary" : "ghost"} size="sm"
            aria-label="Show source" aria-pressed={viewMode === "source"}
            disabled={!selected} onClick={onShowSource}>
            <Code /> Source
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant={viewMode === "bytecode" ? "secondary" : "ghost"} size="sm"
                  aria-label="Show bytecode" aria-pressed={viewMode === "bytecode"}
                  disabled={!pairHasClass(selected)} onClick={onShowBytecode}>
                  <Binary /> Bytecode
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Open ASM bytecode for class entries; useful for metadata-only differences.</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="editors">
        {(preview.left?.details || preview.right?.details) && (
          <p className="preview-details">
            {preview.left?.details && `LEFT: ${preview.left.details}`}
            {preview.left?.details && preview.right?.details && " · "}
            {preview.right?.details && `RIGHT: ${preview.right.details}`}
          </p>
        )}
        {mode === "compare" ? (
          <DiffEditor
            height="100%"
            language={preview.left?.language ?? preview.right?.language ?? "plaintext"}
            original={preview.left?.content ?? ""}
            modified={preview.right?.content ?? ""}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, automaticLayout: true, ignoreTrimWhitespace }}
            onMount={onDiffMount}
          />
        ) : (
          <Editor
            height="100%"
            language={preview.left?.language ?? "plaintext"}
            value={preview.left?.content ?? ""}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
            onMount={onEditorMount}
          />
        )}
      </div>
    </div>
  );
}
```

Note `automaticLayout: true` is added so Monaco re-measures when the drawer pushes its container (spec risk mitigation).

- [ ] **Step 4: Wire into App.tsx**

In `App.tsx`: add `const [viewMode, setViewMode] = useState<ViewMode>("source");`.
- In `inspect(...)` and `changeEngine(...)` (source paths) the existing code sets the preview; add `setViewMode("source");` at the start of `inspect`.
- In `showBytecode()` add `setViewMode("bytecode");` after the successful `setPreview(next);`.
- Define mount handlers (these keep the ref-assignment strings the guard checks):

```tsx
const handleEditorMount: OnMount = (editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; };
const handleDiffMount: DiffOnMount = (editor, monaco) => { diffEditorRef.current = editor; monacoRef.current = monaco; };
```

- Replace the JSX block currently at lines 868-929 (the `editor-panel` ResizablePanel contents: `copy-actions` div + `editors` div) with:

```tsx
<DiffView
  mode={mode}
  selected={selected}
  preview={preview}
  viewMode={viewMode}
  ignoreTrimWhitespace={ignoreTrimWhitespace}
  onCopy={(from, to) => void copy(from, to)}
  onShowSource={() => selected && void inspect(selected)}
  onShowBytecode={showBytecode}
  onEditorMount={handleEditorMount}
  onDiffMount={handleDiffMount}
/>
```

Keep the surrounding `<ResizablePanel defaultSize={56} minSize={30} className="editor-panel">` wrapper (or move `className="editor-panel"` onto DiffView's root and keep the ResizablePanel). Import `DiffView` and `ViewMode`, `OnMount`, `DiffOnMount`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/DiffView.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DiffView.tsx src/components/DiffView.test.tsx src/App.tsx
git commit -m "refactor: extract DiffView with icon copy buttons and Source/Bytecode toggle"
```

---

## Task 4: Extract FileTree

**Files:**
- Create: `src/components/FileTree.tsx`
- Create: `src/components/FileTree.test.tsx`
- Modify: `src/App.tsx` (replace the `tree` div JSX with `<FileTree/>`)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/FileTree.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "@/components/FileTree";
import type { ComparePair } from "@/lib/types";

const pairs: ComparePair[] = [
  { path: "A.class", status: "different", left: { path: "A.class", kind: "class" }, right: { path: "A.class", kind: "class" } },
  { path: "B.txt", status: "onlyLeft", left: { path: "B.txt", kind: "text" } },
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
  it("renders a row per visible pair with its status badge", () => {
    setup();
    expect(screen.getByText("different")).toBeInTheDocument();
    expect(screen.getByText("onlyLeft")).toBeInTheDocument();
  });
  it("calls onInspect when a row is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(props.onInspect).toHaveBeenCalledWith(pairs[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/FileTree.test.tsx`
Expected: FAIL — cannot resolve `@/components/FileTree`.

- [ ] **Step 3: Write FileTree** (move JSX from App lines 818-865 verbatim into a component)

```tsx
// src/components/FileTree.tsx
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
```

- [ ] **Step 4: Wire into App.tsx**

Replace the `<div className="tree">…</div>` block (App lines 818-865) with:

```tsx
<FileTree
  visiblePairs={visiblePairs}
  selected={selected}
  stagedEntries={stagedEntries}
  mode={mode}
  onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
  onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
  onCopy={(from, to, pair) => void copy(from, to, pair)}
  onUnstage={(entryPath) => void unstage(entryPath)}
/>
```

Import `FileTree`. The `Badge` and context-menu imports may now be unused in App — remove them from App only if nothing else uses them (the guard now reads the combined source, so the markers remain satisfied by `FileTree.tsx`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/FileTree.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/FileTree.tsx src/components/FileTree.test.tsx src/App.tsx
git commit -m "refactor: extract FileTree component"
```

---

## Task 5: Extract ConfigDrawer (push drawer with moved configs)

**Files:**
- Create: `src/components/ConfigDrawer.tsx`
- Create: `src/components/ConfigDrawer.test.tsx`
- Modify: `src/App.tsx` (add `drawerOpen` state; move `toolbar`/`options-zone`/`save-settings` controls into the drawer)

This task moves: search **scope** select, **Deep search**/**Cancel**/**Clear** buttons, **tree filter** select, **engine** select, **ignore-whitespace** checkbox, **backup-on-save** checkbox.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ConfigDrawer.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigDrawer } from "@/components/ConfigDrawer";

function setup(overrides = {}) {
  const props = {
    open: true, mode: "compare" as const, searchScope: "both" as const, searching: false,
    treeFilter: "differences" as const, engine: "cfr" as const,
    ignoreTrimWhitespace: true, backupEnabled: false,
    onScopeChange: vi.fn(), onDeepSearch: vi.fn(), onCancelDeepSearch: vi.fn(), onClearSearch: vi.fn(),
    onFilterChange: vi.fn(), onEngineChange: vi.fn(), onIgnoreWsChange: vi.fn(), onBackupChange: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><ConfigDrawer {...props} /></TooltipProvider>);
  return props;
}

describe("ConfigDrawer", () => {
  it("renders nothing actionable when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Deep search")).not.toBeInTheDocument();
  });
  it("shows backup toggle only in compare mode", () => {
    setup({ mode: "single" });
    expect(screen.queryByText(/Keep one overwritten .bak on save/)).not.toBeInTheDocument();
  });
  it("fires onDeepSearch", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("Deep search"));
    expect(props.onDeepSearch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ConfigDrawer.test.tsx`
Expected: FAIL — cannot resolve `@/components/ConfigDrawer`.

- [ ] **Step 3: Write ConfigDrawer**

```tsx
// src/components/ConfigDrawer.tsx
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

export function ConfigDrawer(props: ConfigDrawerProps) {
  if (!props.open) return <aside className="config-drawer closed" aria-hidden="true" />;
  return (
    <aside className="config-drawer open" aria-label="Configuration">
      <section className="drawer-group">
        <span className="zone-label">Search</span>
        <Select value={props.searchScope} disabled={props.mode === "single"}
          onValueChange={(v) => props.onScopeChange(v as SearchScope)}>
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
                <Button variant="secondary" disabled={props.searching} onClick={props.onDeepSearch}>Deep search</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent><p>Decompile classes in the background and stream source matches.</p></TooltipContent>
          </Tooltip>
          <Button variant="outline" disabled={!props.searching} onClick={props.onCancelDeepSearch}>Cancel search</Button>
          <Button variant="ghost" onClick={props.onClearSearch}>Clear search</Button>
        </div>
      </section>

      <section className="drawer-group">
        <span className="zone-label">View</span>
        <Select value={props.treeFilter} onValueChange={(v) => props.onFilterChange(v as TreeFilter)}>
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
        <Select value={props.engine} onValueChange={(v) => props.onEngineChange(v as Engine)}>
          <SelectTrigger aria-label="Decompiler engine"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="cfr">CFR</SelectItem>
            <SelectItem value="vineflower">Vineflower</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <label className="check-label">
          <Checkbox checked={props.ignoreTrimWhitespace} onCheckedChange={(c) => props.onIgnoreWsChange(c === true)} />
          Ignore trim whitespace
        </label>
      </section>

      {props.mode === "compare" && (
        <section className="drawer-group">
          <span className="zone-label">Save</span>
          <label className="check-label">
            <Checkbox checked={props.backupEnabled} onCheckedChange={(c) => props.onBackupChange(c === true)} />
            Keep one overwritten .bak on save
          </label>
        </section>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Wire into App.tsx**

- Add `const [drawerOpen, setDrawerOpen] = useState(false);`.
- Delete the `<section className="toolbar panel">…</section>` block (App lines 701-788) **except** the search query `<Input>` + `Search` button (those move to SearchBar in Task 6 — for now, temporarily keep them inline directly under the sources section so search still works between tasks).
- Delete the `{mode === "compare" && <section className="save-settings">…</section>}` block (App lines 790-799); the backup checkbox moves to the drawer. Keep the staged-status text — relocate the `stagedTarget ? … : "No staged copies"` span into the menu bar in Task 8 (temporarily keep it under the message line).
- Render the drawer as a sibling of the workspace so it can push (Task 10 finalizes layout):

```tsx
<ConfigDrawer
  open={drawerOpen}
  mode={mode}
  searchScope={searchScope}
  searching={searching}
  treeFilter={treeFilter}
  engine={engine}
  ignoreTrimWhitespace={ignoreTrimWhitespace}
  backupEnabled={backupEnabled}
  onScopeChange={setSearchScope}
  onDeepSearch={runDeepSearch}
  onCancelDeepSearch={cancelDeepSearch}
  onClearSearch={clearSearch}
  onFilterChange={setTreeFilter}
  onEngineChange={(next) => void changeEngine(next)}
  onIgnoreWsChange={setIgnoreTrimWhitespace}
  onBackupChange={setBackupEnabled}
/>
```

Add a temporary toggle button near the header so the drawer is reachable until MenuBar lands: `<Button variant="outline" aria-label="Settings" onClick={() => setDrawerOpen((o) => !o)}>Settings</Button>`. Import `ConfigDrawer`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/ConfigDrawer.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/App.tsx
git commit -m "refactor: move search/view/decompiler/backup configs into ConfigDrawer"
```

---

## Task 6: Extract SearchBar (inline collapsible search)

**Files:**
- Create: `src/components/SearchBar.tsx`
- Create: `src/components/SearchBar.test.tsx`
- Modify: `src/App.tsx` (add `searchOpen` state; replace the temporary inline search with `<SearchBar/>`)

SearchBar holds the always-available query input + the quick tree-filter select. Deep/scope live in the drawer (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/SearchBar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "@/components/SearchBar";

function setup(overrides = {}) {
  const props = {
    open: true, query: "", treeFilter: "differences" as const,
    onQueryChange: vi.fn(), onSearch: vi.fn(), onFilterChange: vi.fn(),
    ...overrides,
  };
  render(<SearchBar {...props} />);
  return props;
}

describe("SearchBar", () => {
  it("shows the query input when open", () => {
    setup();
    expect(screen.getByPlaceholderText(/Search paths, text, constants/)).toBeInTheDocument();
  });
  it("fires onSearch on submit button", async () => {
    const props = setup({ query: "foo" });
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SearchBar.test.tsx`
Expected: FAIL — cannot resolve `@/components/SearchBar`.

- [ ] **Step 3: Write SearchBar**

```tsx
// src/components/SearchBar.tsx
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { TreeFilter } from "@/lib/types";

interface SearchBarProps {
  open: boolean;
  query: string;
  treeFilter: TreeFilter;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onFilterChange: (filter: TreeFilter) => void;
}

export function SearchBar({ open, query, treeFilter, onQueryChange, onSearch, onFilterChange }: SearchBarProps) {
  if (!open) return null;
  return (
    <div className="search-bar">
      <Input
        className="search-input"
        value={query}
        placeholder="Search paths, text, constants"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
      />
      <Button aria-label="Search" onClick={onSearch}><Search /> Search</Button>
      <Select value={treeFilter} onValueChange={(v) => onFilterChange(v as TreeFilter)}>
        <SelectTrigger aria-label="Tree filter"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="all">Show all</SelectItem>
          <SelectItem value="differences">Differences only</SelectItem>
          <SelectItem value="onlyLeft">Only left</SelectItem>
          <SelectItem value="onlyRight">Only right</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
    </div>
  );
}
```

(The tree-filter select intentionally appears in both SearchBar and ConfigDrawer — quick access vs full config. Both call the same `setTreeFilter`. If you prefer a single source, drop it from the drawer's View group; keep it here. Decision: keep in SearchBar, remove the View group from ConfigDrawer to avoid duplication — update `ConfigDrawer.tsx` and its test accordingly.)

- [ ] **Step 4: Wire into App.tsx**

- Add `const [searchOpen, setSearchOpen] = useState(true);` (start open; menu bar toggle in Task 8 can collapse it).
- Remove the temporary inline search input/button added in Task 5.
- Render under the source chips:

```tsx
<SearchBar
  open={searchOpen}
  query={query}
  treeFilter={treeFilter}
  onQueryChange={setQuery}
  onSearch={runSearch}
  onFilterChange={setTreeFilter}
/>
```

Import `SearchBar`. If you removed the View group from ConfigDrawer, also remove `treeFilter`/`onFilterChange` from `ConfigDrawer` props + test.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/SearchBar.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchBar.tsx src/components/SearchBar.test.tsx src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/App.tsx
git commit -m "refactor: extract inline SearchBar"
```

---

## Task 7: Extract SourceChips (compact pickers + repick Popover)

**Files:**
- Create: `src/components/SourceChips.tsx`
- Create: `src/components/SourceChips.test.tsx`
- Modify: `src/App.tsx` (replace the `sources-zone` section with `<SourceChips/>`)
- Modify: `scripts/verify-frontend-invariants.mjs` (tighten the Save-staged marker to require `aria-label="Save staged"`)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/SourceChips.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceChips } from "@/components/SourceChips";
import type { ArchiveSummary } from "@/lib/types";

const leftArchive: ArchiveSummary = {
  path: "/x/app.jar",
  metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
  entries: [],
};

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, archives: { left: leftArchive }, paths: { left: "", right: "" },
    pathErrors: {}, onOpenPath: vi.fn(), onBrowse: vi.fn(), onBrowseFolder: vi.fn(), onSave: vi.fn(),
    ...overrides,
  };
  render(<SourceChips {...props} />);
  return props;
}

describe("SourceChips", () => {
  it("shows the loaded archive filename on its chip", () => {
    setup();
    expect(screen.getByText(/app.jar/)).toBeInTheDocument();
  });
  it("opens a repick popover when a chip is clicked", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    expect(screen.getByRole("button", { name: /Browse file/i })).toBeInTheDocument();
  });
  it("disables Save staged in single mode", async () => {
    setup({ mode: "single" });
    await userEvent.click(screen.getByRole("button", { name: /change left source/i }));
    expect(screen.getByLabelText("Save staged")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SourceChips.test.tsx`
Expected: FAIL — cannot resolve `@/components/SourceChips`.

- [ ] **Step 3: Write SourceChips**

```tsx
// src/components/SourceChips.tsx
import { ArrowLeftRight, FileText, Folder, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ArchiveSummary, Mode, Side } from "@/lib/types";

interface SourceChipsProps {
  mode: Mode;
  archives: Partial<Record<Side, ArchiveSummary>>;
  paths: Record<Side, string>;
  pathErrors: Partial<Record<Side, string>>;
  onOpenPath: (side: Side, path: string) => void;
  onBrowse: (side: Side) => void;
  onBrowseFolder: (side: Side) => void;
  onSave: (side: Side) => void;
}

function basename(path: string) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function SourceChips(props: SourceChipsProps) {
  const sides: Side[] = props.mode === "compare" ? ["left", "right"] : ["left"];
  return (
    <div className="source-chips">
      {sides.map((side, index) => {
        const archive = props.archives[side];
        return (
          <span className="chip-wrap" key={side}>
            {index === 1 && <ArrowLeftRight className="chip-sep" aria-hidden="true" />}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="source-chip" aria-label={`Change ${side} source`}>
                  <Package /> {archive ? basename(archive.path) : `${side.toUpperCase()} — no source`}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="repick">
                  <strong>{side.toUpperCase()}</strong>
                  <Input
                    value={props.paths[side]}
                    placeholder="~/path/to/archive.jar or folder"
                    onChange={(e) => { props.paths[side] = e.target.value; }}
                    onKeyDown={(e) => { if (e.key === "Enter") props.onOpenPath(side, (e.target as HTMLInputElement).value); }}
                  />
                  <div className="repick-actions">
                    <Button variant="outline" onClick={() => props.onBrowse(side)}><FileText /> Browse file</Button>
                    <Button variant="outline" onClick={() => props.onBrowseFolder(side)}><Folder /> Browse folder</Button>
                    <Button variant="secondary" aria-label="Save staged"
                      disabled={props.mode === "single"} onClick={() => props.onSave(side)}>Save staged</Button>
                  </div>
                  <small>{archive ? `${archive.metadata.sourceKind}: ${archive.path}` : "No source loaded"}</small>
                  {props.pathErrors[side] && <small className="path-error">{props.pathErrors[side]}</small>}
                </div>
              </PopoverContent>
            </Popover>
          </span>
        );
      })}
    </div>
  );
}
```

Note: the path `<Input>` here is uncontrolled-on-change to avoid threading a per-keystroke callback; the source of truth on submit is the input value passed to `onOpenPath`. Keep App's `paths` state for the controlled value via `value`; for full controlled behavior, pass an `onPathChange(side, value)` prop and call `setPaths` in App. Use the controlled variant:

Add prop `onPathChange: (side: Side, value: string) => void;` and replace the `onChange` with `onChange={(e) => props.onPathChange(side, e.target.value)}` and Enter handler with `props.onOpenPath(side, props.paths[side])`. Update the test's props accordingly (`onPathChange: vi.fn()`).

- [ ] **Step 4: Wire into App.tsx**

Replace the `<section className="sources-zone">…</section>` block (App lines 677-699) with:

```tsx
<SourceChips
  mode={mode}
  archives={archives}
  paths={paths}
  pathErrors={pathErrors}
  onPathChange={(side, value) => setPaths((current) => ({ ...current, [side]: value }))}
  onOpenPath={(side, path) => void openPath(side, path)}
  onBrowse={(side) => void browse(side)}
  onBrowseFolder={(side) => void browseFolder(side)}
  onSave={(side) => void save(side)}
/>
```

Import `SourceChips`.

- [ ] **Step 5: Tighten the Save-staged invariant marker**

In `scripts/verify-frontend-invariants.mjs`, replace the interim Save-staged check from Task 2 Step 4 with:

```js
if (!frontend.includes('disabled={props.mode === "single"}') && !frontend.includes('disabled={mode === "single"}')) {
  failures.push('frontend: Save staged control must be disabled in Single mode');
}
if (!frontend.includes('aria-label="Save staged"') || !/onSave\(side\)|save\(side\)/.test(frontend)) {
  failures.push('frontend: Save staged control must carry aria-label and trigger save for the side');
}
```

- [ ] **Step 6: Run tests + typecheck + guard**

Run: `npx vitest run src/components/SourceChips.test.tsx && npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: all PASS; guard prints `frontend invariants passed`.

- [ ] **Step 7: Commit**

```bash
git add src/components/SourceChips.tsx src/components/SourceChips.test.tsx src/App.tsx scripts/verify-frontend-invariants.mjs
git commit -m "refactor: collapse file pickers into compact SourceChips with repick popover"
```

---

## Task 8: Extract MenuBar

**Files:**
- Create: `src/components/MenuBar.tsx`
- Create: `src/components/MenuBar.test.tsx`
- Modify: `src/App.tsx` (replace `<header>…</header>` + temporary settings/search toggles + staged-status text with `<MenuBar/>`)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/MenuBar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MenuBar } from "@/components/MenuBar";

function setup(overrides = {}) {
  const props = {
    mode: "compare" as const, stagedTarget: undefined as "left" | "right" | undefined, stagedCount: 0,
    searchOpen: true, drawerOpen: false,
    onChangeMode: vi.fn(), onSave: vi.fn(), onClearStaged: vi.fn(),
    onToggleSearch: vi.fn(), onToggleDrawer: vi.fn(),
    ...overrides,
  };
  render(<TooltipProvider><MenuBar {...props} /></TooltipProvider>);
  return props;
}

describe("MenuBar", () => {
  it("shows the staged badge when copies are pending", () => {
    setup({ stagedTarget: "right", stagedCount: 2 });
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });
  it("toggles the drawer", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Settings"));
    expect(props.onToggleDrawer).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MenuBar.test.tsx`
Expected: FAIL — cannot resolve `@/components/MenuBar`.

- [ ] **Step 3: Write MenuBar**

```tsx
// src/components/MenuBar.tsx
import { Save, Search, Settings, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Mode, Side } from "@/lib/types";

interface MenuBarProps {
  mode: Mode;
  stagedTarget?: Side;
  stagedCount: number;
  searchOpen: boolean;
  drawerOpen: boolean;
  onChangeMode: (mode: Mode) => void;
  onSave: (side: Side) => void;
  onClearStaged: () => void;
  onToggleSearch: () => void;
  onToggleDrawer: () => void;
}

export function MenuBar({
  mode, stagedTarget, stagedCount, searchOpen, drawerOpen,
  onChangeMode, onSave, onClearStaged, onToggleSearch, onToggleDrawer,
}: MenuBarProps) {
  return (
    <header className="menu-bar">
      <div className="brand">
        <h1>LDiff</h1>
        <span className="tagline">archive diff · merge</span>
      </div>
      <div className="topbar-controls">
        <Select value={mode} onValueChange={(value) => onChangeMode(value as Mode)}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="single">Single</SelectItem>
            <SelectItem value="compare">Compare</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="secondary" size="icon" aria-label="Save staged"
                disabled={mode === "single"} onClick={() => stagedTarget && onSave(stagedTarget)}>
                <Save />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>Save staged copies to their target archive</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="icon" aria-label="Clear staged" onClick={onClearStaged}>
                <Trash2 />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent><p>Discard all staged copies</p></TooltipContent>
        </Tooltip>
        {stagedTarget && <Badge variant="secondary">{stagedCount} → {stagedTarget}</Badge>}
        <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" aria-label="Search" aria-pressed={searchOpen} onClick={onToggleSearch}>
          <Search />
        </Button>
        <Button variant={drawerOpen ? "secondary" : "ghost"} size="icon" aria-label="Settings" aria-pressed={drawerOpen} onClick={onToggleDrawer}>
          <Settings />
        </Button>
      </div>
    </header>
  );
}
```

Note the guard requires the literal `<Select value={mode} onValueChange={(value) => changeMode(value as Mode)}>`. To satisfy it exactly, keep that callback name: pass `onChangeMode={changeMode}` from App and inside MenuBar write `onValueChange={(value) => onChangeMode(value as Mode)}` — the guard's literal will NOT match `onChangeMode`. **To preserve the exact marker, instead inline the App callback name:** change the guard marker in Task 2 was left as the literal; update it now in this task's guard step (Step 5) to accept `onChangeMode` OR `changeMode`.

- [ ] **Step 4: Wire into App.tsx**

Replace `<header>…</header>` (App lines 656-675) and the temporary settings/search toggle buttons and the staged-status span with:

```tsx
<MenuBar
  mode={mode}
  stagedTarget={stagedTarget}
  stagedCount={Object.keys(stagedEntries).length}
  searchOpen={searchOpen}
  drawerOpen={drawerOpen}
  onChangeMode={changeMode}
  onSave={(side) => void save(side)}
  onClearStaged={clearStaged}
  onToggleSearch={() => setSearchOpen((o) => !o)}
  onToggleDrawer={() => setDrawerOpen((o) => !o)}
/>
```

Import `MenuBar`.

- [ ] **Step 5: Update the mode-selector invariant marker**

In `scripts/verify-frontend-invariants.mjs`, replace the mode-selector check (originally line 311) with one that accepts the prop-callback form:

```js
if (!frontend.includes('onValueChange={(value) => onChangeMode(value as Mode)}') &&
    !frontend.includes('onValueChange={(value) => changeMode(value as Mode)}')) {
  failures.push('frontend: mode selector must use guarded changeMode');
}
```

Also confirm `changeMode` still contains its guard body in `App.tsx` (the `changeModeBody` regex check is unchanged and still reads `app`).

- [ ] **Step 6: Run tests + typecheck + guard**

Run: `npx vitest run src/components/MenuBar.test.tsx && npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MenuBar.tsx src/components/MenuBar.test.tsx src/App.tsx scripts/verify-frontend-invariants.mjs
git commit -m "refactor: extract icon-based MenuBar with search/settings toggles"
```

---

## Task 9: Recompose App layout + CSS (center fills, drawer push)

**Files:**
- Modify: `src/App.tsx` (final JSX structure of the `workspace` return)
- Modify: `src/styles.css`

- [ ] **Step 1: Final App return structure**

Ensure the workspace return reads (top-to-bottom): `<MenuBar/>`, `<SourceChips/>`, `<SearchBar/>`, then a `<div className="work-area">` containing the `<section className="workspace">` (with the `ResizablePanelGroup` composing `<FileTree/>` and `<DiffView/>`) and `<ConfigDrawer/>` as flex siblings, then `{dropHint && <p className="platform-hint">{dropHint}</p>}`, the `<p className="message">`, the search-results `<section>`, and the signed-save `<Dialog>`. Keep `<TooltipProvider>` wrapping `<main>`. Keep `ResizablePanelGroup orientation="vertical"` + `ResizableHandle withHandle`.

Example skeleton (logic unchanged):

```tsx
return (
  <TooltipProvider>
  <main className="app-shell">
    <MenuBar … />
    <SourceChips … />
    <SearchBar … />
    {dropHint && <p className="platform-hint">{dropHint}</p>}
    <div className="work-area">
      <section className="workspace">
        <ResizablePanelGroup orientation="vertical" className="workspace-panels">
          <ResizablePanel defaultSize={44} minSize={25}>
            <FileTree … />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={56} minSize={30} className="editor-panel">
            <DiffView … />
          </ResizablePanel>
        </ResizablePanelGroup>
      </section>
      <ConfigDrawer … />
    </div>
    <p className="message">{message}</p>
    {searchResults.length > 0 && ( <section className="search-results"> … </section> )}
    <Dialog open={signedSavePrompt !== undefined} …> … </Dialog>
  </main>
  </TooltipProvider>
);
```

- [ ] **Step 2: Rewrite the layout CSS so the work area fills the viewport**

In `src/styles.css`, set the shell to a full-height column and let `.work-area` flex to fill. Add (and reconcile with existing rules — keep the Tailwind/shadcn `@import` and `@theme inline` markers intact):

```css
main.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.menu-bar, .source-chips, .search-bar { flex: 0 0 auto; }
.work-area { display: flex; flex: 1 1 auto; min-height: 0; }
.work-area .workspace { flex: 1 1 auto; min-width: 0; display: flex; }
.workspace-panels { flex: 1 1 auto; min-height: 0; }
.message { flex: 0 0 auto; }

.source-chips { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; }
.source-chip { max-width: 22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; }
.search-bar .search-input { flex: 1 1 auto; }

.config-drawer { flex: 0 0 auto; overflow-y: auto; border-left: 1px solid var(--border); transition: width 0.15s ease; }
.config-drawer.closed { width: 0; border-left: none; }
.config-drawer.open { width: 280px; padding: 0.75rem; }
.drawer-group { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }

.copy-actions { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.25rem; }
.copy-cluster, .view-toggle { display: flex; gap: 0.25rem; }
```

Remove now-dead rules for `.sources-zone`, `.open-grid`, `.open-panel`, `.open-actions`, `.toolbar`, `.toolbar-group`, `.options-zone`, `.options-group`, `.save-settings` only if nothing else references them. If unsure, leave them — dead CSS does not fail any guard.

- [ ] **Step 3: Run tests + typecheck + guard**

Run: `npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: all PASS.

- [ ] **Step 4: Manually verify layout in dev**

Run: `npm run dev` and open the printed URL in a browser (Tauri-less preview).
Confirm: (1) menu bar + chip row + search row are thin; (2) tree + diff fill the rest with no page scroll; (3) ⚙ opens a right drawer that pushes the diff narrower (diff does not get covered); (4) 🔍 toggles the search row; (5) clicking a source chip opens the repick popover. Stop dev (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "refactor: center-focused layout with push config drawer"
```

---

## Task 10: Icon pass + tooltip coverage cleanup

**Files:**
- Modify: `src/components/*.tsx` (ensure every icon-only button has an `aria-label` + tooltip; keep text where the spec says)

- [ ] **Step 1: Audit icon buttons**

Confirm each icon-only `Button` has `aria-label` and, where the action is non-obvious, a `Tooltip`. Text remains on: tree status `Badge`s, `Select` current values, the signed-save `Dialog` buttons (`Cancel` / `Save anyway`), and the `Deep search`/`Cancel search`/`Clear search` drawer buttons (labels aid discoverability). No code change if already satisfied — this is a verification step.

- [ ] **Step 2: Run the full test suite + typecheck + guard**

Run: `npm test && npx tsc --noEmit && node scripts/verify-frontend-invariants.mjs`
Expected: PASS.

- [ ] **Step 3: Commit (if any tweaks were made)**

```bash
git add -A
git commit -m "polish: ensure icon buttons carry aria-labels and tooltips"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the project's full verification suite**

Run: `npm run verify:all`
Expected: `tsc` build succeeds, all `verify:*` scripts pass — including `verify:frontend-invariants` (`frontend invariants passed`) and `verify:frontend-render` (Playwright renders the app without errors).

If `verify:frontend-render` fails, read its assertions (`scripts/verify-frontend-render.mjs`) and reconcile — it renders the real frontend headless; a missing element or runtime error there is a real regression.

- [ ] **Step 2: Build the Tauri app and smoke-test (optional but recommended)**

Run: `npm run tauri dev`
Manually confirm parity with pre-refactor behavior: open archives via chips, diff renders, search + deep search + cancel + clear, tree filter, copy-to-left/right, stage + save, signed-save dialog, single/compare switch guard, history/splash. The pre-refactor behavior is the regression oracle — nothing should behave differently.

- [ ] **Step 3: Final commit / branch wrap**

```bash
git add -A
git commit -m "refactor: complete config-panel UI reorganization" --allow-empty
```

Then use the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup.

---

## Self-Review

**Spec coverage:**
- Right push drawer (closed by default, ⚙ toggle) → Tasks 5, 8, 9. ✓
- Search bar in main view, advanced in drawer → Tasks 5, 6. ✓
- Clean horizontal toolbar menu bar → Task 8. ✓
- Compact picker chip bar + click (not hover) repick → Task 7. ✓
- Pro diff toolbar (copy arrows + Source/Bytecode segmented) → Task 3. ✓
- lucide icons + tooltips; text kept for badges/dropdowns/destructive confirms → Tasks 3,7,8,10. ✓
- Component split (MenuBar/SourceChips/SearchBar/ConfigDrawer/FileTree/DiffView), state in App → Tasks 3-8. ✓
- UI-only state adds (drawerOpen, searchOpen, viewMode, activePicker) → drawerOpen (T5), searchOpen (T6), viewMode (T3). `activePicker` proved unnecessary because Radix `Popover` manages its own open state per chip — dropped (YAGNI). ✓
- Monaco re-layout on drawer push → `automaticLayout: true` in DiffView (T3). ✓
- Editor ref wiring across boundary → mount handlers stay in App, passed as props (T3). ✓
- No backend changes; invariant guard updated, not bypassed → Tasks 2,7,8; final verify T11. ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code. The one judgment call (tree-filter duplicated in SearchBar vs ConfigDrawer) is resolved explicitly in Task 6 Step 3 (keep in SearchBar, remove from drawer).

**Type consistency:** Component prop names (`onCopy`, `onInspect`, `onSelect`, `onChangeMode`, `onToggleDrawer`, `onScopeChange`, `onPathChange`, …) are used consistently between each component's definition, its test, and the App wiring. `ViewMode` defined in `types.ts` (T1) and consumed in DiffView (T3). Mount handler types `OnMount`/`DiffOnMount` consistent between App and DiffView.

**Known follow-up:** Task 8 Step 3's note about the exact `changeMode` literal is resolved by the guard update in Task 8 Step 5 (accepts `onChangeMode` form). The Save-staged marker is interim in Task 2 and tightened in Task 7 Step 5.
