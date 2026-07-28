# LCDiff Architecture Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize LCDiff into explicit Tauri composition, state, command, event, typed IPC, and frontend feature boundaries without changing product behavior or serialized contracts.

**Architecture:** Keep `lcdiff-core` as the existing Tauri-free domain crate and retain one `Arc<Mutex<AppState>>` while extracting desktop composition and workflow modules. Move all frontend Tauri APIs behind `src/ipc`, split exact wire DTOs from feature view models, then move UI ownership by LCDiff workflow while preserving one root composer.

**Tech Stack:** Tauri 2.11, Rust edition 2024, React 19, TypeScript 5.9, Vite 8, Vitest 3, Monaco 0.52, Java 17, Maven, npm.

## Global Constraints

- Source design: `docs/superpowers/specs/2026-07-28-lcdiff-architecture-standardization-design.md`.
- Preserve all 30 command names, four event names, Tauri argument names, Serde field/enum casing, null/omission behavior, existing error strings, and handler order.
- Preserve one `Arc<Mutex<AppState>>` until the completed refactor proves a narrower locking model separately.
- Preserve nested `!/` resolution, per-source cache ownership/reset, staged original bytes, atomic replacement, optional backups, signed-save confirmation, and backend editability authority.
- Preserve Java 17 resource lookup, length-prefixed JSON protocol, 30-second timeout, one restart/retry, 128 MiB shared cache, warm start, and interactive/prefetch/deep-search worker separation.
- Preserve menu IDs/accelerators, platform close policy, startup arguments, single-instance handoff, macOS `RunEvent::Opened`, and pending-open queue order.
- Preserve Monaco models/workers/tab LRU, the `editStageGenerationRef` staging guard, system-font fallback/remeasure, updater behavior, rendered UI, and all persistence keys.
- Use Java 17 and Node on `PATH`. Run Rust gates with `env -u RUSTC_WRAPPER`.
- Do not commit, push, merge, or tag unless the user explicitly requests it in a later task.

---

## Target File Ownership

### Tauri adapter

```text
src-tauri/src/main.rs                  calls lcdiff_desktop::run()
src-tauri/src/lib.rs                   plugins, setup, state management, handlers, run loop
src-tauri/src/state.rs                 stored AppState and lifecycle invariants
src-tauri/src/events.rs                event constants, payloads and emit helpers
src-tauri/src/menu.rs                  menu/open-with parsing and platform forwarding
src-tauri/src/commands/mod.rs          private modules and handler re-exports
src-tauri/src/commands/app.rs          validate_path, platform_hints, pending_open_paths, list_system_fonts
src-tauri/src/commands/archive.rs      archive/diff/nested/View-source lifecycle
src-tauri/src/commands/preview.rs      entry reads, engine selection and disassembly
src-tauri/src/commands/merge.rs        stage/unstage/commit workflows
src-tauri/src/commands/search.rs       T2/T3 search, cancellation and prefetch
src-tauri/src/sidecar_process.rs       unchanged JVM process/cache adapter
src-tauri/src/system_fonts.rs          blocking native font implementation
```

### Frontend

```text
src/app/App.tsx                        composition root
src/ipc/types.ts                       exact command/event wire DTOs
src/ipc/commands.ts                    typed invoke wrappers
src/ipc/events.ts                      typed subscriptions
src/ipc/platform.ts                    dialog/window/asset wrappers
src/ipc/updater.ts                     updater/process/opener wrappers
src/features/shell/                    navigation, splash, onboarding, actions, status
src/features/sources/                  source inputs, View state/tabs and file tree
src/features/workspace/                Monaco runtime, editor types, tabs and DiffView
src/features/free-text/                drafts, readonly results and temporary history
src/features/search/                   search controls/results/state
src/features/merge/                    staging UI and signed-save confirmation
src/features/preferences/              preferences, fonts and update UI
src/components/ui/                     shared shadcn/Radix primitives only
src/lib/                               pure React/Monaco/Tauri-free utilities
```

---

### Task 1: Lock backend and wire contracts, then establish the Phase-1 guard

