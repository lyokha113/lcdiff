# Edit text entry in-place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit text-based entries (xml/json/ini/txt/properties/yaml…) in place inside JAR/ZIP and folder targets, then write them back through the existing atomic save + `.bak` merge pipeline, with a clearer pending-changes UI.

**Architecture:** Replace `MergePlan`'s `Vec<StagedCopy>` with `Vec<StagedOp>` where `StagedOp` is `Copy{…}` (unchanged behavior) or `Write{ target_entry_path, new_bytes }`. `read_replacements` reduces both kinds to the existing `BTreeMap<target_path, bytes>` the commit pipeline already consumes — CRC32 and sizes are recomputed automatically by the existing `ZipWriter`/directory rewrite. Encoding (UTF-8, BOM, line endings) is detected from the original entry and re-applied when a write is staged. Editing happens only in Single/View mode's editable Monaco `Editor`.

**Tech Stack:** Rust (`jdiff-core`, `zip` crate), Tauri commands (`src-tauri`), React + TypeScript + shadcn/ui + Monaco (`@monaco-editor/react`).

> **Environment note:** This checkout is not a git repository in the current environment. Where a step says "Commit", either `git init` first or substitute running the relevant verifier (`cargo test --workspace` / `npm run verify:all`). Commits are grouped per task.

---

## File Structure

- Create `crates/jdiff-core/src/edit.rs` — text-edit helpers: editability gate, encoding detection, text encoding. One responsibility: turning an edited string into faithful bytes and deciding what is editable.
- Modify `crates/jdiff-core/src/lib.rs` — register `pub mod edit;` and re-export.
- Modify `crates/jdiff-core/src/merge.rs` — `StagedOp` enum, `StagedKind`, `stage_write`, adapted `read_replacements`/`unstage`/`commit`.
- Modify `src-tauri/src/main.rs` — `AppState::stage_write` + `stage_write` Tauri command + handler registration.
- Modify `src/lib/types.ts` — `StagedKind`, `StagedEntry` types.
- Modify `src/App.tsx` — `stagedEntries` shape, `stage_write` invoker, editor edit/stage flow.
- Modify `src/components/DiffView.tsx` — editable single `Editor` for text entries (Compare `DiffEditor` stays read-only).
- Modify `src/components/MenuBar.tsx` — "Save to archive (N)" button + pending-ops popover + clearer badge.
- Modify `src/components/FileTree.tsx` — distinguish `edit` vs `copy` pending badges.

---

## Task 1: Core text-edit helpers (`edit.rs`)

**Files:**
- Create: `crates/jdiff-core/src/edit.rs`
- Modify: `crates/jdiff-core/src/lib.rs`
- Test: inline `#[cfg(test)]` module in `crates/jdiff-core/src/edit.rs`

- [ ] **Step 1: Register the module**

In `crates/jdiff-core/src/lib.rs`, add alongside the other `pub mod` declarations:

