# Edit text entry in-place (jar/zip + folder) — Design

Date: 2026-06-08
Status: Approved (brainstorming)
Risk lane: high-risk (writes new bytes into user archives — data integrity)

## Problem

Editing a text-based file (xml/json/ini/txt/properties/yaml…) inside a JAR/ZIP
today requires unzip → edit → re-zip. Users want to edit such entries directly
inside the archive from jdiff, then write the change back, without the manual
round-trip. Secondary problem: the current "staged" status UI is confusing —
icon-only Save, cryptic `2 → right` badge, jargon "staged" — and gives no view
of what is pending.

## Goals

1. Edit text-based entries in place for JAR/ZIP archives **and** folder targets,
   on both left and right sides.
2. Write edits back through the existing atomic save + `.bak` merge pipeline.
3. Make pending-changes status clear: labeled Save button with count, a popover
   listing each pending op, and unambiguous terminology.

## Non-goals

- Editing decompiled Java (.class views stay read-only).
- Editing binary entries (read-only as today).
- Rich/structured editors per format — plain text editing in Monaco only.

## Decisions (from brainstorming)

- Edit trigger: **text entries editable by default** when opened (no toggle);
  binary + decompiled stay read-only.
- Edit pane: **Single/View mode only** — the single `Editor` is editable for
  text entries; Compare mode's `DiffEditor` stays read-only both sides. To edit
  either archive, open it in View mode (it loads into the left/visible side).
- Save model: **stage → commit through the shared merge pipeline** (one Save
  commits all pending ops atomically; undo before commit).
- Scope: archives **and** folders, both sides.
- Text detection: existing "detected text languages" detection **plus** an
  extension whitelist, AND a null-byte/UTF-8 guard.
- Integration approach: **A — staged op enum** (`StagedCopy` → `StagedOp`).

## Architecture

Reuse the staged-merge pipeline. Core change centred on
`crates/jdiff-core/src/merge.rs`:

```rust
enum StagedOp {
    Copy  { source_archive: PathBuf, source_entry_path: String,
            target_entry_path: String, source_snapshot: Archive },
    Write { target_entry_path: String, new_bytes: Vec<u8>,
            encoding: EntryEncoding, original_crc32: u32 },
}

struct EntryEncoding { charset: Charset /* utf8 default */, bom: bool,
                       line_ending: LineEnding /* LF | CRLF, preserved */ }
```

`MergeSession` holds `Vec<StagedOp>`. `commit_merge` iterates:
- `Copy` → take bytes from `source_snapshot` (unchanged behavior).
- `Write` → encode `new_bytes` per `encoding`, recompute CRC32 + size, replace
  the entry in the target's central directory.

Same atomic temp-rewrite + `.bak` + signed-archive detection as today. A commit
can mix `Copy` and `Write` ops.

## Components & data flow

- **Frontend (`src/App.tsx` + Monaco):** a text entry opens editable by default.
  A dirty buffer calls a new Tauri command `stage_write(side, path, content)`.
  Binary / decompiled views remain read-only.
- **Editable gate `is_editable(entry, view)`:** true when
  (text-detection positive **OR** extension ∈ whitelist) **AND** no null byte in
  content **AND** view is not the decompiled view.
  Whitelist (editable, configurable): `xml json ini txt properties yaml yml md
  csv cfg conf`.
- **Encoding:** detected on read — UTF-8 default; preserve leading BOM and
  original line endings (CRLF vs LF). Stored in `StagedOp::Write.encoding` and
  re-applied on commit so the round-trip is byte-faithful apart from the edit.
- **Commit:** `commit_merge` recomputes CRC32 and uncompressed/compressed size
  for each `Write`, updates the central directory entry.

## Pending-changes UI (MenuBar)

- Terminology: "staged" → **"unsaved changes"**. Save label
  **"Save to archive (N)"**; tooltip "Write unsaved changes into the target
  archive".
- Save button shows text + count and a `▾` that opens a popover listing each
  pending op — `✎ edit` vs `⇒ copy` — each row with a `[×]` to unstage.
  Discard clears all.
- Tree highlight distinguishes an edited entry from a copied entry (different
  icon/color) so the two pending kinds are visible at the source.
- State change: `stagedEntries` grows from `Record<path, Side>` to
  `Record<path, { side: Side; kind: "copy" | "edit" }>` to drive the popover and
  the tree highlight.

## Error handling

- **Signed archive:** editing invalidates the signature — reuse the existing
  signed-save warning dialog; commit reports `signatureInvalidated`.
- **Non-UTF-8 / detection failure:** block editing, keep read-only, show
  "binary/unknown encoding — not editable".
- **Undo before commit:** unstage a write from the pending list (same as
  unstaging a copy).
- **Commit failure:** atomic temp write means the original file is untouched;
  `.bak` allows rollback.
- **Mode guard:** existing "Save or clear staged before switching to Single
  mode" applies to writes too.

## Testing (TDD)

Core (`jdiff-core`):
1. stage write → commit → reopen → bytes and CRC32 match the edit.
2. encoding round-trip: CRLF + BOM preserved through edit+commit.
3. editable gate: whitelist extension passes; null-byte content rejected;
   binary entry rejected.
4. signed archive: commit sets `signatureInvalidated`.
5. folder target: write commits to a folder side.
6. mixed batch: one commit with both `Copy` and `Write` ops.

Frontend:
7. MenuBar renders "Save to archive (N)" with correct count; popover lists ops
   with edit/copy kind; `[×]` unstages.
8. text entry editable, decompiled/binary read-only.

## Affected surfaces

- `crates/jdiff-core/src/merge.rs` — `StagedOp` enum, commit logic.
- `crates/jdiff-core/src/archive.rs` — entry replacement + CRC/size recompute.
- `crates/jdiff-cli` — adapt staged-op callers.
- Tauri commands (`src-tauri`) — add `stage_write`; adapt `commit_merge`,
  `unstage`, `clear_staged`.
- `src/App.tsx`, `src/components/MenuBar.tsx`, tree component, `src/lib/types`.
