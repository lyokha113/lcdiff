# Hide Inner Class Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Java compiler-generated nested/anonymous `.class` entries from the file tree when their parent `.class` exists on every relevant side in the same folder, and align file icons with folder/archive icons.

**Architecture:** Keep the behavior in the React adapter. `src/lib/tree.ts` projects raw `ComparePair` entries into a tree-visible model while preserving all raw archive entries for lower layers. Inner-class suppression is side-aware in compare mode so a left-only parent cannot hide a right-only nested class, or vice versa. `src/components/FileTree.tsx` renders a fixed chevron spacer in file cells so visual alignment matches folder/archive rows.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri adapter boundaries.

---

## Files

- Modify `src/lib/tree.ts`: add Java nested class parent detection and suppress hidden child class leaves inside `buildTree`.
- Modify `src/lib/tree.test.ts`: cover parent-present suppression, orphan visibility, side-aware compare-mode orphan visibility, non-class `$` visibility, and same-folder behavior.
- Modify `src/components/FileTree.tsx`: add a file-cell chevron spacer before file icons.
- Modify `src/components/FileTree.test.tsx`: assert file rows expose spacer markers while existing two-pane behavior remains green.
- Modify `src/styles.css` only if the existing `.tree-chevron-spacer` class is insufficient for file-cell alignment.

## Task 1: Tree Projection

**Files:**
- Modify: `src/lib/tree.ts`
- Modify: `src/lib/tree.test.ts`

- [ ] **Step 1: Write failing tree projection tests**

Add these tests inside the existing `describe("buildTree", ...)` block in `src/lib/tree.test.ts`:

```ts
  it("hides nested and anonymous class leaves when the parent class exists in the same folder", () => {
    const withInnerClasses: ComparePair[] = [
      { path: "pkg/MarketSSEventListener.class", status: "identical", left: { path: "pkg/MarketSSEventListener.class", kind: "class" } },
      { path: "pkg/MarketSSEventListener$1.class", status: "identical", left: { path: "pkg/MarketSSEventListener$1.class", kind: "class" } },
      { path: "pkg/MarketSSEventListener$Inner.class", status: "identical", left: { path: "pkg/MarketSSEventListener$Inner.class", kind: "class" } },
      { path: "pkg/OrderBookEventListener.class", status: "identical", left: { path: "pkg/OrderBookEventListener.class", kind: "class" } },
      { path: "pkg/OrderBookEventListener$1.class", status: "identical", left: { path: "pkg/OrderBookEventListener$1.class", kind: "class" } },
    ];

    const tree = buildTree(withInnerClasses);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual([
      "MarketSSEventListener.class",
      "OrderBookEventListener.class",
    ]);
  });

  it("keeps orphan nested class leaves when the parent class is absent", () => {
    const tree = buildTree([
      { path: "pkg/Outer$Inner.class", status: "identical", left: { path: "pkg/Outer$Inner.class", kind: "class" } },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer$Inner.class"]);
  });

  it("does not hide non-class files that contain a dollar sign", () => {
    const tree = buildTree([
      { path: "assets/foo$bar.txt", status: "identical", left: { path: "assets/foo$bar.txt", kind: "text" } },
      { path: "assets/foo.txt", status: "identical", left: { path: "assets/foo.txt", kind: "text" } },
    ]);
    const assets = tree.find((n) => n.name === "assets") as TreeFolder;

    expect(assets.children.map((n) => n.name)).toEqual(["foo.txt", "foo$bar.txt"]);
  });

  it("only hides nested classes when the parent class is in the same folder", () => {
    const tree = buildTree([
      { path: "a/Outer.class", status: "identical", left: { path: "a/Outer.class", kind: "class" } },
      { path: "b/Outer$Inner.class", status: "identical", left: { path: "b/Outer$Inner.class", kind: "class" } },
    ]);
    const folderB = tree.find((n) => n.name === "b") as TreeFolder;

    expect(folderB.children.map((n) => n.name)).toEqual(["Outer$Inner.class"]);
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- src/lib/tree.test.ts
```

Expected: FAIL because `MarketSSEventListener$1.class`, `MarketSSEventListener$Inner.class`, and `OrderBookEventListener$1.class` still render as tree leaves.

- [ ] **Step 3: Implement parent-present class suppression**

In `src/lib/tree.ts`, add this helper near `isDirectoryPair`:

```ts
function parentClassLeafName(leafName: string): string | undefined {
  if (!leafName.endsWith(".class")) return undefined;
  const dollarIndex = leafName.indexOf("$");
  if (dollarIndex <= 0) return undefined;
  return `${leafName.slice(0, dollarIndex)}.class`;
}
```

Then update `buildTree` so file insertion is delayed until folder-local parent checks are available. Replace the current per-pair file insertion block with the same traversal, but keep files in `fileLists`; after all pairs are collected, `finalize` handles suppression.

Update `finalize` to filter files before sorting. Suppression must be side-aware:

```ts
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
  const rawFiles = fileLists.get(folder) ?? [];
  const leftParentClassNames = new Set(
    rawFiles
      .filter((file) => file.pair.left && file.name.endsWith(".class") && !parentClassLeafName(file.name))
      .map((file) => file.name),
  );
  const rightParentClassNames = new Set(
    rawFiles
      .filter((file) => file.pair.right && file.name.endsWith(".class") && !parentClassLeafName(file.name))
      .map((file) => file.name),
  );
  const files = rawFiles
    .filter((file) => {
      const parent = parentClassLeafName(file.name);
      if (!parent) return true;
      const leftHasParent = !file.pair.left || leftParentClassNames.has(parent);
      const rightHasParent = !file.pair.right || rightParentClassNames.has(parent);
      return !(leftHasParent && rightHasParent);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}
```

- [ ] **Step 4: Run focused tree tests to verify GREEN**

Run:

```bash
npm test -- src/lib/tree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Self-review tree projection**

Check these points manually:

- `parentClassLeafName("$Proxy.class")` would return `undefined`.
- `assets/foo$bar.txt` is not hidden because it does not end with `.class`.
- Folder-local `rawFiles` means `a/Outer.class` does not hide `b/Outer$Inner.class`.
- Side-local parent sets mean a left-only parent does not hide a right-only nested class, and a right-only parent does not hide a left-only nested class.
- `buildTree` still skips directory pairs before file collection.

- [ ] **Step 6: Commit tree projection**

Run:

```bash
git add src/lib/tree.ts src/lib/tree.test.ts
git commit -m "fix(ui): hide inner class leaves from tree"
```

## Task 1 Follow-up: Side-Aware Compare Mode

**Files:**
- Modify: `src/lib/tree.ts`
- Modify: `src/lib/tree.test.ts`

Final review found that pair-level parent detection can hide a one-sided nested
class when the parent exists only on the opposite side. Add these public
`buildTree` tests and keep the implementation side-aware:

```ts
  it("keeps a one-sided nested class visible when its parent exists only on the opposite side", () => {
    const tree = buildTree([
      { path: "pkg/Outer.class", status: "onlyLeft", left: { path: "pkg/Outer.class", kind: "class" } },
      { path: "pkg/Outer$Inner.class", status: "onlyRight", right: { path: "pkg/Outer$Inner.class", kind: "class" } },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer.class", "Outer$Inner.class"]);
  });

  it("keeps a left-only nested class visible when its parent exists only on the right", () => {
    const tree = buildTree([
      { path: "pkg/Outer.class", status: "onlyRight", right: { path: "pkg/Outer.class", kind: "class" } },
      { path: "pkg/Outer$Inner.class", status: "onlyLeft", left: { path: "pkg/Outer$Inner.class", kind: "class" } },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer.class", "Outer$Inner.class"]);
  });

  it("keeps a two-sided nested class visible when its parent exists on only one side", () => {
    const tree = buildTree([
      { path: "pkg/Outer.class", status: "onlyLeft", left: { path: "pkg/Outer.class", kind: "class" } },
      {
        path: "pkg/Outer$Inner.class",
        status: "different",
        left: { path: "pkg/Outer$Inner.class", kind: "class" },
        right: { path: "pkg/Outer$Inner.class", kind: "class" },
      },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer.class", "Outer$Inner.class"]);
  });

  it("hides a two-sided nested class when its parent exists on both sides", () => {
    const tree = buildTree([
      {
        path: "pkg/Outer.class",
        status: "identical",
        left: { path: "pkg/Outer.class", kind: "class" },
        right: { path: "pkg/Outer.class", kind: "class" },
      },
      {
        path: "pkg/Outer$Inner.class",
        status: "identical",
        left: { path: "pkg/Outer$Inner.class", kind: "class" },
        right: { path: "pkg/Outer$Inner.class", kind: "class" },
      },
    ]);
    const pkg = tree.find((n) => n.name === "pkg") as TreeFolder;

    expect(pkg.children.map((n) => n.name)).toEqual(["Outer.class"]);
  });
```

Verification:

```bash
npm test -- src/lib/tree.test.ts
npm test -- src/lib/tree.test.ts src/components/FileTree.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/lib/tree.ts src/lib/tree.test.ts
git commit -m "fix(ui): keep cross-side orphan inner classes visible"
git add src/lib/tree.test.ts
git commit -m "test(ui): cover side-aware inner class matrix"
```

## Task 2: File Icon Alignment

**Files:**
- Modify: `src/components/FileTree.tsx`
- Modify: `src/components/FileTree.test.tsx`
- Modify: `src/styles.css` only if needed

- [ ] **Step 1: Write failing alignment test**

In `src/components/FileTree.test.tsx`, add this test inside `describe("FileTree", ...)`:

```tsx
  it("renders a chevron spacer in file cells so file icons align with folder icons", () => {
    const { container } = setup();

    const fileRows = container.querySelectorAll("button.tree-file");
    expect(fileRows.length).toBeGreaterThan(0);
    for (const row of fileRows) {
      const populatedCells = row.querySelectorAll(".tree-cell:not(.tree-gap)");
      expect(populatedCells.length).toBeGreaterThan(0);
      for (const cell of populatedCells) {
        expect(cell.querySelector(".tree-file-chevron-spacer")).toBeInTheDocument();
      }
    }
  });
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- src/components/FileTree.test.tsx
```

Expected: FAIL because file cells do not yet render `.tree-file-chevron-spacer`.

- [ ] **Step 3: Add file chevron spacer in FileTree**

In `src/components/FileTree.tsx`, add a local constant near `SideCell`:

```tsx
const fileChevronSpacer = (
  <span className="tree-chevron tree-chevron-spacer tree-file-chevron-spacer" aria-hidden="true" />
);
```

Then update the two file `SideCell` calls in the final file-row return:

```tsx
<SideCell
  present={twoPane ? !!pair.left : true}
  chevron={fileChevronSpacer}
  icon={<File className="tree-icon" />}
  name={node.name}
/>
```

and:

```tsx
<SideCell
  present={!!pair.right}
  chevron={fileChevronSpacer}
  icon={<File className="tree-icon" />}
  name={node.name}
/>
```

No CSS change is needed if `.tree-chevron-spacer` continues to hide the spacer while preserving width.

- [ ] **Step 4: Run focused component tests to verify GREEN**

Run:

```bash
npm test -- src/components/FileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run combined frontend tests**

Run:

```bash
npm test -- src/lib/tree.test.ts src/components/FileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit alignment**

Run:

```bash
git add src/components/FileTree.tsx src/components/FileTree.test.tsx src/styles.css
git commit -m "fix(ui): align file icons in tree rows"
```

If `src/styles.css` was not changed, omit it from `git add`.

## Task 3: Final Verification And Review

**Files:**
- No planned code changes unless verification finds a regression.

- [ ] **Step 1: Run relevant frontend tests**

Run:

```bash
npm test -- src/lib/tree.test.ts src/components/FileTree.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full Vitest suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Optional frontend render verifier**

Run when the environment can launch the frontend harness:

```bash
npm run verify:frontend-render
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat main..HEAD
git diff main..HEAD -- src/lib/tree.ts src/lib/tree.test.ts src/components/FileTree.tsx src/components/FileTree.test.tsx src/styles.css
```

Expected: only the tree projection tests/logic and file spacer test/markup changed.

- [ ] **Step 5: Final commit if verification required fixes**

If Step 1-4 required code fixes, commit them:

```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/components/FileTree.tsx src/components/FileTree.test.tsx src/styles.css
git commit -m "test: verify inner class tree projection"
```

If no files changed, no commit is needed.

## Plan Self-Review

- Spec coverage: Task 1 implements parent-only tree projection and decompiler boundary preservation by keeping changes frontend-only. Task 2 implements file icon alignment. Task 3 verifies focused and broader frontend behavior.
- Placeholder scan: no red-flag placeholder steps remain.
- Type consistency: tests use existing `ComparePair`, `TreeFolder`, `FileTree`, and existing CSS class patterns. New helper is internal to `src/lib/tree.ts`.
