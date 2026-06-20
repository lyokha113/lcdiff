# Full UI/UX Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the LDiff frontend hierarchy and visual system around the Compare → inspect → stage → save workflow without changing backend contracts.

**Architecture:** Keep orchestration and backend-facing state in `App.tsx`, while focused presentation components emit existing intents through typed props. Replace the stacked toolbar layout with stable command, source, canvas, context, and status zones. Use Tailwind v4 plus the existing CSS token layer for layout, and GSAP only for startup/workspace entry motion.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Monaco, GSAP, `@gsap/react`, Vitest, Testing Library, Playwright, Tauri v2.

---

## File map

- Modify `package.json` and `package-lock.json`: add GSAP runtime dependencies.
- Keep `src/main.tsx`: Geist variable font is already bundled and imported.
- Create `src/lib/motion.ts`: reduced-motion decision and shared GSAP constants.
- Create `src/lib/motion.test.ts`: deterministic reduced-motion tests.
- Modify `src/components/SplashScreen.tsx` and its test: editorial startup, dense mode grid, recent sessions, GSAP entry.
- Modify `src/components/MenuBar.tsx` and its test: command groups, staged summary, accessible global actions.
- Modify `src/components/SourceChips.tsx` and its test: convert chips into explicit source slots and hide compare-only content in View mode.
- Modify `src/components/WorkspaceTabs.tsx` and its test: navigator hierarchy and Files-owned filter.
- Modify `src/components/SearchBar.tsx`, `src/components/SearchResultsPanel.tsx`, and tests: one contextual search surface.
- Modify `src/components/ConfigDrawer.tsx` and its test: overlay preferences panel with live sections.
- Create `src/components/StatusBar.tsx` and `src/components/StatusBar.test.tsx`: status, background activity, and staged-state summary.
- Modify `src/App.tsx` and `src/App.test.tsx`: integrate stable landmarks and contextual overlays without changing domain state.
- Replace the application-specific portion of `src/styles.css`: new tokens, spacing, responsive behavior, state styling, and motion.
- Modify `scripts/verify-frontend-render.mjs`: assert desktop and compact-height rendering.
- Modify `docs/ARCHITECTURE.md` and `docs/LDIFF_COMPLETION_AUDIT.md`: record the new frontend boundaries and evidence.

### Task 1: Typography and motion foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`
- Create: `src/lib/motion.ts`
- Create: `src/lib/motion.test.ts`

- [ ] **Step 1: Write the failing reduced-motion tests**

```ts
import { describe, expect, it } from "vitest";
import { shouldAnimateUi } from "./motion";

describe("shouldAnimateUi", () => {
  it("disables motion for the saved reduced preference", () => {
    expect(shouldAnimateUi("reduced", false)).toBe(false);
  });

  it("disables motion for an operating-system reduced-motion request", () => {
    expect(shouldAnimateUi("full", true)).toBe(false);
  });

  it("allows motion when both settings allow it", () => {
    expect(shouldAnimateUi("full", false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `rtk npm test -- src/lib/motion.test.ts`

Expected: FAIL because `src/lib/motion.ts` does not exist.

- [ ] **Step 3: Add dependencies and the motion policy**

Run: `rtk npm install gsap @gsap/react`

Create `src/lib/motion.ts`:

```ts
export const motionEase = "power3.out";
export const motionDuration = { fast: 0.18, base: 0.42, slow: 0.72 } as const;

export function shouldAnimateUi(
  preference: "full" | "reduced",
  systemPrefersReducedMotion: boolean,
) {
  return preference === "full" && !systemPrefersReducedMotion;
}
```

Keep the existing `@fontsource-variable/geist` import before `./styles.css` in `src/main.tsx`.

- [ ] **Step 4: Run the test and build**

Run: `rtk npm test -- src/lib/motion.test.ts && rtk npm run build`

Expected: PASS and successful Vite production build.

- [ ] **Step 5: Commit the foundation**

```bash
rtk git add package.json package-lock.json src/lib/motion.ts src/lib/motion.test.ts docs/superpowers/specs/2026-06-20-full-ui-ux-refactor-design.md docs/superpowers/plans/2026-06-20-full-ui-ux-refactor.md
rtk git commit -m "feat: add UI motion and typography foundation"
```

### Task 2: Editorial startup experience

**Files:**
- Modify: `src/components/SplashScreen.tsx`
- Modify: `src/components/SplashScreen.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing startup hierarchy tests**

