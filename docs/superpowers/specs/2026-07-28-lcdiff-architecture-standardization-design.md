# LCDiff architecture standardization design

## Status and decision request

**Proposal only.** This document records the approved-target candidate from a read-only audit of `65b5583` (`v0.3.10`). It does not authorize source moves.

The goal is to apply LCFiBe's proven shape—thin desktop entrypoint, explicit composition/state/events, typed frontend IPC, feature ownership, and executable dependency guards—without changing any LCDiff product contract.

## Audit snapshot

At the audited revision, the frontend root `src/App.tsx` is 2,417 lines and directly imports Tauri `invoke`, `listen`, `getCurrentWindow`, `convertFileSrc`, and the dialog plugin. `src/lib/update-client.ts` separately imports the app, updater, process, and opener APIs. `src-tauri/src/main.rs` is 3,222 lines and owns the desktop builder, `AppState`, 29 Tauri commands, events, native menu/open-with, and workflow helpers; `system_fonts.rs` owns the thirtieth command. `lcdiff-core` is already the reusable Rust archive domain crate and has no Tauri dependency.

The current desktop command spellings are a public compatibility set:

```text
validate_path, platform_hints, list_system_fonts,
open_archive, compute_diff, compute_nested_diff,
open_view_source, list_view_sources, read_entry, read_view_entry,
compute_view_nested_entries, close_view_source,
set_engine, disassemble, disassemble_view_entry,
stage_copy, stage_write, stage_view_write, unstage_view_write,
commit_view, commit_merge, clear_staged, unstage,
search, search_view_source, deep_search, deep_search_view_source,
cancel_deep_search, prefetch_siblings, pending_open_paths
```

The current event spellings are stable: `search-progress`, `search-result`, `os-open-paths`, and `app-action`. DTOs such as `ArchiveSummary`, `EntryPreview`, `CommitResult`, `ViewSourceSummary`, `PlatformHints`, and the event payloads serialize in camelCase. Rust `Option<T>` fields without `skip_serializing_if` serialize as `null`; `SearchHit.line` and `SearchHit.preview` are omitted when absent. Moving their definition must not change a field name, optionality, enum spelling, command argument, null/omission behavior, or error string.

The current `src/lib/types.ts` types are UI projections, not exact wire declarations. For example, they omit `ArchiveEntry.compressedSize` and `crc32`, make `ViewSourceSummary.signed` optional although Rust always emits it, model only `PlatformHints.dropHint`, add `"text"` to `ArchiveSourceKind`, and add `"differentMetadataOnly"` to `PairStatus`. The latter two values are not emitted by the corresponding Rust enums. The target must separate exact IPC DTOs from feature view models rather than silently treating current projections as the serialization authority.

## Target structure

```text
src-tauri/src/
  main.rs                 binary entrypoint: lcdiff_desktop::run()
  lib.rs                  Tauri composition root and handler registration
  state.rs                stored AppState, source/cache/worker generations and queues
  events.rs               stable event names, payloads and emit helpers
  menu.rs                 menu action catalog, platform menu and open-with bridge
  commands/
    mod.rs                private declarations and crate-visible re-exports
    app.rs                path validation, hints, pending paths, font command wrapper
    archive.rs            open/diff/nested/view-source lifecycle
    preview.rs            entry reads, decompile/bytecode and engine selection
    merge.rs              staging, unstage, commit and signed-save boundary
    search.rs             T2/T3 search, cancel and sibling prefetch
  sidecar_process.rs      JVM process, protocol, cache, retry and timeout adapter
  system_fonts.rs         native font enumeration implementation

src/
  app/                    App composition root, entry wiring and app lifecycle
  ipc/                    the only frontend importer of @tauri-apps/*
    types.ts              exact wire DTOs, enums, nullability and event payloads
    commands.ts           typed command façade with stable strings
    events.ts             typed subscriptions and unlisten ownership
    platform.ts           dialog/window/asset protocol adapters and browser fallback
    updater.ts            updater/process/opener adapter
  features/
    shell/                mode, menu actions, splash and navigation
    sources/              compare/view source loading and file tree state
    workspace/            Monaco tabs, previews and staged editor buffers
    free-text/            editable drafts, readonly results and temporary history
    search/               T2/T3 query, progress and result state
    merge/                staging, commit and signed-save confirmation state
    preferences/          preferences, system-font startup and updater UI
  components/ui/          shared shadcn/Radix primitives only
  lib/                    pure React-free, Monaco-free, Tauri-free utilities
```

