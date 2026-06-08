# Decision 0008: In-Place Text Edit via Staged-Op Enum

## Status

Accepted

## Context

Users need to edit text-based entries (xml/json/ini/txt/properties/yaml…) inside
a JAR/ZIP without the manual unzip → edit → re-zip round-trip. Writing new bytes
back into a user archive is a destructive, data-integrity-sensitive operation
(high-risk lane). The existing merge pipeline already performs atomic
temp-rewrite + `.bak` + signed-archive detection for staged entry copies.

## Decision

Extend the existing staged-merge pipeline rather than add a parallel write path.
`MergePlan` stores `Vec<StagedOp>` where `StagedOp` is `Copy{…}` (unchanged) or
`Write{ target_entry_path, new_bytes }`. `read_replacements` reduces both kinds
to the established `BTreeMap<target_path, bytes>` that `commit` already consumes,
so CRC32 and entry sizes are recomputed by the existing `ZipWriter` /
directory-rewrite code with no special-casing.

Encoding is detected from the original entry bytes and re-applied when a write is
staged: UTF-8 only, preserving a leading BOM and the dominant line ending
(LF vs CRLF) so the round-trip is byte-faithful apart from the user's change.
Editability is gated in `jdiff-core::edit::editable_text`: text-detection OR an
extension whitelist, AND no null byte, AND valid UTF-8, AND not a directory or
decompiled class view. Editing is enabled only in Single/View mode's Monaco
editor; the Compare-mode diff stays read-only.

## Consequences

- One commit path: copies and edits commit together, atomically, with `.bak`.
- Editing a signed archive reuses the existing signed-save warning and reports
  `signatureInvalidated` — no new signing logic.
- The editability rule lives in Rust (the authority); the frontend mirrors a
  lighter check only to toggle the editor's read-only state.
- Bare-`\r` (classic-Mac) line endings are treated as LF and preserved unchanged;
  no `Cr` variant was added (out of scope).
- The pending-changes UI was reworked (Save-to-archive (N) button + popover
  distinguishing edit vs copy) so an in-place edit is reachable for save in
  Single/View mode, which previously disabled the Save control.

## Verification

`cargo test --workspace` (79 passed): core `edit` module, `merge` stage_write +
mixed copy/write commit + cross-kind restage, src-tauri `stage_write` AppState
guards. Frontend: vitest (MenuBar pending-ops popover + per-row unstage), tsc,
vite build. Tracked by harness story `jdiff-inplace-edit` (intake #4).