Add assertions that the page has a `main` landmark, a two-source Compare primary action, a View secondary action, and recent sessions under a named navigation region:

```tsx
expect(screen.getByRole("main", { name: "Start LDiff" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Compare two sources" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Open one source" })).toBeInTheDocument();
expect(screen.getByRole("navigation", { name: "Recent sessions" })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `rtk npm test -- src/components/SplashScreen.test.tsx`

Expected: FAIL on the new landmark and accessible-name assertions.

- [ ] **Step 3: Implement the startup composition**

Refactor `SplashScreen` to use this stable skeleton while retaining the existing history callbacks and time formatting:

```tsx
<main className="launch" aria-label="Start LDiff" ref={rootRef}>
  <header className="launch__identity"><span>LDiff</span><span>Archive diff and merge</span></header>
  <section className="launch__hero">
    <div className="launch__copy">
      <h1>See every change. Move only what belongs.</h1>
      <p>Compare archives and folders, inspect source, stage exact changes, and save deliberately.</p>
    </div>
    <div className="launch__grid">
      <button className="launch-card launch-card--compare" onClick={() => onPickMode("compare")} aria-label="Compare two sources">…</button>
      <button className="launch-card launch-card--view" onClick={() => onPickMode("single")} aria-label="Open one source">…</button>
      <nav className="launch-card launch-card--recent" aria-label="Recent sessions">…</nav>
    </div>
  </section>
</main>
```

Register GSAP with `useGSAP`, scope selectors to `rootRef`, and animate only transform/opacity when `shouldAnimateUi` returns true.

- [ ] **Step 4: Add dense 12-column layout and responsive fallback**

Define `.launch__grid` with 12 columns, dense flow, and two rows; assign Compare `grid-column: span 8; grid-row: span 2`, View and Recent `grid-column: span 4`. Below 760px, stack the three regions and remove fixed row spans.

- [ ] **Step 5: Run component tests and frontend render verification**

Run: `rtk npm test -- src/components/SplashScreen.test.tsx && rtk npm run verify:frontend-render`

Expected: PASS with no page errors.

- [ ] **Step 6: Commit startup**

```bash
rtk git add src/components/SplashScreen.tsx src/components/SplashScreen.test.tsx src/styles.css
rtk git commit -m "feat: redesign LDiff startup experience"
```

### Task 3: Command bar, source rail, and status bar

**Files:**
- Modify: `src/components/MenuBar.tsx`
- Modify: `src/components/MenuBar.test.tsx`
- Modify: `src/components/SourceChips.tsx`
- Modify: `src/components/SourceChips.test.tsx`
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/StatusBar.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing command/source/status tests**

Assert command grouping and View-mode removal of the right source:

```tsx
expect(screen.getByRole("banner", { name: "Workspace commands" })).toBeInTheDocument();
expect(screen.getByRole("group", { name: "Workspace mode" })).toBeInTheDocument();
expect(screen.getByRole("group", { name: "Save changes" })).toBeInTheDocument();
expect(screen.getByRole("region", { name: "Left source" })).toBeInTheDocument();
expect(screen.queryByRole("region", { name: "Right source" })).not.toBeInTheDocument();
```

Create `StatusBar.test.tsx`:

```tsx
render(<StatusBar message="Opened sample.jar" searching={false} pendingCount={2} />);
expect(screen.getByRole("status")).toHaveTextContent("Opened sample.jar");
expect(screen.getByText("2 pending")).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `rtk npm test -- src/components/MenuBar.test.tsx src/components/SourceChips.test.tsx src/components/StatusBar.test.tsx`

Expected: FAIL because the new landmarks and `StatusBar` are absent.

- [ ] **Step 3: Refactor the command bar without changing command callbacks**

Use a named banner with three groups: identity/mode, global tools, staged/save actions. Keep every existing callback and disabled condition. Replace the redundant pending badge with one count inside the save group.

