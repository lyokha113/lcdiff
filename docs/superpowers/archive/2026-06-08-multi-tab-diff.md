# Multi-Tab Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Diff tab with one tab per opened diff, a pinned Files tab, horizontal-scrolling tab strip, per-tab close, focus-existing-on-reclick, LRU cap of 10, and reset-on-reload.

**Architecture:** Keep `selected`/`preview`/`viewMode` as the *live* active-tab state so `DiffView`, the search-highlight effect, copy, and `changeEngine` stay untouched. Add an `openTabs` array of snapshots `{path, pair, preview, viewMode, lastFocus}`. A sync effect persists live state into the active snapshot whenever it changes; switching tabs loads the target snapshot back into live state. A new presentational `WorkspaceTabs` component renders the strip. No backend change.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, Tauri (`invoke`), Monaco diff editor, Tailwind/CSS classes.

---

## File Structure

- `src/components/WorkspaceTabs.tsx` — **new**, pure presentational tab strip (Files tab + diff tabs + close + scroll).
- `src/components/WorkspaceTabs.test.tsx` — **new**, component tests.
- `src/lib/tabs.ts` — **new**, pure helpers: `DiffTab` type, `upsertTab`, `evictLru`, `pickNeighbor`.
- `src/lib/tabs.test.ts` — **new**, unit tests for the helpers.
- `src/App.tsx` — **modify**, swap `activeTab: "tree"|"diff"` model for `"files" | path`, add `openTabs` state + sync effect + open/focus/close handlers, render `WorkspaceTabs`.
- `src/App.css` (or the file holding `.workspace-tabs` rules — confirm during Task 5) — **modify**, horizontal scroll + close button + status dot styles.

---

## Task 1: Tab helpers (`src/lib/tabs.ts`)

**Files:**
- Create: `src/lib/tabs.ts`
- Test: `src/lib/tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tabs.test.ts
import { describe, expect, it } from "vitest";
import type { ComparePair, EntryPreview, ViewMode } from "@/lib/types";
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "@/lib/tabs";

function pair(path: string): ComparePair {
  return { path, status: "different", left: undefined, right: undefined };
}
function tab(path: string, lastFocus: number): DiffTab {
  return { path, pair: pair(path), preview: {} as Partial<Record<"left" | "right", EntryPreview>>, viewMode: "source" as ViewMode, lastFocus };
}

describe("upsertTab", () => {
  it("appends a new tab in insertion order", () => {
    const next = upsertTab([tab("a", 1)], tab("b", 2));
    expect(next.map((t) => t.path)).toEqual(["a", "b"]);
  });
  it("replaces an existing tab in place without reordering", () => {
    const next = upsertTab([tab("a", 1), tab("b", 2)], { ...tab("a", 3), viewMode: "bytecode" });
    expect(next.map((t) => t.path)).toEqual(["a", "b"]);
    expect(next[0].viewMode).toBe("bytecode");
  });
});

describe("evictLru", () => {
  it("returns the list unchanged when at or below the cap", () => {
    const list = [tab("a", 1), tab("b", 2)];
    expect(evictLru(list, 2)).toBe(list);
  });
  it("drops the lowest lastFocus when over the cap, preserving order", () => {
    const next = evictLru([tab("a", 5), tab("b", 1), tab("c", 9)], 2);
    expect(next.map((t) => t.path)).toEqual(["a", "c"]);
  });
});

describe("pickNeighbor", () => {
  it("returns the right neighbor of the closed path", () => {
    expect(pickNeighbor([tab("a", 1), tab("b", 2), tab("c", 3)], "b")).toBe("c");
  });
  it("returns the left neighbor when closing the last tab", () => {
    expect(pickNeighbor([tab("a", 1), tab("b", 2)], "b")).toBe("a");
  });
  it("returns 'files' when closing the only tab", () => {
    expect(pickNeighbor([tab("a", 1)], "a")).toBe("files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tabs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/tabs'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/tabs.ts
import type { ComparePair, EntryPreview, Side, ViewMode } from "@/lib/types";

export interface DiffTab {
  path: string;
  pair: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  viewMode: ViewMode;
  lastFocus: number;
}

export function upsertTab(tabs: DiffTab[], next: DiffTab): DiffTab[] {
  const idx = tabs.findIndex((t) => t.path === next.path);
  if (idx === -1) return [...tabs, next];
  const copy = tabs.slice();
  copy[idx] = next;
  return copy;
}

export function evictLru(tabs: DiffTab[], cap: number): DiffTab[] {
  if (tabs.length <= cap) return tabs;
  let lru = tabs[0];
  for (const t of tabs) if (t.lastFocus < lru.lastFocus) lru = t;
  return tabs.filter((t) => t.path !== lru.path);
}

export function pickNeighbor(tabs: DiffTab[], closingPath: string): "files" | string {
  const idx = tabs.findIndex((t) => t.path === closingPath);
  if (idx === -1) return "files";
  const remaining = tabs.filter((t) => t.path !== closingPath);
  if (remaining.length === 0) return "files";
  return (remaining[idx] ?? remaining[remaining.length - 1]).path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tabs.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabs.ts src/lib/tabs.test.ts
git commit -m "feat: add diff-tab list helpers (upsert, LRU evict, neighbor)"
```

