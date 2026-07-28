# Updater Downloading Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep visible, disabled download feedback in the StatusBar while an in-app update is downloading.

**Architecture:** `App` continues to own updater state and maps `downloading` into the existing StatusBar prompt contract. `StatusBar` gains only the type and disabled-action support required to render that state.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- Do not change native updater, manifest, signing, dependency, or progress callback behavior.
- Do not expose a second install action or release fallback while downloading.
- Preserve existing success and failure transitions.

---

### Task 1: Preserve StatusBar Feedback While Downloading

**Files:**
- Modify: `src/App.test.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: existing `AppUpdateState.status === "downloading"` state.
- Produces: `StatusBarUpdatePrompt` support for `status: "downloading"` and `primaryDisabled?: boolean`.

- [ ] **Step 1: Write the failing integration test**

Add a deferred `downloadAndInstallAppUpdate` mock to the existing available
update test. While unresolved, assert that the `Downloading...` button is
visible and disabled. Resolve it to a `readyToRestart` state and assert the
existing completion message.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
rtk npm test -- --run src/App.test.tsx -t "keeps update feedback visible while downloading"
```

Expected: FAIL because no `Downloading...` button exists after App changes the
state to `downloading`.

- [ ] **Step 3: Implement the minimal UI state**

Extend `StatusBarUpdatePrompt.status` with `"downloading"` and add
`primaryDisabled?: boolean`. Render a primary button when it has a label and is
either actionable or explicitly disabled, and pass the flag to the Button.
Map App's `downloading` state to the prompt with message
`Downloading update...`, label `Downloading...`, and `primaryDisabled: true`.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
rtk npm test -- --run src/App.test.tsx src/components/StatusBar.test.tsx src/lib/update-client.test.ts
```

Expected: 90 or more tests pass with zero failures.

- [ ] **Step 5: Run project verification**

Run:

```bash
rtk npm run verify:all
```

Expected: formatting, lint, TypeScript, frontend tests, render checks, branding,
and documentation verification all exit successfully.
