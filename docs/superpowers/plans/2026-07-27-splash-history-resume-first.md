# Resume-first Splash History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recent LCDiff sessions the dominant splash-screen action while keeping Compare, View, and Text immediately available as compact secondary actions.

**Architecture:** Keep `App.tsx`, `HistoryEntry`, local storage, and reopen callbacks unchanged. Refactor only `SplashScreen` markup and its dedicated CSS, then extend the existing component and Playwright render contracts so semantic hierarchy, distinct Compare sides, responsive geometry, and direct reopen behavior remain executable requirements.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind v4 global CSS, Playwright frontend render verification, Tauri desktop shell.

## Global Constraints

- Preserve `SplashScreenProps`: `history`, `now`, `onPickMode`, `onOpenEntry`, `onClear`, and `motion`.
- Preserve the `HistoryEntry` type, `lcdiff.history` storage key, 20-entry limit, deduplication, and ordering.
- Show five recent sessions by default; `View all history` expands the stored list and `Show less history` collapses it.
- A recent-session row remains one native button that immediately invokes `onOpenEntry(entry)`.
- Do not add pinning, per-entry deletion, filesystem validation, new history metadata, or a new persistence format.
- Use a warm monochrome canvas, flat near-white surfaces, one-pixel borders, radii no larger than 12 px, muted pastel mode accents, and no gradients or heavy shadows.
- Remove Lucide icons from the splash; use text, CSS primitives, or compact inline SVG primitives only.
- Keep full paths available through native tooltips and accessible row labels when visual text truncates.
- Preserve meaningful DOM order at narrow widths: recent history first, new-task actions second.
- Respect both the `motion="reduced"` prop and the operating-system reduced-motion preference.

---

## File Structure

- `src/components/SplashScreen.tsx` owns splash semantics, history expansion state, source-side rendering, and intent callbacks.
- `src/components/SplashScreen.test.tsx` owns component behavior and accessibility contracts.
- `src/styles.css` owns the resume-first split desk, minimalist visual system, motion, and responsive layout.
- `scripts/verify-frontend-render.mjs` owns real-browser geometry and overflow assertions.
- No new production component or history utility is needed; splitting these small, splash-specific responsibilities would add indirection without creating a reusable boundary.

---

### Task 1: Resume-first Splash Semantics and History Rows

**Files:**
- Modify: `src/components/SplashScreen.test.tsx:9-110`
- Modify: `src/components/SplashScreen.tsx:1-159`

**Interfaces:**
- Consumes: `HistoryEntry { id: string; mode: Mode; paths: string[]; openedAt: number }`, `timeAgo(timestamp, now)`, and the existing `SplashScreenProps`.
- Produces: existing `SplashScreen` export with a `.launch__desk` whose first child is the `Recent sessions` navigation and whose second child is the `Start a new task` region.
- Produces: `.launch-history__source[data-side="left"|"right"|"single"]` elements with child `.launch-history__name` and `.launch-history__path`.

- [ ] **Step 1: Update fixtures and write failing hierarchy/source-side tests**

Change the two-entry fixture to use paths that prove basename and full-path
separation:

```tsx
const history: HistoryEntry[] = [
  {
    id: "k1",
    mode: "compare",
    paths: ["/work/releases/a.jar", "/work/fixes/b.jar"],
    openedAt: NOW - 60_000,
  },
  {
    id: "k2",
    mode: "single",
    paths: ["~/libs/commons.jar"],
    openedAt: NOW - 60_000,
  },
];
```

Replace `presents a task-first startup hierarchy` with:

```tsx
it("presents recent work before secondary new-task actions", () => {
  setup();
  const recent = screen.getByRole("navigation", { name: "Recent sessions" });
  const newTask = screen.getByRole("region", { name: "Start a new task" });

  expect(recent.parentElement).toHaveClass("launch__desk");
  expect(recent.parentElement?.firstElementChild).toBe(recent);
  expect(recent.nextElementSibling).toBe(newTask);
  expect(screen.getByRole("button", { name: "Open Compare mode" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open View mode" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Text mode" })).toBeInTheDocument();
});
```

