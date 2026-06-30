# Nested Archive Expansion + Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a nested zip/jar entry expand inline into the file tree (lazy, on click, to any depth) for diff, and support staging/committing copies of entries that live inside nested archives.

**Architecture:** Approach A — temp-extract on demand. A new `EntryKind::Archive` marks expandable entries. A `NestedArchiveCache` (per side, in `AppState`) extracts a nested archive's bytes to a temp file and opens it as a real `Archive`, so existing path-based machinery (`compare`, `read_entry`, decompile sidecar, search) keeps working. Nested entry paths use the JAR `!/` boundary marker. Merge commit recursively repacks: inner replacements rebuild the nested jar bytes, which become the parent's top-level replacement.

**Tech Stack:** Rust (`lcdiff-core`, `src-tauri` Tauri commands, `zip` crate, `tempfile`), TypeScript/React frontend (Vitest).

**Conventions:** TDD per task. Every commit message ends with the trailer:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Work happens on branch `feat/nested-archive-expand`.

---

## File Structure

**Core (`crates/lcdiff-core/`):**
- `src/detect.rs` — add `EntryKind::Archive`; map `jar|zip|war|ear` to it.
- `src/nested.rs` — **NEW**: `ARCHIVE_SEPARATOR`, `is_nested`, `NestedArchiveCache` (extraction).
- `src/merge.rs` — bytes-based zip helpers + recursive `apply_nested_replacements` + `flatten_nested_replacements`; nested-aware `read_replacements`; relax `stage_copy` for nested; wire into `commit`.
- `src/lib.rs` — export new public items.
- `Cargo.toml` — promote `tempfile` to a runtime dependency.
- `tests/core.rs` — integration tests.

**IPC (`src-tauri/src/main.rs`):**
- `AppState` gains `left_nested` / `right_nested: NestedArchiveCache`; reset on `install_archive`.
- New `resolve_side_entry` helper; route `read_entry` / `disassemble` through it.
- New `compute_nested_diff` command; register in `generate_handler!`.

**Frontend (`src/`):**
- `lib/types.ts` — `EntryKind` gains `"archive"`.
- `lib/tree.ts` — add `isArchiveKind(pair)` helper (buildTree unchanged).
- `components/FileTree.tsx` — archive nodes render expandable; `basePath` threading; `nestedPairs` + `onExpandArchive` props.
- `components/FileTree.test.tsx` — pass new props.
- `App.tsx` — `nestedPairs` state, `expandArchive`, clear on rediff, prefetch guard.

---

## Phase A — Core data model

### Task 1: Add `EntryKind::Archive`