`App.tsx` remains one explicit composition root; it does not become a second state/service layer. Directory moves are gradual and preserve the existing visual hierarchy and component APIs where possible.

## Current-to-target ownership map

| Current source | Target owner |
| --- | --- |
| `src/App.tsx` | `src/app/App.tsx` plus feature-owned controllers/hooks |
| `src/lib/types.ts` | exact wire types in `src/ipc/types.ts`; UI types beside their feature |
| `src/lib/update-client.ts` | `src/ipc/updater.ts` plus preferences-owned update state |
| `src/lib/monaco.ts` | `src/features/workspace/monaco-runtime.ts` |
| `src/components/FreeTextWorkspace.tsx`, `src/lib/free-text-history.ts` | `src/features/free-text/` |
| `src/components/{SearchBar,SearchResultsPanel}.tsx` | `src/features/search/` |
| `src/components/ConfigDrawer.tsx`, `src/components/preferences/**` | `src/features/preferences/` |
| `src/components/{DiffView,WorkspaceTabs}.tsx`, `src/lib/tabs.ts` | `src/features/workspace/` |
| `src/components/{SourceChips,ViewSourceTabs,FileTree}.tsx`, `src/lib/view-workspace.ts` | `src/features/sources/` |
| `src/components/{MenuBar,WorkspaceRail,SplashScreen,OnboardingTour,KeyboardShortcutsDialog,StatusBar}.tsx` | `src/features/shell/` |
| `src-tauri/src/main.rs` builder | `src-tauri/src/lib.rs` |
| `AppState` fields and lifecycle data | `src-tauri/src/state.rs` under the existing single `Arc<Mutex<AppState>>` |
| state workflow methods | matching `commands/archive.rs`, `preview.rs`, `merge.rs`, or `search.rs` |
| menu/open-with functions | `menu.rs`, emitting only through `events.rs` helpers |

## Dependency and ownership rules

```text
feature intent -> src/ipc typed facade -> stable Tauri command/event
              -> command module -> state + lcdiff-core -> archive/JVM work

native menu/open-with -> menu.rs -> events.rs -> src/ipc/events.ts -> feature state
```

- Only `src/ipc/**` imports `@tauri-apps/*`, including plugins.
- `src/lib/**` imports neither React, Monaco, Tauri, nor a feature.
- A feature never imports a React component from another feature; cross-feature communication is through root composition props or a small neutral contract.
- `main.rs` has no state, command annotation, event emission, or menu logic.
- `lib.rs` constructs plugins/state and registers the unchanged handler list.
- `state.rs` stores the existing archives, nested caches, view sources, plans, sidecar workers, cancellation generations, engine, and pending-open queue under the current single mutex. It owns lifecycle invariants but not command orchestration.
- `commands/app.rs` owns the Tauri wrapper for `list_system_fonts`; `system_fonts.rs` remains the blocking native implementation.
- Commands may use `state`, `events`, `sidecar_process`, `system_fonts`, and `lcdiff-core`; state/events/menu/adapters never depend on command modules.
- `lcdiff-core` remains free of Tauri and continues to own archive parsing, nested extraction semantics, staging and atomic rewrite.

## Non-negotiable LCDiff preservation contracts