Replace the combined Compare-entry assertion with:

```tsx
it("renders compare sources as distinct left and right values", () => {
  setup();

  const left = document.querySelector('.launch-history__source[data-side="left"]');
  const right = document.querySelector('.launch-history__source[data-side="right"]');
  expect(left).toHaveTextContent("a.jar");
  expect(left).toHaveTextContent("/work/releases/a.jar");
  expect(left).toHaveAttribute("title", "/work/releases/a.jar");
  expect(right).toHaveTextContent("b.jar");
  expect(right).toHaveTextContent("/work/fixes/b.jar");
  expect(right).toHaveAttribute("title", "/work/fixes/b.jar");
});
```

Update the existing basename/path assertion to target the single source:

```tsx
it("presents a single basename separately from its full path", () => {
  setup();
  const source = document.querySelector('.launch-history__source[data-side="single"]');
  expect(source).toHaveTextContent("commons.jar");
  expect(source).toHaveTextContent("~/libs/commons.jar");
  expect(source).toHaveAttribute("title", "~/libs/commons.jar");
});
```

- [ ] **Step 2: Write failing collapse and accessible-name assertions**

Extend the existing expansion test:

```tsx
it("shows five recent sessions, expands, and collapses the stored list", async () => {
  setup({ history: sixHistoryEntries });
  expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);

  await userEvent.click(screen.getByRole("button", { name: "View all history" }));
  expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(6);

  await userEvent.click(screen.getByRole("button", { name: "Show less history" }));
  expect(screen.getAllByRole("button", { name: /reopen/i })).toHaveLength(5);
});
```

Add:

```tsx
it("includes mode and both source names in a compare row accessible name", () => {
  setup();
  expect(
    screen.getByRole("button", { name: "Reopen Compare a.jar and b.jar" }),
  ).toBeInTheDocument();
});
```

Keep the existing mode callback, direct reopen, clear callback, and empty-state
tests. Update the direct-reopen query to:

```tsx
await userEvent.click(
  screen.getByRole("button", { name: "Reopen View commons.jar" }),
);
```

- [ ] **Step 3: Run the component test and verify the new contract fails**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx
```

Expected: FAIL because `Start a new task`, `.launch__desk`, and distinct
`data-side` source elements do not exist; the current combined Compare row also
cannot satisfy the exact accessible-name assertion.

- [ ] **Step 4: Replace the splash component with the minimal semantic implementation**

Remove the Lucide import and keep only:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { HistoryEntry, Mode } from "@/lib/history";
```

Add these local helpers below `basename`:

```tsx
function modeLabel(mode: Mode) {
  if (mode === "compare") return "Compare";
  if (mode === "text") return "Text";
  return "View";
}

function reopenLabel(entry: HistoryEntry) {
  return `Reopen ${modeLabel(entry.mode)} ${entry.paths.map(basename).join(" and ")}`;
}
```

Keep `historyExpanded` and `visibleHistory`. Replace the content between the
identity header and footer with this structure:

```tsx
<section className="launch__content" aria-labelledby="launch-title">
  <div className="launch__copy">
    <p className="launch__kicker">Local archive workspace</p>
    <h1 id="launch-title">
      {history.length > 0
        ? "Continue where you left off."
        : "Start a precise inspection."}
    </h1>
    <p className="launch__intro">
      Reopen recent work, or choose a focused task for JARs, ZIPs, folders, and text.
    </p>
  </div>

  <div className="launch__desk">
    <nav className="launch-recent" aria-label="Recent sessions">
      <div className="launch-recent__header">
        <div>
          <span className="launch-recent__eyebrow">Recent work</span>
          <strong>{history.length} {history.length === 1 ? "session" : "sessions"}</strong>
        </div>
        <div className="launch-recent__actions">
          {history.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryExpanded((expanded) => !expanded)}
            >
              {historyExpanded ? "Show less history" : "View all history"}
            </Button>
          )}
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear history
            </Button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div className="launch-recent__empty">
          <strong>No recent sessions yet.</strong>
          <span>History appears after you open a source.</span>
        </div>
      ) : (
        <ul className="launch-history">
          {visibleHistory.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-label={reopenLabel(entry)}
                onClick={() => onOpenEntry(entry)}
              >
                <span
                  className="launch-history__mode"
                  data-mode={entry.mode}
                >
                  {modeLabel(entry.mode)}
                </span>
                <span className="launch-history__sources">
                  {entry.paths.map((path, index) => (
                    <span
                      className="launch-history__source"
                      data-side={
                        entry.mode === "compare"
                          ? index === 0 ? "left" : "right"
                          : "single"
                      }
                      title={path}
                      key={`${entry.id}-${index}`}
                    >
                      <span className="launch-history__name">{basename(path)}</span>
                      <span className="launch-history__path">{path}</span>
                    </span>
                  ))}
                </span>
                <span className="launch-history__meta">
                  <time dateTime={new Date(entry.openedAt).toISOString()}>
                    {timeAgo(entry.openedAt, now)}
                  </time>
                  <span aria-hidden="true">Reopen</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>

    <section className="launch-new-task" aria-label="Start a new task">
      <span className="launch-new-task__eyebrow">New task</span>
      {([
        ["compare", "Compare", "Open two sources"],
        ["single", "View", "Inspect one source"],
        ["text", "Text", "Compare two drafts"],
      ] as const).map(([mode, title, description]) => (
        <button
          type="button"
          className="launch-mode"
          onClick={() => onPickMode(mode)}
          aria-label={`Open ${title} mode`}
          key={mode}
        >
          <span className="launch-mode__index" aria-hidden="true">
            {mode === "compare" ? "01" : mode === "single" ? "02" : "03"}
          </span>
          <span className="launch-mode__copy">
            <strong className="launch-card__title">{title}</strong>
            <span>{description}</span>
          </span>
          <span className="launch-mode__arrow" aria-hidden="true">↗</span>
        </button>
      ))}
    </section>
  </div>
</section>
```

Do not change the identity header, footer copy, prop types, callbacks, or history
slice logic.

- [ ] **Step 5: Run the component test and verify it passes**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx
```

Expected: PASS with all SplashScreen tests green and no React accessibility or
key warnings.

- [ ] **Step 6: Run the complete unit-test suite**

Run:

```bash
rtk npm test
```

Expected: PASS with zero failed test files and zero failed tests.

- [ ] **Step 7: Commit semantic behavior**

```bash
rtk git add src/components/SplashScreen.tsx src/components/SplashScreen.test.tsx
rtk git diff --cached --check
rtk git commit -m "feat: make splash history resume-first"
```

---

### Task 2: Minimalist Split-desk Styling and Browser Geometry Contract

**Files:**
- Modify: `scripts/verify-frontend-render.mjs:185-203`
- Modify: `src/styles.css:1578-1796`

**Interfaces:**
- Consumes: `.launch__content`, `.launch__desk`, `.launch-recent`, `.launch-new-task`, `.launch-history`, and `.launch-mode` markup from Task 1.
- Produces: wide geometry where the recent panel is more than twice the width of the new-task column.
- Produces: narrow geometry where recent history precedes the new-task section vertically with no horizontal overflow.

- [ ] **Step 1: Add failing wide and narrow geometry assertions**

After waiting for `.launch-recent`, insert:

```js
  const recentPanel = page.locator(".launch-recent");
  const newTaskPanel = page.locator(".launch-new-task");
  const [wideRecentBox, wideNewTaskBox] = await Promise.all([
    recentPanel.boundingBox(),
    newTaskPanel.boundingBox(),
  ]);
  if (!wideRecentBox || !wideNewTaskBox) {
    throw new Error("resume-first splash geometry is unavailable");
  }
  if (wideRecentBox.width <= wideNewTaskBox.width * 2) {
    throw new Error(
      `recent history is not dominant: recent=${formatBox(wideRecentBox)}, newTask=${formatBox(wideNewTaskBox)}`,
    );
  }

  await page.setViewportSize({ width: 700, height: 900 });
  const narrowMetrics = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  const [narrowRecentBox, narrowNewTaskBox] = await Promise.all([
    recentPanel.boundingBox(),
    newTaskPanel.boundingBox(),
  ]);
  if (narrowMetrics.bodyWidth > narrowMetrics.viewportWidth + 1) {
    throw new Error(
      `resume-first splash overflows horizontally: body=${narrowMetrics.bodyWidth}, viewport=${narrowMetrics.viewportWidth}`,
    );
  }
  if (
    !narrowRecentBox ||
    !narrowNewTaskBox ||
    narrowRecentBox.y >= narrowNewTaskBox.y
  ) {
    throw new Error("recent history does not precede new-task actions at narrow width");
  }
  await page.setViewportSize({ width: 1280, height: 720 });