---

## Task 2: `WorkspaceTabs` component

**Files:**
- Create: `src/components/WorkspaceTabs.tsx`
- Test: `src/components/WorkspaceTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/WorkspaceTabs.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";

function setup(overrides = {}) {
  const props = {
    fileCount: 3,
    activeId: "files" as "files" | string,
    tabs: [
      { path: "com/x/Foo.class", status: "different" as const },
      { path: "com/x/Bar.class", status: "onlyLeft" as const },
    ],
    onSelectFiles: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceTabs {...props} />);
  return props;
}

describe("WorkspaceTabs", () => {
  it("renders the Files tab with its count", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Files/ })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("renders one tab per diff with the basename label", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Foo\.class/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Bar\.class/ })).toBeInTheDocument();
  });
  it("marks the active tab with aria-selected", () => {
    setup({ activeId: "com/x/Bar.class" });
    expect(screen.getByRole("tab", { name: /Bar\.class/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Files/ })).toHaveAttribute("aria-selected", "false");
  });
  it("calls onSelectFiles when the Files tab is clicked", async () => {
    const props = setup({ activeId: "com/x/Foo.class" });
    await userEvent.click(screen.getByRole("tab", { name: /Files/ }));
    expect(props.onSelectFiles).toHaveBeenCalled();
  });
  it("calls onSelectTab with the path when a diff tab is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("tab", { name: /Foo\.class/ }));
    expect(props.onSelectTab).toHaveBeenCalledWith("com/x/Foo.class");
  });
  it("calls onCloseTab when the close button is clicked, without selecting the tab", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Close com/x/Foo.class"));
    expect(props.onCloseTab).toHaveBeenCalledWith("com/x/Foo.class");
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WorkspaceTabs.test.tsx`
Expected: FAIL — `Cannot find module '@/components/WorkspaceTabs'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/WorkspaceTabs.tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WorkspaceTabs.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkspaceTabs.tsx src/components/WorkspaceTabs.test.tsx
git commit -m "feat: add WorkspaceTabs strip component (Files + scrollable diff tabs)"
```

---

## Task 3: Wire `openTabs` state model into `App.tsx`

This task changes behavior, so it is verified by the existing App-level suite plus manual `tauri dev`. There is no App.test.tsx today; verification is the full `npx vitest run` (must stay green) plus `npx tsc --noEmit`.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the tab-type and state declarations**

Replace line 64:

```ts
type WorkspaceTab = "tree" | "diff";
```

with:

```ts
const MAX_DIFF_TABS = 10;
```

Add the import near the other `@/lib` imports (after the `@/components/DiffView` import on line 47):

```ts
import { type DiffTab, evictLru, pickNeighbor, upsertTab } from "@/lib/tabs";
```

Replace the `activeTab` state (line 132):

```ts
const [activeTab, setActiveTab] = useState<WorkspaceTab>("tree");
```

with:

```ts
const [activeTab, setActiveTab] = useState<"files" | string>("files");
const [openTabs, setOpenTabs] = useState<DiffTab[]>([]);
const focusCounter = useRef(0);
```

- [ ] **Step 2: Add the live→snapshot sync effect**

Add immediately after the existing diff-highlight `useEffect` that ends on line 323 (the one with deps `[mode, preview.left?.content, preview.right?.content, selected?.path, selectedSearchResult]`):

```ts
useEffect(() => {
  if (activeTab === "files" || !selected) return;
  setOpenTabs((prev) =>
    prev.map((t) => (t.path === activeTab ? { ...t, pair: selected, preview, viewMode } : t)),
  );
}, [activeTab, selected, preview, viewMode]);
```

- [ ] **Step 3: Rewrite `inspect` to open-or-focus a tab**

Replace the `setActiveTab("diff")` line inside `inspect` (line 345) — i.e. change the opening of `inspect` (lines 341–346) from:

```ts
  async function inspect(pair: ComparePair) {
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setSelected(pair);
    setActiveTab("diff");
    setViewMode("source");
```

to:

```ts
  function focusTab(path: string) {
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setSelected(tab.pair);
    setPreview(tab.preview);
    setViewMode(tab.viewMode);
    setActiveTab(path);
    setOpenTabs((prev) => prev.map((t) => (t.path === path ? { ...t, lastFocus: stamp } : t)));
  }

  async function inspect(pair: ComparePair) {
    const existing = openTabs.find((t) => t.path === pair.path);
    if (existing) {
      focusTab(pair.path);
      return;
    }
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setSelected(pair);
    setActiveTab(pair.path);
    setViewMode("source");
```