1. `NestedArchiveCache` stays scoped to left/right/view source and is reset on source replacement or successful commit; `!/` resolution and lazy extraction retain their current behavior.
2. `MergePlan` remains the only write path: source bytes are staged, atomic replacement and optional backup stay in `lcdiff-core`, and signed targets still require confirmation. No frontend state is authoritative for a save.
3. JVM sidecar resource lookup, Java 17 jlink layout, length-prefixed JSON, 30-second watchdog, one restart/retry, 128 MiB shared response cache, and interactive/prefetch/deep-search worker separation remain unchanged.
4. `menu.rs` preserves menu IDs, accelerator mapping, macOS close-window policy, single-instance arguments, startup `RunEvent::Opened`, and the pending-open queue before emitting `os-open-paths`/`app-action`.
5. Monaco models, workers, tab LRU, staged buffers, diff options and font remeasure remain lifecycle-owned by the workspace feature. Asynchronous system-font enumeration keeps fallback fonts and persisted preferences usable.
6. `edit::editable_text` remains the backend authority. Decompiled classes, bytecode, metadata, binary content, signed View archives, and nested entries remain read-only; the frontend affordance stays synchronized with that rule.
7. Persistence keys and limits remain exact: `lcdiff.history`, `lcdiff.freeTextHistory.v1` with a 20-entry cap, and `lcdiff.onboarding.v1.<mode>`. Malformed or unavailable local storage must retain the current non-blocking fallbacks.
8. Frontend staging retains the `editStageGenerationRef` generation guard that prevents stale asynchronous `stage_view_write`/`stage_write` responses from overwriting newer state. View entries use bare staging keys; two-sided file sources retain side-prefixed keys.
9. Free text remains frontend-only: drafts are editable, results are created only on confirmation, confirmed results are readonly, and clearing temporary history never invokes archive IPC.

## Typed IPC contract

`src/ipc/types.ts` is a wire-contract module, not a copy of all frontend state. It must represent every returned field and event payload exactly:

- archive entries include `path`, `kind`, `uncompressedSize`, `compressedSize`, and `crc32`;
- wire `ArchiveSourceKind` is exactly `"archive" | "directory" | "file"` and wire `PairStatus` is exactly `"onlyLeft" | "onlyRight" | "identical" | "different"`;
- `ViewSourceSummary.signed` is required;
- `PlatformHints` includes `os`, `sessionType`, `wayland`, and `dropHint`;
- `EntryPreview.details`, `CommitResult.backupPath`, `PlatformHints.sessionType`, and `PlatformHints.dropHint` are nullable because Rust serializes their absent values as `null`;
- `SearchHit.line` and `SearchHit.preview` remain optional because Serde omits `None`;
- `SearchProgress`, `DeepSearchMatch`, `OsOpenPathsPayload`, and `AppActionPayload` are named event DTOs.

Feature models may deliberately project these DTOs, but projection occurs after the IPC boundary. Phase 0 adds Rust serialization fixtures and frontend contract tests; generated bindings remain optional and are not required for this migration.

## Executable guard

Add `scripts/verify-architecture.mjs` with independent checks that are introduced one phase at a time. Each new rule must first demonstrate the expected red failure, then become green in the same phase before it is added to `verify:all` and CI:

1. Phase 1: thin `src-tauri/src/main.rs` and no commands/events/state there; no `tauri` dependency under `crates/lcdiff-core`.
2. Phase 2: no command-module dependency from state/events/menu/sidecar adapters; backend command/event allowlists preserve exact spellings.
3. Phase 3: no raw Tauri/plugin import outside `src/ipc` (test mocks excepted); frontend command/event literals occur only in the IPC façade.
4. Phase 4: no React/Monaco/Tauri/feature import from `src/lib`; no cross-feature React component import; only shared primitives remain under `src/components/ui`.

The guard intentionally does not ban Tauri from `src-tauri`, Monaco from the workspace feature, or Java resources from the sidecar adapter.

## Contract tests before moves

Before extraction, add focused tests/snapshots for handler registration names, command argument names, full returned DTO fields, enum casing, null versus omitted fields, event payload camelCase, frontend façade arguments, cache reset after source change/commit, signed-save confirmation, native open-with queue ordering, read-only editability, sidecar timeout/resource lookup, persistence keys/limits, and staging-generation races. These are behavior locks, not product redesign tests.

## Alternatives rejected

- **Copy LCFiBe's crate count or Specta setup unchanged:** LCDiff has one sound domain seam already; adding crates/code generation is unjustified unless a later domain boundary proves it necessary.
- **Move everything in one rename:** it would make regressions in cache, Monaco, native integration and serialized IPC hard to isolate.
- **Put all frontend bridge code in `App.tsx`:** this preserves the current bottleneck and cannot be mechanically guarded.