- [ ] **Step 4: Convert source chips to source slots**

Each source becomes a named `section` with side label, basename/path, validation message, Browse file, Browse folder, and replace behavior. Render the right source section only when `mode === "compare"`.

- [ ] **Step 5: Implement `StatusBar`**

```tsx
interface StatusBarProps { message: string; searching: boolean; pendingCount: number; }

export function StatusBar({ message, searching, pendingCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <p role="status" aria-live="polite">{searching ? "Searching sources" : message}</p>
      <span>{pendingCount === 0 ? "No pending changes" : `${pendingCount} pending`}</span>
    </footer>
  );
}
```

- [ ] **Step 6: Run focused tests**

Run: `rtk npm test -- src/components/MenuBar.test.tsx src/components/SourceChips.test.tsx src/components/StatusBar.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit workspace chrome**

```bash
rtk git add src/components/MenuBar.tsx src/components/MenuBar.test.tsx src/components/SourceChips.tsx src/components/SourceChips.test.tsx src/components/StatusBar.tsx src/components/StatusBar.test.tsx src/styles.css
rtk git commit -m "feat: restructure workspace command and source chrome"
```

### Task 4: Contextual search and preferences surfaces

**Files:**
- Modify: `src/components/SearchBar.tsx`
- Modify: `src/components/SearchBar.test.tsx`
- Modify: `src/components/SearchResultsPanel.tsx`
- Modify: `src/components/SearchResultsPanel.test.tsx`
- Modify: `src/components/ConfigDrawer.tsx`
- Modify: `src/components/ConfigDrawer.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing contextual-surface tests**

```tsx
expect(screen.getByRole("search", { name: "Search files" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Close search" })).toBeInTheDocument();
expect(screen.getByRole("dialog", { name: "Preferences" })).toBeInTheDocument();
expect(screen.getByRole("navigation", { name: "Preference categories" })).toBeInTheDocument();
```

Also assert that Save preferences are absent in View mode and that source search remains distinct from in-diff find.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `rtk npm test -- src/components/SearchBar.test.tsx src/components/SearchResultsPanel.test.tsx src/components/ConfigDrawer.test.tsx`

Expected: FAIL on contextual landmarks and close controls.

- [ ] **Step 3: Make search one bounded surface**

Wrap query controls and grouped results in one `role="search"` region whose accessible label is derived from the existing `context`. Keep cancel, clear, source-search inclusion, grouping, result inspection, and line navigation semantics unchanged.

- [ ] **Step 4: Convert preferences into an overlay dialog**

Render `ConfigDrawer` as an accessible non-modal `role="dialog"` panel with a category navigation rail. Preserve all preference state and callbacks. Theme selection uses visual swatches with text labels; editor/search/decompiler/save controls retain their current values and conditions.

- [ ] **Step 5: Run focused tests and render verification**

Run: `rtk npm test -- src/components/SearchBar.test.tsx src/components/SearchResultsPanel.test.tsx src/components/ConfigDrawer.test.tsx && rtk npm run verify:frontend-render`

Expected: PASS and no page errors.

- [ ] **Step 6: Commit contextual surfaces**

```bash
rtk git add src/components/SearchBar.tsx src/components/SearchBar.test.tsx src/components/SearchResultsPanel.tsx src/components/SearchResultsPanel.test.tsx src/components/ConfigDrawer.tsx src/components/ConfigDrawer.test.tsx src/styles.css
rtk git commit -m "feat: redesign search and preferences surfaces"
```

### Task 5: App-shell integration and visual-system replacement

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/WorkspaceTabs.tsx`
- Modify: `src/components/WorkspaceTabs.test.tsx`
- Modify: `src/components/FileTree.tsx`
- Modify: `src/components/DiffView.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing shell landmark and visibility tests**

```tsx
expect(screen.getByRole("main", { name: "Comparison workspace" })).toBeInTheDocument();
expect(screen.getByRole("navigation", { name: "Open files" })).toBeInTheDocument();
expect(screen.getByRole("region", { name: "Workspace canvas" })).toBeInTheDocument();
expect(screen.getByRole("contentinfo")).toBeInTheDocument();
```

