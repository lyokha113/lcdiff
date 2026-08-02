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

## Fix Round 1 — Integration Race and Recovery Review

### Reviewer findings resolved

- Added one compare-diff generation plus source-generation and temp-ownership
  snapshots. Both successful and failed stale `compute_diff` completions are
  ignored, including the Apply-refresh/source-replacement race.
- Disabled legacy Move hunk UI and native actions for the whole temp-owned
  workspace. Copy, edit, and bulk routes remain target-scoped; no action can
  partially stage the protected source.
- Excluded active, recovering, and not-yet-cleaned temp projections from recent
  Compare history, so the app-owned `workingName` is never persisted as a
  reopenable source.
- Kept the close dialog actionable in recovery with only `Cancel closing` and
  the matching Retry operation. Cancelling downgrades the retained close intent,
  so a later menu retry cannot unexpectedly destroy the window.
- Reserved Save As picker ownership with single-flight and lifecycle generation
  guards. Stale/out-of-order results cannot publish a path into a newer session;
  matching recovery still reuses the exact selected path.
- Routed native and keyboard `file.save` through temp Apply and Retry Apply while
  temp ownership exists, and blocked legacy save during other recovery states.
- Added a synchronous App-call reservation around every temp controller entry
  point. A same-tick native Save or late picker cannot record a false successful
  intent while another controller operation is already active.
- Reworked acceptance fixtures so archive summaries preserve requested paths and
  diff rows depend on the replaceable source. Three distinct replacements are
  rendered for both target sides.

### TDD evidence

RED:

```bash
pnpm vitest run src/app/App.test.tsx
```

Result before production fixes: 131 passed and 9 expected failures. The failures
covered stale diff success/error, history leakage, Move hunk, native Save,
picker single-flight/stale resolution, and close Save recovery/cancel behavior.

GREEN:

```bash
pnpm vitest run src/app/App.test.tsx
```

Result: 142 passed, 0 failed. New coverage also drives native `file.save` through
the same-value Apply recovery path and verifies same-path Save As and Discard
recovery inherited from the original Task 7 suite. Additional review regressions
cover pending-picker close cancellation and native Save racing an in-flight
Save As operation.

### Validation

```bash
pnpm verify:all
```

Result: exit 0. Architecture, TypeScript/Vite build, frontend render, branding,
and docs gates passed; the final full frontend suite passed 41 files and 521
tests.

```bash
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop temp_merge --lib
```

Result: 52 passed, 0 failed.

```bash
git diff --check
```

Result: exit 0.

### Fix-round self-review

- Audited every `refreshDiff` caller and the atomic pair publisher. The same
  generation/ownership predicate guards both success and error publication.
- Verified picker ownership changes synchronously across active session,
  recovery, discard, and a newly created session, including reused session IDs.
- Verified the App call reservation spans controller settlement, rather than
  only picker settlement, so rejected cross-operation calls create no intent.
- Verified window-close Save recovery keeps the selected destination and close
  intent only until the user explicitly cancels closing.
- Kept controller ownership and IPC DTO/command contracts unchanged; fixes are
  limited to App composition and integration fixtures.
- Independent read-only review found no remaining Critical, Important, or Minor
  issues and returned a Ready verdict after the controller-call race fix.
- Confirmed `.github/workflows/windows-release.yml` remains the unrelated,
  pre-existing unstaged modification and is excluded from this fix commit.

### Fix-round concerns

- Native picker/modal interaction remains unit-tested through the platform
  facade; real OS modal behavior is not exercised in jsdom.
- The existing Node local-storage warning and Vite large-chunk advisory remain
  non-failing and unchanged.

## Fix Round 2 — Picker Admission and Recovery Fixtures

### Requirements resolved

- Centralized synchronous temp-controller reservation in
  `reserveTempControllerCall`. Every Create, preview, Apply, Save As, and Discard
  admission invalidates outstanding Save picker ownership before invoking the
  controller. A picker rejection from before a newer Apply or Discard therefore
  cannot publish an error or overwrite the current status.
- Preserved Save As single-flight and recovery semantics: controller reservation
  invalidates only picker ownership, not `tempSavePathRef`, so the exact selected
  destination remains available to matching Save As recovery.
- Made `openLeftAndCreateRightTemp` use backend-realistic archive summaries while
  retaining the suite-wide `sourceKind: file` default for unrelated standalone
  file-merge tests. Requested archive paths continue to flow through `fileSummary`.
- Strengthened App recovery acceptance coverage. Save As now fails twice with the
  identical recovery value before succeeding on the third attempt, reusing one
  selected path and opening the picker exactly once. Discard likewise returns the
  identical retry-only outcome twice before succeeding on the third attempt.

### TDD evidence

RED:

```bash
pnpm vitest run src/app/App.test.tsx
```

Result before the production change: 142 passed and 2 failed. Both failures were
the intended regressions: an old Save picker rejection overwrote the existing
status while a newer Apply or Discard controller call remained pending.

GREEN:

```bash
pnpm vitest run src/app/App.test.tsx
```

Result: 144 passed, 0 failed. The parameterized stale-rejection regression passed
for both Apply and Discard, together with the strengthened repeated Save As and
Discard recovery cases.

### Validation

```bash
pnpm verify:all
```

Result: exit 0. Architecture, TypeScript/Vite build, frontend render, branding,
and docs gates passed; the full frontend suite passed 41 files and 523 tests.

```bash
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop temp_merge --lib
```

Result: 52 passed, 0 failed.

### Fix-round self-review

- Picker invalidation occurs at the authoritative App-side controller reservation,
  closing the pre-render window where `busy` and session identity are not yet
  observable through React state.
- Recovery path reuse remains independent from picker generation and is asserted
  by three identical Save As command paths after one picker selection.
- The test-only archive default is scoped to the temp helper; standalone file
  tests continue to start from `summarySourceKind = "file"` in `beforeEach`.
- `.github/workflows/windows-release.yml` remains the unrelated pre-existing
  unstaged modification and is excluded from this fix commit.

### Fix-round concerns

- Native picker/modal behavior remains represented through the platform facade
  in jsdom rather than a real OS modal.
- The existing Node local-storage, npm config, and Vite large-chunk warnings remain
  non-failing and unchanged.
