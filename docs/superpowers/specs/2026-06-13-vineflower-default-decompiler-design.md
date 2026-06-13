# Vineflower Default Decompiler Design

## Context

LDiff already supports two Java source decompiler engines through the JVM
sidecar: CFR and Vineflower. The current product documentation describes both
engines, the sidecar smoke test exercises both engines, and the Config drawer
lets users switch between them.

The product gap is default selection. The desktop UI and Rust app state still
start with CFR, so a fresh app session uses CFR until the user changes the
engine.

## Goal

Make Vineflower the default Java source decompiler while keeping CFR available
as an explicit user-selectable engine.

This is a product contract change, not a merge behavior change. Decompiled Java
remains read-only, and merge/save operations continue to copy original archive
entry bytes.

## Non-Goals

- Remove CFR support.
- Add per-engine advanced option UI.
- Add automatic Vineflower-to-CFR fallback on engine errors.
- Change ASM bytecode behavior.
- Change class tree projection or inner-class hiding behavior.
- Rebuild or replace the bundled JRE in this change.

## Design

### Defaults

Vineflower becomes the default in every layer that can independently decide an
engine:

- React app state starts with `vineflower`.
- Rust `AppState` starts with `DecompileEngine::Vineflower`.
- The JVM sidecar treats a missing `engine` field on `decompile` requests as
  `vineflower`.

The UI keeps both Config drawer options:

- `Vineflower`
- `CFR`

Users can still switch to CFR, and the existing `set_engine` IPC command remains
the way the frontend updates Rust state.

### Data Flow

Fresh app startup:

```text
React default engine: vineflower
  -> set/read preview requests use current frontend state
  -> Rust AppState default engine: Vineflower
  -> SidecarClient sends engine: "vineflower"
  -> JVM sidecar runs Vineflower
  -> Monaco renders read-only source
```

When the user selects CFR, the same flow runs with `engine: "cfr"`.

Deep source search and prefetch use the Rust shared engine state, so they also
default to Vineflower without introducing a separate setting.

### Cache Behavior

No cache model change is required. Sidecar cache keys already include action,
engine, options, archive metadata, and entry path. Vineflower and CFR responses
remain partitioned even when users switch engines during one session.

### Error Handling

The selected engine remains explicit. If Vineflower fails, LDiff should surface
the existing decompiler-unavailable behavior or bytecode fallback path rather
than silently switching to CFR.

Automatic fallback would make source output harder to reason about, especially
in compare/deep-search workflows where users need to know which engine produced
the text.

### Packaging Constraint

Vineflower requires the Java 17 sidecar runtime described in the current
sidecar docs. This design does not repair or replace a wrong-platform bundled
JRE. Platform-specific sidecar runtime assembly remains covered by the existing
`scripts/assemble-sidecar-resources.sh` path and release validation.

## Testing

Add or update regression coverage for:

- Frontend startup/default configuration expects `vineflower`.
- Rust `AppState::default` or equivalent initialization uses
  `DecompileEngine::Vineflower`.
- Sidecar smoke proves missing-engine decompile requests use Vineflower.
- Sidecar smoke still proves explicit CFR requests work.
- Existing cache key tests continue to prove CFR/Vineflower partitioning where
  applicable.

Run focused tests first, then the normal project validation needed for a desktop
decompiler contract change.

## Documentation

Update user/developer docs where they imply CFR is the default or primary
engine. Docs should state that LDiff uses Vineflower by default and CFR remains
available from the Config drawer.

## Acceptance Criteria

- A new app session defaults to Vineflower in the UI.
- Rust preview, deep search, and prefetch use Vineflower before any user engine
  change.
- Missing-engine sidecar requests default to Vineflower.
- CFR remains selectable and smoke-tested.
- Decompiled output remains read-only and does not affect merge bytes.
- Tests and docs capture Vineflower as the default contract.
