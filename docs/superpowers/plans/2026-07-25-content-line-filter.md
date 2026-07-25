# Compare Content Line Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-wide `All` and `Differences` line-display filters to Compare content while preserving Monaco models, diff navigation, editing, and merge behavior.

**Architecture:** `App.tsx` owns one session-only `ContentFilter` state and passes it into the controlled `DiffView`. `DiffView` maps the state to Monaco 0.52.2's public `hideUnchangedRegions` option and renders the filter beside the existing diff navigator; no preview projection, Rust, or IPC path changes.

**Tech Stack:** React 19, TypeScript 5.9, Monaco Editor 0.52.2, Vitest, Testing Library, Playwright render verification, CSS.

## Global Constraints

- Content filter values are exactly `"all" | "diff"`; `Identical` is out of scope.
- The default is `all`.
- State is shared across the Compare workspace and is not stored per tab, in Preferences, or in local storage.
- `diff` uses Monaco `hideUnchangedRegions` with exactly `contextLineCount: 3`.
- Monaco's native minimum collapsible line count and reveal line count remain unchanged.
- The filter is visible only in Compare mode.
- The filter applies to source, bytecode, and text previews in Compare mode.
- Editing, undo, cursor state, line numbers, staging, `Move hunk`, `Take all`, `Copy file`, and diff navigation must continue using the original Monaco models.
- The editor must stay side by side at narrow widths.
- No Rust core, archive, merge-plan, preview DTO, or IPC changes.
- Follow the repository commands through `rtk`.

---

## File Structure

### Files to modify

- `src/lib/types.ts`
  - Own the shared `ContentFilter` union type.
- `src/components/DiffView.tsx`
  - Accept the controlled filter value and callback.
  - Render the accessible `All / Differences` segmented control.
  - Map the filter to Monaco's `hideUnchangedRegions` option.
- `src/components/DiffView.test.tsx`
  - Verify the controlled UI contract, Compare-only visibility, and Monaco option mapping.
- `src/App.tsx`
  - Own the session-only workspace state and wire it to `DiffView`.
- `src/App.test.tsx`
  - Verify the default and state retention across Compare navigation, view switching, and source replacement.
- `src/styles.css`
  - Lay out the content filter and diff navigator as the toolbar's compact center cluster.
- `scripts/verify-frontend-render.mjs`
  - Protect placement, accessibility, selected state, and compact-width visibility in the real browser renderer.

### Files intentionally unchanged

- `src/lib/tree.ts` and `src/components/WorkspaceTabs.tsx`
  - The file-tree filter remains independent.
- `src/lib/textMerge.ts`
  - Hunk coordinates continue to come from the real Monaco models.
- `crates/**` and `src-tauri/**`
  - There is no backend or desktop-host contract change.
- `src/components/FreeTextWorkspace.tsx`
  - Free text comparison keeps its current full-content behavior.

---

### Task 1: Implement the controlled content filter and workspace state

**Files:**

- Modify: `src/lib/types.ts:13-15`
- Modify: `src/components/DiffView.test.tsx:8-96,192-258`
- Modify: `src/components/DiffView.tsx:7-61,140-191`
- Modify: `src/App.test.tsx:55-73,385-408,1167-1205`
- Modify: `src/App.tsx:1-90,247-300,2098-2125`

**Interfaces:**

- Produces: `export type ContentFilter = "all" | "diff"`
- Produces: required `DiffViewProps.contentFilter: ContentFilter`
- Produces: required `DiffViewProps.onContentFilterChange: (filter: ContentFilter) => void`
- Consumes: Monaco `IDiffEditorOptions.hideUnchangedRegions`
- Preserves: the existing `DiffNavigatorProps`, merge callbacks, and editor-model callbacks

- [ ] **Step 1: Extend the `DiffView` test harness with the future controlled props**

In `src/components/DiffView.test.tsx`, import `ContentFilter`, remove the obsolete
`FutureDiffViewTestProps` comment/type, and make the harness describe the actual
component contract:

```tsx
import type { ComparePair, ContentFilter, Mode } from "@/lib/types";

type RenderDiffViewOverrides = Partial<
  Pick<
    React.ComponentProps<typeof DiffView>,
    | "contentFilter"
    | "editable"
    | "editValue"
    | "fileMerge"
    | "hunkMerge"
    | "ignoreTrimWhitespace"
    | "diffNavigator"
    | "onContentFilterChange"
  >
>;
```

Add these defaults to the `props` object in `renderDiffView`:

```tsx
contentFilter: "all" as ContentFilter,
onContentFilterChange: vi.fn(),
```

Keep the existing `diffNavigator` default and return the full `props` object.

- [ ] **Step 2: Write failing component tests for the UI and Monaco mapping**

Add the following tests inside the existing `describe("DiffView", ...)`:

```tsx
it("renders a controlled content line filter in Compare mode", async () => {
  const user = userEvent.setup();
  const props = renderDiffView("compare", DEFAULT_UI_PREFERENCES);

  const filter = screen.getByRole("group", { name: "Content line filter" });
  expect(within(filter).getByRole("button", { name: "Show all content lines" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(within(filter).getByRole("button", { name: "Show differences only" }))
    .toHaveAttribute("aria-pressed", "false");

  await user.click(within(filter).getByRole("button", { name: "Show differences only" }));
  expect(props.onContentFilterChange).toHaveBeenCalledWith("diff");
});

it("maps Differences to Monaco hidden unchanged regions with three context lines", () => {
  renderDiffView("compare", DEFAULT_UI_PREFERENCES, "dark", {
    contentFilter: "diff",
  });

  expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
    options: {
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: 3,
      },
    },
  });
});

it("keeps unchanged regions visible for All", () => {
  renderDiffView("compare", DEFAULT_UI_PREFERENCES);

  expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
    options: {
      hideUnchangedRegions: {
        enabled: false,
      },
    },
  });
});

it("hides the content line filter and unchanged-region filtering outside Compare", () => {
  renderDiffView("text", DEFAULT_UI_PREFERENCES, "dark", {
    contentFilter: "diff",
  });

  expect(screen.queryByRole("group", { name: "Content line filter" }))
    .not.toBeInTheDocument();
  expect(diffEditorMock.mock.calls[0]?.[0]).toMatchObject({
    options: {
      hideUnchangedRegions: {
        enabled: false,
      },
    },
  });
});
```