```rust
pub mod edit;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/jdiff-core/src/edit.rs` with only the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ArchiveEntry, EntryKind};

    fn entry(path: &str, kind: EntryKind) -> ArchiveEntry {
        ArchiveEntry {
            path: path.to_owned(),
            kind,
            uncompressed_size: 0,
            compressed_size: 0,
            crc32: 0,
        }
    }

    #[test]
    fn text_entry_is_editable() {
        assert!(editable_text(&entry("a/config.xml", EntryKind::Text), b"<x/>"));
    }

    #[test]
    fn whitelisted_extension_on_binary_kind_is_editable() {
        assert!(editable_text(&entry("app.properties", EntryKind::Binary), b"k=v"));
    }

    #[test]
    fn class_entry_is_not_editable() {
        assert!(!editable_text(&entry("A.class", EntryKind::Class), b"text"));
    }

    #[test]
    fn null_byte_content_is_not_editable() {
        assert!(!editable_text(&entry("a.txt", EntryKind::Text), b"a\0b"));
    }

    #[test]
    fn unknown_extension_binary_is_not_editable() {
        assert!(!editable_text(&entry("blob.dat", EntryKind::Binary), b"data"));
    }

    #[test]
    fn detect_lf_no_bom() {
        let enc = detect_encoding(b"a\nb\n");
        assert_eq!(enc, EntryEncoding { bom: false, line_ending: LineEnding::Lf });
    }

    #[test]
    fn detect_crlf_with_bom() {
        let enc = detect_encoding(b"\xEF\xBB\xBFa\r\nb\r\n");
        assert_eq!(enc, EntryEncoding { bom: true, line_ending: LineEnding::Crlf });
    }

    #[test]
    fn encode_preserves_bom_and_crlf() {
        let enc = EntryEncoding { bom: true, line_ending: LineEnding::Crlf };
        assert_eq!(encode_text("a\nb", &enc), b"\xEF\xBB\xBFa\r\nb".to_vec());
    }

    #[test]
    fn encode_lf_no_bom_roundtrip() {
        let enc = detect_encoding(b"a\nb\n");
        assert_eq!(encode_text("a\nb\n", &enc), b"a\nb\n".to_vec());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p jdiff-core edit::tests -- --nocapture`
Expected: FAIL — `cannot find function editable_text` / `detect_encoding` / `encode_text` / type `EntryEncoding` not found.

- [ ] **Step 4: Implement the helpers**

Prepend to `crates/jdiff-core/src/edit.rs` (above the test module):

```rust
//! Helpers for editing text-based archive entries in place.

use crate::{ArchiveEntry, EntryKind};

/// Extensions treated as editable text even when content sniffing labelled the
/// entry binary. Lower-case, compared case-insensitively.
const EDITABLE_EXTENSIONS: &[&str] = &[
    "xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf",
];

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntryEncoding {
    pub bom: bool,
    pub line_ending: LineEnding,
}

/// True when the entry's basename ends in a whitelisted text extension.
pub fn has_editable_extension(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((_, ext)) => EDITABLE_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes)
}

/// Whether an entry may be edited as UTF-8 text. Directories and decompiled
/// class entries are never editable; binary payloads (null byte present or
/// not valid UTF-8) are rejected unless... they still must be valid UTF-8.
pub fn editable_text(entry: &ArchiveEntry, bytes: &[u8]) -> bool {
    if matches!(entry.kind, EntryKind::Directory | EntryKind::Class) {
        return false;
    }
    if bytes.contains(&0) {
        return false;
    }
    let is_text = entry.kind == EntryKind::Text || has_editable_extension(&entry.path);
    is_text && std::str::from_utf8(strip_bom(bytes)).is_ok()
}