Add a View-mode assertion that compare-only copy controls and right-source content are absent, not disabled.

- [ ] **Step 2: Run focused shell tests and verify failure**

Run: `rtk npm test -- src/App.test.tsx src/components/WorkspaceTabs.test.tsx src/components/DiffView.test.tsx src/components/FileTree.test.tsx`

Expected: FAIL on the new landmarks and visibility expectations.

- [ ] **Step 3: Integrate the five-zone shell**

In `App.tsx`, preserve state and callbacks while rendering this hierarchy:

```tsx
<main className="app-shell" aria-label={mode === "compare" ? "Comparison workspace" : "Source workspace"}>
  <a className="skip-link" href="#workspace-canvas">Skip to workspace</a>
  <MenuBar … />
  <SourceChips … />
  <section className="workspace-stage">
    <WorkspaceTabs … />
    <section id="workspace-canvas" className="workspace-canvas" aria-label="Workspace canvas">…</section>
  </section>
  <SearchBar … />
  <ConfigDrawer … />
  <StatusBar message={message} searching={searching} pendingCount={Object.keys(stagedEntries).length} />
</main>
```

Remove the old standalone message and bottom search-results placement.

- [ ] **Step 4: Replace application visual tokens and layout CSS**

Use Geist as `--font-sans`, retain JetBrains Mono, and keep theme variables as the source of truth. Implement stable z-index tokens, a graphite/brass default palette, a dominant canvas, compact command/source rails, overlay context surfaces, focus-visible rings, pressed states, empty states, and narrow/compact-height media queries. Remove decorative uppercase `zone-label` treatment and redundant card borders.

- [ ] **Step 5: Run the complete frontend test suite**

Run: `rtk npm test`

Expected: all Vitest tests pass.

- [ ] **Step 6: Commit shell integration**

```bash
rtk git add src/App.tsx src/App.test.tsx src/components/WorkspaceTabs.tsx src/components/WorkspaceTabs.test.tsx src/components/FileTree.tsx src/components/DiffView.tsx src/styles.css
rtk git commit -m "feat: integrate redesigned LDiff workspace"
```

### Task 6: Verification contracts, documentation, and visual QA

**Files:**
- Modify: `scripts/verify-frontend-render.mjs`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/LDIFF_COMPLETION_AUDIT.md`

- [ ] **Step 1: Extend render verification before implementation**

Add viewport cases for `1280×800`, `1024×640`, and `720×520`. For each case, assert the body has no horizontal overflow and the active primary action or workspace canvas remains visible.

- [ ] **Step 2: Run verification and observe any layout failure**

Run: `rtk npm run verify:frontend-render`

Expected: any overflow or hidden-primary-surface regression fails with the viewport name.

- [ ] **Step 3: Fix only evidence-backed responsive defects**

Adjust the corresponding compact-width or compact-height media rule in `src/styles.css`; do not change backend state or hide required actions.

- [ ] **Step 4: Update architecture and completion evidence**

Document the five frontend zones, contextual search/preferences surfaces, GSAP motion boundary, reduced-motion behavior, and the commands used as evidence. Keep Rust ownership and IPC boundaries unchanged.

- [ ] **Step 5: Run the full local frontend/docs gate**

Run: `rtk npm run verify:all`

Expected: build, packaging-script contracts, frontend invariants, frontend render, and docs verification all pass.

- [ ] **Step 6: Perform browser visual QA**

Inspect startup, Compare, View, Files tree, open diff, search, preferences, pending changes, warning dialogs, `1024×640`, `720×520`, and reduced motion. Capture screenshots for the startup and Compare workspace and correct every visible clipping, overlap, unreadable contrast, or dead-space defect.

- [ ] **Step 7: Commit verification and docs**

```bash
rtk git add scripts/verify-frontend-render.mjs docs/ARCHITECTURE.md docs/LDIFF_COMPLETION_AUDIT.md src/styles.css
rtk git commit -m "test: verify redesigned frontend across viewports"
```

- [ ] **Step 8: Run final repository status and diff checks**

Run: `rtk git status --short && rtk git diff --check`

Expected: clean worktree and no whitespace errors.