- [ ] **Step 3: Run the focused component test and verify the new tests fail**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx
```

Expected: FAIL because `DiffView` does not yet render `Content line filter` and
does not pass `hideUnchangedRegions`.

- [ ] **Step 4: Add the shared type and controlled `DiffView` contract**

In `src/lib/types.ts`, immediately after `TreeFilter`, add:

```ts
export type ContentFilter = "all" | "diff";
```

In `src/components/DiffView.tsx`, include `ContentFilter` in the type import:

```ts
import type { ComparePair, ContentFilter, EntryPreview, Mode, Side } from "@/lib/types";
```

Add required properties to `DiffViewProps`:

```ts
contentFilter: ContentFilter;
onContentFilterChange: (filter: ContentFilter) => void;
```

Destructure them in `DiffView`:

```ts
contentFilter,
onContentFilterChange,
```

- [ ] **Step 5: Render the accessible segmented control and center cluster**

Add this local renderer near `renderDiffNavigator`:

```tsx
const renderContentLineFilter = () => {
  if (mode !== "compare") return null;
  const options: Array<{
    value: ContentFilter;
    label: string;
    ariaLabel: string;
  }> = [
    { value: "all", label: "All", ariaLabel: "Show all content lines" },
    { value: "diff", label: "Differences", ariaLabel: "Show differences only" },
  ];

  return (
    <div className="content-line-filter" role="group" aria-label="Content line filter">
      {options.map(({ value, label, ariaLabel }) => (
        <Button
          key={value}
          variant={contentFilter === value ? "secondary" : "ghost"}
          size="sm"
          aria-label={ariaLabel}
          aria-pressed={contentFilter === value}
          onClick={() => onContentFilterChange(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
};
```

Replace the direct `{renderDiffNavigator()}` child in `.merge-actions` with:

```tsx
<div className="diff-toolbar-center">
  {renderContentLineFilter()}
  {renderDiffNavigator()}
</div>
```

Do not place this control in `WorkspaceTabs`; that component owns file tabs and
the Source/Bytecode switch, not line visibility.

- [ ] **Step 6: Map the filter to Monaco's public option**

Inside the `DiffEditor` options object, after `ignoreTrimWhitespace`, add:

```ts
hideUnchangedRegions:
  mode === "compare" && contentFilter === "diff"
    ? { enabled: true, contextLineCount: 3 }
    : { enabled: false },
```

Do not set `minimumLineCount` or `revealLineCount`; Monaco 0.52.2's native
defaults must remain active.

- [ ] **Step 7: Run the focused component test and verify it passes**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx
```

Expected: PASS for all `DiffView` tests, including the existing merge-action and
diff-navigator tests.

- [ ] **Step 8: Write failing application tests for workspace ownership**

In `src/App.test.tsx`, add a test that opens two Compare tabs and switches to
bytecode without resetting the selected filter:

```tsx
it("keeps the content line filter across Compare tabs and source/bytecode views", async () => {
  invoke.mockImplementation((cmd, args) => {
    if (cmd === "compute_diff") {
      return Promise.resolve({
        pairs: [
          ...onePairDiff.pairs,
          {
            path: "App.class",
            status: "different" as const,
            left: { path: "App.class", kind: "class" as const },
            right: { path: "App.class", kind: "class" as const },
          },
        ],
      });
    }
    if (cmd === "read_entry" && args?.entryPath === "App.class") {
      const side = args.side as "left" | "right";
      return Promise.resolve({
        path: "App.class",
        kind: "class" as const,
        language: "java",
        content: side === "left" ? "class App { int v = 1; }" : "class App { int v = 2; }",
      });
    }
    if (cmd === "disassemble") {
      return Promise.resolve(`${args?.side}: bytecode`);
    }
    return defaultInvoke(cmd, args);
  });
  const user = userEvent.setup();
  await driveIntoFileCompare(user);

  const filter = screen.getByRole("group", { name: "Content line filter" });
  expect(within(filter).getByRole("button", { name: "Show all content lines" }))
    .toHaveAttribute("aria-pressed", "true");
  await user.click(within(filter).getByRole("button", { name: "Show differences only" }));

  await user.click(screen.getByRole("tab", { name: /files/i }));
  const classCells = await screen.findAllByText("App.class");
  const classRow = classCells.find((element) => element.closest("button.tree-file"));
  expect(classRow).toBeDefined();
  await user.click(classRow!);

  expect(screen.getByRole("button", { name: "Show differences only" }))
    .toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Show bytecode" }));
  expect(screen.getByRole("button", { name: "Show differences only" }))
    .toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("tab", { name: /config\.json/ }));
  expect(screen.getByRole("button", { name: "Show differences only" }))
    .toHaveAttribute("aria-pressed", "true");
});
```

Add a separate visibility test:

```tsx
it("shows the content line filter only on an active Compare diff tab", async () => {
  const user = userEvent.setup();
  await driveIntoFileCompare(user);

  expect(screen.getByRole("group", { name: "Content line filter" }))
    .toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /files/i }));
  expect(screen.queryByRole("group", { name: "Content line filter" }))
    .not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Text mode" }));
  expect(screen.queryByRole("group", { name: "Content line filter" }))
    .not.toBeInTheDocument();
});
```

Add a source-replacement regression:

```tsx
it("keeps the content line filter after replacing a Compare source", async () => {
  const user = userEvent.setup();
  await driveIntoFileCompare(user);
  await user.click(screen.getByRole("button", { name: "Show differences only" }));

  await user.click(screen.getByRole("button", { name: "Change left source" }));
  await user.click(await screen.findByText("Browse file"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith(
    "open_archive",
    { path: "/tmp/config.json", side: "left" },
  ));

  const cells = await screen.findAllByText("config.json");
  const row = cells.find((element) => element.closest("button.tree-file"));
  expect(row).toBeDefined();
  await user.click(row!);

  expect(screen.getByRole("button", { name: "Show differences only" }))
    .toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 9: Run the focused application tests and verify they fail**

Run:

```bash
rtk npm test -- src/App.test.tsx
```

Expected: FAIL because `App` does not yet supply a content-filter state or
callback to `DiffView`.

- [ ] **Step 10: Own and wire one workspace-level state in `App.tsx`**

Add `ContentFilter` to the existing import from `@/lib/types`, then add the state
next to `treeFilter`:

```ts
const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
```

Pass the controlled contract into the single shared `diffView` instance:

```tsx
contentFilter={contentFilter}
onContentFilterChange={setContentFilter}
```

Do not add `contentFilter` to `DiffTab`, Preferences, history, local storage, or
any mode/source reset function.

- [ ] **Step 11: Run the component and application tests**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Type-check and build the frontend**

Run:

```bash
rtk npm run build
```

Expected: TypeScript and Vite build complete successfully. Fix only
feature-related type or lint errors; do not weaken the controlled prop types.

- [ ] **Step 13: Commit the functional feature**

Run:

```bash
rtk git add src/lib/types.ts src/components/DiffView.tsx src/components/DiffView.test.tsx src/App.tsx src/App.test.tsx
rtk git commit -m "feat: filter compare content by changed lines"
```

Expected: one commit containing the typed state, Monaco mapping, and automated
behavior coverage. Styling and browser layout coverage remain for Task 2.

---

### Task 2: Integrate the center toolbar layout and browser regression coverage

**Files:**

- Modify: `src/styles.css:1330-1375,1995-1998,2306-2309`
- Modify: `scripts/verify-frontend-render.mjs:890-945`

**Interfaces:**

- Consumes: `.diff-toolbar-center` and `.content-line-filter` emitted by Task 1
- Preserves: `.merge-actions` as a three-column grid
- Preserves: `.diff-navigator` and both `.pane-actions` groups
- Produces: browser assertions for placement and compact-width visibility

- [ ] **Step 1: Add failing browser assertions for selection and placement**

In `scripts/verify-frontend-render.mjs`, after both pane-action groups are
validated and before the Compare edit smoke test, add:

```js
const contentLineFilter = mockedPage.getByRole("group", { name: "Content line filter" });
await contentLineFilter.waitFor({ timeout: 5_000 });
const showAllLines = contentLineFilter.getByRole("button", { name: "Show all content lines" });
const showDiffLines = contentLineFilter.getByRole("button", { name: "Show differences only" });
if (await showAllLines.getAttribute("aria-pressed") !== "true") {
  throw new Error("Compare content filter did not default to All");
}
await showDiffLines.click();
if (await showDiffLines.getAttribute("aria-pressed") !== "true") {
  throw new Error("Compare content filter did not select Differences");
}

const centerCluster = mockedPage.locator(".diff-toolbar-center");
const centerOwnsFilter = await centerCluster
  .getByRole("group", { name: "Content line filter" })
  .count();
const centerOwnsNavigator = await centerCluster
  .getByRole("group", { name: "Diff block navigation" })
  .count();
if (centerOwnsFilter !== 1 || centerOwnsNavigator !== 1) {
  throw new Error("Compare toolbar center does not own the line filter and diff navigator");
}
const centerLayout = await centerCluster.evaluate((element) => {
  const style = getComputedStyle(element);
  return { display: style.display, overflowX: style.overflowX };
});
if (centerLayout.display !== "flex" || centerLayout.overflowX !== "auto") {
  throw new Error(`Compare toolbar center layout is not protected: ${JSON.stringify(centerLayout)}`);
}
```

Extend the existing compact-width block after `assertViewportFits(...)`:

```js
const compactContentFilter = mockedPage.getByRole("group", { name: "Content line filter" });
const [contentFilterBox, centerClusterBox] = await Promise.all([
  compactContentFilter.boundingBox(),
  mockedPage.locator(".diff-toolbar-center").boundingBox(),
]);
if (!contentFilterBox || contentFilterBox.width <= 0) {
  throw new Error("Compact Compare content filter is not visible");
}
if (!centerClusterBox || centerClusterBox.width < contentFilterBox.width) {
  throw new Error(`Compact toolbar center clipped the content filter: ${JSON.stringify({
    contentFilterBox,
    centerClusterBox,
  })}`);
}
```

- [ ] **Step 2: Run render verification and capture the layout failure**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected before the CSS is added: FAIL at compact layout because the new center
cluster has no sizing or overflow rules and cannot guarantee the filter remains
visible.

- [ ] **Step 3: Add focused toolbar styles**

In the editor-pane section of `src/styles.css`, add:

```css
.diff-toolbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-width: 0;
  max-width: 100%;
  padding-inline: 0.35rem;
  overflow-x: auto;
  scrollbar-width: thin;
}
.diff-toolbar-center > * { flex: 0 0 auto; }
.content-line-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.12rem;
  border: 1px solid var(--line-soft);
  border-radius: 0.38rem;
  background: var(--ink-2);
}
.content-line-filter [data-slot="button"] {
  height: 1.65rem;
  padding-inline: 0.45rem;
  border: 0;
  font-size: 0.66rem;
  white-space: nowrap;
}
```

Keep `.merge-actions` at three grid columns. Do not hide button text, convert the
control to a dropdown, overlay it on Monaco, or enable inline diff at compact
widths.

- [ ] **Step 4: Run render verification and adjust only measured layout issues**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS at all harness viewport sizes. If a measured width fails, adjust
only `.diff-toolbar-center` or `.content-line-filter`; preserve the labels,
three-column toolbar, and side-by-side editor contract.

- [ ] **Step 5: Run the complete frontend test suite**

Run:

```bash
rtk npm test
```

Expected: PASS with no regression in tree filtering, workspace tabs, diff
navigation, or hunk merge.

- [ ] **Step 6: Run repository whitespace and umbrella gates**

Run:

```bash
rtk git diff --check
rtk npm run verify:all
```

Expected: both commands PASS. `verify:all` must complete the frontend build,
unit tests, browser render check, branding check, and docs synchronization.

- [ ] **Step 7: Perform the manual Monaco smoke test**

Launch the desktop development build using the command documented by the
repository:

```bash
rtk npm run tauri -- dev
```

In Compare mode:

1. Open two sources containing a large text or decompiled class diff.
2. Confirm `All` shows the full content.
3. Select `Differences`; confirm long unchanged regions collapse with three
   context lines and Monaco's native reveal control is usable.
4. Switch Source/Bytecode and two open diff tabs; confirm `Differences` remains
   selected.
5. Exercise `Move hunk` and `Take all`; confirm collapsed regions recompute,
   navigation targets the correct block, and staged content reflects the editor
   models.
6. Open an identical pair through the tree's `All`/`Identical` file filter;
   confirm content `Differences` shows `0/0` and a collapsed unchanged region.
7. Open a one-sided entry; confirm all present lines remain visible as changes.
8. Narrow the window; confirm the editor stays side by side and the content
   filter remains reachable without covering code.

Expected: all eight checks match the design. Stop the dev process after the
smoke test.

- [ ] **Step 8: Commit the layout and render protection**

Run:

```bash
rtk git add src/styles.css scripts/verify-frontend-render.mjs
rtk git commit -m "test: protect compare content filter layout"
```

Expected: a second focused commit containing CSS and real-browser regression
coverage.

- [ ] **Step 9: Confirm the final repository state**

Run:

```bash
rtk git status --short
rtk git log -3 --oneline
```

Expected: no uncommitted feature changes. The latest two implementation commits
are the functional feature commit and the layout/render-protection commit; the
approved design commit remains immediately before the implementation work unless
unrelated commits were added concurrently.
