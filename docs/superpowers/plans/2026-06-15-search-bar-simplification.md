# Search Bar Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify search UI so Files-index search always covers both compare sides, tree filtering lives with the Files workspace, and search actions use explicit labels.

**Architecture:** Keep search orchestration in `App.tsx`, keep command-bar rendering in `SearchBar`, and move tree-filter rendering into `WorkspaceTabs`. The backend search API remains side-based; the frontend resolves sides from mode and invokes the existing commands once per side.

**Tech Stack:** React 19, TypeScript, shadcn/Radix select controls, Vitest + Testing Library, Playwright-backed render verifier.

---

## File Map

- Modify: `src/components/SearchBar.tsx` - remove side scope and tree filter props, rename Files-index labels, hide cancel outside cancelable Files-index search, remove Current-diff archive-wide action.
- Modify: `src/components/SearchBar.test.tsx` - lock the new command-bar contract.
- Modify: `src/components/WorkspaceTabs.tsx` - render `Show all / Differences / Identical` next to the `Files` tab.
- Modify: `src/components/WorkspaceTabs.test.tsx` - verify tree-filter rendering and change callback.
- Modify: `src/styles.css` - keep the new tab-strip filter compact and responsive.
- Modify: `src/App.tsx` - remove search side-scope state, resolve search sides from mode, pass tree filter into `WorkspaceTabs`, pass simplified props into `SearchBar`, and make decompiled-source search cancelable.
- Modify: `src/App.test.tsx` - verify Files-index search searches both compare sides and decompiled source uses the new label.
- Modify: `scripts/verify-frontend-render.mjs` - update UI selectors for new labels and removed search-scope control.
- Optional cleanup: `src/lib/types.ts` - remove `SearchScope` if no references remain after implementation.

## Task 1: Simplify `SearchBar`

**Files:**
- Modify: `src/components/SearchBar.test.tsx`
- Modify: `src/components/SearchBar.tsx`

- [ ] **Step 1: Rewrite `SearchBar` tests for the new contract**

Replace the default props and affected assertions in `src/components/SearchBar.test.tsx` with this shape:

```tsx
function setup(overrides = {}) {
  const props = {
    open: true,
    context: "files" as const,
    mode: "compare" as const,
    query: "",
    includeSource: false,
    searching: false,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onCancel: vi.fn(),
    onClear: vi.fn(),
    onIncludeSourceChange: vi.fn(),
    ...overrides,
  };
  render(<SearchBar {...props} />);
  return props;
}
```

Update the Files-index test body to assert the simplified UI:

```tsx
it("shows Files index controls on the Files tab", async () => {
  const props = setup({ query: "needle" });

  expect(screen.getByText("Files index")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Search paths, text, constants")).toBeInTheDocument();
  expect(screen.getByText("Decompiled source")).toBeInTheDocument();
  expect(screen.queryByLabelText("Search scope")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Tree filter")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /search files/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear results/i })).toBeInTheDocument();
  expect(screen.getByLabelText("Include decompiled source search")).not.toBeChecked();

  await userEvent.click(screen.getByLabelText("Include decompiled source search"));
  expect(props.onIncludeSourceChange).toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole("button", { name: /search files/i }));
  expect(props.onSearch).toHaveBeenCalled();
});
```

Update the Current-diff test body to assert only local find controls:

```tsx
it("shows Current diff controls on a diff tab", async () => {
  const props = setup({ context: "diff", query: "needle" });

  expect(screen.getByText("Current diff")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Find in current diff")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^find$/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear find/i })).toBeInTheDocument();
  expect(screen.queryByText("Decompiled source")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /search all files/i })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^find$/i }));
  expect(props.onSearch).toHaveBeenCalled();
});
```

Replace the cancel/clear test with:

```tsx
it("renders cancel only for an active Files-index source search", async () => {
  const props = setup({ searching: true });
  expect(screen.getByRole("button", { name: /search files/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  await userEvent.click(screen.getByRole("button", { name: /clear results/i }));
  expect(props.onCancel).toHaveBeenCalled();
  expect(props.onClear).toHaveBeenCalled();
});
```

Keep the Enter-key test as the guard for keyboard submit:

```tsx
it("runs the primary search action from Enter", async () => {
  const props = setup({ query: "needle" });
  await userEvent.type(screen.getByPlaceholderText("Search paths, text, constants"), "{Enter}");
  expect(props.onSearch).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx
```

Expected: FAIL because `SearchBarProps` still requires `treeFilter`, `searchScope`, `onSearchAllFiles`, `onFilterChange`, and `onScopeChange`, and the old labels still render.

- [ ] **Step 3: Update `SearchBar.tsx` implementation**

Replace the imports and props in `src/components/SearchBar.tsx` so the component no longer imports `Select` or `TreeFilter/SearchScope`:

```tsx
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { labelForSearchContext } from "@/lib/search";
import type { Mode, SearchContext } from "@/lib/types";

interface SearchBarProps {
  open: boolean;
  context: SearchContext;
  mode: Mode;
  query: string;
  includeSource: boolean;
  searching: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onCancel: () => void;
  onClear: () => void;
  onIncludeSourceChange: (value: boolean) => void;
}
```

Replace the component render body with:

```tsx
export function SearchBar({
  open,
  context,
  mode,
  query,
  includeSource,
  searching,
  onQueryChange,
  onSearch,
  onCancel,
  onClear,
  onIncludeSourceChange,
}: SearchBarProps) {
  if (!open) return null;

  const filesContext = context === "files";
  const placeholder = filesContext ? "Search paths, text, constants" : "Find in current diff";
  const clearLabel = filesContext ? "Clear results" : "Clear find";

  return (
    <div className="search-bar" data-context={context}>
      <span className="search-context-label">{labelForSearchContext(context)}</span>
      <Input
        className="search-input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
      />
      {filesContext ? (
        <>
          <label className="check-label search-inline-check">
            <Checkbox
              aria-label="Include decompiled source search"
              checked={includeSource}
              onCheckedChange={(checked) => onIncludeSourceChange(checked === true)}
            />
            Decompiled source
          </label>
          <Button aria-label="Search files" disabled={searching} onClick={onSearch}>
            <Search /> Search files
          </Button>
          {searching && (
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
          )}
        </>
      ) : (
        <Button aria-label="Find" disabled={searching} onClick={onSearch}><Search /> Find</Button>
      )}
      <Button variant="ghost" aria-label={clearLabel} onClick={onClear}><X /> {clearLabel}</Button>
    </div>
  );
}
```

Keep `mode` in props for this task so the call site shape remains stable while
the search controls are moved in later tasks.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/components/SearchBar.tsx src/components/SearchBar.test.tsx
rtk git commit -m "refactor: simplify search bar controls"
```

## Task 2: Move Tree Filter Into `WorkspaceTabs`

**Files:**
- Modify: `src/components/WorkspaceTabs.test.tsx`
- Modify: `src/components/WorkspaceTabs.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing `WorkspaceTabs` test coverage**

In `src/components/WorkspaceTabs.test.tsx`, add these default props:

```tsx
treeFilter: "diff" as const,
onFilterChange: vi.fn(),
```

Add this test:

```tsx
it("renders the tree filter next to the Files tab", async () => {
  const props = setup();

  expect(screen.getByRole("tab", { name: /Files/ })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Tree filter" })).toBeInTheDocument();
  expect(screen.getByText("Differences")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("combobox", { name: "Tree filter" }));
  await userEvent.click(screen.getByRole("option", { name: "Identical" }));

  expect(props.onFilterChange).toHaveBeenCalledWith("same");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk npm test -- src/components/WorkspaceTabs.test.tsx
```

Expected: FAIL because `WorkspaceTabs` does not accept or render the tree-filter props.

- [ ] **Step 3: Update `WorkspaceTabs.tsx` props and imports**

Add the shadcn select import and the `TreeFilter` type:

```tsx
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { PairStatus, TreeFilter } from "@/lib/types";
```

Update props:

```tsx
export interface WorkspaceTabsProps {
  fileCount: number;
  activeId: "files" | string;
  tabs: WorkspaceTabDescriptor[];
  treeFilter: TreeFilter;
  onSelectFiles: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onFilterChange: (filter: TreeFilter) => void;
}
```

Update the function signature:

```tsx
export function WorkspaceTabs({
  fileCount,
  activeId,
  tabs,
  treeFilter,
  onSelectFiles,
  onSelectTab,
  onCloseTab,
  onFilterChange,
}: WorkspaceTabsProps) {
```

- [ ] **Step 4: Render the tree filter beside `Files`**

Place this select immediately after the Files tab button and before `workspace-tabs-scroll`:

```tsx
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
```

- [ ] **Step 5: Add compact tab-strip styling**

Add these rules near the workspace tabs section in `src/styles.css`:

```css
.workspace-tree-filter {
  flex: 0 0 auto;
  width: 9.5rem;
  height: 32px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
```

In the existing small-screen media block that already targets `.search-bar`, add:

```css
  .workspace-tabs { flex-wrap: wrap; }
  .workspace-tree-filter { width: min(100%, 9.5rem); }
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
rtk npm test -- src/components/WorkspaceTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/components/WorkspaceTabs.tsx src/components/WorkspaceTabs.test.tsx src/styles.css
rtk git commit -m "refactor: move tree filter to workspace tabs"
```

## Task 3: Wire App Behavior To The New Contract

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Optional modify: `src/lib/types.ts`