**Files:**
- Modify: `crates/lcdiff-core/src/detect.rs`
- Test: `crates/lcdiff-core/src/detect.rs` (inline `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Append to `crates/lcdiff-core/src/detect.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::{EntryKind, detect_entry_kind};

    #[test]
    fn classifies_archives() {
        assert_eq!(detect_entry_kind("lib/inner.jar", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.zip", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.war", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.ear", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.bin", false), EntryKind::Binary);
        assert_eq!(detect_entry_kind("A.class", false), EntryKind::Class);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p lcdiff-core detect`
Expected: FAIL — `no variant named Archive found for enum EntryKind`.

- [ ] **Step 3: Implement**

In `crates/lcdiff-core/src/detect.rs`, add `Archive` to the enum and a match arm:

```rust
pub enum EntryKind {
    Directory,
    Class,
    Text,
    Archive,
    Binary,
}
```

In `detect_entry_kind`, add before the `Some("class")` arm or alongside the text arm:

```rust
        Some("jar" | "zip" | "war" | "ear") => EntryKind::Archive,
```

(Place it as its own arm in the `match extension.as_deref()` block.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p lcdiff-core detect`
Expected: PASS.

- [ ] **Step 5: Fix exhaustive matches**

Run: `cargo build -p lcdiff-core`
Expected: may FAIL where `EntryKind` is matched exhaustively. Known site: `crates/lcdiff-core/src/archive.rs` `read_entry` only checks `== EntryKind::Directory` (no exhaustive match — OK). If the build reports a non-exhaustive match anywhere in `lcdiff-core`, add an `EntryKind::Archive => …` arm mirroring `EntryKind::Binary`. Re-run `cargo build -p lcdiff-core` until green.

- [ ] **Step 6: Commit**

```bash
git add crates/lcdiff-core/src/detect.rs
git commit -m "feat(core): add EntryKind::Archive for jar/zip/war/ear

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Nested path utilities

**Files:**
- Create: `crates/lcdiff-core/src/nested.rs`
- Modify: `crates/lcdiff-core/src/lib.rs`
- Test: in `crates/lcdiff-core/src/nested.rs`

- [ ] **Step 1: Write the failing test + module skeleton**

Create `crates/lcdiff-core/src/nested.rs`:

```rust
//! On-demand extraction of nested archives to temp files.

pub const ARCHIVE_SEPARATOR: &str = "!/";

/// True when `path` addresses an entry inside a nested archive.
pub fn is_nested(path: &str) -> bool {
    path.contains(ARCHIVE_SEPARATOR)
}

#[cfg(test)]
mod tests {
    use super::{ARCHIVE_SEPARATOR, is_nested};

    #[test]
    fn detects_nesting() {
        assert!(!is_nested("lib/inner.jar"));
        assert!(is_nested("lib/inner.jar!/com/A.class"));
        assert!(is_nested("a.jar!/b.jar!/B.class"));
        assert_eq!(ARCHIVE_SEPARATOR, "!/");
    }
}
```

- [ ] **Step 2: Register the module**

In `crates/lcdiff-core/src/lib.rs`, add `mod nested;` (alphabetical, after `mod merge;`) and export:

```rust
pub use nested::{ARCHIVE_SEPARATOR, NestedArchiveCache, is_nested};
```

(`NestedArchiveCache` is added in Task 4 — comment it out of the `pub use` until then, or add a placeholder. Simplest: in this task export only `ARCHIVE_SEPARATOR, is_nested`; extend the `pub use` in Task 4.)

- [ ] **Step 3: Run test to verify it passes**

Run: `cargo test -p lcdiff-core nested`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/lcdiff-core/src/nested.rs crates/lcdiff-core/src/lib.rs
git commit -m "feat(core): nested archive path helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Core nested extraction

### Task 3: Promote `tempfile` to a runtime dependency

**Files:**
- Modify: `crates/lcdiff-core/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml**

In `crates/lcdiff-core/Cargo.toml`, add to `[dependencies]` (keep alphabetical):

```toml
tempfile.workspace = true
```

It is already under `[dev-dependencies]`; leave that line too (harmless duplication is fine, or remove the dev one). The workspace pins `tempfile = "3.20"`.

- [ ] **Step 2: Verify it builds**

Run: `cargo build -p lcdiff-core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/lcdiff-core/Cargo.toml
git commit -m "build(core): make tempfile a runtime dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `NestedArchiveCache` extraction

**Files:**
- Modify: `crates/lcdiff-core/src/nested.rs`
- Modify: `crates/lcdiff-core/src/lib.rs`
- Test: `crates/lcdiff-core/tests/core.rs`

- [ ] **Step 1: Write the failing integration test**

First note the existing test helper `create_zip(path, &[(name, bytes)])` in `crates/lcdiff-core/tests/core.rs`. Append this test (it builds an outer jar containing an inner jar as a stored entry):

```rust
#[test]
fn resolves_one_and_two_level_nested_entries() {
    use lcdiff_core::NestedArchiveCache;
    use std::io::Read as _;

    let dir = tempdir().unwrap();

    // innermost jar: B.class-ish bytes
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("com/A.txt", b"hello-inner")]);
    let inner_bytes = fs::read(&inner_path).unwrap();

    // middle jar contains inner.jar
    let middle_path = dir.path().join("middle.jar");
    create_zip(&middle_path, &[("nested/inner.jar", &inner_bytes)]);
    let middle_bytes = fs::read(&middle_path).unwrap();

    // outer jar contains middle.jar
    let outer_path = dir.path().join("outer.jar");
    create_zip(&outer_path, &[("lib/middle.jar", &middle_bytes)]);

    let root = Archive::open(outer_path.to_string_lossy()).unwrap();
    let mut cache = NestedArchiveCache::new().unwrap();

    // one level: read an entry inside lib/middle.jar
    let (arc1, leaf1) = cache.resolve(&root, "lib/middle.jar!/nested/inner.jar").unwrap();
    assert_eq!(leaf1, "nested/inner.jar");
    assert_eq!(arc1.read_entry("nested/inner.jar").unwrap(), inner_bytes);

    // two levels: read an entry inside lib/middle.jar!/nested/inner.jar
    let (arc2, leaf2) = cache
        .resolve(&root, "lib/middle.jar!/nested/inner.jar!/com/A.txt")
        .unwrap();
    assert_eq!(leaf2, "com/A.txt");
    assert_eq!(arc2.read_entry("com/A.txt").unwrap(), b"hello-inner");

    // top-level (no separator) returns root + whole path
    let (arc0, leaf0) = cache.resolve(&root, "lib/middle.jar").unwrap();
    assert_eq!(leaf0, "lib/middle.jar");
    assert!(arc0.entry("lib/middle.jar").is_some());

    let _ = (&mut cache, Read::read); // silence unused import if needed
}

#[test]
fn resolve_archive_opens_nested_archive_directly() {
    use lcdiff_core::NestedArchiveCache;

    let dir = tempdir().unwrap();
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("x.txt", b"xx")]);
    let inner_bytes = fs::read(&inner_path).unwrap();
    let outer_path = dir.path().join("outer.jar");
    create_zip(&outer_path, &[("lib/inner.jar", &inner_bytes)]);

    let root = Archive::open(outer_path.to_string_lossy()).unwrap();
    let mut cache = NestedArchiveCache::new().unwrap();
    let arc = cache.resolve_archive(&root, "lib/inner.jar").unwrap();
    assert_eq!(arc.read_entry("x.txt").unwrap(), b"xx");
}
```

If `create_zip` in `tests/core.rs` does not accept `&[u8]` slices of varying source, confirm its signature; it is `fn create_zip(path: &Path, entries: &[(&str, &[u8])])`. The byte vectors above coerce via `&inner_bytes`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p lcdiff-core --test core resolves_one_and_two_level`
Expected: FAIL — `NestedArchiveCache` / `resolve` not found.

- [ ] **Step 3: Implement `NestedArchiveCache`**

In `crates/lcdiff-core/src/nested.rs`, add above the `#[cfg(test)]` block:

```rust
use std::{collections::HashMap, fs, path::PathBuf};

use tempfile::TempDir;

use crate::{Archive, Result};

/// Extracts nested archives to temp files on demand and caches the opened
/// `Archive` keyed by its archive-chain prefix (e.g. `"lib/inner.jar"` or
/// `"lib/inner.jar!/inner2.jar"`).
pub struct NestedArchiveCache {
    temp_dir: TempDir,
    archives: HashMap<String, Archive>,
    counter: usize,
}

impl NestedArchiveCache {
    pub fn new() -> Result<Self> {
        Ok(Self {
            temp_dir: tempfile::tempdir()?,
            archives: HashMap::new(),
            counter: 0,
        })
    }

    /// Drop all cached archives. Temp files are removed when `temp_dir` is
    /// dropped (i.e. when the whole cache is replaced).
    pub fn clear(&mut self) {
        self.archives.clear();
    }

    /// Open the archive addressed by `archive_path` (every `!/`-segment is an
    /// archive, including the last).
    pub fn resolve_archive(&mut self, root: &Archive, archive_path: &str) -> Result<Archive> {
        let mut current = root.clone();
        let mut prefix = String::new();
        for segment in archive_path.split(ARCHIVE_SEPARATOR) {
            prefix = if prefix.is_empty() {
                segment.to_owned()
            } else {
                format!("{prefix}{ARCHIVE_SEPARATOR}{segment}")
            };
            if !self.archives.contains_key(&prefix) {
                let bytes = current.read_entry(segment)?;
                let path = self.next_temp_path();
                fs::write(&path, &bytes)?;
                let archive = Archive::open_validated(path)?;
                self.archives.insert(prefix.clone(), archive);
            }
            current = self.archives.get(&prefix).expect("just inserted").clone();
        }
        Ok(current)
    }

    /// Resolve a (possibly nested) entry path to its innermost `Archive` plus
    /// the leaf entry path inside that archive. Non-nested paths return a clone
    /// of `root` and the path unchanged.
    pub fn resolve(&mut self, root: &Archive, entry_path: &str) -> Result<(Archive, String)> {
        match entry_path.rsplit_once(ARCHIVE_SEPARATOR) {
            None => Ok((root.clone(), entry_path.to_owned())),
            Some((archive_chain, leaf)) => {
                let archive = self.resolve_archive(root, archive_chain)?;
                Ok((archive, leaf.to_owned()))
            }
        }
    }

    fn next_temp_path(&mut self) -> PathBuf {
        let name = format!("nested-{}.zip", self.counter);
        self.counter += 1;
        self.temp_dir.path().join(name)
    }
}
```

`Archive::open_validated` is already `pub` (used in `archive.rs`); confirm with `grep -n "pub fn open_validated" crates/lcdiff-core/src/archive.rs`. If it is not `pub`, make it `pub`.

- [ ] **Step 4: Export it**

In `crates/lcdiff-core/src/lib.rs`, extend the nested export to:

```rust
pub use nested::{ARCHIVE_SEPARATOR, NestedArchiveCache, is_nested};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p lcdiff-core --test core nested ; cargo test -p lcdiff-core --test core resolve`
Expected: PASS for `resolves_one_and_two_level_nested_entries` and `resolve_archive_opens_nested_archive_directly`.

(If the `let _ = (&mut cache, Read::read);` line causes a warning/error, delete it and the `use std::io::Read as _;` line — they are only there to avoid an unused-import lint; remove if unused.)

- [ ] **Step 6: Commit**

```bash
git add crates/lcdiff-core/src/nested.rs crates/lcdiff-core/src/lib.rs crates/lcdiff-core/tests/core.rs
git commit -m "feat(core): NestedArchiveCache extracts nested archives on demand

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Core merge recursive repack

### Task 5: Bytes-based zip read/rewrite helpers

**Files:**
- Modify: `crates/lcdiff-core/src/merge.rs`
- Test: `crates/lcdiff-core/tests/core.rs`

- [ ] **Step 1: Write the failing test**

Append to `crates/lcdiff-core/tests/core.rs`:

```rust
#[test]
fn rewrite_zip_bytes_replaces_entry() {
    use lcdiff_core::{read_zip_entry_from_bytes, rewrite_zip_bytes};
    use std::collections::BTreeMap;

    let dir = tempdir().unwrap();
    let jar = dir.path().join("a.jar");
    create_zip(&jar, &[("keep.txt", b"keep"), ("swap.txt", b"old")]);
    let bytes = fs::read(&jar).unwrap();

    let mut repl = BTreeMap::new();
    repl.insert("swap.txt".to_owned(), b"new".to_vec());
    let out = rewrite_zip_bytes(&bytes, &repl).unwrap();

    assert_eq!(read_zip_entry_from_bytes(&out, "keep.txt").unwrap(), b"keep");
    assert_eq!(read_zip_entry_from_bytes(&out, "swap.txt").unwrap(), b"new");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p lcdiff-core --test core rewrite_zip_bytes`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement helpers in `merge.rs`**

Add to `crates/lcdiff-core/src/merge.rs` (and to imports: `use std::io::Cursor;` and `use crate::{... , nested::ARCHIVE_SEPARATOR}` will be needed in Task 6; for now just `Cursor`). Add these public functions:

```rust
/// Read a single entry's bytes from an in-memory zip.
pub fn read_zip_entry_from_bytes(zip_bytes: &[u8], name: &str) -> Result<Vec<u8>> {
    let name = normalize_archive_entry_path(name)?;
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;
    let mut entry = archive
        .by_name(&name)
        .map_err(|_| Error::EntryNotFound(name.clone()))?;
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut out)?;
    Ok(out)
}