**Files:**
- Create: `scripts/verify-architecture.mjs`
- Create: `scripts/verify-architecture.test.mjs`
- Create: `src-tauri/src/ipc_contracts.rs` as a test-only child module
- Modify: `src-tauri/src/main.rs` to include the test-only module; move the declaration to `lib.rs` in Task 2
- Modify: `package.json`
- Test: existing `src-tauri/src/main.rs` tests

**Interfaces:**
- Produces: `npm run verify:architecture`.
- Produces: serialization fixtures for exact command names, event names, DTO keys, enum spelling, and null/omission behavior.
- Produces: Phase-1 guard rules only: thin `main.rs` and no Tauri dependency in `lcdiff-core`.

- [ ] **Step 1: Write failing architecture-guard tests**

Add test fixtures that feed representative source strings to the guard and assert independent failures for:

```text
src-tauri/src/main.rs contains struct AppState
src-tauri/src/main.rs contains #[tauri::command]
src-tauri/src/main.rs contains .emit(
crates/lcdiff-core/Cargo.toml contains tauri dependency
```

- [ ] **Step 2: Run the focused guard test and verify RED**

Run:

```bash
node --test scripts/verify-architecture.test.mjs
```

Expected: failure because `scripts/verify-architecture.mjs` does not exist.

- [ ] **Step 3: Implement only the Phase-1 guard rules**

The script must inspect tracked source, report every violation in one run, and keep its rule definitions independently testable. Do not add raw frontend-Tauri or feature rules yet.

- [ ] **Step 4: Run the guard against the current tree and capture expected RED**

Run:

```bash
npm run verify:architecture
```

Expected: failures for state, commands, and event emission still owned by `src-tauri/src/main.rs`; the `lcdiff-core` dependency rule passes.

- [ ] **Step 5: Add Rust IPC contract tests**

Test exact serialization for:

```text
Side, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind, ArchiveSummary, ViewSourceSummary,
EntryPreview, PlatformHints, CommitResult, SearchHit, SearchProgress,
DeepSearchMatch, OsOpenPathsPayload, AppActionPayload, SystemFont, PairStatus
```

Assertions must distinguish required values, explicit `null`, and omitted `SearchHit.line`/`preview`. Add an exact allowlist containing all 30 command names and all four event names.

- [ ] **Step 6: Run the behavior-lock tests**

Run:

```bash
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop ipc_contracts
node --test scripts/verify-architecture.test.mjs
```

Expected: contract tests and guard-unit tests pass; the repository guard itself remains intentionally red until Task 2.

---

### Task 2: Extract desktop composition, stored state, menu, and events

**Files:**
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/state.rs`
- Create: `src-tauri/src/events.rs`
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml` only if Cargo requires explicit library metadata
- Modify: `scripts/verify-architecture.mjs`
- Test: module-local tests moved from `src-tauri/src/main.rs`

**Interfaces:**
- Produces: `pub fn run()` in the `lcdiff_desktop` library crate.
- Produces: `pub(crate) type SharedState = Arc<Mutex<AppState>>`.
- Produces: event constants `SEARCH_PROGRESS`, `SEARCH_RESULT`, `OS_OPEN_PATHS`, and `APP_ACTION`.
- Produces: menu/open helpers that store paths before emitting them.
- Preserves: the existing single mutex and all `AppState` fields.

- [ ] **Step 1: Write focused extraction tests before moving code**

Lock these behaviors:

```text
AppState::new creates three SidecarClient workers sharing one cache
left/right/View nested caches reset on source replacement or successful commit
pending paths are drained with std::mem::take
store_and_emit_open_paths stores before emitting
menu action IDs, accelerators, order and close-window policy remain exact
```

- [ ] **Step 2: Run the focused tests before extraction**

Run:

```bash
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop app_state
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop menu_
```

Expected: existing tests pass and form the pre-move baseline.

- [ ] **Step 3: Create the composition root**

Move the builder, plugins, setup, managed state, unchanged handler list, menu callback, build, and run loop into `lib.rs`. Reduce `main.rs` to:

```rust
fn main() {
    lcdiff_desktop::run();
}
```

- [ ] **Step 4: Move stored state without redesigning locking**