- [ ] **Step 1: Update App tests for both-side Files-index search**

In `src/App.test.tsx`, update the existing test named `"runs Files index search with typed backend options"` to click the new button and assert both sides:

```tsx
it("runs Files index search with typed backend options on both compare sides", async () => {
  const user = userEvent.setup();
  await driveIntoFileCompare(user);

  await user.click(screen.getByRole("tab", { name: /files/i }));
  await user.clear(screen.getByPlaceholderText(/Search paths, text, constants/));
  await user.type(screen.getByPlaceholderText(/Search paths, text, constants/), "config");
  await user.click(screen.getByRole("button", { name: /search files/i }));

  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("search", {
      side: "left",
      query: "config",
      options: { includePath: true, includeText: true, includeConstants: true },
    }),
  );
  expect(invoke).toHaveBeenCalledWith("search", {
    side: "right",
    query: "config",
    options: { includePath: true, includeText: true, includeConstants: true },
  });
  expect((await screen.findAllByText("Path")).length).toBeGreaterThan(0);
  expect((await screen.findAllByText("Text")).length).toBeGreaterThan(0);
});
```

Update the source-search test to use the new checkbox and button labels:

```tsx
await user.click(screen.getByLabelText("Include decompiled source search"));
await user.click(screen.getByRole("button", { name: /search files/i }));
```

Run this search and update every matching App test assertion:

```bash
rtk rg -n "Search all|Clear search|Include source search|search all files" src/App.test.tsx
```

Required replacements in `src/App.test.tsx`:

- `Search all` button queries in Files-index tests become `Search files`.
- `Include source search` becomes `Include decompiled source search`.
- `Clear search` becomes `Clear results` when the active tab is Files, and
  `Clear find` when the active tab is a diff tab.
- `search all files` assertions are removed because Current-diff search no
  longer exposes an archive-wide secondary action.

- [ ] **Step 2: Run focused App tests and verify they fail**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "Files index search|source search|current diff"
```

Expected: FAIL because `App.tsx` still passes removed props, still keeps `searchScope`, and still renders old labels through `SearchBar`.

- [ ] **Step 3: Remove side-scope state and make side resolution mode-based**

In `src/App.tsx`, delete:

```tsx
const [searchScope, setSearchScope] = useState<SearchScope>("both");
```

Replace `searchSides()` with:

```tsx
function searchSides(): Side[] {
  return mode === "single" ? ["left"] : ["left", "right"];
}
```

Remove `SearchScope` from imports if TypeScript reports it as unused.

- [ ] **Step 4: Make Files-index decompiled-source search cancelable**

Replace the start and end of `runSearch()` with this structure, keeping the existing backend result mapping inside:

```tsx
async function runSearch() {
  const searchId = searchStreamId.current + 1;
  const sourceTierEnabled = includeSourceSearch;
  searchStreamId.current = searchId;
  setSearching(sourceTierEnabled);
  try {
    const matches = new Set<string>();
    const results: SearchResult[] = [];
    const options = { includePath: true, includeText: true, includeConstants: true };
    for (const side of searchSides()) {
      if (!archives[side]) continue;
      for (const hit of await invoke<BackendSearchHit[]>("search", { side, query, options })) {
        if (searchStreamId.current !== searchId) return;
        matches.add(hit.entryPath);
        results.push({
          side,
          tier: "T2",
          path: hit.entryPath,
          kind: hit.kind,
          line: hit.line,
          preview: hit.preview,
        });
      }
    }
    if (sourceTierEnabled) {
      for (const side of searchSides()) {
        if (!archives[side]) continue;
        for (const hit of await invoke<BackendSearchHit[]>("deep_search", { side, query, searchId })) {
          if (searchStreamId.current !== searchId) return;
          matches.add(hit.entryPath);
          results.push({
            side,
            tier: "T3",
            path: hit.entryPath,
            kind: hit.kind,
            line: hit.line,
            preview: hit.preview,
          });
        }
      }
    }
    if (searchStreamId.current !== searchId) return;
    setSearchPaths(matches);
    setSearchResults(results);
    setMessage(`${sourceTierEnabled ? "Search with decompiled source" : "Search"} matched ${matches.size} entries.`);
  } catch (error) {
    if (searchStreamId.current !== searchId) return;
    setSearchPaths(undefined);
    setSearchResults([]);
    setMessage(String(error));
  } finally {
    if (searchStreamId.current === searchId) setSearching(false);
  }
}
```

Update `cancelDeepSearch()` message:

```tsx
setMessage("Cancelling decompiled source search...");
```

- [ ] **Step 5: Split clear handlers by context**

Replace `clearSearch()` with two explicit handlers:

```tsx
function clearSearchResults() {
  searchStreamId.current += 1;
  setSearching(false);
  setSearchPaths(undefined);
  setSearchResults([]);
  setSelectedSearchResult(undefined);
}

