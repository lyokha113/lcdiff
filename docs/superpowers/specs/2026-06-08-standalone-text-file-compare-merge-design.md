# Standalone text-file compare & line-merge — Design

Date: 2026-06-08
Status: Approved (brainstorming)
Risk lane: high-risk (new write path can overwrite/delete bytes in user files;
"move" deletes from the source file — data-loss surface)

## Problem

LDiff today only opens a `.jar`/`.zip` archive or a folder. Users cannot open a
standalone text-based file (json, xml, properties, toml, sql, txt, yaml…) to
compare it against another standalone file. Comparing two loose config files
requires wrapping them in archives or using a separate diff tool. Users want to
open two text-based files directly, see the diff, and merge changes between them
at hunk granularity — copy a change across, or move it (copy then delete from
the source) — and save the result back.

## Goals

1. Open any single file as a compare source (no extension allowlist). Text →
   Monaco source diff; binary → hex/size/CRC diff (reuses existing detection).
2. Compare two standalone files side by side with the existing diff pipeline.
3. Hunk-level + whole-file merge between two **File** sources via the Monaco diff
   editor: copy a hunk across, "take all" from one side, and **move** (copy hunk
   to target + delete from source).
4. Save edited buffers back atomically (temp → fsync → rename) with optional
   `.bak`, preserving original encoding (BOM) and line endings.

## Non-goals

- Per-single-line merge inside a hunk (v1 is hunk-level + whole-file only).
- A 3-pane editable merge view (Meld style). Result edits happen in the existing
  two-pane Compare editor.
- Changing archive/entry merge semantics: archive merge stays **whole-entry byte
  copy** (`StagedOp::Copy`), never synthesized content. The new line/hunk merge
  applies only to standalone File↔File compare.
- Save-as to a new path. Save overwrites the opened file in place (+ `.bak`).
- Editing decompiled Java or binary files (read-only as today).

## Decisions (from brainstorming)

- Use case: **compare two standalone files** (Q1 → option 1).
- Accepted files: **any single file**, reuse `detect_entry_kind`; no allowlist
  (Q2 → option 1). A `.jar`/`.zip` picked still opens as an archive (existing
  path wins); a folder still opens as a directory.
- Merge support: **hunk + whole-file**, Monaco-native arrows (Q4 → option 1).
  **Move** = copy hunk to target side, then delete it from the source side; both
  files become dirty and both are saved (Q5).
- Save: **overwrite in place, atomic + `.bak`, preserve encoding + EOL** (Q5 →
  option 1).
- Archive merge unchanged — same merge *flow/UI*, but archive operates at file
  (whole-entry) grain; only File↔File gets hunk/line merge.

## Architecture

Reuse the shipped text-write pipeline from the in-place-edit feature. A single
file is modeled as a **one-entry Archive**, so the entire entry/diff/preview/
save machinery applies unchanged.

### Source model

`ArchiveSourceKind` gains a `File` variant beside `Archive` and `Directory`.

```rust
pub enum ArchiveSourceKind { Archive, Directory, File }
```

`Archive::open_validated(path)`:
- `path.is_dir()` → `open_directory` (unchanged).
- else if it parses as a zip (existing zip-magic / `open_zip` path) → archive.
- else → **`open_single_file(path)`** (new): read bytes, compute CRC32 + size,
  build a `BTreeMap` with one `ArchiveEntry` whose `path` is the file name and
  whose `kind` comes from `detect_entry_kind(name, false)`. `source_paths` maps
  that single entry to the on-disk file. `metadata.source_kind = File`.

The tree then renders a single node; CRC diff, source/hex preview, and Monaco
diff all work with no new code on the read side.

### Write model — reuse `StagedOp::Write`

The merge result is synthesized text, which is exactly what `StagedOp::Write {
target_entry_path, new_bytes, encoding, original_crc32 }` already represents.
`commit_merge` already encodes per `EntryEncoding`, recomputes CRC/size, and
writes atomically with `.bak`. For a `File` source the central-directory
replacement collapses to "write these bytes to the single backing file".

