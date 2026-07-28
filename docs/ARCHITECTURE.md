# Architecture

## LCDiff Application Shape

```text
src/app/App.tsx composition root
  -> feature state/controllers and presentational components
    -> src/ipc typed command/event/platform adapters
      -> stable Tauri command and event contracts
        -> src-tauri command modules
          -> stored state + lcdiff-core
            -> lazy ZIP/JAR reads and atomic rewrite
          -> sidecar_process
            -> length-prefixed JSON Java 17 sidecar

native menu / single instance / OS open
  -> src-tauri/menu.rs
    -> src-tauri/events.rs
      -> src/ipc/events.ts
        -> shell/source feature state
```

`lcdiff-core` remains the Tauri-free domain crate. It owns archive metadata,
normalized entries, CRC diff, class constant-pool search, nested extraction,
staged original bytes, and atomic save/backup semantics. The desktop host and
frontend are adapters. Decompiled Java is a view only and never enters merge
writes.

## Final File Ownership

### Tauri adapter

```text
src-tauri/src/
  main.rs                 binary entrypoint; calls lcdiff_desktop::run()
  lib.rs                  plugins, setup, handler registration and run loop
  state.rs                AppState storage and lifecycle invariants
  events.rs               four stable event names, payloads and emit helpers
  menu.rs                 menu, accelerators, single instance and OS-open handoff
  archive_access.rs       validated/canonical opens and nested-entry resolution
  commands/
    app.rs                path validation, platform hints, pending paths, fonts
    archive.rs            archive/diff/nested/View-source lifecycle
    preview.rs            reads, decompile, bytecode and engine selection
    merge.rs              stage, unstage, commit and signed-save boundary
    search.rs             T2/T3 search, cancellation and sibling prefetch
  sidecar_process.rs      Java process, protocol, cache, timeout and retry
  system_fonts.rs         blocking native font enumeration
```

`lib.rs` preserves the ordered 30-command handler list and constructs the
existing single `Arc<Mutex<AppState>>`. `state.rs` stores archives, per-source
nested caches, View sources, merge plans, sidecar workers, cancellation
generations, engine selection, and pending open paths. Command modules own
workflow orchestration; `archive_access.rs` provides neutral, reusable
archive-opening and nested-resolution operations; stored state owns lifecycle
invariants.

### Frontend

```text
src/
  app/App.tsx             composition and cross-feature lifecycle wiring
  ipc/
    types.ts              exact Rust wire DTOs and event payloads
    commands.ts           typed wrappers for the 30 stable commands
    events.ts             typed subscriptions and unlisten ownership
    platform.ts           dialog/window/drop/asset adapters
    updater.ts            app/updater/process/opener adapters
  features/
    shell/                mode, navigation, history, onboarding and status
    sources/              source inputs, View state/tabs and file tree
    workspace/            Monaco runtime, models, tab LRU and previews
    free-text/            drafts, readonly results and bounded history
    search/               search controls, projection and result state
    merge/                generation-guarded staging and save confirmation
    preferences/          preferences, fonts and updater state/UI
  components/ui/          approved shared shadcn/Radix primitives only
  lib/                    pure React/Monaco/Tauri/feature-free utilities
```

`src/app/App.tsx` is the single composition root, not a second service layer.
Workspace and merge side effects live in `useWorkspaceController` and
`useMergeController`; feature components render typed state and emit intent.

## Completed Ownership Mapping

| Before standardization | Final owner |
| --- | --- |
| `src/App.tsx` | `src/app/App.tsx` plus workspace and merge controllers |
| UI projections and wire assumptions in `src/lib/types.ts` | exact DTOs in `src/ipc/types.ts`; feature projections remain in `src/lib/types.ts` |
| `src/lib/update-client.ts` | `src/ipc/updater.ts` plus `src/features/preferences/update-client.ts` |
| `src/lib/monaco.ts`, editor lifecycle in the root | `src/features/workspace/monaco-runtime.ts`, `editor-types.ts`, and `useWorkspaceController.ts` |
| components under `src/components/` | matching `src/features/*`; only approved primitives remain in `src/components/ui/` |
| free-text/history/search/preferences/source/tab helpers under generic folders | their matching `src/features/*` owner |
| builder, state, commands, events and menu in `src-tauri/src/main.rs` | `lib.rs`, `state.rs`, `commands/*`, `events.rs`, and `menu.rs` |
| JVM process/cache mixed with desktop orchestration | `src-tauri/src/sidecar_process.rs` |