/// Detect leading UTF-8 BOM and the dominant line ending so an edit round-trips
/// byte-faithfully apart from the user's changes.
pub fn detect_encoding(bytes: &[u8]) -> EntryEncoding {
    let bom = bytes.starts_with(UTF8_BOM);
    let body = strip_bom(bytes);
    let line_ending = if body.windows(2).any(|window| window == b"\r\n") {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    EntryEncoding { bom, line_ending }
}

/// Encode edited content (Monaco emits LF newlines) back to the detected
/// encoding: re-apply CRLF if the original used it, and re-prepend the BOM.
pub fn encode_text(content: &str, encoding: &EntryEncoding) -> Vec<u8> {
    let normalized = content.replace("\r\n", "\n");
    let body = match encoding.line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(body.len() + if encoding.bom { UTF8_BOM.len() } else { 0 });
    if encoding.bom {
        out.extend_from_slice(UTF8_BOM);
    }
    out.extend_from_slice(body.as_bytes());
    out
}
```

> Note: this requires `ArchiveEntry` to be public and reachable as `crate::ArchiveEntry`. Verify with `grep -n "pub use" crates/jdiff-core/src/lib.rs`. If `ArchiveEntry` is only at `crate::archive::ArchiveEntry`, import that path instead.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p jdiff-core edit::tests`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Commit**

```bash
git add crates/jdiff-core/src/edit.rs crates/jdiff-core/src/lib.rs
git commit -m "feat(core): add text-edit encoding + editability helpers"
```

---

## Task 2: `StagedOp` enum + `stage_write` in `MergePlan`

**Files:**
- Modify: `crates/jdiff-core/src/merge.rs`
- Test: inline `#[cfg(test)]` in `crates/jdiff-core/src/merge.rs` (add module if none exists; otherwise append tests)

- [ ] **Step 1: Write the failing tests**

Add to a `#[cfg(test)] mod tests` in `crates/jdiff-core/src/merge.rs`. These exercise the new API surface. Use the existing test fixtures pattern in the crate — build two tiny zips on a `tempfile::TempDir` (the crate already depends on `tempfile` for nested cache). If the crate has a helper to write a fixture archive, reuse it; otherwise this inline helper:

```rust
#[cfg(test)]
mod stage_write_tests {
    use super::*;
    use crate::Archive;
    use std::io::Write as _;

    fn write_zip(dir: &std::path::Path, name: &str, entries: &[(&str, &[u8])]) -> std::path::PathBuf {
        let path = dir.join(name);
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (entry, bytes) in entries {
            zip.start_file(*entry, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn stage_write_replaces_entry_bytes_on_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_zip(dir.path(), "t.jar", &[("config.xml", b"<old/>")]);
        let target = Archive::open(path.to_str().unwrap()).unwrap();

        let mut plan = MergePlan::new();
        plan.stage_write("config.xml", b"<new/>".to_vec()).unwrap();
        let result = plan.commit(&target, CommitOptions::default()).unwrap();
        assert_eq!(result.copied_entries, 1);

        let reopened = Archive::open(path.to_str().unwrap()).unwrap();
        assert_eq!(reopened.read_entry("config.xml").unwrap(), b"<new/>");
    }

    #[test]
    fn mixed_copy_and_write_commit() {
        let dir = tempfile::tempdir().unwrap();
        let src = write_zip(dir.path(), "src.jar", &[("Main.class", b"CLASSBYTES")]);
        let tgt = write_zip(dir.path(), "tgt.jar", &[("Main.class", b"OLD"), ("a.txt", b"x")]);
        let source = Archive::open(src.to_str().unwrap()).unwrap();
        let target = Archive::open(tgt.to_str().unwrap()).unwrap();

        let mut plan = MergePlan::new();
        plan.stage_copy(&source, "Main.class", "Main.class").unwrap();
        plan.stage_write("a.txt", b"y".to_vec()).unwrap();
        assert_eq!(plan.staged().len(), 2);
        plan.commit(&target, CommitOptions::default()).unwrap();

        let reopened = Archive::open(tgt.to_str().unwrap()).unwrap();
        assert_eq!(reopened.read_entry("Main.class").unwrap(), b"CLASSBYTES");
        assert_eq!(reopened.read_entry("a.txt").unwrap(), b"y");
    }

    #[test]
    fn unstage_removes_a_write_and_kind_is_reported() {
        let mut plan = MergePlan::new();
        plan.stage_write("a.txt", b"y".to_vec()).unwrap();
        assert_eq!(plan.staged()[0].kind(), StagedKind::Write);
        assert_eq!(plan.staged()[0].target_entry_path(), "a.txt");
        assert!(plan.unstage("a.txt").unwrap());
        assert!(plan.staged().is_empty());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p jdiff-core stage_write_tests`
Expected: FAIL — `no method named stage_write`, `StagedKind` not found, `kind`/`target_entry_path` not found.

- [ ] **Step 3: Replace `StagedCopy` with `StagedOp`**

In `crates/jdiff-core/src/merge.rs`, replace the `StagedCopy` struct (lines ~17-23) with:

```rust
#[derive(Clone, Debug)]
pub enum StagedOp {
    Copy {
        source_archive: PathBuf,
        source_entry_path: String,
        target_entry_path: String,
        source_snapshot: Archive,
    },
    Write {
        target_entry_path: String,
        new_bytes: Vec<u8>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StagedKind {
    Copy,
    Write,
}

impl StagedOp {
    pub fn target_entry_path(&self) -> &str {
        match self {
            StagedOp::Copy { target_entry_path, .. } => target_entry_path,
            StagedOp::Write { target_entry_path, .. } => target_entry_path,
        }
    }

    pub fn kind(&self) -> StagedKind {
        match self {
            StagedOp::Copy { .. } => StagedKind::Copy,
            StagedOp::Write { .. } => StagedKind::Write,
        }
    }
}
```

- [ ] **Step 4: Update `MergePlan` storage and methods**

Replace the `MergePlan` struct and its `impl` members that reference `copies`:

```rust
#[derive(Debug, Default)]
pub struct MergePlan {
    ops: Vec<StagedOp>,
}

impl MergePlan {
    pub fn new() -> Self {
        Self::default()
    }

    fn replace_or_push(&mut self, target_entry_path: &str, op: StagedOp) {
        if let Some(existing) = self
            .ops
            .iter_mut()
            .find(|existing| existing.target_entry_path() == target_entry_path)
        {
            *existing = op;
        } else {
            self.ops.push(op);
        }
    }

    pub fn stage_copy(
        &mut self,
        source: &Archive,
        source_entry_path: &str,
        target_entry_path: &str,
    ) -> Result<()> {
        let source_entry_path = normalize_archive_entry_path(source_entry_path)?;
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        if !is_nested(&source_entry_path) {
            let source_entry = source
                .entry(&source_entry_path)
                .ok_or_else(|| Error::EntryNotFound(source_entry_path.clone()))?;
            if source_entry.kind == EntryKind::Directory {
                return Err(Error::CannotCopyDirectory(source_entry_path));
            }
        }
        let op = StagedOp::Copy {
            source_archive: source.path().to_path_buf(),
            source_entry_path,
            target_entry_path: target_entry_path.clone(),
            source_snapshot: source.clone(),
        };
        self.replace_or_push(&target_entry_path, op);
        Ok(())
    }

    pub fn stage_write(&mut self, target_entry_path: &str, new_bytes: Vec<u8>) -> Result<()> {
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        let op = StagedOp::Write {
            target_entry_path: target_entry_path.clone(),
            new_bytes,
        };
        self.replace_or_push(&target_entry_path, op);
        Ok(())
    }

    pub fn staged(&self) -> &[StagedOp] {
        &self.ops
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    pub fn unstage(&mut self, target_entry_path: &str) -> Result<bool> {
        let target_entry_path = normalize_archive_entry_path(target_entry_path)?;
        let previous_len = self.ops.len();
        self.ops
            .retain(|op| op.target_entry_path() != target_entry_path);
        Ok(self.ops.len() != previous_len)
    }

    pub fn clear(&mut self) {
        self.ops.clear();
    }
```

- [ ] **Step 5: Update `commit` and `read_replacements`**

In `commit`, change the empty guard from `self.copies.is_empty()` to `self.ops.is_empty()`. Replace `read_replacements` with:

```rust
    fn read_replacements(&self) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut replacements = BTreeMap::new();
        let mut cache = NestedArchiveCache::new()?;
        for op in &self.ops {
            match op {
                StagedOp::Copy {
                    source_archive,
                    source_entry_path,
                    target_entry_path,
                    source_snapshot,
                } => {
                    if source_snapshot.changed_on_disk()? {
                        return Err(Error::ArchiveChanged(source_archive.clone()));
                    }
                    let (archive, leaf) = cache.resolve(source_snapshot, source_entry_path)?;
                    replacements.insert(target_entry_path.clone(), archive.read_entry(&leaf)?);
                }
                StagedOp::Write {
                    target_entry_path,
                    new_bytes,
                } => {
                    replacements.insert(target_entry_path.clone(), new_bytes.clone());
                }
            }
        }
        Ok(replacements)
    }
```

> The rest of `commit` is unchanged — `raw.len()` still yields the op count, and `flatten_nested_replacements`/`rewrite_archive`/`rewrite_directory` already recompute CRC32 and sizes for whatever bytes they receive.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p jdiff-core`
Expected: PASS — new `stage_write_tests` green and the existing merge/CLI tests still pass (they call `stage_copy`/`staged()`/`unstage`, all preserved).

- [ ] **Step 7: Commit**

```bash
git add crates/jdiff-core/src/merge.rs
git commit -m "feat(core): StagedOp enum with stage_write for in-place edits"
```

---

## Task 3: Tauri `stage_write` command + AppState wiring

**Files:**
- Modify: `src-tauri/src/main.rs`
- Test: append to the existing `#[cfg(test)] mod tests` in `src-tauri/src/main.rs` (the module with `clear_staged_unlocks_archive_switch`, ~line 962)

- [ ] **Step 1: Write the failing test**

The existing tests build state with `load_archive`. Add a fixture archive under the test module if one is not already available; reuse the crate's `Archive::open` against a temp zip exactly as in Task 2's `write_zip`. Add:

```rust
    #[test]
    fn stage_write_locks_target_and_rejects_other_side() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jar");
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            use std::io::Write as _;
            zip.start_file("config.xml", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(b"<old/>").unwrap();
            zip.finish().unwrap();
        }
        let mut state = AppState::default();
        state.load_archive(path.to_str().unwrap(), Side::Left).unwrap();

        state.stage_write(Side::Left, "config.xml", "<new/>").unwrap();
        assert_eq!(state.staged_target, Some(Side::Left));

        let err = state.stage_write(Side::Right, "config.xml", "<x/>").unwrap_err();
        assert!(err.contains("other archive"));
    }

    #[test]
    fn stage_write_rejects_binary_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.jar");
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            use std::io::Write as _;
            zip.start_file("blob.bin", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(&[0u8, 1, 2, 3]).unwrap();
            zip.finish().unwrap();
        }
        let mut state = AppState::default();
        state.load_archive(path.to_str().unwrap(), Side::Left).unwrap();
        let err = state.stage_write(Side::Left, "blob.bin", "text").unwrap_err();
        assert!(err.contains("editable"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p jdiff stage_write` (or the `src-tauri` package name from `src-tauri/Cargo.toml` — check `grep '^name' src-tauri/Cargo.toml`)
Expected: FAIL — `no method named stage_write` on `AppState`.

- [ ] **Step 3: Add `AppState::stage_write`**

In `src-tauri/src/main.rs`, add this method to `impl AppState` (after `stage_copy`, ~line 122). Add `use jdiff_core::edit;` to the imports if not present (the crate is imported as `jdiff_core`; confirm the alias with `grep -n "use jdiff_core" src-tauri/src/main.rs`):

```rust
    fn stage_write(&mut self, side: Side, entry_path: &str, content: &str) -> Result<(), String> {
        if self.staged_target.is_some_and(|target| target != side) {
            return Err("save unsaved changes before editing the other archive".to_owned());
        }
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
        self.merge_plan
            .stage_write(entry_path, new_bytes)
            .map_err(|error| error.to_string())?;
        self.staged_target = Some(side);
        Ok(())
    }
```

- [ ] **Step 4: Add the `stage_write` Tauri command**

After the `stage_copy` command (~line 484), add:

```rust
#[tauri::command]
fn stage_write(
    side: Side,
    entry_path: String,
    content: String,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.stage_write(side, &entry_path, &content)
}
```

- [ ] **Step 5: Register the command**

In the `tauri::generate_handler![…]` list (~line 898-903, where `stage_copy` is registered), add `stage_write,` next to `stage_copy,`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --workspace`
Expected: PASS — new AppState tests green, all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(app): stage_write Tauri command for in-place text edits"
```

---

## Task 4: Frontend types + edit/stage flow in App

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the staged-entry types**

In `src/lib/types.ts`, after the `Side` type, add:

```ts
export type StagedKind = "copy" | "edit";
export interface StagedEntry {
  side: Side;
  kind: StagedKind;
}
```

- [ ] **Step 2: Change `stagedEntries` state shape**

In `src/App.tsx`, change the state declaration (line ~120) from:

```tsx
const [stagedEntries, setStagedEntries] = useState<Record<string, Side>>({});
```

to:

```tsx
const [stagedEntries, setStagedEntries] = useState<Record<string, StagedEntry>>({});
```

Import `StagedEntry` from `@/lib/types` in the existing type import block.

- [ ] **Step 3: Update copy staging to the new shape**

In the `stageCopy` handler (~line 509-512), change:

```tsx
setStagedEntries((current) => ({ ...current, [pair.path]: to }));
```

to:

```tsx
setStagedEntries((current) => ({ ...current, [pair.path]: { side: to, kind: "copy" } }));
```

- [ ] **Step 4: Add the edit-staging handler**

In `src/App.tsx`, add a handler near `stageCopy`. Editing applies to the loaded archive in Single/View mode, which is the `left` side. Staging fires on editor blur; an edit that reverts to the original content unstages instead:

```tsx
async function stageEdit(entryPath: string, content: string) {
  const original = preview.left?.content ?? "";
  if (content === original) {
    // reverted to original — drop any pending edit for this entry
    if (stagedEntries[entryPath]?.kind === "edit") {
      await invoke("unstage", { entryPath });
      setStagedEntries((current) => {
        const next = { ...current };
        delete next[entryPath];
        return next;
      });
    }
    return;
  }
  try {
    await invoke("stage_write", { side: "left", entryPath, content });
    setStagedEntries((current) => ({ ...current, [entryPath]: { side: "left", kind: "edit" } }));
    setMessage(`Edited ${entryPath} (unsaved)`);
  } catch (error) {
    setMessage(String(error));
  }
}
```

- [ ] **Step 5: Track edited buffer + decide editability**

Add state for the working buffer near the other editor state (~line 104):

```tsx
const [editBuffer, setEditBuffer] = useState<string>("");
```

Add a derived flag for whether the current Single-mode entry is editable (text kind or whitelisted extension). Place near the render computing `selected`:

```tsx
const EDIT_EXTENSIONS = ["xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf"];
const isEditableEntry =
  mode === "single" &&
  preview.left?.kind === "text" ||
  (mode === "single" &&
    !!preview.left &&
    EDIT_EXTENSIONS.includes((selected?.path ?? "").split(".").pop()?.toLowerCase() ?? ""));
```

> This is a UI affordance only; `stage_write` in Rust is the authority and rejects non-editable entries.

- [ ] **Step 6: Reset the buffer when the previewed entry changes**

In the effect that loads a preview (where `setPreview` is called after `read_entry`), set the buffer to the freshly loaded left content. Add after the preview state is set:

```tsx
setEditBuffer(next.left?.content ?? "");
```

(Use the same `next`/preview object that is assigned to `setPreview` in that effect; if the variable is named differently, adapt the reference.)

- [ ] **Step 7: Wire the props into `DiffView`**

In the `<DiffView … />` usage (~line where DiffView is rendered), add props:

```tsx
editable={isEditableEntry}
editValue={editBuffer}
onEditChange={(value) => setEditBuffer(value ?? "")}
onEditBlur={() => selected && void stageEdit(selected.path, editBuffer)}
```

- [ ] **Step 8: Manual type-check**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: FAIL until Task 5 adds the matching `DiffView` props. This is expected; proceed to Task 5, then re-run.

- [ ] **Step 9: Commit (after Task 5 makes it compile)**

Defer the commit for App.tsx until Task 5 compiles; commit together there.

---

## Task 5: Editable single `Editor` in `DiffView`

**Files:**
- Modify: `src/components/DiffView.tsx`

- [ ] **Step 1: Extend the props interface**

In `src/components/DiffView.tsx`, add to `DiffViewProps`:

```tsx
  editable: boolean;
  editValue: string;
  onEditChange: (value: string | undefined) => void;
  onEditBlur: () => void;
```

Add them to the destructured parameters in the `DiffView({ … })` signature.

- [ ] **Step 2: Make the single-mode `Editor` editable**

Replace the Single-mode `<Editor … />` block (lines ~96-103) with:

```tsx
          <Editor
            height="100%"
            language={preview.left?.language ?? "plaintext"}
            value={editable ? editValue : (preview.left?.content ?? "")}
            theme="vs-dark"
            options={{ readOnly: !editable, minimap: { enabled: false }, automaticLayout: true }}
            onChange={(value) => editable && onEditChange(value)}
            onMount={(editor, monaco) => {
              onEditorMount(editor, monaco);
              editor.onDidBlurEditorText(() => editable && onEditBlur());
            }}
          />
```

> The Compare-mode `DiffEditor` is intentionally left `readOnly: true` on both panes — editing only happens in Single/View mode.

- [ ] **Step 3: Type-check the whole frontend**

Run: `npm run build`
Expected: PASS — App.tsx (Task 4) and DiffView now agree on props.

- [ ] **Step 4: Commit App.tsx + DiffView together**

```bash
git add src/lib/types.ts src/App.tsx src/components/DiffView.tsx
git commit -m "feat(ui): editable Monaco editor stages in-place text edits"
```

---

## Task 6: Pending-changes UI in `MenuBar`

**Files:**
- Modify: `src/components/MenuBar.tsx`
- Modify: `src/App.tsx` (pass the staged-ops list + per-op unstage)
- Test: `src/components/MenuBar.test.tsx`

- [ ] **Step 1: Update the failing test first**

In `src/components/MenuBar.test.tsx`, the current setup passes `stagedTarget`/`stagedCount`. Add a test asserting the labeled button + popover list. Replace the `stagedCount: 2` case with:

```tsx
  it("shows save-to-archive label and lists pending ops", () => {
    setup({
      stagedTarget: "right",
      pendingOps: [
        { path: "config.xml", side: "right", kind: "edit" },
        { path: "Main.class", side: "right", kind: "copy" },
      ],
      onUnstageOne: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /save to archive \(2\)/i })).toBeInTheDocument();
    expect(screen.getByText(/2 unsaved/i)).toBeInTheDocument();
  });
```

Update the shared `setup` defaults: add `pendingOps: []` and `onUnstageOne: vi.fn()`, and remove `stagedCount`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/MenuBar.test.tsx`
Expected: FAIL — prop `pendingOps` not used; no "Save to archive" button.

- [ ] **Step 3: Update `MenuBarProps`**

In `src/components/MenuBar.tsx`, replace `stagedCount: number;` with:

```tsx
  pendingOps: Array<{ path: string; side: Side; kind: "copy" | "edit" }>;
  onUnstageOne: (entryPath: string) => void;
```

Update the destructured params accordingly (remove `stagedCount`, add `pendingOps`, `onUnstageOne`).

- [ ] **Step 4: Replace the Save button + badge with the labeled button and popover**

Import shadcn Popover at the top:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, Pencil, ArrowRightLeft } from "lucide-react";
```

> If `src/components/ui/popover.tsx` does not exist, generate it with `npx shadcn@latest add popover` before this step.

Replace the Save `<Tooltip>…</Tooltip>` block and the trailing badge (`{stagedTarget && <Badge …>}`) with:

```tsx
        <div className="pending-actions">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Save to archive (${pendingOps.length})`}
            disabled={mode === "single" || !stagedTarget}
            onClick={() => stagedTarget && onSave(stagedTarget)}>
            <Save /> Save to archive ({pendingOps.length})
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Show pending changes"
                disabled={!stagedTarget}>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="pending-popover">
              <p className="pending-header">Pending changes → {stagedTarget}</p>
              <ul>
                {pendingOps.map((op) => (
                  <li key={op.path}>
                    {op.kind === "edit" ? <Pencil size={14} /> : <ArrowRightLeft size={14} />}
                    <span className="pending-path">{op.path}</span>
                    <Button variant="ghost" size="icon" aria-label={`Unstage ${op.path}`}
                      onClick={() => onUnstageOne(op.path)}>×</Button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
          {stagedTarget && (
            <Badge variant="secondary">{pendingOps.length} unsaved → {stagedTarget}</Badge>
          )}
        </div>
```

Update the Save tooltip text references elsewhere to "Write unsaved changes into the target archive" if a tooltip is retained.

- [ ] **Step 5: Pass the new props from `App.tsx`**

Where `<MenuBar … />` is rendered (~line 678), replace `stagedCount={Object.keys(stagedEntries).length}` with:

```tsx
pendingOps={Object.entries(stagedEntries).map(([path, entry]) => ({ path, side: entry.side, kind: entry.kind }))}
onUnstageOne={(entryPath) => void unstage(entryPath)}
```

Confirm `unstage` in App.tsx clears `stagedEntries[entryPath]` (it already does via `setStagedEntries`); ensure it deletes the keyed entry under the new object shape (the existing delete-by-key logic is shape-agnostic).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/MenuBar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MenuBar.tsx src/App.tsx
git commit -m "feat(ui): labeled Save-to-archive button with pending-ops popover"
```

---

## Task 7: Distinguish edit vs copy in `FileTree`

**Files:**
- Modify: `src/components/FileTree.tsx`

- [ ] **Step 1: Update the prop type**

In `src/components/FileTree.tsx`, change `stagedEntries: Record<string, Side>;` to:

```tsx
  stagedEntries: Record<string, { side: Side; kind: "copy" | "edit" }>;
```

- [ ] **Step 2: Update both badge render sites**

Replace the two occurrences of:

```tsx
{stagedEntries[fullPath] && <Badge variant="secondary">pending → {stagedEntries[fullPath]}</Badge>}
```

with:

```tsx
{stagedEntries[fullPath] && (
  <Badge variant={stagedEntries[fullPath].kind === "edit" ? "default" : "secondary"}>
    {stagedEntries[fullPath].kind === "edit" ? "edited" : "copy"} → {stagedEntries[fullPath].side}
  </Badge>
)}
```

Update the per-row `disabled={!stagedEntries[fullPath]}` unstage items — they remain correct (truthiness of the object).

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/FileTree.tsx
git commit -m "feat(ui): show edited vs copy pending badges in file tree"
```

---

## Task 8: Full verification + harness records

**Files:** none (verification + governance)

- [ ] **Step 1: Run the Rust workspace tests**

Run: `cargo test --workspace`
Expected: PASS — all crates, including the new `edit` and `stage_write` tests.

- [ ] **Step 2: Run the frontend verifiers**

Run: `npm run verify:all`
Expected: PASS — frontend build, invariant verifier, render verifier, docs verifier. If the render verifier asserts a fixed set of MenuBar controls, update its expectations to the new "Save to archive" button.

- [ ] **Step 3: Record story proof in the harness**

```bash
./scripts/bin/harness-cli story update jdiff-inplace-edit --verify "cargo test --workspace; npm run verify:all"
./scripts/bin/harness-cli story verify jdiff-inplace-edit
```

- [ ] **Step 4: Decision record (high-risk lane)**

This feature writes new bytes into user archives (data integrity). Add a decision record:

```bash
./scripts/bin/harness-cli decision add --story jdiff-inplace-edit --summary "In-place text edit reuses staged-op commit pipeline; encoding (BOM/CRLF) preserved; signed-jar edits reuse existing signed-save warning"
```

Also write `docs/decisions/2026-06-08-in-place-text-edit.md` capturing the same rationale (the trace flag does not satisfy the decision-record requirement).

- [ ] **Step 5: Trace the work**

```bash
./scripts/bin/harness-cli trace --agent claude --intake 4 --story jdiff-inplace-edit \
  --actions "implemented StagedOp enum + stage_write + editor edit flow + pending UI" \
  --changed "crates/jdiff-core/src/edit.rs,crates/jdiff-core/src/merge.rs,src-tauri/src/main.rs,src/App.tsx,src/components/DiffView.tsx,src/components/MenuBar.tsx,src/components/FileTree.tsx" \
  --read "docs/superpowers/specs/2026-06-08-edit-text-entry-in-place-design.md"
```

- [ ] **Step 6: Request code review**

Use superpowers:requesting-code-review before integrating the branch.

---

## Self-Review

**Spec coverage:**
- Editable-by-default text entries → Task 4 (`isEditableEntry`) + Task 5 (editable Editor). ✓
- View-mode-only editing → Task 5 (Compare `DiffEditor` stays read-only). ✓
- Stage → commit shared pipeline → Task 2 (`StagedOp`), Task 3 (`stage_write`). ✓
- Archives + folders, both sides → core write path is target-kind agnostic (folder via `rewrite_directory`); side via the loaded View archive. ✓
- Text detection + whitelist + null-byte/UTF-8 guard → Task 1 (`editable_text`, `has_editable_extension`). ✓
- Encoding preserve (BOM/CRLF) → Task 1 (`detect_encoding`/`encode_text`). ✓
- Signed-jar warning reuse → unchanged `commit` path sets `signature_invalidated`; existing signed-save dialog still fires. ✓
- Pending-changes UI (labeled Save + popover + edit/copy distinction) → Tasks 6, 7. ✓
- Undo before commit → `unstage` works for writes (Task 2 test). ✓

**Placeholder scan:** No TBD/TODO; every code step shows code. The two "confirm the alias/path with grep" notes are verification aids, not placeholders.

**Type consistency:** `StagedOp`/`StagedKind` (Rust), `StagedEntry`/`StagedKind` (TS) names consistent across tasks. `stage_write(side, entryPath, content)` signature matches between Tauri command (Task 3) and App invoker (Task 4). `pendingOps` shape `{path, side, kind}` matches between MenuBar (Task 6) and App mapping. `editable`/`editValue`/`onEditChange`/`onEditBlur` props match between App (Task 4) and DiffView (Task 5).
