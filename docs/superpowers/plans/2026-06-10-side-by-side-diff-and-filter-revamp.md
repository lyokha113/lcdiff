# Side-by-side Diff and Filter Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diff editor always render two panes side-by-side, and replace the four-mode tree filter (`all`/`differences`/`onlyLeft`/`onlyRight`) with three modes (`all`/`diff`/`same`).

**Architecture:** Pure frontend change in the Tauri React adapter. The Monaco `DiffEditor` loses its inline-collapse options. `TreeFilter` is renamed/reduced in `types.ts`, its predicate in `tree.ts` is rewritten, and the `SearchBar` dropdown plus two tests and two verify-scripts are updated to the new values. No `ldiff-core` / Rust / IPC change.

**Tech Stack:** TypeScript, React, Monaco (`@monaco-editor/react`), Vitest, Playwright-style render harness (`scripts/verify-frontend-render.mjs`).

---

### Task 1: Always render diff side-by-side

**Files:**
- Modify: `src/components/DiffView.tsx:113-123` (DiffEditor `options`)

- [ ] **Step 1: Remove inline-collapse options**

In the `<DiffEditor … options={{ … }}>` block, delete these two lines:

```ts
              useInlineViewWhenSpaceIsLimited: true,
              renderSideBySideInlineBreakpoint: 720,
```

The remaining `options` object keeps `renderSideBySide: true` and every other existing key (`readOnly`, `originalEditable`, `renderMarginRevertIcon`, `minimap`, `automaticLayout`, `ignoreTrimWhitespace`). After the edit the options read:

```ts
            options={{
              readOnly: !hunkMerge,
              originalEditable: hunkMerge,
              renderMarginRevertIcon: hunkMerge,
              minimap: { enabled: false },
              renderSideBySide: true,
              automaticLayout: true,
              ignoreTrimWhitespace,
            }}
```

- [ ] **Step 2: Build to verify types compile**

