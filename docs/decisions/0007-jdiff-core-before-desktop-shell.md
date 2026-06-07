# Decision 0007: Build jdiff Core Before Desktop Shell

## Status

Accepted

## Context

The jdiff specification selects Tauri v2, React, a Rust backend, and a JVM
sidecar. The destructive operation is archive replacement after staged merge.
The repository starts with no application code.

## Decision

Implement archive rules as a framework-independent Rust crate before wiring
Tauri. Keep archive indexing, diff, search, staged merge, and atomic save in
`jdiff-core`. Expose a small CLI for deterministic smoke verification.

## Consequences

- Safety-critical archive behavior can be tested without a WebView.
- Tauri IPC remains an adapter over stable Rust operations.
- Bundled JVM and desktop packaging remain separate milestones.
- Windows atomic replacement requires a dedicated platform implementation.