```

Update the existing selector from `.launch-card--recent` to `.launch-recent`.
Keep the exact five-row collapse and six-row expansion assertions.

- [ ] **Step 2: Run the browser render gate and verify it fails**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: FAIL because the existing launch CSS does not define the new
resume-first grid geometry and still targets the removed `.launch-card--recent`
and three-card layout.

- [ ] **Step 3: Replace the obsolete splash CSS with the minimalist visual system**

Delete the legacy `.splash*` rules and the current launch block from
`.launch` through the launch-specific `@media (max-height: 680px)` rule. Add
these exact design tokens and structural rules:

```css
.launch {
  --launch-canvas: #f7f6f3;
  --launch-surface: #ffffff;
  --launch-surface-muted: #fbfbfa;
  --launch-text: #2f3437;
  --launch-muted: #787774;
  --launch-line: #eaeaea;
  --launch-blue-bg: #e1f3fe;
  --launch-blue-text: #1f6c9f;
  --launch-green-bg: #edf3ec;
  --launch-green-text: #346538;
  --launch-yellow-bg: #fbf3db;
  --launch-yellow-text: #956400;
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: clamp(1.5rem, 4vh, 3.5rem);
  width: 100%;
  min-height: 100dvh;
  padding: clamp(1.25rem, 3vw, 3rem);
  overflow-x: hidden;
  background: var(--launch-canvas);
  color: var(--launch-text);
}

.launch::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  pointer-events: none;
  opacity: 0.24;
  inset-block-end: 28%;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M0 0H32M0 0V32' fill='none' stroke='%232f3437' stroke-opacity='.14'/%3E%3C/svg%3E");
  background-size: 32px 32px;
}

.launch__identity,
.launch__content,
.launch__footer {
  width: min(100%, 78rem);
  margin-inline: auto;
}

.launch__identity,
.launch__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 0 1rem;
  border-bottom: 1px solid var(--launch-line);
}

.launch__wordmark {
  color: var(--launch-text);
  font-family: "Bricolage Grotesque Variable", var(--font-sans);
  font-size: 1.25rem;
  font-weight: 720;
  letter-spacing: -0.045em;
}