Run: `npm run build`
Expected: PASS (tsc + vite build, no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/DiffView.tsx
git commit -m "feat(ui): diff editor always side-by-side, never inline"
```

---

### Task 2: Reduce TreeFilter to all/diff/same

**Files:**
- Modify: `src/lib/types.ts:14` (type)
- Modify: `src/lib/tree.ts:99-105` (`pairPassesTreeFilter`)
- Test: `src/lib/tree.test.ts`

- [ ] **Step 1: Write a failing test for the new predicate**

Append to `src/lib/tree.test.ts` (inside the existing top-level `describe`, or as a new one):

```ts
import { pairPassesTreeFilter } from "@/lib/tree";
import type { ComparePair } from "@/lib/types";

describe("pairPassesTreeFilter", () => {
  const diffPair = { path: "a", status: "different" } as ComparePair;
  const leftPair = { path: "b", status: "onlyLeft" } as ComparePair;
  const samePair = { path: "c", status: "identical" } as ComparePair;
  const metaPair = { path: "d", status: "differentMetadataOnly" } as ComparePair;

  it("all passes everything", () => {
    for (const p of [diffPair, leftPair, samePair, metaPair]) {
      expect(pairPassesTreeFilter(p, "all")).toBe(true);
    }
  });

  it("diff passes everything except identical", () => {
    expect(pairPassesTreeFilter(diffPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(leftPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(metaPair, "diff")).toBe(true);
    expect(pairPassesTreeFilter(samePair, "diff")).toBe(false);
  });

  it("same passes only identical", () => {
    expect(pairPassesTreeFilter(samePair, "same")).toBe(true);
    expect(pairPassesTreeFilter(diffPair, "same")).toBe(false);
    expect(pairPassesTreeFilter(leftPair, "same")).toBe(false);
  });
});
```

If `tree.test.ts` already imports `pairPassesTreeFilter` / `ComparePair`, do not duplicate the import lines.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/tree.test.ts`
Expected: FAIL — `"diff"`/`"same"` are not assignable to `TreeFilter`, and the predicate doesn't handle them.

- [ ] **Step 3: Update the type**

In `src/lib/types.ts:14` replace:

```ts
export type TreeFilter = "all" | "differences" | "onlyLeft" | "onlyRight";
```

with:

```ts
export type TreeFilter = "all" | "diff" | "same";
```

- [ ] **Step 4: Rewrite the predicate**

In `src/lib/tree.ts` replace the `pairPassesTreeFilter` body:

```ts
export function pairPassesTreeFilter(pair: ComparePair, filter: TreeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "same") return pair.status === "identical";
  return pair.status !== "identical";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/tree.ts src/lib/tree.test.ts
git commit -m "feat(ui): reduce tree filter to all/diff/same"
```

---

### Task 3: Update default state and SearchBar dropdown

**Files:**
- Modify: `src/App.tsx:114` (default `treeFilter` state)
- Modify: `src/components/SearchBar.tsx:33-36` (`SelectItem`s)
- Test: `src/components/SearchBar.test.tsx:8`, `src/components/FileTree.test.tsx:84`

- [ ] **Step 1: Update existing tests to the new filter value**

In `src/components/SearchBar.test.tsx:8` change `treeFilter: "differences" as const,` to:

```ts
    open: true, query: "", treeFilter: "diff" as const,
```

In `src/components/FileTree.test.tsx:84` change `treeFilter="differences"` to:

```tsx
        treeFilter="diff"
```

- [ ] **Step 2: Run those tests to verify they fail**

Run: `npm test -- src/components/SearchBar.test.tsx src/components/FileTree.test.tsx`
Expected: FAIL — `"diff"` not assignable while SearchBar still renders old options / App still defaults to `"differences"` (type error on `"differences"` literal elsewhere).

- [ ] **Step 3: Update the default state in App.tsx**

In `src/App.tsx:114` replace:

```ts
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("differences");
```

with:

```ts
  const [treeFilter, setTreeFilter] = useState<TreeFilter>("diff");
```

- [ ] **Step 4: Update the SearchBar dropdown options**

In `src/components/SearchBar.tsx` replace the four `SelectItem` lines (33-36):

```tsx
          <SelectItem value="all">Show all</SelectItem>
          <SelectItem value="differences">Differences only</SelectItem>
          <SelectItem value="onlyLeft">Only left</SelectItem>
          <SelectItem value="onlyRight">Only right</SelectItem>
```

with three:

```tsx
          <SelectItem value="all">Show all</SelectItem>
          <SelectItem value="diff">Differences</SelectItem>
          <SelectItem value="same">Identical</SelectItem>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/SearchBar.test.tsx src/components/FileTree.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/SearchBar.tsx src/components/SearchBar.test.tsx src/components/FileTree.test.tsx
git commit -m "feat(ui): wire all/diff/same filter through state and dropdown"
```

---

### Task 4: Update the render-harness filter label

**Files:**
- Modify: `scripts/verify-frontend-render.mjs:309`

- [ ] **Step 1: Update the option name the harness clicks**

In `scripts/verify-frontend-render.mjs:309` replace:

```js
  await mockedPage.getByRole("option", { name: "Differences only" }).click();
```

with:

```js
  await mockedPage.getByRole("option", { name: "Differences" }).click();
```

(Leave the `status: "onlyLeft"` / `"onlyRight"` mock entries at lines 127/132 unchanged — those are `PairStatus` values, not filter values.)

- [ ] **Step 2: Run the render harness**

Run: `npm run verify:frontend-render`
Expected: PASS (the Tree filter combobox now offers "Differences"; the click resolves).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-frontend-render.mjs
git commit -m "test: update render harness for renamed diff filter option"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Run the full verify chain**

Run: `npm run verify:all`
Expected: PASS — build, packaging-scripts, frontend-invariants, frontend-render, docs all green.

- [ ] **Step 3: Manual smoke (optional, if running the app)**

Open a compare; shrink the workspace pane below 720px — the editor stays two-pane (no inline collapse). Open the Tree filter dropdown — three options (Show all / Differences / Identical); each filters the tree as specified.

- [ ] **Step 4: No commit needed** (verification only; nothing changed).
