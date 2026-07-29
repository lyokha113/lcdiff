# Cumulative Temp Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-owned temporary archive target to Compare so users can accumulate selected or bulk entry copies from multiple JAR/ZIP sources and export the result with Save As.

**Architecture:** `lcdiff-core` supplies only empty-archive and atomic-export primitives. Tauri stored state owns one `TempMergeSession`, installs its working archive into a normal Compare side, and exposes typed lifecycle/conflict commands. A merge-feature controller and two focused dialogs project that state without creating a fourth workspace mode.

**Tech Stack:** Rust, `zip`, `tempfile`, `lcdiff-core`, Tauri 2 typed commands, React 19, TypeScript, Vitest, Testing Library, existing shadcn/Radix primitives.

## Global Constraints

- Temp merge remains inside Compare; do not add a workspace mode.
- Exactly one temp session may exist.
- The target side is fixed for the session; only the source side is replaceable.
- Source archives are never modified.
- All copied entries use original source bytes.
- Empty targets support only `.jar`, `.zip`, `.war`, and `.ear`.
- Every bulk conflict receives exactly one `overwrite` or `skip` decision before staging.
- Apply is atomic and retains the last good working archive on failure.
- Save As is atomic and does not end the session automatically.
- Entry paths and bytes receive no signature- or content-specific interpretation.
- Temp session state is not persisted across app restart.
- Only app-owned temp directories may be deleted by Discard or cleanup.
- `lcdiff-core` remains Tauri-free.

---

## Planned File Structure

### Create

- `crates/lcdiff-core/src/temp_archive.rs` — valid empty ZIP-compatible creation and atomic export.
- `src-tauri/src/commands/temp_merge.rs` — six typed lifecycle/bulk commands.
- `src/features/merge/temp-merge-types.ts` — frontend-only dialog/controller view models derived from IPC DTOs.
- `src/features/merge/useTempMergeController.ts` — session orchestration and UI intent.
- `src/features/merge/useTempMergeController.test.ts` — controller transitions and retry behavior.
- `src/features/merge/CreateTempTargetDialog.tsx` and test — empty/copy-current choice.
- `src/features/merge/MergeConflictDialog.tsx` and test — per-entry and bulk decisions.
- `scripts/test-temp-merge-smoke.mjs` — native three-source smoke driver or fixture orchestrator.

### Modify

- `crates/lcdiff-core/src/lib.rs`, `crates/lcdiff-core/src/error.rs`, `crates/lcdiff-core/src/merge.rs`, and tests — export primitives through core.
- `src-tauri/src/state.rs` — `TempMergeSession`, guards, create/stage/apply/save/discard methods.
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/ipc_contracts.rs` — register and lock commands/DTOs.
- `src/ipc/types.ts`, `src/ipc/commands.ts`, and tests — exact frontend wire authority.
- `scripts/verify-architecture.mjs` and tests — command allowlist and ownership.
- `src/features/sources/SourceChips.tsx` and test — source/temp roles and create action.
- `src/features/workspace/DiffView.tsx` and test — temp-aware selected/bulk action labels.
- `src/features/shell/MenuBar.tsx`, `src/features/shell/StatusBar.tsx`, and tests — Save As/Discard/session status.
- `src/app/App.tsx` and tests — composition, source replacement, dialogs, close guard.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, and `docs/PLATFORM_VALIDATION.md` — product and proof ladder.

---

### Task 1: Add core empty-archive and atomic-export primitives

**Files:**
- Create: `crates/lcdiff-core/src/temp_archive.rs`
- Modify: `crates/lcdiff-core/src/lib.rs`
- Modify: `crates/lcdiff-core/src/error.rs`
- Modify: `crates/lcdiff-core/src/merge.rs`
- Test: `crates/lcdiff-core/tests/core.rs`

**Interfaces:**
- Produces: `create_empty_archive(path: impl AsRef<Path>) -> Result<()>`.
- Produces: `export_archive_atomic(source: impl AsRef<Path>, destination: impl AsRef<Path>) -> Result<()>`.
- Both functions are filesystem primitives and contain no session logic.

- [ ] **Step 1: Write failing core tests**

```rust
#[test]
fn creates_reopenable_empty_archive_for_supported_extensions() {
    let dir = tempdir().unwrap();
    for extension in ["jar", "zip", "war", "ear"] {
        let path = dir.path().join(format!("empty.{extension}"));
        create_empty_archive(&path).unwrap();
        let archive = Archive::open(path.to_string_lossy()).unwrap();
        assert_eq!(archive.entries().count(), 0);
    }
}

