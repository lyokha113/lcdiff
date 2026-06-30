# Architecture

## LCDiff Application Shape

```text
React + shadcn/ui + Tailwind v4 + Monaco desktop view
  -> Tauri IPC adapter
    -> lcdiff-core Rust domain/application crate
      -> lazy ZIP/JAR reads and atomic rewrite
      -> length-prefixed JSON sidecar protocol
        -> bundled JVM service: Vineflower default, CFR alternate, ASM Textifier
```

`lcdiff-core` owns archive metadata, normalized entries, CRC diff, class
constant-pool search, staged changes, and save semantics. Frontend and CLI code
are adapters. Decompiled Java is a view only and must never enter merge writes.

The Tauri desktop adapter currently uses React with shadcn/ui source
components, Tailwind v4 theming, and Monaco. It provides path preflight with per-panel
inline errors, picker and drop events, entry preview, tree diff, staged copy,
clear, signed-save confirmation, commit, search IPC, background deep source
search with cancel, async sidecar warm
start, a 30-second watchdog, canonical-path, metadata, typed-options, mode, and
engine-version keyed 128 MB LRU source/bytecode cache, and one restart/retry.
Dedicated deep-search and
low-priority prefetch JVM workers share that cache without blocking interactive
class navigation. The desktop view renders a hierarchical foldable file tree
with per-node status, a multi-tab diff workspace (capped at 10 tabs with LRU
eviction and per-tab view-mode/preview state), a Preferences drawer organized
into Appearance, Editor, and Misc sections, where Appearance controls
Light/Dark/System color pattern, Editor controls Monaco-only font/display
settings, and Misc groups Search, Decompiler, and Save defaults, contextual
Files-index/current-diff search, and a startup splash while the sidecar warms. Nested archives
(jar/zip/war/ear inside an archive) expand lazily through the
`compute_nested_diff` command using the `parent!/inner` path separator, extract
to cached temp files on demand, and merge by flattening staged replacements back
into their parent archives. ZIP open/diff/read/search/save and sidecar read
operations
use async Tauri commands with blocking work offloaded from the IPC thread. The
Java sidecar implements Vineflower decompile by default, CFR as an explicit
alternate source engine, and ASM Textifier for bytecode.
`scripts/assemble-sidecar-resources.sh` builds a minimal Java 17 jlink runtime
and copies the shaded sidecar JAR into Tauri resources. Release verification is
split between local invariants and external platform gates. Locally,
`npm run verify:packaging-scripts` checks the macOS/Windows helper-script
contracts that cannot all execute on one host.
`scripts/sign-macos-bundle.sh` stages a clean copy outside FileProvider
directories, signs JRE Mach-O children inside-out, signs the outer `.app`,
verifies the result, and can copy the signed app back to a deterministic output
path. `scripts/notarize-macos-app.sh` zips that signed `.app`, submits it with
`xcrun notarytool`, staples the ticket, and runs Gatekeeper assessment when
Developer ID credentials are available. `scripts/package-macos-dmg.sh` packages
the final `.app` into a verified UDZO DMG with an `Applications` symlink. Real
Developer ID notarization, Windows Authenticode signing, Windows atomic replace,
and Linux compositor drop behavior remain external gates in
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

`App.tsx` remains the orchestration owner for Tauri-facing state. `MenuBar`,
`SourceChips`, `WorkspaceTabs`, `FileTree`, `DiffView`, `SearchBar`,
`SearchResultsPanel`, `ConfigDrawer`, and `StatusBar` render state and emit typed
intent callbacks. Search opens on demand and closes after result selection, so
the contextual surface cannot block the Files navigator. View mode removes
right-side and merge-only controls instead of disabling them.

GSAP and `@gsap/react` are restricted to the startup composition. Normal
workspace interactions use transform/opacity CSS transitions, and reduced
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