Then, at the end of `inspect`, after `setPreview(next)` (currently line 354), register the new tab. Change:

```ts
    if (previewRequestId.current !== requestId) return;
    setPreview(next);
```

to:

```ts
    if (previewRequestId.current !== requestId) return;
    setPreview(next);
    focusCounter.current += 1;
    const stamp = focusCounter.current;
    setOpenTabs((prev) =>
      evictLru(
        upsertTab(prev, { path: pair.path, pair, preview: next, viewMode: "source", lastFocus: stamp }),
        MAX_DIFF_TABS,
      ),
    );
```

> Note: the `metadataOnly` block (lines 367–372) calls `setSelected(metadataOnly)`; the sync effect from Step 2 propagates that into the open tab automatically. No change needed there.

- [ ] **Step 4: Add a `closeTab` handler**

Add after `inspect` (after its closing brace, ~line 373):

```ts
  function closeTab(path: string) {
    if (activeTab === path) {
      const next = pickNeighbor(openTabs, path);
      if (next === "files") {
        setActiveTab("files");
      } else {
        focusTab(next);
      }
    }
    setOpenTabs((prev) => prev.filter((t) => t.path !== path));
  }
```

- [ ] **Step 5: Reset tabs on reload in `openPath`**

In `openPath`, replace lines 195–197:

```ts
      setSelected(undefined);
      setActiveTab("tree");
      setPreview({});
```

with:

```ts
      setSelected(undefined);
      setActiveTab("files");
      setOpenTabs([]);
      setPreview({});
```

- [ ] **Step 6: Replace the render tab strip + panels**

Replace the whole `<div className="workspace-tabs" …>` block (lines 650–671) **and** the `hidden`-based panels logic (lines 672–702) with `WorkspaceTabs` + conditional panels. Replace lines 650–702:

```tsx
          <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "tree"}
              className={`workspace-tab${activeTab === "tree" ? " active" : ""}`}
              onClick={() => setActiveTab("tree")}
            >
              <ListTree /> Files
              {visiblePairs.length > 0 && <span className="workspace-tab-count">{visiblePairs.length}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "diff"}
              className={`workspace-tab${activeTab === "diff" ? " active" : ""}`}
              disabled={!selected}
              onClick={() => selected && setActiveTab("diff")}
            >
              <FileDiff /> {selected ? basename(selected.path) : "Diff"}
            </button>
          </div>
          <div className="workspace-tabpanels">
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab !== "tree"}>
              <FileTree
                visiblePairs={visiblePairs}
                selected={selected}
                stagedEntries={stagedEntries}
                mode={mode}
                treeFilter={treeFilter}
                nestedPairs={nestedPairs}
                onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
                onCopy={(from, to, pair) => void copy(from, to, pair)}
                onUnstage={(entryPath) => void unstage(entryPath)}
                onExpandArchive={(fullPath) => void expandArchive(fullPath)}
              />
            </div>
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab !== "diff"}>
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
            </div>
          </div>
```

with:

```tsx
          <WorkspaceTabs
            fileCount={visiblePairs.length}
            activeId={activeTab}
            tabs={openTabs.map((t) => ({ path: t.path, status: t.pair.status }))}
            onSelectFiles={() => setActiveTab("files")}
            onSelectTab={(path) => focusTab(path)}
            onCloseTab={(path) => closeTab(path)}
          />
          <div className="workspace-tabpanels">
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab !== "files"}>
              <FileTree
                visiblePairs={visiblePairs}
                selected={selected}
                stagedEntries={stagedEntries}
                mode={mode}
                treeFilter={treeFilter}
                nestedPairs={nestedPairs}
                onInspect={(pair) => { setSelectedSearchResult(undefined); void inspect(pair); }}
                onSelect={(pair) => { setSelectedSearchResult(undefined); setSelected(pair); }}
                onCopy={(from, to, pair) => void copy(from, to, pair)}
                onUnstage={(entryPath) => void unstage(entryPath)}
                onExpandArchive={(fullPath) => void expandArchive(fullPath)}
              />
            </div>
            <div className="workspace-tabpanel" role="tabpanel" hidden={activeTab === "files"}>
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
            </div>
          </div>
```

- [ ] **Step 7: Add the `WorkspaceTabs` import and remove now-unused imports**

Add near the other component imports (after line 47):

```ts
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
```

`basename` (line 66) is now only used inside `WorkspaceTabs`. If `npx tsc --noEmit` reports `basename` and/or the `FileDiff`/`ListTree` icon imports (line 42) as unused in `App.tsx`, delete the local `basename` function (lines 66–70) and trim the unused names from the `lucide-react` import on line 42. Do not delete an import that is still referenced elsewhere — let `tsc` tell you.