## Dependency Directions

Allowed arrows are:

```text
feature intent -> src/ipc -> stable command/event
command module -> archive_access | state | events | sidecar_process | system_fonts | lcdiff-core
archive_access -> state snapshots | Tauri async runtime | lcdiff-core
menu -> events -> frontend IPC subscriptions
src/app -> feature controllers/components + typed IPC orchestration
feature -> same-feature files + non-component feature contracts
        -> src/lib + src/components/ui + src/ipc
```

The reverse arrows are forbidden:

- only `src/ipc/**` may import `@tauri-apps/*` or access Tauri internals;
- non-literal dynamic imports are forbidden outside `src/ipc/**` production
  files because their dependency target cannot be verified statically;
- `src/lib/**` may not import React, Monaco, Tauri, or a feature;
- a feature may not import a React component owned by another feature;
- a feature may not depend on `src/app/**`, directly or through re-export
  barrels;
- non-primitive components may not live under `src/components`;
- a command submodule may not import another command submodule; shared archive
  access belongs in `archive_access.rs`;
- `state.rs`, `events.rs`, `menu.rs`, `sidecar_process.rs`, and
  `system_fonts.rs` may not depend on command modules;
- Tauri command annotations belong only under `src-tauri/src/commands`;
- `main.rs` is exactly the thin `lcdiff_desktop::run()` entrypoint;
- `lcdiff-core` has no Tauri dependency.

## Wire Contract Authority

`src/ipc/types.ts` is the frontend wire authority and mirrors Rust serialization
exactly. It includes the complete archive fields, exact wire enum sets, required
`ViewSourceSummary.signed`, complete `PlatformHints`, explicit nullable fields,
and omitted optional `SearchHit.line`/`preview`. Feature view models are
deliberate projections after the IPC boundary and are not wire declarations.

The command names, handler order, argument keys, event names, camelCase fields,
enum spelling, null/omission behavior, and error strings are compatibility
contracts. Rust serialization fixtures and frontend facade tests lock them.

## Executable Architecture Guard

`npm run verify:architecture` runs `scripts/verify-architecture.mjs` against the
tracked source tree. Its independent rules enforce the exact thin entrypoint
and Tauri-free core; backend command/event allowlists, reverse dependencies,
and sibling-command isolation; frontend Tauri/command/event ownership,
including conservative non-literal dynamic-import rejection; pure-lib,
feature-to-app, and graph-aware cross-feature component ownership; and the
workspace/merge controller boundaries. `scripts/verify-architecture.test.mjs`
contains focused mutation and allowance fixtures for each rule.

The guard is phase-independent after standardization: it is the first step of
`npm run verify:all` and each release workflow has an explicit architecture
validation step. Platform release scripts still run the aggregate gate before
packaging where supported.

## Preserved Runtime Contracts

- `NestedArchiveCache` remains scoped per left/right/View source and resets on
  source replacement or successful commit; `!/` lookup stays lazy.
- `MergePlan` remains the only write path. Original entry bytes are staged and
  saved atomically with optional backup; signed targets require confirmation.
- Java 17 resource lookup, framed JSON, the 30-second watchdog, one
  restart/retry, 128 MiB shared response cache, warm start, and separate
  interactive/prefetch/deep-search workers remain unchanged.
- Menu IDs, accelerators, macOS close policy, single-instance arguments,
  `RunEvent::Opened`, and store-before-emit pending path order remain unchanged.
- Monaco models/workers, ten-tab LRU, staged buffers, diff options, installed
  font fallback/remeasure, and read-only editability boundaries remain
  feature-owned.
- Persistence keys remain `lcdiff.history`, `lcdiff.freeTextHistory.v1` with a
  20-entry cap, and `lcdiff.onboarding.v1.<mode>`.

Nested archive, sidecar, staged-save, frontend render, and native bundle checks
are part of the local proof ladder in `docs/DEVELOPMENT.md`. Windows atomic
replace, Linux compositor behavior, Developer ID notarization, Authenticode,
and public release/AUR publication remain external gates in
`docs/PLATFORM_VALIDATION.md`.

## Frontend Interaction Zones

The desktop shell is organized around the primary Compare workflow without
moving archive or merge state into presentation components:

```text
command bar
  -> source rail
    -> Files/open-diff navigator
      -> tree or Monaco workspace canvas
        -> persistent status bar

context overlays: search, preferences, pending changes, confirmations
```

`src/app/App.tsx` composes the workflow controllers and feature surfaces.
`MenuBar`, `SourceChips`, `WorkspaceTabs`, `FileTree`, `DiffView`, `SearchBar`,
`SearchResultsPanel`, `ConfigDrawer`, and `StatusBar` render state and emit
typed intent callbacks. Search opens on demand and closes after result
selection, so the contextual surface cannot block the Files navigator.

View mode is a multi-source inspector with source tabs, a single-column tree
for the active source, and per-source entry tabs. It uses View-specific state
and backend source handles instead of the Compare left/right slots. Root-level
UTF-8 text entries use a View-owned merge plan, so edits stay staged until Save
and preserve the same atomic rewrite/backup contract as Compare. Decompiled
classes, binary entries, signed archives, and entries inside nested archives
remain read-only. Compare-only tree filters, the Compare content-line filter,
and cross-side merge controls do not render in View. The content filter is
display-only: it leaves Monaco's original models, line coordinates, navigation,
and staged merge operations intact.

Free text mode is a frontend workspace for ad hoc paste/type comparison. It
keeps editable left/right draft buffers separate from readonly confirmed diff
results. A result is created only when the user confirms comparison, and
confirmed results are stored in local temporary history with a fixed limit and
clear action.

Startup and workspace motion use CSS animations and transitions, while reduced
motion suppresses nonessential animation. Geist and JetBrains Mono remain
self-hosted so the desktop bundle renders offline.

## Generic Boundary Rules

The following boundary rules continue to apply.

## Discovery Before Shape

Before proposing implementation shape, identify:

- Product surfaces: browser, mobile, desktop, CLI, API, worker, or service.
- Runtime stack: language, framework, database, queues, providers, and hosting.
- Core domains: the product concepts that deserve stable names and contracts.
- Boundary inputs: user input, API requests, webhooks, jobs, files, credentials,
  provider payloads, and environment configuration.
- Validation ladder: the smallest checks that can prove the selected stack.

Record stack choices in this document when they meaningfully constrain
future work.

## Default Layering

```text
domain
  <- application
      <- infrastructure
          <- interface
              <- app surfaces
```

## Candidate Structure

```text
app/
  domain/
    entities/
    value-objects/
    repositories/
    services/

  application/
    commands/
    queries/
    handlers/

  infrastructure/
    database/
    logging/
    notifications/

  interface/
    controllers/
    dto/
    presenters/
    routes/
    middlewares/

surfaces/
  browser/
  mobile/
  desktop/
  cli/
```

This is a thinking template, not a scaffold. Create real folders only when a
story enters implementation and the selected stack needs them.

## Dependency Rule

Inner layers must not depend on outer layers.

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| domain | nothing project-external except tiny pure utilities | framework, database, UI, provider, process/env |
| application | domain | framework, UI, provider, database concrete clients |
| infrastructure | domain, application | interface controllers or UI |
| interface | all backend layers | UI state or platform shell assumptions |
| app surfaces | API contracts and app-facing clients | domain internals directly |

## Parse-First Boundary Rule

Unknown data must be parsed at boundaries before it enters inner code.

Boundaries include:

- HTTP request bodies, params, and query strings.
- Session payloads and identity claims.
- Environment variables.
- Database rows returned from external clients.
- Platform shell payloads.
- Deep links, tokens, and signed URLs.
- Provider webhooks, events, and async payloads.

Target flow:

```text
unknown input
  -> parser
  -> typed DTO or command
  -> application use case
  -> domain object/value object
```

Inner layers should work with meaningful product types such as `UserId`,
`AccountId`, `WorkspaceId`, `Role`, `DateRange`, or domain-specific IDs,
rather than repeatedly validating raw strings.

## Command/Query Boundary

If the product has both reads and writes, keep command/query separation clear at
the code level even when the storage layer is simple:

- Commands mutate state and own audit side effects.
- Queries read state and format for consumers.
- Shared domain rules live in domain/application, not controllers.

## Observability Contract

The future server should emit one canonical JSON log line per request with:

- timestamp
- level
- request_id
- user_id when known
- action
- duration_ms
- status_code
- message

Audit logs are product records. Application logs are operational records. Do not
use one as a substitute for the other.
