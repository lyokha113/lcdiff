# Stories

Stories are work packets. They turn product intent into bounded implementation
and validation work.

Current story status is tracked in the durable layer and queried with
`scripts/bin/harness-cli query matrix`. Implemented packet folders in this
directory:

- `jdiff-mvp-core/` — Rust archive engine: validated open, lazy read, CRC diff,
  search, staged atomic save (implemented).
- `jdiff-jvm-sidecar/` — JVM decompiler sidecar: CFR/Vineflower/ASM, typed
  options, versioned LRU cache, jlink runtime (implemented).

The `jdiff-desktop-shell` story (Tauri React shell, compare/merge UI,
multi-tab diff workspace, nested-archive expansion) is tracked in the matrix;
see `../JDIFF_COMPLETION_AUDIT.md` for proof evidence.

## Normal Story

Use `docs/templates/story.md` for normal feature work.

Suggested path:

```text
docs/stories/epics/E01-domain-name/US-001-short-story-title.md
```

## High-Risk Story

Use `docs/templates/high-risk-story/` when the feature intake classifies work as
high-risk.

Suggested path:

```text
docs/stories/epics/E02-risky-domain/US-012-risky-story-title/
  execplan.md
  overview.md
  design.md
  validation.md
```

## Status Flow

```text
planned -> in_progress -> implemented
                  |
                  v
               changed
                  |
                  v
               retired
```