- [ ] **Step 8: Verify types and full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all suites PASS (including the new `tabs` and `WorkspaceTabs` suites; no regressions).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat: multi-tab diff — open/focus/close tabs, LRU cap, reset on reload"
```

---

## Task 4: Manual behavior verification (`tauri dev`)

**Files:** none (manual).

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev` (or check the already-running `/tmp/tauri-dev.log`).

- [ ] **Step 2: Walk the acceptance checklist**

- [ ] Open two jars in Compare mode → only the **Files** tab shows, selected.
- [ ] Click a changed file → a new diff tab opens, becomes active, shows the diff.
- [ ] Click a second file → second tab opens beside the first; both remain.
- [ ] Re-click the first file in the tree → focuses the existing first tab (no duplicate, no re-decompile flicker).
- [ ] Toggle Bytecode on one tab, switch to another tab and back → each tab keeps its own source/bytecode view.
- [ ] Open >10 distinct files → tab count caps at 10; the least-recently-focused tab disappears.
- [ ] Click a tab's **X** (and middle-click another) → tab closes; if it was active, focus moves to a neighbor, else stays put.
- [ ] Open a new jar (Browse) → all diff tabs clear, Files tab active.
- [ ] Open enough tabs to overflow width → the diff-tab strip scrolls horizontally; the Files tab stays pinned.

- [ ] **Step 3: Note any deviation**

If any item fails, stop and route to `superpowers:systematic-debugging` before continuing.

---

## Task 5: Tab-strip styling

**Files:**
- Modify: the stylesheet that defines `.workspace-tabs` / `.workspace-tab` (find with `grep -rn "workspace-tabs" src --include=*.css`).

- [ ] **Step 1: Find the existing rules**

Run: `grep -rn "workspace-tab" src` — locate the file holding `.workspace-tabs`, `.workspace-tab`, `.workspace-tab-count`.

- [ ] **Step 2: Add scroll + close + dot styles**

Append (adjust selectors to match the existing file's conventions):

```css
.workspace-tabs { display: flex; align-items: stretch; min-width: 0; }
.workspace-tab-files { flex: 0 0 auto; }
.workspace-tabs-scroll {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.workspace-tab-diff { flex: 0 0 auto; display: flex; align-items: center; gap: 0.35rem; max-width: 16rem; }
.workspace-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-tab-dot { width: 0.5rem; height: 0.5rem; border-radius: 9999px; flex: 0 0 auto; background: currentColor; }
.workspace-tab-close {
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: transparent; cursor: pointer; padding: 0; opacity: 0;
}
.workspace-tab-diff:hover .workspace-tab-close,
.workspace-tab-diff.active .workspace-tab-close { opacity: 1; }
.workspace-tab-close svg { width: 0.85em; height: 0.85em; }
```

> The status-dot color reuses the existing `.status-different` / `.status-onlyLeft` / etc. classes already applied to the dot via `statusPresentation().className`; if those set `color`, the dot picks it up through `currentColor`. If they only set `background`, change `.workspace-tab-dot { background: currentColor; }` to inherit from the status class instead.

- [ ] **Step 3: Re-verify in `tauri dev`**

Confirm: close button appears on hover/active, status dot color matches the tree badge, the strip scrolls without pushing the Files tab off-screen.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "style: horizontal-scroll diff tab strip with status dot and close button"
```

---

## Self-Review

**Spec coverage:**
- Each diff click = its own tab → Task 3 Step 3 (`inspect` opens a new tab).
- Focus existing on re-click → Task 3 Step 3 (`existing` branch → `focusTab`).
- LRU cap 10 → Task 1 `evictLru` + Task 3 `MAX_DIFF_TABS`.
- Files separate from diff tabs → Task 2 pinned Files tab + scroll container.
- Horizontal scroll on overflow → Task 5 `.workspace-tabs-scroll`.
- Per-tab close + middle-click → Task 2 close button / `onAuxClick`, Task 3 `closeTab` neighbor logic.
- Reset on reload → Task 3 Step 5.
- Per-tab view mode → sync effect (Task 3 Step 2) + snapshot restore in `focusTab`.

**Placeholder scan:** none — every code step is concrete.

**Type consistency:** `DiffTab` fields (`path`, `pair`, `preview`, `viewMode`, `lastFocus`) used identically across `tabs.ts`, the App handlers, and the sync effect. `WorkspaceTabs` props (`fileCount`, `activeId`, `tabs`, `onSelectFiles`, `onSelectTab`, `onCloseTab`) match the App call site in Task 3 Step 6. `activeTab` is `"files" | string` everywhere (`"files"`, not `"tree"`/`"diff"`).
