# Standalone Text-File Compare & Line-Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open any single file as a compare source, diff two standalone files, and merge changes between them (hunk copy / take-all / move) with atomic in-place save.

**Architecture:** Model a single file as a one-entry `Archive` (`ArchiveSourceKind::File`) so the existing entry/diff/preview/save pipeline applies unchanged. Reuse `StagedOp::Write` + `EntryEncoding` for synthesized text. Relax the single-target staging lock only when both sides are File sources, so "move" (write target + delete-from-source) can stage both sides at once. Archive/folder merge stays whole-entry byte copy, lock intact.

**Tech Stack:** Rust (`ldiff-core`, `zip`, `crc32fast`), Tauri commands (`src-tauri`), React + `@monaco-editor/react` DiffEditor, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-standalone-text-file-compare-merge-design.md`

---

## File map

- `crates/ldiff-core/src/archive.rs` — `ArchiveSourceKind::File`, `open_single_file`, magic-byte routing in `open_validated`, `read_entry` File branch.
- `crates/ldiff-core/src/merge.rs` — `commit` File branch (write backing file atomically).
- `src-tauri/src/main.rs` — per-side merge plans in `AppState`, relaxed lock for File↔File, per-side commit/unstage/clear.
- `src/lib/types.ts` — add `"file"` to `sourceKind`.
- `src/lib/textMerge.ts` (new) — pure hunk/take-all/move buffer transforms.
- `src/components/DiffView.tsx` — editable Compare DiffEditor + merge toolbar for File↔File.
- `src/App.tsx` — `isFileMerge`, per-side dirty buffers, stage/commit wiring.

---

## Phase A — Core: File source

### Task 1: `ArchiveSourceKind::File` variant

**Files:**
- Modify: `crates/ldiff-core/src/archive.rs:37-42`

- [ ] **Step 1: Write the failing test**

Add to the test module at the bottom of `crates/ldiff-core/src/archive.rs` (create a `#[cfg(test)] mod source_kind_tests { use super::*; ... }` block if none exists in this file; otherwise append):

```rust
#[test]
fn file_source_kind_serializes_camel_case() {
    let json = serde_json::to_string(&ArchiveSourceKind::File).unwrap();
    assert_eq!(json, "\"file\"");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p ldiff-core file_source_kind_serializes_camel_case`
Expected: FAIL — no variant `File`.

- [ ] **Step 3: Add the variant**