Move all existing `AppState` fields, `ViewSourceState`, snapshots, pending-path queue, cache-reset helpers, and construction to `state.rs`. Keep state-backed lifecycle invariants there. Workflow orchestration for open/read/search/stage/commit is moved in Task 3.

- [ ] **Step 5: Move event and native integration ownership**

Move payloads/constants and emission helpers to `events.rs`. Move menu construction, action catalog, argument parsing, startup paths, single-instance forwarding, and macOS open handling to `menu.rs`. `menu.rs` calls `events.rs`; `events.rs` does not import `menu.rs`.

- [ ] **Step 6: Run Phase-1 GREEN gates**

Run:

```bash
npm run verify:architecture
node --test scripts/verify-architecture.test.mjs
env -u RUSTC_WRAPPER cargo fmt --all -- --check
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop
env -u RUSTC_WRAPPER cargo clippy -p lcdiff-desktop --all-targets -- -D warnings
```

Expected: all pass. No frontend boundary rule exists yet, so current raw frontend Tauri imports do not make this phase red.

- [ ] **Step 7: Run native integration smoke**

Build and launch a debug app with assembled Java 17 resources. Verify one menu action and one OS-open path reach the existing frontend event handlers.

---

### Task 3: Extract workflow command modules and extend the backend guard

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/app.rs`
- Create: `src-tauri/src/commands/archive.rs`
- Create: `src-tauri/src/commands/preview.rs`
- Create: `src-tauri/src/commands/merge.rs`
- Create: `src-tauri/src/commands/search.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/system_fonts.rs`
- Modify: `scripts/verify-architecture.mjs`
- Modify: `scripts/verify-architecture.test.mjs`

**Interfaces:**
- `commands/app.rs`: `validate_path`, `platform_hints`, `pending_open_paths`, `list_system_fonts`.
- `commands/archive.rs`: `open_archive`, `compute_diff`, `compute_nested_diff`, `open_view_source`, `list_view_sources`, `compute_view_nested_entries`, `close_view_source`.
- `commands/preview.rs`: `read_entry`, `read_view_entry`, `set_engine`, `disassemble`, `disassemble_view_entry`.
- `commands/merge.rs`: `stage_copy`, `stage_write`, `stage_view_write`, `unstage_view_write`, `commit_view`, `commit_merge`, `clear_staged`, `unstage`.
- `commands/search.rs`: `search`, `search_view_source`, `deep_search`, `deep_search_view_source`, `cancel_deep_search`, `prefetch_siblings`.

- [ ] **Step 1: Extend guard-unit tests and verify RED**

Add failures for imports from `commands` inside `state.rs`, `events.rs`, `menu.rs`, `sidecar_process.rs`, or `system_fonts.rs`; add exact backend command/event allowlist checks.

Run:

```bash
node --test scripts/verify-architecture.test.mjs
```

Expected: new tests fail until the guard implements the Phase-2 rules.

- [ ] **Step 2: Implement Phase-2 guard rules**

Run the guard against the pre-extraction tree and record that command ownership is red while event allowlists remain exact.

- [ ] **Step 3: Move commands with unchanged signatures**

Move annotations, arguments, async/sync status, `spawn_blocking` boundaries, result types, and error mappings unchanged. `commands/app.rs::list_system_fonts` delegates to a non-command native function in `system_fonts.rs`.

- [ ] **Step 4: Keep workflow logic out of stored-state ownership**

Move archive, preview, search, and merge orchestration out of the state module. State methods remain only where they enforce state lifecycle invariants such as target locks, cache reset, pending-path drain, or staged-plan mutation.

- [ ] **Step 5: Re-register the exact handler list**

Keep the original order and all 30 names in `tauri::generate_handler!`. Do not rename Rust arguments because Tauri derives frontend argument keys from them.

- [ ] **Step 6: Run Phase-2 GREEN gates**

Run:

```bash
npm run verify:architecture
env -u RUSTC_WRAPPER cargo fmt --all -- --check
env -u RUSTC_WRAPPER cargo test -p lcdiff-desktop
env -u RUSTC_WRAPPER cargo clippy -p lcdiff-desktop --all-targets -- -D warnings
env -u RUSTC_WRAPPER cargo test --workspace
git diff --check
```

Expected: exact contract snapshots remain unchanged and all backend dependency rules pass.

---

### Task 4: Establish exact typed frontend IPC and platform adapters

**Files:**
- Create: `src/ipc/types.ts`
- Create: `src/ipc/commands.ts`
- Create: `src/ipc/commands.test.ts`
- Create: `src/ipc/events.ts`
- Create: `src/ipc/events.test.ts`
- Create: `src/ipc/platform.ts`
- Create: `src/ipc/platform.test.ts`
- Create: `src/ipc/updater.ts`
- Move/modify: `src/lib/update-client.ts` and its tests
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `scripts/verify-architecture.mjs`
- Modify: `scripts/verify-architecture.test.mjs`

**Interfaces:**
- Produces exact wire DTOs including required fields, Rust-only enum sets, and `null` versus omitted semantics.
- Produces one named wrapper per existing command; wrapper arguments use current camelCase Tauri keys.
- Produces typed subscriptions returning an unlisten handle.
- Produces platform wrappers for dialog, window drag/drop, close requests, asset URLs, app version, updater, opener, and relaunch.

- [ ] **Step 1: Write wire-type and invoke-wrapper tests**

For every command group, assert the exact command string and argument object. Add compile-time fixtures for full `ArchiveEntry`, required `ViewSourceSummary.signed`, complete `PlatformHints`, wire-only `ArchiveSourceKind`/`PairStatus`, nullable `EntryPreview.details`/`CommitResult.backupPath`, and optional `SearchHit.line`/`preview`.

- [ ] **Step 2: Write event lifecycle tests**

Assert exact event names, typed payload forwarding, returned unlisten functions, and disposal when the listener promise resolves after the owner has already unmounted.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- src/ipc
```