/// Rewrite an in-memory zip, substituting any entry present in `replacements`
/// (keyed by normalized entry path). Entries only present in `replacements`
/// are appended.
pub fn rewrite_zip_bytes(
    zip_bytes: &[u8],
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let mut source = ZipArchive::new(Cursor::new(zip_bytes))?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let mut pending = replacements.clone();
    for index in 0..source.len() {
        let mut entry = source.by_index(index)?;
        let path = normalize_archive_entry_path(entry.name())?;
        let options = entry
            .options()
            .large_file(entry.size().max(entry.compressed_size()) >= ZIP64_BYTES_THR)
            .unix_permissions(entry.unix_mode().unwrap_or(0o644));
        if entry.is_dir() {
            writer.add_directory(path, options)?;
            continue;
        }
        writer.start_file(path.clone(), options)?;
        if let Some(replacement) = pending.remove(&path) {
            writer.write_all(&replacement)?;
        } else {
            io::copy(&mut entry, &mut writer)?;
        }
    }
    for (path, bytes) in pending {
        writer.start_file(
            path,
            SimpleFileOptions::default()
                .large_file(bytes.len() as u64 >= ZIP64_BYTES_THR)
                .compression_method(zip::CompressionMethod::Deflated),
        )?;
        writer.write_all(&bytes)?;
    }
    Ok(writer.finish()?.into_inner())
}
```

`std::io::Read` is needed for `read_to_end`; add `Read` to the `use std::{... io::{...}}` import in `merge.rs` (currently imports `io::{self, Write}` — change to `io::{self, Read, Write}`).

- [ ] **Step 4: Export the helpers**

In `crates/lcdiff-core/src/lib.rs`, extend the merge export line to include them:

```rust
pub use merge::{
    CommitOptions, CommitResult, MergePlan, StagedCopy, read_zip_entry_from_bytes,
    rewrite_zip_bytes,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p lcdiff-core --test core rewrite_zip_bytes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/lcdiff-core/src/merge.rs crates/lcdiff-core/src/lib.rs crates/lcdiff-core/tests/core.rs
git commit -m "feat(core): in-memory zip read/rewrite helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Recursive repack + nested-aware commit

**Files:**
- Modify: `crates/lcdiff-core/src/merge.rs`
- Test: `crates/lcdiff-core/tests/core.rs`

- [ ] **Step 1: Write the failing integration test**

Append to `crates/lcdiff-core/tests/core.rs`:

```rust
#[test]
fn commit_copies_entry_into_nested_jar() {
    use lcdiff_core::read_zip_entry_from_bytes;

    let dir = tempdir().unwrap();

    // SOURCE side: top-level file new.txt to copy into target's nested jar.
    let source_path = dir.path().join("source.jar");
    create_zip(&source_path, &[("payload.txt", b"NEW-PAYLOAD")]);
    let source = Archive::open(source_path.to_string_lossy()).unwrap();

    // TARGET side: contains lib/inner.jar which contains docs/old.txt.
    let inner_path = dir.path().join("inner.jar");
    create_zip(&inner_path, &[("docs/old.txt", b"OLD")]);
    let inner_bytes = fs::read(&inner_path).unwrap();
    let target_path = dir.path().join("target.jar");
    create_zip(&target_path, &[("lib/inner.jar", &inner_bytes)]);
    let target = Archive::open(target_path.to_string_lossy()).unwrap();

    // Stage: copy source payload.txt -> target lib/inner.jar!/docs/new.txt
    let mut plan = MergePlan::new();
    plan.stage_copy(&source, "payload.txt", "lib/inner.jar!/docs/new.txt")
        .unwrap();
    let result = plan.commit(&target, CommitOptions::default()).unwrap();
    assert_eq!(result.copied_entries, 1);

    // Reopen target, extract lib/inner.jar, assert it now holds docs/new.txt.
    let rewritten = Archive::open(target_path.to_string_lossy()).unwrap();
    let inner_after = rewritten.read_entry("lib/inner.jar").unwrap();
    assert_eq!(
        read_zip_entry_from_bytes(&inner_after, "docs/new.txt").unwrap(),
        b"NEW-PAYLOAD"
    );
    // original entry preserved
    assert_eq!(
        read_zip_entry_from_bytes(&inner_after, "docs/old.txt").unwrap(),
        b"OLD"
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p lcdiff-core --test core commit_copies_entry_into_nested_jar`
Expected: FAIL — `stage_copy` rejects the nested target (entry not found) or commit produces wrong bytes.

- [ ] **Step 3: Relax `stage_copy` for nested paths**

In `crates/lcdiff-core/src/merge.rs`, add `use crate::{... is_nested}` (extend the existing `use crate::{...}` line to include `is_nested`). Change `MergePlan::stage_copy` so the source-entry existence/directory check is skipped for nested source paths:

```rust
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
        let staged = StagedCopy {
            source_archive: source.path().to_path_buf(),
            source_entry_path,
            target_entry_path: target_entry_path.clone(),
            source_snapshot: source.clone(),
        };
        if let Some(copy) = self
            .copies
            .iter_mut()
            .find(|copy| copy.target_entry_path == target_entry_path)
        {
            *copy = staged;
        } else {
            self.copies.push(staged);
        }
        Ok(())
    }
```

- [ ] **Step 4: Make `read_replacements` resolve nested sources**

In `crates/lcdiff-core/src/merge.rs`, add `use crate::NestedArchiveCache;` (or `crate::nested::NestedArchiveCache`). Replace `read_replacements`:

```rust
    fn read_replacements(&self) -> Result<BTreeMap<String, Vec<u8>>> {
        let mut replacements = BTreeMap::new();
        let mut cache = NestedArchiveCache::new()?;
        for copy in &self.copies {
            if copy.source_snapshot.changed_on_disk()? {
                return Err(Error::ArchiveChanged(copy.source_archive.clone()));
            }
            let (archive, leaf) = cache.resolve(&copy.source_snapshot, &copy.source_entry_path)?;
            replacements.insert(copy.target_entry_path.clone(), archive.read_entry(&leaf)?);
        }
        Ok(replacements)
    }
```

- [ ] **Step 5: Add recursive repack + flatten**

In `crates/lcdiff-core/src/merge.rs`, add these free functions (near `rewrite_archive`):

```rust
/// Apply replacements (keys relative to `archive_bytes`, possibly nested via
/// `!/`) to an in-memory archive, recursively repacking inner archives.
fn apply_nested_replacements(
    archive_bytes: &[u8],
    replacements: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let mut direct: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut nested: BTreeMap<String, BTreeMap<String, Vec<u8>>> = BTreeMap::new();
    for (key, bytes) in replacements {
        match key.split_once(ARCHIVE_SEPARATOR) {
            Some((head, rest)) => {
                nested
                    .entry(head.to_owned())
                    .or_default()
                    .insert(rest.to_owned(), bytes.clone());
            }
            None => {
                direct.insert(key.clone(), bytes.clone());
            }
        }
    }
    for (child_entry, child_repls) in nested {
        let original = read_zip_entry_from_bytes(archive_bytes, &child_entry)?;
        let rewritten = apply_nested_replacements(&original, &child_repls)?;
        direct.insert(child_entry, rewritten);
    }
    rewrite_zip_bytes(archive_bytes, &direct)
}

/// Collapse nested replacements into top-level-only replacements by reading the
/// affected top-level archive entries from `target` and repacking them.
fn flatten_nested_replacements(
    target: &Archive,
    replacements: BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut direct: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut nested: BTreeMap<String, BTreeMap<String, Vec<u8>>> = BTreeMap::new();
    for (key, bytes) in replacements {
        match key.split_once(ARCHIVE_SEPARATOR) {
            Some((head, rest)) => {
                nested
                    .entry(head.to_owned())
                    .or_default()
                    .insert(rest.to_owned(), bytes);
            }
            None => {
                direct.insert(key, bytes);
            }
        }
    }
    for (archive_entry, child_repls) in nested {
        let original = target.read_entry(&archive_entry)?;
        let rewritten = apply_nested_replacements(&original, &child_repls)?;
        direct.insert(archive_entry, rewritten);
    }
    Ok(direct)
}
```

Add `use crate::nested::ARCHIVE_SEPARATOR;` (or include in the existing `use crate::{...}`).

- [ ] **Step 6: Wire flatten + nested-signature into `commit`**

In `MergePlan::commit`, after `ensure_target_writable(target.path())?;`, change the replacement computation:

```rust
        let raw = self.read_replacements()?;
        let copied_entries = raw.len();
        let nested_rewrite = raw.keys().any(|key| crate::is_nested(key));
        let replacements = flatten_nested_replacements(target, raw)?;
```

Then in both branches replace `copied_entries: replacements.len(),` with `copied_entries,` and set:

```rust
            signature_invalidated: target.metadata().signed || nested_rewrite,
```

for the archive branch. For the directory branch keep `signature_invalidated: nested_rewrite` (directories were `false`; nested jar rewrite inside a directory still warrants the flag). Concretely the directory branch `CommitResult` becomes:

```rust
                CommitResult {
                    rewritten_path: target_path.to_path_buf(),
                    backup_path,
                    signature_invalidated: nested_rewrite,
                    copied_entries,
                }
```

and the archive branch:

```rust
                .map(|_| CommitResult {
                    rewritten_path: target_path.to_path_buf(),
                    backup_path,
                    signature_invalidated: target.metadata().signed || nested_rewrite,
                    copied_entries,
                })
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test -p lcdiff-core`
Expected: PASS, including `commit_copies_entry_into_nested_jar` and all pre-existing merge tests (verify no regression — the non-nested path now flows through `flatten_nested_replacements`, which is a no-op when no key contains `!/`).

- [ ] **Step 8: Commit**

```bash
git add crates/lcdiff-core/src/merge.rs crates/lcdiff-core/tests/core.rs
git commit -m "feat(core): recursive repack to commit copies into nested archives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — IPC wiring

### Task 7: Per-side `NestedArchiveCache` in `AppState`

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add fields + reset**

In `src-tauri/src/main.rs`:

1. Extend the `lcdiff_core` import to add `NestedArchiveCache, compute as _?` — specifically add `NestedArchiveCache` and `ArchiveDiff` is already imported. Add `NestedArchiveCache` to the `use lcdiff_core::{...}` list.
2. Add fields to `struct AppState`:

```rust
    left_nested: NestedArchiveCache,
    right_nested: NestedArchiveCache,
```

3. In `AppState::new`, initialize them (it returns `Self`, not `Result`; `NestedArchiveCache::new()` returns `Result`, so use `.expect`):

```rust
            left_nested: NestedArchiveCache::new().expect("temp dir for nested cache"),
            right_nested: NestedArchiveCache::new().expect("temp dir for nested cache"),
```

4. In `install_archive`, reset the relevant side's cache after installing:

```rust
    fn install_archive(&mut self, archive: Archive, side: Side) -> Result<ArchiveSummary, String> {
        if !self.merge_plan.staged().is_empty() {
            return Err("save staged copies before changing an archive".to_owned());
        }
        let summary = summarize(&archive);
        *archive_mut(self, side) = Some(archive);
        match side {
            Side::Left => self.left_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?,
            Side::Right => self.right_nested = NestedArchiveCache::new().map_err(|e| e.to_string())?,
        }
        Ok(summary)
    }
```

(Replacing the whole cache drops the old `TempDir`, deleting stale temp files.)

- [ ] **Step 2: Add a resolve helper**

Add near the other free helpers (e.g. after `fn archive_mut`):

```rust
fn nested_cache_mut(state: &mut AppState, side: Side) -> &mut NestedArchiveCache {
    match side {
        Side::Left => &mut state.left_nested,
        Side::Right => &mut state.right_nested,
    }
}

/// Resolve a (possibly nested) entry path for `side` to its innermost archive
/// (a clone) plus the leaf entry path. Clones the root first so the cache
/// borrow does not conflict with the archive borrow.
fn resolve_side_entry(
    state: &mut AppState,
    side: Side,
    entry_path: &str,
) -> Result<(Archive, String), String> {
    let root = archive(state, side).ok_or("archive is not loaded")?.clone();
    nested_cache_mut(state, side)
        .resolve(&root, entry_path)
        .map_err(|error| error.to_string())
}
```

- [ ] **Step 3: Verify it builds (commands not yet using it)**

Run: `cargo build -p lcdiff-tauri 2>/dev/null || cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (the helper may warn as unused — acceptable for this step; it is used in Task 8 next).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(app): per-side nested archive cache in AppState

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Route `read_entry` + `disassemble` through nested resolve, add `compute_nested_diff`

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Handle `EntryKind::Archive` in `read_entry_preview`**

In `read_entry_preview`, add an arm so an archive entry previews as hex like binary. Change the `match entry.kind` to add:

```rust
        EntryKind::Archive | EntryKind::Binary => (
            "plaintext",
            Some(format!(
                "Binary · {} bytes · SHA-256 {} · CRC32 {:08x}",
                entry.uncompressed_size,
                sha256_hex(&bytes),
                entry.crc32
            )),
            hex_preview(&bytes),
        ),
```

(Merge the existing `EntryKind::Binary` arm into this combined pattern.)

- [ ] **Step 2: Route `read_entry` through the cache**

Replace the body of the `read_entry` command's state block so it resolves nested paths:

```rust
#[tauri::command]
async fn read_entry(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<EntryPreview, String> {
    let (archive, leaf, engine, sidecar) = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.sidecar);
        let (archive, leaf) = resolve_side_entry(&mut state, side, &entry_path)?;
        (archive, leaf, engine, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_entry_preview(&archive, engine, &sidecar, leaf)
    })
    .await
    .map_err(|error| error.to_string())?
}
```

Note: `read_entry_preview` returns `EntryPreview { path: entry_path, .. }` using the *leaf* path now. That is fine for display; the frontend tracks the full path itself. (No behavior depends on the returned `path` for nested.)

- [ ] **Step 3: Route `disassemble` through the cache**

Replace the `disassemble` command's state block:

```rust
#[tauri::command]
async fn disassemble(
    side: Side,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let (archive_path, source_path, sidecar) = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let sidecar = Arc::clone(&state.sidecar);
        let (archive, leaf) = resolve_side_entry(&mut state, side, &entry_path)?;
        let source_path = class_source_path(&archive, &leaf)?;
        (archive.path().display().to_string(), source_path, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        sidecar
            .lock()
            .map_err(|_| "sidecar lock is poisoned".to_owned())?
            .disassemble(archive_path, source_path)
    })
    .await
    .map_err(|error| error.to_string())?
}
```

The decompile sidecar receives the temp jar's real path + the leaf source path — this is why Approach A needs no sidecar change.

- [ ] **Step 4: Add `compute_nested_diff`**

Add a new command (place after `compute_diff`):

```rust
#[tauri::command]
async fn compute_nested_diff(
    nested_path: String,
    state: State<'_, SharedState>,
) -> Result<ArchiveDiff, String> {
    let left = nested_side_archive(&state, Side::Left, &nested_path);
    let right = nested_side_archive(&state, Side::Right, &nested_path);
    match (left, right) {
        (None, None) => Err("nested archive is not present on either side".to_owned()),
        (Some(left), Some(right)) => {
            tauri::async_runtime::spawn_blocking(move || Ok(compare(&left, &right)))
                .await
                .map_err(|error| error.to_string())?
        }
        (Some(only), None) => Ok(one_sided_diff(&only, Side::Left)),
        (None, Some(only)) => Ok(one_sided_diff(&only, Side::Right)),
    }
}

fn nested_side_archive(state: &SharedState, side: Side, nested_path: &str) -> Option<Archive> {
    let mut state = state.lock().ok()?;
    let root = archive(&state, side)?.clone();
    nested_cache_mut(&mut state, side)
        .resolve_archive(&root, nested_path)
        .ok()
}

fn one_sided_diff(archive: &Archive, side: Side) -> ArchiveDiff {
    use lcdiff_core::{ComparePair, PairStatus};
    let pairs = archive
        .entries()
        .map(|entry| {
            let entry = entry.clone();
            match side {
                Side::Left => ComparePair {
                    path: entry.path.clone(),
                    left: Some(entry),
                    right: None,
                    status: PairStatus::OnlyLeft,
                },
                Side::Right => ComparePair {
                    path: entry.path.clone(),
                    left: None,
                    right: Some(entry),
                    status: PairStatus::OnlyRight,
                },
            }
        })
        .collect();
    ArchiveDiff { pairs }
}
```

Add `ComparePair, PairStatus` to the `lcdiff_core` import (or use the inline `use` as shown). Ensure `compare` and `ArchiveDiff` are imported (they are).

- [ ] **Step 5: Register the command**

In `generate_handler!`, add `compute_nested_diff` (e.g. after `compute_diff,`):

```rust
            compute_diff,
            compute_nested_diff,
```

- [ ] **Step 6: Build + run existing app tests**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. Existing `read_entry_preview` test still passes (binary arm unchanged in behavior).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(app): nested-aware read_entry/disassemble + compute_nested_diff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — Frontend

### Task 9: `EntryKind` "archive" + tree helper

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/tree.ts`
- Test: `src/lib/tree.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tree.test.ts` inside the file (new `describe` or `it`):

```ts
import { isArchiveKind } from "@/lib/tree";

describe("isArchiveKind", () => {
  it("detects archive entries on either side", () => {
    expect(isArchiveKind({ path: "a.jar", status: "different", left: { path: "a.jar", kind: "archive" } })).toBe(true);
    expect(isArchiveKind({ path: "b.txt", status: "onlyLeft", left: { path: "b.txt", kind: "text" } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tree`
Expected: FAIL — `isArchiveKind` not exported / `"archive"` not assignable to `EntryKind`.

- [ ] **Step 3: Implement**

In `src/lib/types.ts` change:

```ts
export type EntryKind = "directory" | "class" | "text" | "archive" | "binary";
```

In `src/lib/tree.ts` add at the end:

```ts
export function isArchiveKind(pair: ComparePair): boolean {
  return pair.left?.kind === "archive" || pair.right?.kind === "archive";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tree`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/tree.ts src/lib/tree.test.ts
git commit -m "feat(ui): archive EntryKind + isArchiveKind helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: FileTree renders nested archives as expandable

**Files:**
- Modify: `src/components/FileTree.tsx`
- Modify: `src/components/FileTree.test.tsx`

This task introduces `basePath` threading so a node's full (possibly nested) path is `basePath ? `${basePath}!/${node.path}` : node.path`, and renders archive nodes with their children fetched lazily via `nestedPairs` / `onExpandArchive`.

- [ ] **Step 1: Update the test to pass new props and assert expandable rendering**

In `src/components/FileTree.test.tsx`, locate where `<FileTree .../>` is rendered. Add the two new required props to every render: `nestedPairs={{}}` and `onExpandArchive={() => {}}`. Then add a test:

```tsx
it("renders a nested archive entry as an expandable row", () => {
  const pairs: ComparePair[] = [
    { path: "lib/inner.jar", status: "different", left: { path: "lib/inner.jar", kind: "archive" }, right: { path: "lib/inner.jar", kind: "archive" } },
  ];
  const onExpandArchive = vi.fn();
  render(
    <FileTree
      visiblePairs={pairs}
      stagedEntries={{}}
      mode="compare"
      nestedPairs={{}}
      onInspect={() => {}}
      onSelect={() => {}}
      onCopy={() => {}}
      onUnstage={() => {}}
      onExpandArchive={onExpandArchive}
    />,
  );
  const row = screen.getByText("inner.jar").closest("button")!;
  fireEvent.click(row);
  expect(onExpandArchive).toHaveBeenCalledWith("lib/inner.jar");
});
```

Ensure imports at the top of the test file include `vi`, `fireEvent`, `screen`, `render` from the existing testing setup, and `ComparePair` from `@/lib/types`. Match the existing test file's import style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FileTree`
Expected: FAIL — `onExpandArchive` not called / prop type errors.

- [ ] **Step 3: Implement FileTree changes**

Rewrite `src/components/FileTree.tsx` as follows (full file):

```tsx
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, File, FileArchive, Folder, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { statusPresentation } from "@/lib/status";
import { buildTree, isArchiveKind, type TreeNode } from "@/lib/tree";
import type { ComparePair, Mode, Side } from "@/lib/types";

interface FileTreeProps {
  visiblePairs: ComparePair[];
  selected?: ComparePair;
  stagedEntries: Record<string, Side>;
  mode: Mode;
  nestedPairs: Record<string, ComparePair[]>;
  onInspect: (pair: ComparePair) => void;
  onSelect: (pair: ComparePair) => void;
  onCopy: (from: Side, to: Side, pair: ComparePair) => void;
  onUnstage: (entryPath: string) => void;
  onExpandArchive: (fullPath: string) => void;
}

function defaultExpanded(nodes: TreeNode[], acc: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.diffCount > 0) acc.add(node.path);
      defaultExpanded(node.children, acc);
    }
  }
  return acc;
}

export function FileTree(props: FileTreeProps) {
  const { visiblePairs } = props;
  const tree = useMemo(() => buildTree(visiblePairs), [visiblePairs]);
  const pathsKey = useMemo(() => visiblePairs.map((p) => p.path).join("|"), [visiblePairs]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(tree));
  useEffect(() => {
    setExpanded(defaultExpanded(tree));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="tree">
      {tree.map((node) => (
        <FileTreeNode {...props} key={node.path} node={node} depth={0} basePath="" expanded={expanded} onToggle={toggle} />
      ))}
    </div>
  );
}

interface NodeProps extends FileTreeProps {
  node: TreeNode;
  depth: number;
  basePath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

function fullPathOf(basePath: string, nodePath: string): string {
  return basePath ? `${basePath}!/${nodePath}` : nodePath;
}

function FileTreeNode({ node, depth, basePath, expanded, onToggle, ...props }: NodeProps) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === "folder") {
    const fullPath = fullPathOf(basePath, node.path);
    const open = expanded.has(fullPath);
    return (
      <>
        <button
          type="button"
          className="tree-row tree-folder"
          style={indent}
          aria-expanded={open}
          onClick={() => onToggle(fullPath)}
        >
          {open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />}
          {open ? <FolderOpen className="tree-icon" /> : <Folder className="tree-icon" />}
          <span className="tree-name">{node.name}</span>
          {node.diffCount > 0 && <span className="folder-rollup">● {node.diffCount}</span>}
        </button>
        {open && node.children.map((child) => (
          <FileTreeNode {...props} key={child.path} node={child} depth={depth + 1} basePath={basePath} expanded={expanded} onToggle={onToggle} />
        ))}
      </>
    );
  }

  const { pair } = node;
  const fullPath = fullPathOf(basePath, node.path);
  const fullPair: ComparePair = basePath ? { ...pair, path: fullPath } : pair;
  const { selected, stagedEntries, mode, nestedPairs, onInspect, onSelect, onCopy, onUnstage, onExpandArchive } = props;
  const pres = statusPresentation(pair.status);

  if (isArchiveKind(pair)) {
    const open = expanded.has(fullPath);
    const children = nestedPairs[fullPath];
    return (
      <>
        <button
          type="button"
          style={indent}
          className={`tree-row tree-folder ${pair.status}`}
          aria-expanded={open}
          onClick={() => {
            if (!open && children === undefined) onExpandArchive(fullPath);
            onToggle(fullPath);
          }}
        >
          {open ? <ChevronDown className="tree-chevron" /> : <ChevronRight className="tree-chevron" />}
          <FileArchive className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          {stagedEntries[fullPath] && <Badge variant="secondary">pending → {stagedEntries[fullPath]}</Badge>}
          <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>
        </button>
        {open && children === undefined && (
          <div className="tree-row" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>Loading…</div>
        )}
        {open && children !== undefined && buildTree(children).map((child) => (
          <FileTreeNode {...props} key={child.path} node={child} depth={depth + 1} basePath={fullPath} expanded={expanded} onToggle={onToggle} />
        ))}
      </>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          style={indent}
          className={`tree-row tree-file ${pair.status} ${selected?.path === fullPath ? "selected" : ""}`}
          onClick={() => onInspect(fullPair)}
          onContextMenu={() => onSelect(fullPair)}
        >
          <File className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          {stagedEntries[fullPath] && <Badge variant="secondary">pending → {stagedEntries[fullPath]}</Badge>}
          <span className="status-chip" title={pres.label} aria-label={pres.label}>{pres.glyph}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={mode === "single" || !pair.right || pair.right.kind === "directory"}
          onSelect={() => onCopy("right", "left", fullPair)}
        >
          Copy to left
        </ContextMenuItem>
        <ContextMenuItem
          disabled={mode === "single" || !pair.left || pair.left.kind === "directory"}
          onSelect={() => onCopy("left", "right", fullPair)}
        >
          Copy to right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!stagedEntries[fullPath]} onSelect={() => onUnstage(fullPath)}>
          Unstage
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

Key points: `selected?.path === fullPath`, `stagedEntries[fullPath]`, and all callbacks use `fullPair` (path = fullPath). `FileArchive` is a lucide-react icon; confirm it exists in the installed version (`grep -r "FileArchive" node_modules/lucide-react/dist/lucide-react.d.ts | head`). If absent, use `Folder` with a distinct className instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- FileTree`
Expected: PASS (new expandable test + existing FileTree tests, which now pass the extra props).

- [ ] **Step 5: Commit**

```bash
git add src/components/FileTree.tsx src/components/FileTree.test.tsx
git commit -m "feat(ui): render nested archives as expandable tree nodes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Wire `compute_nested_diff` into App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add nestedPairs state + expand handler**

In `src/App.tsx`, add state near the other `useState` declarations (after `pairs`):

```tsx
  const [nestedPairs, setNestedPairs] = useState<Record<string, ComparePair[]>>({});
```

Add an expand handler (a `useCallback`, near `inspect`/`copy`):

```tsx
  const expandArchive = useCallback(async (fullPath: string) => {
    try {
      const diff = await invoke<ArchiveDiff>("compute_nested_diff", { nestedPath: fullPath });
      setNestedPairs((prev) => ({ ...prev, [fullPath]: diff.pairs }));
    } catch (error) {
      setMessage(String(error));
    }
  }, []);
```

- [ ] **Step 2: Clear nestedPairs when the top-level diff changes**

In the effect/function that calls `invoke<ArchiveDiff>("compute_diff")` and `setPairs(diff.pairs)` (around line 173), add `setNestedPairs({});` alongside `setPairs(...)` in both the success and the empty/`catch` branches.

- [ ] **Step 3: Guard prefetch against nested paths**

In `inspect`, the loop that calls `invoke("prefetch_siblings", ...)` should skip nested entries (the prefetch command reads from the top-level archive only). Change the condition:

```tsx
    for (const side of ["left", "right"] as const) {
      if (pair[side]?.kind === "class" && !pair.path.includes("!/")) {
        void invoke("prefetch_siblings", { side, entryPath: pair.path });
      }
    }
```

- [ ] **Step 4: Pass the new props to FileTree**

Find every `<FileTree ... />` usage (there are two in the JSX around lines 670–690). Add to each:

```tsx
                nestedPairs={nestedPairs}
                onExpandArchive={(fullPath) => void expandArchive(fullPath)}
```

- [ ] **Step 5: Build + typecheck + test**

Run: `npm run build` (or the repo's typecheck script) and `npm test`
Expected: PASS, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): lazy-expand nested archives in the diff tree

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Full build + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Workspace build + all tests**

Run: `cargo test && npm test`
Expected: PASS across `lcdiff-core`, `src-tauri`, and Vitest.

- [ ] **Step 2: Lint/format if the repo enforces it**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings` (skip flags the repo does not use)
Expected: clean, or fix reported issues.

- [ ] **Step 3: Manual smoke (document outcome)**

Build/run the app (`npm run tauri dev` if available), open a jar that contains a nested jar on both sides, click the nested jar row, confirm it expands into a sub-tree, select an inner class and confirm source/bytecode shows (not hex), then stage-copy an inner entry across sides and commit; reopen and confirm the nested jar was rewritten. Record the result in the PR description.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test: verify nested archive expand + merge end to end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** `!/` addressing (Tasks 2,4,6,8,10), `EntryKind::Archive` (Task 1), `extract_nested`/cache (Task 4), `compute_nested_diff` + nested `read_entry`/`disassemble` (Task 8), frontend expand + graft (Tasks 9–11), recursive commit repack incl. signed flag (Task 6), non-zip fallback (archive node still hex-previews via Task 8 Step 1; expansion error surfaces via `setMessage` in Task 11), cache invalidation on reload (Task 7) and post-commit (commit clears the merge plan; the next `compute_diff` clears `nestedPairs`, and committing reloads via the app's existing post-commit refresh — confirm during smoke).
- **Out of scope (matches spec):** size guards; deep-search recursion into nested archives; nested-signature *gating* (only reported, not blocked) — noted in the design.
- **Type consistency:** `NestedArchiveCache::{new,resolve,resolve_archive,clear}`, `read_zip_entry_from_bytes`, `rewrite_zip_bytes`, `is_nested`, `ARCHIVE_SEPARATOR` used consistently. Frontend `nestedPairs` keyed by full `!/` path; `fullPathOf` joins with `!/`.