#[test]
fn exports_archive_without_mutating_source() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("source.jar");
    create_zip(&source, &[("a.txt", b"A")]);
    let destination = dir.path().join("output.jar");
    let before = std::fs::read(&source).unwrap();
    export_archive_atomic(&source, &destination).unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), before);
    assert_eq!(std::fs::read(&destination).unwrap(), before);
}
```

- [ ] **Step 2: Run core tests and confirm RED**

Run:

```bash
cargo test -p lcdiff-core creates_reopenable_empty_archive
cargo test -p lcdiff-core exports_archive
```

Expected: FAIL because both functions are undefined.

- [ ] **Step 3: Implement valid empty archive creation**

```rust
pub fn create_empty_archive(path: impl AsRef<Path>) -> Result<()> {
    let path = path.as_ref();
    let file = File::create(path)?;
    ZipWriter::new(file).finish()?;
    Ok(())
}
```

Reject unsupported extensions before creating a file:

```rust
match path.extension().and_then(OsStr::to_str).map(str::to_ascii_lowercase).as_deref() {
    Some("jar" | "zip" | "war" | "ear") => {}
    _ => return Err(Error::UnsupportedTempArchiveExtension(path.to_path_buf())),
}
```

Add the exact error variant in `error.rs`:

```rust
#[error("temporary archive must use .jar, .zip, .war, or .ear: {0}")]
UnsupportedTempArchiveExtension(PathBuf),
```

- [ ] **Step 4: Reuse the existing atomic replacement path for export**

In `merge.rs`, expose a focused wrapper that copies to a sibling temporary file,
flushes it, and calls the same platform-specific atomic replacement used by
commit:

```rust
pub fn export_archive_atomic(source: impl AsRef<Path>, destination: impl AsRef<Path>) -> Result<()> {
    let destination = destination.as_ref();
    let temp_path = temp_path_for(destination);
    let result = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .and_then(|mut output| {
            let mut input = File::open(source.as_ref())?;
            io::copy(&mut input, &mut output)?;
            output.sync_all()
        })
        .map_err(Error::from)
        .and_then(|_| atomic_replace(&temp_path, destination));
    if result.is_err() {
        fs::remove_file(&temp_path).ok();
    }
    result
}
```

- [ ] **Step 5: Run core tests**

Run:

```bash
cargo test -p lcdiff-core temp_archive
cargo test -p lcdiff-core exports_archive
cargo fmt --all -- --check
```

Expected: all pass; existing Windows atomic replacement tests remain green.

- [ ] **Step 6: Commit**

```bash
git add crates/lcdiff-core/src/temp_archive.rs crates/lcdiff-core/src/lib.rs crates/lcdiff-core/src/error.rs crates/lcdiff-core/src/merge.rs crates/lcdiff-core/tests/core.rs
git commit -m "feat: add temporary archive primitives"
```

---

### Task 2: Define temp-session state and lifecycle creation/discard

**Files:**
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces Rust `TempTargetCreation`, `TempMergeSessionSummary`, and internal `TempMergeSession`.
- Produces `AppState::create_temp_target(source_side, creation)`.
- Produces `AppState::discard_temp_target()`.

- [ ] **Step 1: Write failing stored-state tests**

Cover empty, copy-current, one-session guard, target-side immutability, and
discard ownership:

```rust
#[test]
fn copy_current_creates_opposite_temp_target_without_mutating_source() {
    let mut state = state_with_left_archive();
    let source_before = std::fs::read(state.left.as_ref().unwrap().path()).unwrap();
    let summary = state
        .create_temp_target(Side::Left, TempTargetCreation::CopyCurrent)
        .unwrap();
    assert_eq!(summary.target_side, Side::Right);
    assert_eq!(std::fs::read(state.left.as_ref().unwrap().path()).unwrap(), source_before);
    assert_ne!(state.right.as_ref().unwrap().path(), state.left.as_ref().unwrap().path());
    assert!(state.temp_merge_session.is_some());
}
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `cargo test -p lcdiff-desktop temp_target`

