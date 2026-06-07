# Exec Plan

## Goal

Build the safety-critical Rust core and expose a CLI smoke surface.

## Scope

In scope:

- Archive validation, indexing, classification, diff, search, staging, save.
- Harness product contract, decision, and proof updates.
- Tests and CLI smoke verification.

Out of scope:

- Full desktop UI and bundled JVM sidecar distribution.

## Risk Classification

Risk flags:

- Data loss.
- Public contracts.
- Cross-platform.
- Weak proof.
- Multi-domain.

Hard gates:

- Atomic archive replacement must preserve the target on pre-rename failure.

## Work Phases

1. Record product contract and architecture decision.
2. Create Rust workspace and core domain modules.
3. Add deterministic tests and CLI adapter.
4. Run format, clippy, test, and CLI smoke checks.
5. Update Harness evidence.

## Stop Conditions

Pause for human confirmation if:

- The merge unit changes away from original entry bytes.
- Immediate writes are requested instead of staged save.
- A platform requires a weaker-than-atomic replacement strategy.

