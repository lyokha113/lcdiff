# Task 7 Report — Cumulative Temp-Merge App Composition

## Status

DONE. The existing Task 5 controller remains the sole owner of temp-session,
busy, error, and recovery state. `App` now composes that state with the Task 6
controls, platform Save As dialog, source replacement policy, and window-close
flow.

## Implementation

- Instantiated one `useTempMergeController` and projected its authoritative
  session into `SourceChips`, `DiffView`, `MenuBar`, and `StatusBar`.
- Composed copy-current/empty creation, selected copy, Merge all conflict
  review, staged Apply, Save As, confirmed Discard, and the three-action close
  dialog. Conflict review can be dismissed and reopened without changing the
  controller session.
- Added a typed `savePathDialog` platform facade. The UI forwards the selected
  path to the backend and displays the canonical exported path returned by the
  backend.
- Added source replacement decisions: Apply continues only after controller
  success, Discard staged removes only target-side staged work, and Cancel
  preserves source and staging. Existing open-tab confirmation remains in the
  continuation.
- Protected the owned target from Browse, direct path open, drop, refresh,
  copy/edit/hunk writes, and stale async publications. The replaceable source
  can be changed repeatedly after Apply; both target-side layouts are covered.
- Recovery renders no normal temp session or conflict projection and exposes
  only the matching Retry Apply, Retry Save As, or Retry Discard action.
  Attempt tracking observes awaited controller calls without duplicating its
  lifecycle, handles identical repeated failures, and rejects double-clicks
  while an attempt is still in flight.
- Moved the legacy close guard from `useMergeController` into the App-level
  close composition so there is exactly one native close subscription. Added
  side-scoped staging projection helpers for temp Apply and source-change
  discard.

## TDD Evidence

### RED

Before production composition:

```bash
npm test -- src/app/App.test.tsx src/features/shell/MenuBar.test.tsx src/features/shell/StatusBar.test.tsx src/ipc/platform.test.ts
```

Result: 4 files failed with 14 expected failures and 133 existing tests
passing. App had no Create composition; MenuBar and StatusBar had no temp
session controls/status; the platform Save facade did not exist.

### GREEN

Focused composition and inherited Task 5/6 surfaces:

```bash
npm test -- src/app/App.test.tsx src/features/shell/MenuBar.test.tsx src/features/shell/StatusBar.test.tsx src/ipc/platform.test.ts src/features/merge/useTempMergeController.test.ts src/features/merge/CreateTempTargetDialog.test.tsx src/features/merge/MergeConflictDialog.test.tsx src/features/sources/SourceChips.test.tsx src/features/workspace/DiffView.test.tsx
```

Result before the final additional Apply-recovery regression: 9 files passed,
200 tests passed. The final aggregate run below includes that regression.

App acceptance coverage includes target-left and target-right sessions, three
successive ZIP/JAR source replacements, bulk conflict staging and Apply,
Apply/Discard staged/Cancel source decisions, stale async error suppression,
Save success/cancel/failure, repeated same-value Apply/Save/Discard recovery,
backend-canonical export paths, target drop/navigation guards, and close
Save As/Discard/Cancel behavior.

## Validation

```bash
npm run verify:all
```

Result: exit 0.

- Architecture guard passed.
- Production TypeScript/Vite build passed.
- Full frontend suite passed: 41 files, 509 tests.
- Frontend render, branding, and release-doc gates passed.

```bash
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop temp_merge --lib
```

Result: 52 passed, 0 failed.

```bash
git diff --check
```

Result: exit 0 with no whitespace errors.

## Self-review

- Traced every mutable route independently: path/Browse/drop/refresh,
  selected and bulk copy, text edit, Take all, Move hunk, unstage, menu actions,
  mode/history/OS navigation, and native close.
- Used per-side request generations so a target acquisition invalidates only
  the owned side; normal parallel source refresh remains valid. Success and
  error completions use the same stale/ownership check.
- Kept controller DTOs and backend command spellings unchanged. App intent
  refs retain only UI continuations (source path or close-after-success) and
  completion tokens; they do not own session, busy, error, or recovery state.
- Verified Save As cancel performs no backend mutation, backend export paths
  override dialog paths in status, successful Discard removes only the
  app-owned target projection, and every recovery keeps the matching retry
  reachable.
- Confirmed history/reopen and open-tab confirmation behavior remain intact
  through the full App regression suite.
- Confirmed `.github/workflows/windows-release.yml` is still the unrelated,
  pre-existing worktree modification and is not part of this task.

## Concerns

- Vitest continues to emit the existing Node `--localstorage-file` warning.
- Vite continues to emit the existing large-chunk advisory. Neither warning
  fails its gate.