Expected: failure because the IPC modules do not exist.

- [ ] **Step 4: Implement exact IPC types and command/event façades**

Keep wire types separate from View workspace state, Monaco editor types, search presentation results, and staged UI records.

- [ ] **Step 5: Move every raw platform import**

Move raw Tauri imports from both `App.tsx` and `src/lib/update-client.ts`. Preserve `isTauriRuntime()` fallbacks, updater fallback behavior, drag/drop, close interception, asset conversion, and subscription cleanup.

- [ ] **Step 6: Add Phase-3 guard rules and demonstrate red-green**

First add tests rejecting raw `@tauri-apps/*` imports outside `src/ipc`, then run the repository guard before and after the moves. Test files may mock Tauri packages but production files may not import them elsewhere.

- [ ] **Step 7: Run Phase-3 GREEN gates**

Run:

```bash
npm run verify:architecture
npm test
npm run build
npm run verify:frontend-render
git diff --check
```

Expected: all pass; raw command/event strings exist only in the backend allowlist/constants and frontend IPC façade.

---

### Task 5: Move frontend ownership by LCDiff workflow

**Files:**
- Create/move: `src/app/App.tsx`
- Modify: `src/main.tsx`
- Create/move: `src/features/shell/**`
- Create/move: `src/features/sources/**`
- Create/move: `src/features/workspace/**`
- Create/move: `src/features/free-text/**`
- Create/move: `src/features/search/**`
- Create/move: `src/features/merge/**`
- Create/move: `src/features/preferences/**`
- Retain: `src/components/ui/**`
- Modify: `scripts/verify-architecture.mjs`
- Modify: `scripts/verify-architecture.test.mjs`

**Interfaces:**
- `src/app/App.tsx` composes feature controllers and presentational components.
- `features/workspace` owns Monaco runtime setup, editor types, models, tab LRU, previews, and diff navigation.
- `features/free-text` owns key `lcdiff.freeTextHistory.v1`, limit 20, editable drafts, confirmation, readonly results, and clear behavior.
- `features/shell` owns keys `lcdiff.history` and `lcdiff.onboarding.v1.<mode>`.
- `features/merge` preserves generation-guarded staging and bare versus side-prefixed staging keys.

- [ ] **Step 1: Add persistence and staging-race behavior locks**

Add focused tests for:

```text
lcdiff.history ordering/deduplication/cap
lcdiff.freeTextHistory.v1 ordering/deduplication/cap 20
lcdiff.onboarding.v1.<mode>
malformed/unavailable localStorage fallbacks
stale stage_view_write/stage_write completion cannot overwrite newer state
View bare staging keys and two-sided file side-prefixed keys
```