Expected: FAIL because session types and methods do not exist.

- [ ] **Step 3: Add exact state types**

```rust
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum TempTargetCreation {
    Empty { extension: String },
    CopyCurrent,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeSessionSummary {
    pub(crate) id: String,
    pub(crate) target_side: Side,
    pub(crate) working_name: String,
    pub(crate) entry_count: usize,
    pub(crate) applied_source_count: usize,
    pub(crate) exported_path: Option<String>,
}

pub(crate) struct TempMergeSession {
    id: String,
    target_side: Side,
    temp_dir: tempfile::TempDir,
    working_path: PathBuf,
    creation: TempTargetCreation,
    applied_source_count: usize,
    exported_path: Option<PathBuf>,
}
```

Add `temp_merge_session: Option<TempMergeSession>` to `AppState`.

- [ ] **Step 4: Implement create and discard**

Creation must:

1. require exactly the declared source side to be loaded;
2. require the opposite side to be empty;
3. require no pending plan;
4. create/copy under a fresh `TempDir`;
5. open the working archive before publishing state; and
6. install it on the opposite side only after every prior operation succeeds.

Discard clears the target plan, removes the target archive/cache, and finally
drops the `TempDir`.

- [ ] **Step 5: Enforce target/source action guards**

Add:

```rust
fn ensure_replaceable_side(&self, side: Side) -> Result<(), String> {
    if self.temp_merge_session.as_ref().is_some_and(|s| s.target_side == side) {
        return Err("temporary merge target cannot be replaced".to_owned());
    }
    Ok(())
}
```

During a temp session, `ensure_can_stage` must reject plans targeting the
replaceable source side, guaranteeing source archives remain untouched.

- [ ] **Step 6: Run state tests**

Run: `cargo test -p lcdiff-desktop temp_target`

