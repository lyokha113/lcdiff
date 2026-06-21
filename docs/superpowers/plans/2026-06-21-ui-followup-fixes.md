# UI Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make startup history understandable, simplify source identification, repair Diff toolbar mode behavior, and remove the stretched Preferences header.

**Architecture:** Keep all backend and persistence contracts unchanged. Make each correction inside its existing React component, lock the intended behavior with component tests first, and centralize layout changes in the existing workspace visual-system section of `src/styles.css` so later rules cannot be overridden by legacy declarations.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS Grid/Flexbox, Vite, Tauri 2, Playwright/browser QA.

---

## File Map

- `src/components/SplashScreen.tsx`: recent-work presentation and local expand/collapse state.
- `src/components/SplashScreen.test.tsx`: recent row content, empty state, and expansion behavior.
- `src/components/SourceChips.tsx`: visually simplified source slots while retaining semantic side labels.
- `src/components/SourceChips.test.tsx`: source-label regression coverage.
- `src/components/DiffView.tsx`: mode-aware toolbar grouping and labeled copy actions.
- `src/components/DiffView.test.tsx`: Compare/View toolbar behavior.
- `src/components/ConfigDrawer.tsx`: stable structural hooks for header/body scrolling.
- `src/components/ConfigDrawer.test.tsx`: Preferences structure regression coverage.
- `src/styles.css`: launch history layout, source rail, Diff toolbar, Preferences rows, and responsive behavior.
- `scripts/verify-frontend-render.mjs`: rendered viewport assertions for the repaired surfaces.

### Task 1: Make Recent Work Explicit and Expandable

**Files:**
- Modify: `src/components/SplashScreen.test.tsx`
- Modify: `src/components/SplashScreen.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing Recent Work tests**

Add this explicit fixture, then add the tests:

```tsx
const sixHistoryEntries: HistoryEntry[] = [
  { id: "k1", mode: "compare", paths: ["/work/a.jar", "/work/b.jar"], openedAt: NOW - 60_000 },
  { id: "k2", mode: "single", paths: ["/work/commons.jar"], openedAt: NOW - 120_000 },
  { id: "k3", mode: "compare", paths: ["/work/c.jar", "/work/d.jar"], openedAt: NOW - 180_000 },
  { id: "k4", mode: "single", paths: ["/work/e.jar"], openedAt: NOW - 240_000 },
  { id: "k5", mode: "single", paths: ["/work/f.jar"], openedAt: NOW - 300_000 },
  { id: "k6", mode: "compare", paths: ["/work/g.jar", "/work/h.jar"], openedAt: NOW - 360_000 },
];

it("explains when recent work is recorded", () => {
  setup({ history: [] });
  expect(screen.getByText("History appears after you open a source."))
    .toBeInTheDocument();
});

it("shows five recent sessions and expands to the stored list", async () => {
  setup({ history: sixHistoryEntries });
  expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);
  await userEvent.click(screen.getByRole("button", { name: "View all history" }));
  expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Show less history" })).toBeInTheDocument();
});