In `crates/ldiff-core/src/archive.rs`, extend the enum (currently `Archive, Directory`):

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveSourceKind {
    Archive,
    Directory,
    File,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p ldiff-core file_source_kind_serializes_camel_case`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/ldiff-core/src/archive.rs
git commit -m "feat(core): add ArchiveSourceKind::File variant"
```

---

### Task 2: `open_single_file` + magic-byte routing

A single file is a one-entry archive. Route to it only when the path is not a directory and not a zip (detected by local/EOCD signature), so `.jar`/`.zip` keep opening as archives.

**Files:**
- Modify: `crates/ldiff-core/src/archive.rs:60-65` (`open_validated`), add `open_single_file` after `open_directory`.

- [ ] **Step 1: Write the failing tests**

Append to the test module in `crates/ldiff-core/src/archive.rs`:

```rust
#[test]
fn opens_single_text_file_as_one_entry() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("config.json");
    std::fs::write(&file, b"{\"a\":1}\n").unwrap();

    let archive = Archive::open(file.to_string_lossy()).unwrap();
    assert_eq!(archive.metadata().source_kind, ArchiveSourceKind::File);
    let entries: Vec<_> = archive.entries().collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "config.json");
    assert_eq!(entries[0].kind, EntryKind::Text);
    assert_eq!(archive.read_entry("config.json").unwrap(), b"{\"a\":1}\n");
}

#[test]
fn zip_path_still_opens_as_archive() {
    // Build a minimal in-memory zip on disk.
    let dir = tempfile::tempdir().unwrap();
    let jar = dir.path().join("lib.jar");
    let file = std::fs::File::create(&jar).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    zip.start_file("a.txt", zip::write::SimpleFileOptions::default()).unwrap();
    use std::io::Write as _;
    zip.write_all(b"hi").unwrap();
    zip.finish().unwrap();

    let archive = Archive::open(jar.to_string_lossy()).unwrap();
    assert_eq!(archive.metadata().source_kind, ArchiveSourceKind::Archive);
}
```

If `tempfile` is not already a dev-dependency of `ldiff-core`, add it: in `crates/ldiff-core/Cargo.toml` under `[dev-dependencies]` add `tempfile = "3"` and `serde_json = "1"` (only if missing — check first with `rg tempfile crates/ldiff-core/Cargo.toml`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p ldiff-core opens_single_text_file_as_one_entry zip_path_still_opens_as_archive`
Expected: FAIL — `opens_single_text_file...` errors (non-zip currently returns `Error::InvalidArchive`).

- [ ] **Step 3: Implement routing + `open_single_file`**

Replace `open_validated` body in `crates/ldiff-core/src/archive.rs`:

```rust
pub fn open_validated(path: PathBuf) -> Result<Self> {
    if path.is_dir() {
        return Self::open_directory(path);
    }
    if path_is_zip(&path)? {
        return Self::open_zip(path);
    }
    Self::open_single_file(path)
}
```

Add helper `path_is_zip` (free function near the bottom of the file, beside other helpers):

```rust
/// True when the file begins with a ZIP signature (local header, EOCD, or
/// spanned marker). Used to route archive vs single-file open.
fn path_is_zip(path: &Path) -> Result<bool> {
    use std::io::Read as _;
    let mut header = [0u8; 4];
    let mut file = File::open(path)?;
    let read = file.read(&mut header)?;
    if read < 4 {
        return Ok(false);
    }
    Ok(matches!(
        &header,
        b"PK\x03\x04" | b"PK\x05\x06" | b"PK\x07\x08"
    ))
}
```

Add `open_single_file` after `open_directory`:

```rust
fn open_single_file(path: PathBuf) -> Result<Self> {
    let file_metadata = fs::metadata(&path)?;
    let bytes = fs::read(&path)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_owned());
    let normalized = normalize_archive_entry_path(&name)?;
    let mut hasher = Hasher::new();
    hasher.update(&bytes);
    let crc32 = hasher.finalize();
    let entry = ArchiveEntry {
        path: normalized.clone(),
        kind: detect_entry_kind(&normalized, false),
        uncompressed_size: bytes.len() as u64,
        compressed_size: bytes.len() as u64,
        crc32,
    };
    let mut entries = BTreeMap::new();
    entries.insert(normalized.clone(), entry);
    let mut source_paths = BTreeMap::new();
    source_paths.insert(normalized.clone(), name);
    Ok(Self {
        path,
        size: file_metadata.len(),
        modified: file_metadata.modified().ok(),
        entries,
        source_paths,
        metadata: ArchiveMetadata {
            source_kind: ArchiveSourceKind::File,
            signed: false,
            multi_release: false,
            zip64: false,
        },
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p ldiff-core opens_single_text_file_as_one_entry zip_path_still_opens_as_archive`
Expected: both PASS. (`read_entry` for File works after Task 3; the read assertion in test 1 will still fail until Task 3 — temporarily comment the `read_entry` line, OR implement Task 3 before running Step 4. Recommended: implement Task 3 then run both. To keep this task self-contained, comment the last assertion now and uncomment in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add crates/ldiff-core/src/archive.rs crates/ldiff-core/Cargo.toml
git commit -m "feat(core): open standalone file as one-entry File-source archive"
```

---

### Task 3: `read_entry` File branch

**Files:**
- Modify: `crates/ldiff-core/src/archive.rs:173-205` (`read_entry`)

- [ ] **Step 1: Write the failing test**

Uncomment the `read_entry` assertion in `opens_single_text_file_as_one_entry` (Task 2). It currently fails because `read_entry` falls through to the zip branch (`ZipArchive::new` on a non-zip file errors).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p ldiff-core opens_single_text_file_as_one_entry`
Expected: FAIL — zip parse error.

- [ ] **Step 3: Add the File branch**

In `read_entry`, right after the `Directory` branch (before the zip logic), add:

```rust
if self.metadata.source_kind == ArchiveSourceKind::File {
    return fs::read(&self.path).map_err(Error::from);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p ldiff-core opens_single_text_file_as_one_entry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/ldiff-core/src/archive.rs
git commit -m "feat(core): read_entry reads backing file for File source"
```

---

### Task 4: `commit` File branch — atomic in-place write

`commit` branches Directory vs archive. A File target must write the single replacement's bytes straight to `target.path()` (atomic temp → rename), with optional `.bak` via `fs::copy`.

**Files:**
- Modify: `crates/ldiff-core/src/merge.rs:146-192` (`commit`)

- [ ] **Step 1: Write the failing test**

Add to the `stage_write_tests` module in `crates/ldiff-core/src/merge.rs`:

```rust
#[test]
fn commit_writes_file_source_in_place_with_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.txt");
    std::fs::write(&path, b"old\n").unwrap();

    let target = Archive::open(path.to_string_lossy()).unwrap();
    let mut plan = MergePlan::new();
    plan.stage_write("notes.txt", b"new\n".to_vec()).unwrap();
    let result = plan.commit(&target, CommitOptions { backup: true }).unwrap();

    assert_eq!(std::fs::read(&path).unwrap(), b"new\n");
    assert!(result.backup_path.is_some());
    assert_eq!(std::fs::read(result.backup_path.unwrap()).unwrap(), b"old\n");
    assert_eq!(result.copied_entries, 1);
    assert!(!result.signature_invalidated);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p ldiff-core commit_writes_file_source_in_place_with_backup`
Expected: FAIL — File target falls into the archive branch and `rewrite_archive` corrupts/errors on a non-zip file.

- [ ] **Step 3: Add the File branch in `commit`**

In `commit`, change the `result` selection to a three-way branch. Replace the `let result = if ... Directory { ... } else { ...archive... };` with:

```rust
let result = if target.metadata().source_kind == ArchiveSourceKind::Directory {
    rewrite_directory(target_path, &replacements, backup_path.as_deref()).map(|_| {
        CommitResult {
            rewritten_path: target_path.to_path_buf(),
            backup_path,
            signature_invalidated: nested_rewrite,
            copied_entries,
        }
    })
} else if target.metadata().source_kind == ArchiveSourceKind::File {
    // Single backing file: write the one replacement's bytes atomically.
    let bytes = replacements
        .values()
        .next()
        .ok_or(Error::EmptyMergePlan)?;
    let temp_path = temp_path_for(target_path);
    let write = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .and_then(|mut f| {
            f.write_all(bytes)?;
            f.sync_all()
        })
        .map_err(Error::from)
        .and_then(|_| {
            if let Some(backup_path) = &backup_path {
                fs::copy(target_path, backup_path)?;
            }
            atomic_replace(&temp_path, target_path)
        })
        .inspect_err(|_| {
            fs::remove_file(&temp_path).ok();
        });
    write.map(|_| CommitResult {
        rewritten_path: target_path.to_path_buf(),
        backup_path,
        signature_invalidated: false,
        copied_entries,
    })
} else {
    let temp_path = temp_path_for(target_path);
    rewrite_archive(target_path, &temp_path, &replacements)
        .and_then(|_| {
            if let Some(backup_path) = &backup_path {
                fs::copy(target_path, backup_path)?;
            }
            atomic_replace(&temp_path, target_path)
        })
        .map(|_| CommitResult {
            rewritten_path: target_path.to_path_buf(),
            backup_path,
            signature_invalidated: target.metadata().signed || nested_rewrite,
            copied_entries,
        })
        .inspect_err(|_| {
            fs::remove_file(&temp_path).ok();
        })
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p ldiff-core commit_writes_file_source_in_place_with_backup`
Expected: PASS.

- [ ] **Step 5: Run full core suite (no regressions)**

Run: `cargo test -p ldiff-core`
Expected: PASS (all existing copy/write/directory tests still green).

- [ ] **Step 6: Commit**

```bash
git add crates/ldiff-core/src/merge.rs
git commit -m "feat(core): commit File source by atomic in-place write"
```

---

## Phase B — Tauri: both-sides-writable for File↔File

`AppState` holds one `merge_plan` + one `staged_target`, enforcing a single staging target. "Move" needs both File sides staged at once. Replace with per-side plans; keep the single-target lock for archive/folder, bypass it only when both sides are File sources.

### Task 5: per-side merge plans in `AppState`

**Files:**
- Modify: `src-tauri/src/main.rs:40-53` (struct), `:62-75` (new), `:105-207` (stage/commit/clear/unstage), `:284` (open guard).

- [ ] **Step 1: Write the failing test**

Add to the test module in `src-tauri/src/main.rs` (next to `stage_write_locks_target_and_rejects_other_side`):

```rust
#[test]
fn file_sources_allow_staging_both_sides() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("a.txt");
    let right = dir.path().join("b.txt");
    std::fs::write(&left, b"a\n").unwrap();
    std::fs::write(&right, b"b\n").unwrap();

    let mut state = AppState::default();
    state.install_archive(Archive::open(left.to_string_lossy()).unwrap(), Side::Left).unwrap();
    state.install_archive(Archive::open(right.to_string_lossy()).unwrap(), Side::Right).unwrap();

    // Both sides stage without the cross-side lock error.
    state.stage_write(Side::Left, "a.txt", "a2\n").unwrap();
    state.stage_write(Side::Right, "b.txt", "b2\n").unwrap();
}
```

Keep the existing `stage_write_locks_target_and_rejects_other_side` test unchanged — it uses archive sources and must still reject the second side.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p ldiff-desktop file_sources_allow_staging_both_sides` (use the actual `src-tauri` package name — check `name =` in `src-tauri/Cargo.toml`; substitute below wherever `ldiff-desktop` appears).
Expected: FAIL — second `stage_write` returns the cross-side lock error.

- [ ] **Step 3: Refactor `AppState` to per-side plans**

In the struct (`src-tauri/src/main.rs:40`), replace:

```rust
    merge_plan: MergePlan,
    staged_target: Option<Side>,
```

with:

```rust
    left_plan: MergePlan,
    right_plan: MergePlan,
```

In `AppState::new` (`:71-72`) replace the two initializers with:

```rust
            left_plan: MergePlan::new(),
            right_plan: MergePlan::new(),
```

Add accessor + lock helpers in `impl AppState` (near `archive`):

```rust
fn plan_mut(&mut self, side: Side) -> &mut MergePlan {
    match side {
        Side::Left => &mut self.left_plan,
        Side::Right => &mut self.right_plan,
    }
}

fn plan(&self, side: Side) -> &MergePlan {
    match side {
        Side::Left => &self.left_plan,
        Side::Right => &self.right_plan,
    }
}

fn both_sides_are_files(&self) -> bool {
    matches!((&self.left, &self.right), (Some(l), Some(r))
        if l.metadata().source_kind == ArchiveSourceKind::File
            && r.metadata().source_kind == ArchiveSourceKind::File)
}

fn any_pending(&self) -> bool {
    !self.left_plan.is_empty() || !self.right_plan.is_empty()
}

/// Legacy single-target lock: only one side may carry pending ops unless both
/// sources are standalone files. Returns Err if `side` would violate it.
fn ensure_can_stage(&self, side: Side) -> Result<(), String> {
    if self.both_sides_are_files() {
        return Ok(());
    }
    let other = match side {
        Side::Left => Side::Right,
        Side::Right => Side::Left,
    };
    if !self.plan(other).is_empty() {
        return Err("save or clear unsaved changes before editing the other side".to_owned());
    }
    Ok(())
}
```

Add the imports `ArchiveSourceKind` to the `use ldiff_core::{...}` line if not present.

- [ ] **Step 4: Update stage/commit/clear/unstage to per-side plans**

`stage_copy` (`:105`): replace the `staged_target` check + `self.merge_plan` use:

```rust
fn stage_copy(&mut self, from: Side, to: Side, entry_path: &str) -> Result<(), String> {
    if from == to {
        return Err("source and target sides must differ".to_owned());
    }
    self.ensure_can_stage(to)?;
    let source = archive(self, from)
        .ok_or("source archive is not loaded")?
        .clone();
    self.plan_mut(to)
        .stage_copy(&source, entry_path, entry_path)
        .map_err(|error| error.to_string())?;
    Ok(())
}
```

`stage_write` (`:124`): replace the `staged_target` check + plan use:

```rust
fn stage_write(&mut self, side: Side, entry_path: &str, content: &str) -> Result<(), String> {
    self.ensure_can_stage(side)?;
    let archive = archive(self, side)
        .ok_or("archive is not loaded")?
        .clone();
    let entry = archive
        .entry(entry_path)
        .ok_or("entry is not indexed")?
        .clone();
    let original = archive
        .read_entry(entry_path)
        .map_err(|error| error.to_string())?;
    if !edit::editable_text(&entry, &original) {
        return Err("entry is not an editable text file".to_owned());
    }
    let encoding = edit::detect_encoding(&original);
    let new_bytes = edit::encode_text(content, &encoding);
    self.plan_mut(side)
        .stage_write(entry_path, new_bytes)
        .map_err(|error| error.to_string())?;
    Ok(())
}
```

`commit_merge` (`:150`): commit that side's own plan, drop `staged_target`:

```rust
fn commit_merge(
    &mut self,
    target_side: Side,
    backup: bool,
    confirm_signed: bool,
) -> Result<CommitResult, String> {
    let target = archive(self, target_side)
        .ok_or("target archive is not loaded")?
        .clone();
    if target.metadata().signed && !confirm_signed {
        return Err("signed archive confirmation is required before save".to_owned());
    }
    let result = self
        .plan_mut(target_side)
        .commit(&target, CommitOptions { backup })
        .map_err(|error| error.to_string())?;
    *archive_mut(self, target_side) = Some(
        Archive::open(result.rewritten_path.to_string_lossy())
            .map_err(|error| error.to_string())?,
    );
    match target_side {
        Side::Left => {
            self.left_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
        }
        Side::Right => {
            self.right_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?
        }
    }
    Ok(result)
}
```

`clear_staged` (`:190`):

```rust
fn clear_staged(&mut self) {
    self.left_plan.clear();
    self.right_plan.clear();
}
```

`unstage` (`:195`): search both plans:

```rust
fn unstage(&mut self, entry_path: &str) -> Result<(), String> {
    for side in [Side::Left, Side::Right] {
        if self
            .plan_mut(side)
            .unstage(entry_path)
            .map_err(|error| error.to_string())?
        {
            return Ok(());
        }
    }
    Err("staged entry is not found".to_owned())
}
```

Fix the open guard at `:284`:

```rust
        if state.any_pending() {
            return Err("save staged copies before changing an archive".to_owned());
        }
```

Fix `install_archive` if it referenced `staged_target` / `merge_plan` (`rg -n "staged_target|merge_plan" src-tauri/src/main.rs` and resolve each remaining hit: pending checks → `any_pending()`, clears → clear both plans).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p ldiff-desktop file_sources_allow_staging_both_sides stage_write_locks_target_and_rejects_other_side`
Expected: both PASS — File↔File stages both; archive still rejects the second side.

- [ ] **Step 6: Run full Tauri suite**

Run: `cargo test -p ldiff-desktop`
Expected: PASS. Resolve any remaining `staged_target` references the compiler flags.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tauri): per-side merge plans; allow both-side staging for File sources"
```

---

### Task 6: expose `stagedTarget` removal to the frontend contract

The frontend reads `stagedTarget` to decide which side to save. With per-side plans, both sides can be dirty. The Tauri layer no longer owns a single target; the frontend already tracks `stagedEntries[path].side`. No new command needed — `commit_merge` already takes `targetSide`. This task only verifies the existing commands still satisfy the frontend.

- [ ] **Step 1: Verify command surface unchanged**

Run: `rg -n "tauri::command" src-tauri/src/main.rs | rg -i "stage_write|commit_merge|stage_copy|unstage|clear_staged"`
Expected: all five commands still present with the same signatures.

- [ ] **Step 2: Build check**

Run: `cargo build -p ldiff-desktop`
Expected: clean build.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "chore(tauri): confirm command surface after per-side plan refactor" || echo "nothing to commit"
```

---

## Phase C — Frontend: compare-merge UI

### Task 7: surface `file` source kind

**Files:**
- Modify: `src/lib/types.ts:24`

- [ ] **Step 1: Add the union member**

Change the `sourceKind` field:

```ts
{ sourceKind: "archive" | "directory" | "file"; signed: boolean; multiRelease: boolean; ... }
```

(keep the rest of the line as-is)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(ui): add 'file' source kind to types"
```

---

### Task 8: pure text-merge transforms

Isolate merge math from Monaco so it is unit-testable. A "hunk" is a line range on one side mapped to a line range on the other (from Monaco `getLineChanges()`).

**Files:**
- Create: `src/lib/textMerge.ts`
- Create: `src/lib/textMerge.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/textMerge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { takeAll, applyHunk, moveHunk, type Hunk } from "./textMerge";

describe("takeAll", () => {
  it("replaces target with source content", () => {
    expect(takeAll("dst\n", "src\n")).toBe("src\n");
  });
});

describe("applyHunk", () => {
  it("replaces target lines with source lines", () => {
    const target = "1\n2\n3\n";
    const source = "1\nX\n3\n";
    // replace target line 2 (1-based) with source line 2
    const hunk: Hunk = { targetStart: 2, targetEnd: 2, sourceStart: 2, sourceEnd: 2 };
    expect(applyHunk(target, source, hunk)).toBe("1\nX\n3\n");
  });

  it("handles insertion (target range empty)", () => {
    const target = "1\n3\n";
    const source = "1\n2\n3\n";
    const hunk: Hunk = { targetStart: 2, targetEnd: 1, sourceStart: 2, sourceEnd: 2 };
    expect(applyHunk(target, source, hunk)).toBe("1\n2\n3\n");
  });
});

describe("moveHunk", () => {
  it("adds to target and removes from source", () => {
    const target = "1\n3\n";
    const source = "1\n2\n3\n";
    const hunk: Hunk = { targetStart: 2, targetEnd: 1, sourceStart: 2, sourceEnd: 2 };
    const { target: t, source: s } = moveHunk(target, source, hunk);
    expect(t).toBe("1\n2\n3\n");
    expect(s).toBe("1\n3\n");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- textMerge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `textMerge.ts`**

```ts
/**
 * Pure line-range merge transforms shared by the File↔File compare editor.
 * Line numbers are 1-based and inclusive, matching Monaco's IChange ranges.
 * An empty range is encoded as `end = start - 1` (Monaco's convention for
 * an insertion point with no lines on that side).
 */
export interface Hunk {
  targetStart: number;
  targetEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

function splitLines(text: string): string[] {
  // Preserve a trailing newline as a trailing empty segment so join round-trips.
  return text.split("\n");
}

function sliceInclusive(lines: string[], start: number, end: number): string[] {
  if (end < start) return [];
  return lines.slice(start - 1, end);
}

/** Replace the entire target buffer with the source buffer. */
export function takeAll(_target: string, source: string): string {
  return source;
}

/** Replace the target's line range with the source's line range. */
export function applyHunk(target: string, source: string, hunk: Hunk): string {
  const tLines = splitLines(target);
  const sLines = splitLines(source);
  const replacement = sliceInclusive(sLines, hunk.sourceStart, hunk.sourceEnd);
  const before = tLines.slice(0, Math.max(0, hunk.targetStart - 1));
  const after = tLines.slice(Math.max(hunk.targetStart - 1, hunk.targetEnd));
  return [...before, ...replacement, ...after].join("\n");
}

/** Apply the hunk to target AND remove the moved lines from source. */
export function moveHunk(
  target: string,
  source: string,
  hunk: Hunk,
): { target: string; source: string } {
  const newTarget = applyHunk(target, source, hunk);
  const sLines = splitLines(source);
  const before = sLines.slice(0, Math.max(0, hunk.sourceStart - 1));
  const after = sLines.slice(Math.max(hunk.sourceStart - 1, hunk.sourceEnd));
  return { target: newTarget, source: [...before, ...after].join("\n") };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- textMerge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/textMerge.ts src/lib/textMerge.test.ts
git commit -m "feat(ui): pure text-merge transforms (take-all / apply / move)"
```

---

### Task 9: editable Compare editor for File↔File

Make the `DiffEditor` editable on both sides when both sources are `file`, capture both inner editors on mount, and flush each dirty side via `stage_write`. Native per-hunk revert arrows appear once `originalEditable` + `renderMarginRevertIcon` are set.

**Files:**
- Modify: `src/components/DiffView.tsx:11-32` (props), `:90-99` (DiffEditor options + handlers)
- Modify: `src/App.tsx` — add `isFileMerge`, per-side stage on blur

- [ ] **Step 1: Extend `DiffView` props + editable DiffEditor**

In `DiffViewProps` add:

```ts
  fileMerge: boolean;
  onDiffEditEither: (side: Side, content: string) => void;
```

Replace the `<DiffEditor .../>` block (`:91-99`):

```tsx
          <DiffEditor
            height="100%"
            language={preview.left?.language ?? preview.right?.language ?? "plaintext"}
            original={preview.left?.content ?? ""}
            modified={preview.right?.content ?? ""}
            theme="vs-dark"
            options={{
              readOnly: !fileMerge,
              originalEditable: fileMerge,
              renderMarginRevertIcon: fileMerge,
              minimap: { enabled: false },
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: true,
              renderSideBySideInlineBreakpoint: 720,
              automaticLayout: true,
              ignoreTrimWhitespace,
            }}
            onMount={(editor, monaco) => {
              onDiffMount(editor, monaco);
              if (fileMerge) {
                const orig = editor.getOriginalEditor();
                const mod = editor.getModifiedEditor();
                orig.onDidBlurEditorText(() => onDiffEditEither("left", orig.getValue()));
                mod.onDidBlurEditorText(() => onDiffEditEither("right", mod.getValue()));
              }
            }}
          />
```

Import `Side` is already imported in this file (`from "@/lib/types"`).

- [ ] **Step 2: Wire `App.tsx`**

Add near `isEditableEntry` (`src/App.tsx:704`):

```ts
  const isFileMerge =
    mode === "compare" &&
    archives.left?.metadata.sourceKind === "file" &&
    archives.right?.metadata.sourceKind === "file";
```

Add a handler beside `stageEdit`:

```ts
  async function stageFileSide(side: Side, content: string) {
    if (!selected) return;
    const original = (side === "left" ? preview.left?.content : preview.right?.content) ?? "";
    if (content === original) return;
    try {
      await invoke("stage_write", { side, entryPath: selected.path, content });
      setStagedEntries((current) => ({ ...current, [`${side}:${selected.path}`]: { side, kind: "edit" } }));
      setMessage(`Edited ${selected.path} on ${side} (unsaved)`);
    } catch (error) {
      setMessage(String(error));
    }
  }
```

Pass the new props to `<DiffView .../>` (`:778`):

```tsx
                fileMerge={isFileMerge}
                onDiffEditEither={(side, content) => void stageFileSide(side, content)}
```

> Note: `stagedEntries` keys for file-merge are prefixed with the side (`left:`/`right:`) so both sides can be pending simultaneously without key collision. Confirm `unstage`/save read the bare `entryPath`; the prefix is UI-only — strip it before any `invoke("unstage", { entryPath })`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiffView.tsx src/App.tsx
git commit -m "feat(ui): editable compare editor + per-side staging for File merge"
```

---

### Task 10: merge toolbar — take-all + move

Add toolbar buttons (visible only in `fileMerge`) for whole-file take-all each direction and a "move selected hunk" action using `diffEditor.getLineChanges()` + `textMerge`.

**Files:**
- Modify: `src/components/DiffView.tsx` (toolbar in `.copy-actions`), `src/App.tsx` (handlers)

- [ ] **Step 1: Add take-all + move handlers in `App.tsx`**

```ts
  // diffEditorRef is set in handleDiffMount (it already stores the editor).
  function currentHunkAtCursor(): import("./lib/textMerge").Hunk | undefined {
    const ed = diffEditorRef.current;
    if (!ed) return undefined;
    const changes = ed.getLineChanges() ?? [];
    const line = ed.getModifiedEditor().getPosition()?.lineNumber ?? 1;
    const c = changes.find(
      (ch) => line >= ch.modifiedStartLineNumber && line <= Math.max(ch.modifiedEndLineNumber, ch.modifiedStartLineNumber),
    ) ?? changes[0];
    if (!c) return undefined;
    // Monaco: *EndLineNumber === 0 means "no lines on that side" (insertion point).
    return {
      targetStart: c.modifiedStartLineNumber,
      targetEnd: c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber - 1 : c.modifiedEndLineNumber,
      sourceStart: c.originalStartLineNumber,
      sourceEnd: c.originalEndLineNumber === 0 ? c.originalStartLineNumber - 1 : c.originalEndLineNumber,
    };
  }

  async function takeAllTo(target: Side) {
    if (!isFileMerge || !selected) return;
    const source: Side = target === "left" ? "right" : "left";
    const content = (source === "left" ? preview.left?.content : preview.right?.content) ?? "";
    await stageFileSide(target, content);
    // reflect immediately in the editor
    const ed = diffEditorRef.current;
    if (ed) (target === "left" ? ed.getOriginalEditor() : ed.getModifiedEditor()).setValue(content);
  }

  async function moveHunkTo(target: Side) {
    if (!isFileMerge) return;
    const { applyHunk, moveHunk } = await import("./lib/textMerge");
    const ed = diffEditorRef.current;
    const hunk = currentHunkAtCursor();
    if (!ed || !hunk) return;
    const orig = ed.getOriginalEditor().getValue();
    const mod = ed.getModifiedEditor().getValue();
    // target gains the hunk; source loses it (move = copy + delete).
    if (target === "left") {
      // source = right (modified). Map hunk so target/source roles match left=original.
      const swapped = { targetStart: hunk.sourceStart, targetEnd: hunk.sourceEnd, sourceStart: hunk.targetStart, sourceEnd: hunk.targetEnd };
      const res = moveHunk(orig, mod, swapped);
      ed.getOriginalEditor().setValue(res.target);
      ed.getModifiedEditor().setValue(res.source);
      await stageFileSide("left", res.target);
      await stageFileSide("right", res.source);
    } else {
      const res = moveHunk(mod, orig, hunk);
      ed.getModifiedEditor().setValue(res.target);
      ed.getOriginalEditor().setValue(res.source);
      await stageFileSide("right", res.target);
      await stageFileSide("left", res.source);
    }
  }
```

> If `handleDiffMount` does not already keep the editor in a ref, add `const diffEditorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);` and set `diffEditorRef.current = editor;` inside `handleDiffMount`. Check `:147` first.

- [ ] **Step 2: Add toolbar buttons in `DiffView.tsx`**

Extend props with `onTakeAll: (target: Side) => void;` and `onMoveHunk: (target: Side) => void;`. In `.copy-actions`, render a second cluster only when `fileMerge`:

```tsx
        {fileMerge && (
          <div className="copy-cluster">
            <Button variant="outline" size="sm" onClick={() => onTakeAll("left")}>Take all → left</Button>
            <Button variant="outline" size="sm" onClick={() => onTakeAll("right")}>Take all → right</Button>
            <Button variant="outline" size="sm" onClick={() => onMoveHunk("left")}>Move hunk → left</Button>
            <Button variant="outline" size="sm" onClick={() => onMoveHunk("right")}>Move hunk → right</Button>
          </div>
        )}
```

Wire props in `App.tsx`'s `<DiffView>`:

```tsx
                onTakeAll={(t) => void takeAllTo(t)}
                onMoveHunk={(t) => void moveHunkTo(t)}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiffView.tsx src/App.tsx
git commit -m "feat(ui): take-all and move-hunk toolbar for File merge"
```

---

## Phase D — Verification

### Task 11: full proof + manual smoke

- [ ] **Step 1: Workspace tests**

Run: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 2: Frontend tests + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (dev app)**

Run: `npm run tauri dev` (or the project's dev launch).
Verify:
1. Open two standalone `.json` files (Browse) — both load, source-kind chip shows file, diff renders.
2. Compare mode: both panes editable; native ◀▶ revert arrow copies a hunk across; edit a line → blur → "unsaved" appears.
3. "Take all → right" replaces right with left content.
4. "Move hunk → right": hunk appears on right, disappears on left; both sides marked unsaved.
5. Save right → file on disk updated, `.bak` present (if backup enabled); reload shows committed content.
6. Save left independently → only left file changes.
7. Regression: open two `.jar`s — Compare stays read-only; archive copy/save unchanged. Open a folder — unchanged.

- [ ] **Step 4: Final commit / branch wrap**

```bash
git add -A && git commit -m "test: verify standalone text-file compare & merge" || echo "clean"
```

Then use superpowers:finishing-a-development-branch to decide merge/PR.

---

## Notes & risks

- **High-risk write path:** "move" deletes lines from the source file. Atomic temp→rename + `.bak` bound the blast radius; `changed_on_disk` guards stale overwrites. Manual smoke step 4–6 is the data-integrity gate.
- **Monaco original→modified copy:** native revert arrow (`renderMarginRevertIcon`) copies modified→original. The explicit toolbar buttons cover both directions and whole-file, so the feature does not depend on Monaco's built-in arrow direction.
- **`stagedEntries` keying:** file-merge uses `side:path` keys so both sides coexist; strip the prefix before any `unstage` IPC call. Verify the MenuBar pending popover tolerates the prefixed key (display the bare path).
- **Package names:** substitute the real `src-tauri` crate name for `ldiff-desktop` (check `src-tauri/Cargo.toml`).