Expected: all lifecycle and guard tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: own temporary merge sessions"
```

---

### Task 3: Implement conflict preview and deterministic bulk staging

**Files:**
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `TempMergeConflictPreview { new_entries: Vec<String>, conflicts: Vec<String> }`.
- Produces `TempMergeDecision { entry_path: String, action: TempMergeConflictAction }`.
- Produces `AppState::preview_temp_merge_all(source_side)` and `AppState::stage_temp_merge_all(source_side, decisions)`.

- [ ] **Step 1: Write failing conflict tests**

```rust
#[test]
fn bulk_stage_requires_exactly_one_decision_per_conflict() {
    let mut state = temp_session_with_source_and_target(&[
        ("new.txt", b"new"),
        ("same.txt", b"source"),
    ], &[("same.txt", b"target")]);
    let preview = state.preview_temp_merge_all(Side::Left).unwrap();
    assert_eq!(preview.new_entries, ["new.txt"]);
    assert_eq!(preview.conflicts, ["same.txt"]);
    assert!(state.stage_temp_merge_all(Side::Left, vec![]).is_err());
}
```

Add overwrite and skip byte assertions after Apply in a later helper.

- [ ] **Step 2: Run tests and confirm RED**

Run: `cargo test -p lcdiff-desktop temp_merge_all`

Expected: FAIL because preview and stage methods do not exist.

- [ ] **Step 3: Add wire-safe enums and DTOs**

```rust
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TempMergeConflictAction {
    Overwrite,
    Skip,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TempMergeDecision {
    pub(crate) entry_path: String,
    pub(crate) action: TempMergeConflictAction,
}
```

Sort all returned paths for deterministic UI/tests.

- [ ] **Step 4: Implement pure preview and validated staging**

Filter directory entries. Partition source paths by `target.entry(path)`.
`stage_temp_merge_all` must reject:

- a source side equal to the target side;
- missing, duplicate, or extra conflict decisions;
- decisions for non-conflict paths; and
- any source/target change since preview, by recomputing the conflict set.

Stage new entries and `Overwrite` conflicts with existing
`MergePlan::stage_copy`; omit `Skip`.

- [ ] **Step 5: Run tests**

Run: `cargo test -p lcdiff-desktop temp_merge_all`

Expected: new, overwrite, skip, duplicate-decision, and stale-preview cases pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: stage cumulative merge conflicts"
```

---

### Task 4: Add apply, Save As, discard, and typed command contracts

**Files:**
- Create: `src-tauri/src/commands/temp_merge.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ipc_contracts.rs`
- Modify: `scripts/verify-architecture.mjs`
- Test: `scripts/verify-architecture.test.mjs`

**Interfaces:**
- Produces six commands: `create_temp_target`, `preview_merge_all_conflicts`, `stage_temp_merge_all`, `apply_temp_merge`, `save_temp_target_as`, `discard_temp_target`.
- `apply_temp_merge` returns refreshed `TempMergeSessionSummary`.
- `save_temp_target_as(path)` returns `TempMergeSessionSummary` with `exportedPath`.

- [ ] **Step 1: Write failing Apply/Save As failure-safety tests**

```rust
#[test]
fn failed_export_keeps_session_and_last_good_working_archive() {
    let mut state = applied_temp_session();
    let working_before = state.temp_target_bytes_for_test();
    assert!(state.save_temp_target_as(invalid_destination()).is_err());
    assert!(state.temp_merge_session.is_some());
    assert_eq!(state.temp_target_bytes_for_test(), working_before);
}
```

Add Apply success, Apply atomic failure, and discard cleanup tests.

- [ ] **Step 2: Run tests and confirm RED**

Run: `cargo test -p lcdiff-desktop temp_merge_apply`

Expected: FAIL because lifecycle completion methods are absent.

- [ ] **Step 3: Implement state operations**

`apply_temp_merge` commits only the session target plan with backup disabled and
no signature interpretation, reopens the target, resets its nested cache,
increments `applied_source_count`, and returns a summary.

`save_temp_target_as` calls `export_archive_atomic`, records the canonical
destination only after success, and leaves the session active.

- [ ] **Step 4: Add thin command handlers**

Each blocking file action clones `SharedState` and uses
`tauri::async_runtime::spawn_blocking`, matching existing commit commands.
Commands delegate to state methods and contain no lifecycle rules.

- [ ] **Step 5: Register and lock all six command contracts**

Update:

- `commands/mod.rs` re-exports;
- `lib.rs` handler registration;
- `ipc_contracts.rs` exact source/serialization fixtures;
- `backendCommandNames` and expected-command tests.

Add an architecture mutation fixture proving `commands/temp_merge.rs` cannot
import a sibling command module.

- [ ] **Step 6: Run backend and architecture gates**

Run:

```bash
cargo test -p lcdiff-desktop temp_merge
npm run verify:architecture
cargo fmt --all -- --check
```

Expected: all pass and the handler allowlist includes exactly the six new names.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/temp_merge.rs src-tauri/src/commands/mod.rs src-tauri/src/state.rs src-tauri/src/lib.rs src-tauri/src/ipc_contracts.rs scripts/verify-architecture.mjs scripts/verify-architecture.test.mjs
git commit -m "feat: expose temporary merge lifecycle"
```

---

### Task 5: Add frontend IPC facades and the temp-merge controller

**Files:**
- Modify: `src/ipc/types.ts`
- Modify: `src/ipc/commands.ts`
- Test: `src/ipc/commands.test.ts`
- Create: `src/features/merge/temp-merge-types.ts`
- Create: `src/features/merge/useTempMergeController.ts`
- Create: `src/features/merge/useTempMergeController.test.ts`

**Interfaces:**
- Produces exact TypeScript mirrors of every Rust DTO/enum.
- Produces controller actions `create`, `previewMergeAll`, `stageMergeAll`, `apply`, `saveAs`, and `discard`.
- Produces controller state `session`, `createOpen`, `conflictReview`, `busy`, and `error`.

- [ ] **Step 1: Write failing facade type/call tests**

```ts
await createTempTarget("left", { kind: "copyCurrent" });
expect(invoke).toHaveBeenCalledWith("create_temp_target", {
  sourceSide: "left",
  creation: { kind: "copyCurrent" },
});
```

Cover all six command names and exact camelCase arguments.

- [ ] **Step 2: Run facade tests and confirm RED**

Run: `npm test -- src/ipc/commands.test.ts`

Expected: FAIL because types and wrappers are missing.

- [ ] **Step 3: Add exact IPC types and wrappers**

```ts
export type TempTargetCreation =
  | { kind: "empty"; extension: "jar" | "zip" | "war" | "ear" }
  | { kind: "copyCurrent" };

export type TempMergeConflictAction = "overwrite" | "skip";

export interface TempMergeSessionSummary {
  id: string;
  targetSide: Side;
  workingName: string;
  entryCount: number;
  appliedSourceCount: number;
  exportedPath: string | null;
}
```

Mirror preview and decision DTOs without frontend aliases at the IPC boundary.

- [ ] **Step 4: Write failing controller transition tests**

Mock wrappers and assert:

- create publishes session only on success;
- preview opens conflict state without staging;
- Apply clears conflict state and refreshes session;
- failed Save As keeps session and exposes retry error; and
- discard clears session only after backend success.

- [ ] **Step 5: Implement the minimal controller**

Use one operation at a time:

```ts
async function apply() {
  setBusy("apply");
  try {
    setSession(await applyTempMerge());
    setConflictReview(undefined);
  } catch (error) {
    setError(String(error));
  } finally {
    setBusy(undefined);
  }
}
```

Do not duplicate backend validation in the controller.

- [ ] **Step 6: Run facade/controller tests**

Run:

```bash
npm test -- src/ipc/commands.test.ts src/features/merge/useTempMergeController.test.ts
npm run build
```

Expected: exact calls and controller retry semantics pass.

- [ ] **Step 7: Commit**

```bash
git add src/ipc/types.ts src/ipc/commands.ts src/ipc/commands.test.ts src/features/merge/temp-merge-types.ts src/features/merge/useTempMergeController.ts src/features/merge/useTempMergeController.test.ts
git commit -m "feat: add temporary merge controller"
```

---

### Task 6: Build Create and conflict-review UI

**Files:**
- Create: `src/features/merge/CreateTempTargetDialog.tsx`
- Test: `src/features/merge/CreateTempTargetDialog.test.tsx`
- Create: `src/features/merge/MergeConflictDialog.tsx`
- Test: `src/features/merge/MergeConflictDialog.test.tsx`
- Modify: `src/features/sources/SourceChips.tsx`
- Test: `src/features/sources/SourceChips.test.tsx`
- Modify: `src/features/workspace/DiffView.tsx`
- Test: `src/features/workspace/DiffView.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Create dialog emits `(creation: TempTargetCreation) => void`.
- Conflict dialog emits `(decisions: TempMergeDecision[]) => void`.
- Source chips consume optional `tempSession` and emit `onCreateTempTarget`.

- [ ] **Step 1: Write failing dialog tests**

Assert both creation choices, four extension values, Overwrite all, Skip all,
per-entry changes, and submit disabled until every conflict is resolved.

```ts
await user.click(screen.getByRole("button", { name: "Overwrite all" }));
await user.click(screen.getByRole("button", { name: "Stage merge decisions" }));
expect(onSubmit).toHaveBeenCalledWith([
  { entryPath: "a.txt", action: "overwrite" },
  { entryPath: "b.txt", action: "overwrite" },
]);
```

- [ ] **Step 2: Run component tests and confirm RED**

Run:

```bash
npm test -- src/features/merge/CreateTempTargetDialog.test.tsx src/features/merge/MergeConflictDialog.test.tsx src/features/sources/SourceChips.test.tsx src/features/workspace/DiffView.test.tsx
```

Expected: FAIL because components and props are missing.

- [ ] **Step 3: Implement Create dialog**

Use existing Dialog, Button, and Select primitives. Disable submit until a
choice is selected; require extension only for `empty`.

- [ ] **Step 4: Implement conflict dialog**

Initialize a decision map only for `preview.conflicts`. Bulk actions replace
every value; new entries display as informational and require no decision.
Submit a sorted decision array for deterministic calls.

- [ ] **Step 5: Add temp roles and toolbar actions**

When exactly one archive exists and no session is active, the empty source chip
shows `Create temp target...`.

During a session:

- target chip displays `TEMP TARGET - SESSION ONLY`;
- target Browse/path/drop controls are disabled;
- source chip displays `SOURCE - REPLACEABLE`;
- DiffView shows `Copy selected -> temp` and `Merge all -> temp`.

- [ ] **Step 6: Run component and render tests**

Run:

```bash
npm test -- src/features/merge/CreateTempTargetDialog.test.tsx src/features/merge/MergeConflictDialog.test.tsx src/features/sources/SourceChips.test.tsx src/features/workspace/DiffView.test.tsx
npm run verify:frontend-render
```

Expected: components pass in Light/Dark fixtures without toolbar overflow.

- [ ] **Step 7: Commit**

```bash
git add src/features/merge/CreateTempTargetDialog.tsx src/features/merge/CreateTempTargetDialog.test.tsx src/features/merge/MergeConflictDialog.tsx src/features/merge/MergeConflictDialog.test.tsx src/features/sources/SourceChips.tsx src/features/sources/SourceChips.test.tsx src/features/workspace/DiffView.tsx src/features/workspace/DiffView.test.tsx src/styles.css
git commit -m "feat: add temporary merge dialogs"
```

---

### Task 7: Compose session actions, replacement guards, Save As, and close flow

**Files:**
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`
- Modify: `src/features/shell/MenuBar.tsx`
- Test: `src/features/shell/MenuBar.test.tsx`
- Modify: `src/features/shell/StatusBar.tsx`
- Test: `src/features/shell/StatusBar.test.tsx`
- Modify: `src/features/merge/useMergeController.ts`
- Modify: `src/ipc/platform.ts`
- Test: `src/ipc/platform.test.ts`

**Interfaces:**
- Consumes the temp controller and dialogs from Tasks 5-6.
- Platform dialog returns the Save As destination; backend performs the write.
- Produces `savePathDialog(options?: SaveDialogOptions): Promise<string | null>`.
- Produces staged source-change prompt actions `Apply`, `Discard staged`, and `Cancel`.

- [ ] **Step 1: Write failing end-to-end App tests**

Cover:

1. open left source and create right copy-current target;
2. Merge all -> conflict review -> stage -> Apply;
3. replace left source after Apply while right target stays fixed;
4. staged replacement prompt branches;
5. Save As failure/retry;
6. Discard failure retains session; and
7. close request offers Save As/Discard/Cancel.

- [ ] **Step 2: Run App tests and confirm RED**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because App does not compose temp-session state or actions.

- [ ] **Step 3: Compose the controller and dialogs**

Instantiate `useTempMergeController(setMessage)` once. Pass its session to
SourceChips, DiffView, MenuBar, and StatusBar. Render dialogs from controller
state, with callbacks that invoke controller actions and refresh Compare diff
after successful create/apply/discard.

- [ ] **Step 4: Enforce source/target roles in frontend intent**

Derive:

```ts
const tempTargetSide = tempMerge.session?.targetSide;
const replaceableSourceSide =
  tempTargetSide === "left" ? "right" : tempTargetSide === "right" ? "left" : undefined;
```

Reject target-side Browse, path open, native drop, copy-to-source, and menu
actions before IPC. Backend guards remain authoritative.

- [ ] **Step 5: Add staged Change-source decision flow**

When source replacement is requested with pending target operations, show a
dialog with:

- Apply: await Apply, then continue replacement only on success;
- Discard staged: clear only the target plan, then continue; and
- Cancel: leave both source and staging untouched.

- [ ] **Step 6: Add Save As, Discard, status, and close handling**

Extend the platform adapter:

```ts
import {
  open,
  save,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "@tauri-apps/plugin-dialog";

export function savePathDialog(options?: SaveDialogOptions): Promise<string | null> {
  return save(options);
}
```

Add a facade test proving the options and selected path are forwarded. Use
`savePathDialog` from `src/ipc/platform.ts`. MenuBar exposes `Save temp as`
and `Discard temp`. StatusBar shows target name, applied-source count, staged
count, conflicts, and whether any export exists.

Window close with a session uses the approved three-action dialog rather than
`globalThis.confirm`.

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
npm test -- src/app/App.test.tsx src/features/shell/MenuBar.test.tsx src/features/shell/StatusBar.test.tsx
npm run build
```

Expected: the target survives three source replacements and every failure keeps the documented state.

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/features/shell/MenuBar.tsx src/features/shell/MenuBar.test.tsx src/features/shell/StatusBar.tsx src/features/shell/StatusBar.test.tsx src/features/merge/useMergeController.ts src/ipc/platform.ts src/ipc/platform.test.ts
git commit -m "feat: compose cumulative temp merge"
```

---

### Task 8: Document and prove the complete temp-merge workflow

**Files:**
- Create: `scripts/test-temp-merge-smoke.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/PLATFORM_VALIDATION.md`
- Modify: `scripts/verify-frontend-render.mjs`

**Interfaces:**
- Produces package script `test:temp-merge-smoke`.
- Consumes all previous task interfaces.

- [ ] **Step 1: Add a deterministic three-source smoke fixture**

Create archives:

- seed: `base.txt=A`, `conflict.txt=seed`;
- source two: `selected.txt=B`;
- source three: `conflict.txt=third`, `skipped.txt=third`.

Drive backend commands through the production Tauri state test harness:

```js
assert.deepEqual(readEntry(output, "base.txt"), Buffer.from("A"));
assert.deepEqual(readEntry(output, "selected.txt"), Buffer.from("B"));
assert.deepEqual(readEntry(output, "conflict.txt"), Buffer.from("third"));
assert.equal(hasEntry(output, "skipped.txt"), false);
```

- [ ] **Step 2: Update docs and architecture**

Document:

- Empty versus Copy current;
- fixed temp target and replaceable source;
- conflict review and Apply;
- Save As/Discard lifecycle;
- session-only behavior; and
- pure file/byte semantics.

Update the architecture handler count and ownership map.

- [ ] **Step 3: Extend render checks**

Render fixtures for:

- empty slot `Create temp target...`;
- target/source role labels;
- conflict dialog with bulk actions; and
- Save As/Discard/status controls in Light and Dark themes.

- [ ] **Step 4: Run the complete local proof ladder**

Run:

```bash
npm run verify:all
npm run test:temp-merge-smoke
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: every command exits `0`; the output archive reopens with exact expected bytes.

- [ ] **Step 5: Run sidecar and packaged-launch gates**

Run:

```bash
env -u RUSTC_WRAPPER JAVA_HOME=/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8 PATH="/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin:$PATH" bash scripts/test-sidecar-smoke.sh
npm run tauri -- build --debug
```

Expected: sidecar smoke passes and the packaged desktop launches with the temp workflow available.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-temp-merge-smoke.mjs package.json README.md docs/ARCHITECTURE.md docs/DEVELOPMENT.md docs/PLATFORM_VALIDATION.md scripts/verify-frontend-render.mjs
git commit -m "docs: describe cumulative temp merge"
```