Each merge action turns into one or more `stage_write` calls:
- **Copy hunk → target**: target buffer with the hunk applied →
  `stage_write(targetSide, name, mergedContent)`.
- **Take-all from side X**: `stage_write(otherSide, name, contentOfX)`.
- **Move hunk**: `stage_write(targetSide, name, targetWithHunkAdded)` **and**
  `stage_write(sourceSide, name, sourceWithHunkRemoved)`.

### Both-sides-writable constraint (the one real core change)

Today `stage_write` locks a single target side and rejects writes to the other
(`stage_write_locks_target_and_rejects_other_side`). "Move" requires both File
sources writable at once. Resolution: when **both sides are `File` sources**,
relax the single-target lock so each side keeps its own independent
`Vec<StagedOp>` and commits independently. The single-target lock stays in force
for archive/folder targets (unchanged invariant). This is gated on
`source_kind == File` on both sides, so archive merge behavior is untouched.

## Components & data flow

- **Open (frontend → Tauri):** the file picker / drop already yields a path;
  `open_single_file` is reached transparently through `open_validated`. No new
  command for open.
- **Compare editor (`src/App.tsx` + Monaco DiffEditor):** when both sides are
  `File`, the DiffEditor becomes **editable on both sides** (today Compare mode
  is read-only). Monaco's built-in change-navigation arrows copy a hunk across;
  a per-side "take all" action and a "move" action (copy + delete-from-source)
  sit in the diff toolbar. Edited buffers are dirty per side and flushed via
  `stage_write(side, name, content)`.
- **Save:** existing `commit_merge(side)` per dirty side; atomic + `.bak`;
  encoding/EOL from `EntryEncoding` detected on open.
- **Guard:** editable-on-both-sides applies only to File↔File. Archive-entry and
  folder compare keep current read-only Compare behavior + whole-entry copy.

## Error handling

- Unreadable / permission-denied / oversize file on open → existing per-panel
  inline preflight error.
- Non-text / binary single file → opens read-only (hex/size view); merge actions
  hidden (no synthesized text for binary).
- File changed on disk since open (CRC mismatch vs `original_crc32`) → block
  commit, warn, offer reload. Reuses the dirty/stale detection path.
- Commit failure → atomic temp-write leaves the original untouched; `.bak`
  enables rollback.
- Move that empties the source file → allowed (writes empty content); warn in
  the pending-changes summary so it is not silent.

## Testing (TDD)

Core (`ldiff-core`):
1. `open_single_file`: opens a `.json`, one entry, kind = text, CRC/size correct.
2. `.jar` path still opens as `Archive`, folder still as `Directory` (no
   regression in source-kind routing).
3. File source `stage_write` → commit → reopen → bytes + CRC match.
4. Encoding round-trip: CRLF + BOM preserved through merge + commit.
5. Both-sides-writable: two File sources each stage a write and commit
   independently; archive/folder target still rejects second-side write.
6. Move: target gains hunk + source loses it; both commit; reopen confirms both.

Frontend:
7. Two File sources → DiffEditor editable both sides; hunk arrow copies a block;
   buffer becomes dirty.
8. Take-all replaces target buffer with source content.
9. Move marks both sides dirty; pending summary shows source-delete + target-add.
10. Archive/folder compare stays read-only in Compare mode (guard holds).

## Affected surfaces

- `crates/ldiff-core/src/archive.rs` — `ArchiveSourceKind::File`,
  `open_single_file`, routing in `open_validated`.
- `crates/ldiff-core/src/merge.rs` — relax single-target lock when both sides are
  File sources (independent per-side staging/commit).
- `src-tauri/src/main.rs` — allow `stage_write` on both sides for File↔File;
  per-side `commit_merge`.
- `src/App.tsx` + Monaco DiffEditor wrapper — editable Compare for File↔File,
  hunk-copy / take-all / move toolbar actions, per-side dirty state.
- `src/lib/types` + tree component — surface `File` source kind, pending summary
  for move (delete-from-source + add-to-target).