it("presents basenames separately from source paths", () => {
  setup();
  expect(screen.getByText("a.jar", { selector: ".launch-history__name" })).toBeInTheDocument();
  expect(screen.getByTitle("a.jar")).toHaveClass("launch-history__path");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx
```

Expected: FAIL because the new empty-state copy, five-row expansion, accessible reopen names, and basename elements do not exist.

- [ ] **Step 3: Implement minimal Recent Work behavior**

Import `useState` and `basename`, or add a local basename helper. Replace the four-entry slice with local expansion state:

```tsx
const [historyExpanded, setHistoryExpanded] = useState(false);
const visibleHistory = historyExpanded ? history : history.slice(0, 5);
```

Render the recent section below the action-card grid. Give every row an accessible name and separate primary and secondary text:

```tsx
<button
  type="button"
  aria-label={`Reopen ${entry.mode === "compare" ? "comparison" : "view"} ${entry.paths.join(" and ")}`}
  onClick={() => onOpenEntry(entry)}
>
  <span className="launch-history__mode">{entry.mode === "compare" ? "Compare" : "View"}</span>
  <span className="launch-history__sources">
    <span className="launch-history__name">{entry.paths.map(basename).join(" ↔ ")}</span>
    <span className="launch-history__path" title={entry.paths.join(" ↔ ")}>{entry.paths.join(" ↔ ")}</span>
  </span>
  <span className="launch-history__time">{timeAgo(entry.openedAt, now)}</span>
  <ArrowUpRight aria-hidden="true" />
</button>
```

When `history.length > 5`, render `View all history` or `Show less history`. Use the exact empty text `History appears after you open a source.`

Move `.launch-card--recent` out of the dense action grid and style it as a full-width section with readable rows, hover/focus treatment, and a maximum expanded height that scrolls only when needed.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx
```

Expected: all `SplashScreen` tests pass.

- [ ] **Step 5: Commit Recent Work**

```bash
rtk git add src/components/SplashScreen.tsx src/components/SplashScreen.test.tsx src/styles.css
rtk git commit -m "fix: clarify recent work history"
```

### Task 2: Remove Visual Side Labels Without Losing Semantics

**Files:**
- Modify: `src/components/SourceChips.test.tsx`
- Modify: `src/components/SourceChips.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing source-label test**

```tsx
it("keeps semantic side regions without standalone side labels", () => {
  setup();
  expect(screen.getByRole("region", { name: "Left source" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Right source" })).toBeInTheDocument();
  expect(document.querySelector(".source-slot__side")).not.toBeInTheDocument();
  expect(document.querySelector(".source-slot__identity")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk npm test -- src/components/SourceChips.test.tsx
```

Expected: FAIL because `.source-slot__identity` and `.source-slot__side` are still rendered.

- [ ] **Step 3: Remove only the visual identity column**

Delete this block from `renderSlot`:

```tsx
<div className="source-slot__identity">
  <span className="source-slot__side">{sideLabel}</span>
  {archive && <span className="source-slot__kind">{archive.metadata.sourceKind}</span>}
</div>
```

Keep the section `aria-label`, picker heading, trigger label, and input label. Change `.source-slot` to a one-column grid and remove identity-column responsive overrides. Do not change source selection or path behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
rtk npm test -- src/components/SourceChips.test.tsx
```

Expected: all `SourceChips` tests pass.

- [ ] **Step 5: Commit the source rail correction**

```bash
rtk git add src/components/SourceChips.tsx src/components/SourceChips.test.tsx src/styles.css
rtk git commit -m "fix: simplify workspace source rail"
```

### Task 3: Make the Diff Toolbar Mode-Aware

**Files:**
- Modify: `src/components/DiffView.test.tsx`
- Modify: `src/components/DiffView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing toolbar tests**

```tsx
it("hides compare-only actions in View mode", () => {
  setup({ mode: "single", hunkMerge: true });
  expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Compare actions" })).not.toBeInTheDocument();
});

it("groups labeled copy and hunk actions in Compare mode", () => {
  setup({ hunkMerge: true });
  const actions = screen.getByRole("group", { name: "Compare actions" });
  expect(within(actions).getByRole("button", { name: "Copy file to left" })).toHaveTextContent("Copy file ←");
  expect(within(actions).getByRole("button", { name: "Copy file to right" })).toHaveTextContent("Copy file →");
  expect(within(actions).getByRole("group", { name: "Merge hunks" })).toBeInTheDocument();
});
```

Import `within` from Testing Library.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx
```

Expected: FAIL because copy actions use icon-only labels, no Compare action group exists, and View renders disabled copy controls.

- [ ] **Step 3: Implement mode-aware action grouping**

Keep the view toggle as the first toolbar group. Render compare controls only when `mode === "compare"`:

```tsx
{mode === "compare" && (
  <div className="compare-actions" role="group" aria-label="Compare actions">
    <CopyAction target="left" />
    {hunkMerge && <HunkActions />}
    <CopyAction target="right" />
  </div>
)}
```

The concrete buttons remain in `DiffView`; helper extraction is optional only if it reduces duplicated tooltip markup. Use `size="sm"`, labels `Copy file to left/right`, and visible text `Copy file ←/→`. Preserve the existing disabled predicates, callbacks, and tooltip descriptions.

Change `.copy-actions` to `justify-content: flex-start`; give `.compare-actions` `margin-left: auto`, `display: flex`, and horizontal overflow at narrow widths. Keep the hunk divider inside the hunk group.

- [ ] **Step 4: Run focused and App behavior tests**

Run:

```bash
rtk npm test -- src/components/DiffView.test.tsx src/App.test.tsx
```

Expected: both files pass; existing merge callbacks remain covered.

- [ ] **Step 5: Commit the toolbar correction**

```bash
rtk git add src/components/DiffView.tsx src/components/DiffView.test.tsx src/styles.css
rtk git commit -m "fix: repair mode-aware diff actions"
```

### Task 4: Constrain Preferences Header and Scrolling

**Files:**
- Modify: `src/components/ConfigDrawer.test.tsx`
- Modify: `src/components/ConfigDrawer.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing Preferences structure test**

```tsx
it("separates the compact header from the scrollable preferences body", () => {
  setup();
  const dialog = screen.getByRole("dialog", { name: "Preferences" });
  expect(dialog.querySelector(":scope > .preferences-header")).toBeInTheDocument();
  const body = dialog.querySelector(":scope > .preferences-body");
  expect(body).toBeInTheDocument();
  expect(body?.querySelector(".preferences-nav")).toBeInTheDocument();
  expect(body?.querySelector(".preferences-content")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: FAIL because `.preferences-body` does not exist.

- [ ] **Step 3: Add the explicit body boundary and grid rows**

Wrap navigation and content:

```tsx
<div className="preferences-body">
  <nav className="preferences-nav" aria-label="Preference categories">...</nav>
  <div className="preferences-content">...</div>
</div>
```

Use the following layout contract in the final workspace visual-system rules:

```css
.preferences-drawer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: start;
}
.preferences-header { min-height: 0; }
.preferences-body {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  min-height: 0;
}
.preferences-content { min-height: 0; overflow-y: auto; }
```

At the existing narrow breakpoint, switch `.preferences-body` to one column and make `.preferences-nav` horizontal. Remove or override earlier conflicting `.preferences-drawer` column rules so one authoritative declaration wins.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
rtk npm test -- src/components/ConfigDrawer.test.tsx
```

Expected: all `ConfigDrawer` tests pass.

- [ ] **Step 5: Commit the Preferences correction**

```bash
rtk git add src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/styles.css
rtk git commit -m "fix: constrain preferences panel layout"
```

### Task 5: Rendered Regression Coverage and Final Verification

**Files:**
- Modify: `scripts/verify-frontend-render.mjs`
- Modify if required by verified contract: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add a failing rendered invariant**

Extend the verifier to assert at desktop and compact viewports that:

```js
await expect(page.locator(".launch-card--recent")).toBeVisible();
await expect(page.locator(".source-slot__identity")).toHaveCount(0);
await expect(page.getByRole("group", { name: "Compare actions" })).toBeVisible();
await expect(page.locator(".preferences-body")).toBeVisible();
```

For View mode, assert:

```js
await expect(page.getByRole("group", { name: "Compare actions" })).toHaveCount(0);
```

- [ ] **Step 2: Run the verifier and confirm RED before final styling adjustments**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: FAIL until the verifier's fixture interactions and final selectors match the repaired UI.

- [ ] **Step 3: Complete fixture interactions and responsive CSS**

Use existing test adapter controls to open Compare, View, and Preferences states. Keep screenshots and temporary Playwright scripts outside the repository. Make only styling adjustments required to eliminate clipping, overlap, or scroll traps at `1280x800`, `1024x640`, and `720x520`.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
rtk npm test
rtk npm run verify:all
rtk git diff --check
```

Expected: 26 test files and all tests pass; build, packaging script invariants, frontend invariants, rendered frontend verification, documentation invariants, and whitespace checks pass.

- [ ] **Step 5: Perform visual QA in the preferred Browser path**

Target flows:

```text
Startup -> inspect Recent Work -> expand history -> reopen affordance is clear.
Compare workspace -> inspect Diff toolbar -> actions stay grouped and readable.
View workspace -> inspect Diff toolbar -> compare-only actions are absent.
Workspace -> open Preferences -> compact header and scrollable content render without a gap.
```

Check page identity, non-blank content, framework overlays, console errors/warnings, target interactions, and screenshots at desktop and compact viewport. If the Browser plugin invocation fails, record the exact reason and use the existing Playwright runtime without adding dependencies.

- [ ] **Step 6: Commit verification coverage**

```bash
rtk git add scripts/verify-frontend-render.mjs docs/ARCHITECTURE.md
rtk git commit -m "test: verify UI follow-up fixes"
```

Omit `docs/ARCHITECTURE.md` from the commit if no architecture contract changed.