function clearFind() {
  clearSearchResults();
  setQuery("");
}
```

The current Monaco implementation does not own a persistent find decoration list, so `clearFind()` clears the app-level find state and query.

- [ ] **Step 6: Update component wiring in `App.tsx`**

Update `WorkspaceTabs` props:

```tsx
<WorkspaceTabs
  fileCount={visiblePairs.length}
  activeId={activeTab}
  tabs={openTabs.map((t) => ({ path: t.path, status: t.pair.status }))}
  treeFilter={treeFilter}
  onSelectFiles={() => setActiveTab("files")}
  onSelectTab={(path) => focusTab(path)}
  onCloseTab={(path) => closeTab(path)}
  onFilterChange={setTreeFilter}
/>
```

Update `SearchBar` props:

```tsx
<SearchBar
  open={searchOpen}
  context={searchContext}
  mode={mode}
  query={query}
  includeSource={includeSourceSearch}
  searching={searching}
  onQueryChange={setQuery}
  onSearch={searchContext === "files" ? runSearch : findInCurrentDiff}
  onCancel={cancelDeepSearch}
  onClear={searchContext === "files" ? clearSearchResults : clearFind}
  onIncludeSourceChange={setIncludeSourceSearch}
/>
```

Remove the old `treeFilter`, `searchScope`, `onSearchAllFiles`, `onFilterChange`, and `onScopeChange` props from the `SearchBar` call.

- [ ] **Step 7: Remove obsolete `SearchScope` type if unused**

Run:

```bash
rtk rg -n "SearchScope|searchScope|setSearchScope|onScopeChange" src
```

If the only remaining declaration is in `src/lib/types.ts`, remove:

```ts
export type SearchScope = Side | "both";
```

- [ ] **Step 8: Run focused App tests and verify they pass**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "Files index search|source search|current diff"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add src/App.tsx src/App.test.tsx src/lib/types.ts
rtk git commit -m "refactor: search both compare sides by default"
```

If `src/lib/types.ts` did not change, omit it from `git add`.

## Task 4: Update Render Verification And Run Full Frontend Checks

**Files:**
- Modify: `scripts/verify-frontend-render.mjs`
- Optional modify: `scripts/verify-frontend-invariants.mjs`

- [ ] **Step 1: Update render verifier selectors**

In `scripts/verify-frontend-render.mjs`, update the tree-filter comment:

```js
  // Tree filter in the workspace tab strip: Identical hides non-identical rows.
```

Delete the search-scope interaction:

```js
  await mockedPage.getByRole("combobox", { name: "Search scope" }).click();
  await mockedPage.getByRole("option", { name: "Right" }).click();
```

Replace the search and clear button selectors:

```js
  await mockedPage.getByRole("button", { name: "Search files", exact: true }).click();
```

```js
  await mockedPage.getByRole("button", { name: "Clear results" }).click();
```

Keep the `right-only` query. Because compare mode now always searches both sides, it should still produce one matching entry for the fixture.

- [ ] **Step 2: Check frontend invariant script for stale label assumptions**

Run:

```bash
rtk rg -n "Search all|Clear search|Search scope|onScopeChange|searchScope" scripts/verify-frontend-invariants.mjs scripts/verify-frontend-render.mjs
```

Expected after edits: no matches for removed labels or state names.

If `scripts/verify-frontend-invariants.mjs` contains no stale references, leave it unchanged.

- [ ] **Step 3: Run component and App tests**

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx src/components/WorkspaceTabs.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript/build validation**

Run:

```bash
rtk npm run build
```

Expected: PASS.

- [ ] **Step 5: Run frontend invariants**

Run:

```bash
rtk npm run verify:frontend-invariants
```

Expected: PASS.

- [ ] **Step 6: Run render verifier**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS. If the verifier cannot launch a browser in the current environment, record the exact environment error and keep the unit/build checks as the completed validation.

- [ ] **Step 7: Commit**

```bash
rtk git add scripts/verify-frontend-render.mjs scripts/verify-frontend-invariants.mjs
rtk git commit -m "test: update search UI render verification"
```

If `scripts/verify-frontend-invariants.mjs` did not change, omit it from `git add`.

## Final Verification

Run:

```bash
rtk npm test -- src/components/SearchBar.test.tsx src/components/WorkspaceTabs.test.tsx src/App.test.tsx
rtk npm run build
rtk npm run verify:frontend-invariants
rtk npm run verify:frontend-render
```

Expected: all pass, or the render verifier reports only a documented local browser-launch/environment issue.

Then check the final diff:

```bash
rtk git status --short
rtk git log --oneline -4
```

Expected: no unstaged implementation files, and the task commits appear on top of the branch.
