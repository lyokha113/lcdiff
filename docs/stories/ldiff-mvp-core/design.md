# Design

## Domain Model

`Archive` owns archive metadata and indexed `Entry` values. `ArchiveDiff`
contains aligned `ComparePair` values. `MergePlan` owns staged copies and
commits them as one atomic rewrite.

## Application Flow

```text
raw path -> validate_path -> Archive::open -> indexed entries
left + right -> compare -> aligned pairs
stage_copy -> MergePlan -> commit -> temp rewrite -> fsync -> atomic replace
```

## Interface Contract

The initial interface is the `ldiff-core` Rust API and `ldiff-cli`. A Tauri
adapter will map the same operations to IPC commands without moving business
rules into the shell.

## Data Model

No database is required. Archives are indexed lazily in memory. Staged copies
retain source archive path and entry path until save.

## UI / Platform Impact

Atomic replacement is implemented with same-directory rename on Unix. Windows
replacement remains a platform story because replacing an existing file needs
`ReplaceFileW` or `MoveFileExW`.

## Observability

CLI commands return explicit errors. Desktop event logging is deferred to the
shell story.

## Alternatives Considered

1. Implement UI first. Rejected because archive rewrite safety needs proof
   before exposing destructive actions.
2. Rewrite immediately per copy. Rejected because staged batch save is the
   accepted product contract.