- [ ] **Step 2: Run behavior locks before moves**

Run:

```bash
npm test -- src/lib/history.test.ts src/lib/free-text-history.test.ts src/App.test.tsx
```

Expected: existing behavior passes before paths change.

- [ ] **Step 3: Move Monaco runtime and editor types first**

Move side-effectful `src/lib/monaco.ts` and `@monaco-editor/react` editor types into `features/workspace`. Update `main.tsx`/`App.tsx` imports without changing worker selection or offline loading.

- [ ] **Step 4: Move Free text as its own feature**

Move its component, history implementation, and tests together. Do not route Free text through archive IPC or merge state.

- [ ] **Step 5: Move remaining components with their owner**

Use the exact current-to-target table in the design. Keep only shared shadcn/Radix primitives in `src/components/ui`. Cross-feature coordination stays in `src/app/App.tsx` through typed props/controllers.

- [ ] **Step 6: Add Phase-4 guard rules and demonstrate red-green**

Reject React, Monaco, Tauri, or feature imports from `src/lib`; reject feature-to-feature React component imports; reject non-primitive files under `src/components`.

- [ ] **Step 7: Run Phase-4 GREEN gates**

Run:

```bash
npm run verify:architecture
npm run verify:all
git diff --check
```

Expected: rendered UI and existing tests remain unchanged while all frontend ownership rules pass.

- [ ] **Step 8: Run focused desktop interaction smoke**

Verify View, Compare, Free text, nested expansion, T2/T3 search/cancel, Monaco All/Differences, staged text editing, signed confirmation, font fallback/remeasure, updater status, menu shortcuts, drag/drop, and OS-open.

---

### Task 6: Document final boundaries, wire CI, and run the complete proof ladder

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `README.md` only if developer commands change
- Modify: relevant `.github/workflows/*.yml`
- Modify: `package.json`
- Test: all architecture, frontend, Rust, sidecar, and native gates

**Interfaces:**
- Produces documented final dependency arrows and file ownership.
- Produces `verify:architecture` as a required part of `verify:all` and CI.
- Preserves release behavior and artifact/resource paths.

- [ ] **Step 1: Update architecture and development documentation**

Document the final tree, exact allowed dependency directions, wire DTO authority, feature ownership, and phase-independent architecture guard.

- [ ] **Step 2: Wire the fully green guard**

Add `npm run verify:architecture` to `verify:all` and the existing CI validation path only after Tasks 1–5 are green.

- [ ] **Step 3: Run the complete local ladder**

```bash
npm run verify:architecture
npm run verify:all
env -u RUSTC_WRAPPER cargo fmt --all -- --check
env -u RUSTC_WRAPPER cargo clippy --workspace --all-targets -- -D warnings
env -u RUSTC_WRAPPER cargo test --workspace
scripts/test-sidecar-smoke.sh
npm run tauri -- build --debug --bundles app
git diff --check
```

- [ ] **Step 4: Run artifact-backed native smoke**

Using the built app and real sample archives, verify:

```text
normal and nested archive open/read
View editable text and readonly class/binary/nested entries
Compare original-byte staging and atomic save with backup
signed archive confirmation
Java source/bytecode with every configured engine
deep-search progress/result/cancel
Monaco model/tab/font lifecycle
native menu, single-instance and OS-open handoff
Free text history and readonly confirmed result
```

- [ ] **Step 5: Record external gates separately**

Do not claim Windows atomic replacement, Linux compositor behavior, notarization, Authenticode, or public release publication from local macOS evidence. Track those through `docs/PLATFORM_VALIDATION.md`.

---

## Self-Review Checklist

- Every design contract maps to a task and focused test.
- Every architecture rule is introduced red and returned green in the same task.
- Wire DTOs and feature models have separate ownership.
- Free text, updater, Monaco runtime, persistence, staging races, native integration, sidecar workers, nested cache, and atomic merge all have named owners and gates.
- No phase requires a future phase to make its current gate green.
- No commit, push, merge, tag, release, or public publication is implied.