.launch__descriptor,
.launch__footer {
  color: var(--launch-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.launch__content {
  align-self: center;
  display: grid;
  gap: clamp(1.5rem, 3vh, 2.5rem);
}

.launch__copy { max-width: 44rem; }
.launch__kicker,
.launch-recent__eyebrow,
.launch-new-task__eyebrow {
  color: var(--launch-muted);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.launch h1 {
  margin: 0.55rem 0 0;
  color: var(--launch-text);
  font-family: "Bricolage Grotesque Variable", var(--font-sans);
  font-size: clamp(2.35rem, 5vw, 4.5rem);
  font-weight: 620;
  letter-spacing: -0.06em;
  line-height: 0.98;
}

.launch__intro {
  max-width: 38rem;
  margin: 0.9rem 0 0;
  color: var(--launch-muted);
  font-size: 0.92rem;
  line-height: 1.6;
}

.launch__desk {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(12rem, 1fr);
  align-items: stretch;
  gap: 0.75rem;
}

.launch-recent,
.launch-new-task {
  min-width: 0;
  border: 1px solid var(--launch-line);
  border-radius: 12px;
  background: var(--launch-surface);
}

.launch-recent { overflow: hidden; }
.launch-recent__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 4.2rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--launch-line);
}
.launch-recent__header > div:first-child { display: grid; gap: 0.25rem; }
.launch-recent__header strong { font-size: 0.82rem; font-weight: 620; }
.launch-recent__actions { display: flex; align-items: center; gap: 0.25rem; }
.launch-recent__actions button { color: var(--launch-muted); }
.launch-recent__actions button:hover { background: var(--launch-surface-muted); color: var(--launch-text); }

.launch-recent__empty {
  display: grid;
  align-content: center;
  gap: 0.35rem;
  min-height: 14rem;
  padding: 2rem;
  color: var(--launch-muted);
}
.launch-recent__empty strong { color: var(--launch-text); font-size: 1rem; }
.launch-recent__empty span { font-size: 0.8rem; }

.launch-history {
  max-height: min(22rem, 42vh);
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.launch-history li + li { border-top: 1px solid var(--launch-line); }
.launch-history button {
  display: grid;
  grid-template-columns: 4.7rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  width: 100%;
  min-height: 4.35rem;
  padding: 0.65rem 1rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--launch-text);
  text-align: left;
  transition: background-color 180ms ease, transform 180ms ease;
}
.launch-history button:hover { background: var(--launch-surface-muted); }
.launch-history button:active { transform: scale(0.995); }
.launch-history button:focus-visible,
.launch-mode:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--launch-text);
  outline-offset: -3px;
}
.launch-history__mode {
  justify-self: start;
  padding: 0.3rem 0.45rem;
  border-radius: 999px;
  background: var(--launch-yellow-bg);
  color: var(--launch-yellow-text);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.launch-history__mode[data-mode="single"] {
  background: var(--launch-blue-bg);
  color: var(--launch-blue-text);
}
.launch-history__mode[data-mode="text"] {
  background: var(--launch-green-bg);
  color: var(--launch-green-text);
}
.launch-history__sources { display: grid; gap: 0.35rem; min-width: 0; }
.launch-history__source {
  display: grid;
  grid-template-columns: minmax(7rem, 0.7fr) minmax(0, 1.3fr);
  align-items: baseline;
  gap: 0.65rem;
  min-width: 0;
}
.launch-history__name,
.launch-history__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.launch-history__name { font-size: 0.78rem; font-weight: 630; }
.launch-history__path {
  color: var(--launch-muted);
  font-family: var(--font-mono);
  font-size: 0.61rem;
}
.launch-history__meta {
  display: grid;
  justify-items: end;
  gap: 0.2rem;
  color: var(--launch-muted);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  white-space: nowrap;
}
.launch-history__meta span { color: var(--launch-text); font-weight: 650; }

.launch-new-task {
  display: grid;
  grid-template-rows: auto repeat(3, 1fr);
  padding: 0.8rem;
}
.launch-new-task__eyebrow { padding: 0.2rem 0.25rem 0.75rem; }
.launch-mode {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0.25rem;
  border: 0;
  border-top: 1px solid var(--launch-line);
  border-radius: 0;
  background: transparent;
  color: var(--launch-text);
  text-align: left;
  transition: background-color 180ms ease, transform 180ms ease;
}
.launch-mode:hover { background: var(--launch-surface-muted); }
.launch-mode:active { transform: scale(0.98); }
.launch-mode__index { color: var(--launch-muted); font: 0.58rem var(--font-mono); }
.launch-mode__copy { display: grid; gap: 0.22rem; min-width: 0; }
.launch-card__title { font-size: 0.95rem; font-weight: 650; letter-spacing: -0.025em; }
.launch-mode__copy > span { color: var(--launch-muted); font-size: 0.68rem; }
.launch-mode__arrow { color: var(--launch-muted); font-size: 0.9rem; }

.launch__footer {
  padding-block: 1rem 0;
  border-top: 1px solid var(--launch-line);
  border-bottom: 0;
}
```

Add these responsive and motion rules:

```css
@media (max-width: 760px) {
  .launch { gap: 1.25rem; padding: 1rem; }
  .launch__descriptor { display: none; }
  .launch__desk { grid-template-columns: 1fr; }
  .launch-new-task {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: auto auto;
  }
  .launch-new-task__eyebrow { grid-column: 1 / -1; }
  .launch-mode {
    grid-template-columns: auto minmax(0, 1fr);
    align-content: start;
  }
  .launch-mode + .launch-mode { border-left: 1px solid var(--launch-line); }
  .launch-mode__arrow { display: none; }
  .launch-history__source { grid-template-columns: 1fr; gap: 0.12rem; }
}

@media (max-width: 520px) {
  .launch-recent__header { align-items: flex-start; flex-direction: column; }
  .launch-recent__actions { width: 100%; justify-content: space-between; }
  .launch-history button { grid-template-columns: 4.25rem minmax(0, 1fr); }
  .launch-history__meta { display: none; }
  .launch-new-task { grid-template-columns: 1fr; grid-template-rows: auto; }
  .launch-new-task__eyebrow { grid-column: auto; }
  .launch-mode + .launch-mode { border-left: 0; }
  .launch__footer { align-items: flex-start; flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .launch,
  .launch * {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}

.launch[data-motion="reduced"] * {
  animation: none !important;
  transition-duration: 0.01ms !important;
}
```

Do not introduce launch-specific gradients, box shadows, Lucide selectors, or
rules for the removed `.launch__grid`, `.launch-card--recent`,
`.launch-card__icon`, and `.launch-card__arrow` elements.

- [ ] **Step 4: Run the browser render gate and verify it passes**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS, including five collapsed rows, six expanded rows, dominant wide
history geometry, narrow history-first stacking, and zero horizontal overflow.

- [ ] **Step 5: Run component tests and production build**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx
rtk npm run build
```

Expected: both commands exit 0; the SplashScreen test file has zero failures and
TypeScript/Vite complete the production build.

- [ ] **Step 6: Launch and visually inspect the desktop app**

Run:

```bash
rtk npm run tauri dev
```

In the launched desktop window, verify:

- Populated history is visible without scrolling at a normal desktop window
  size.
- The history panel is visually dominant and all row labels remain legible.
- Compare left and right sources are visually distinct.
- Whole-row hover, keyboard focus, and click reopen behavior are evident.
- Resize below 760 px: history remains first and the mode actions move below it
  without horizontal scrolling.
- With reduced motion enabled in app preferences or the operating system,
  nonessential launch animation is suppressed.

Do not clear the user's real desktop history for visual QA. The component
empty-state test covers that state without mutating local application data.

Stop the dev process after inspection with `Ctrl+C`.

- [ ] **Step 7: Run the complete verification ladder**

Run:

```bash
rtk npm run verify:all
rtk git diff --check
rtk git status --short
```

Expected: build, all Vitest files, frontend render, branding, and docs checks
pass; `git diff --check` is silent; only the intended splash CSS and frontend
render script are uncommitted.

- [ ] **Step 8: Commit styling and browser contract**

```bash
rtk git add src/styles.css scripts/verify-frontend-render.mjs
rtk git diff --cached --check
rtk git commit -m "style: clarify splash session history"
```

---

## Final Review Checklist

- Re-read `docs/superpowers/specs/2026-07-27-splash-history-resume-first-design.md`.
- Confirm every approved requirement maps to Task 1 or Task 2.
- Confirm no storage, IPC, workspace, or `App.tsx` changes entered the diff.
- Confirm the final two implementation commits contain only the paths listed in
  their tasks.
- Run `rtk git status --short` and report any pre-existing or unrelated changes
  without staging them.
