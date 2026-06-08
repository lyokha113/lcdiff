# Nested Archive Expansion + Merge — Design

Date: 2026-06-07

## Problem

Selecting a zip/jar entry in the file tree opens a binary (hex) compare in the
diff panel. A nested archive should instead expand inline into the tree like a
sub-folder, exposing its entries for diff and merge to any depth.

## Decisions (locked during brainstorming)

- **Trigger: lazy on click.** A nested archive renders as an expandable node;
  its contents are extracted and diffed on demand when expanded. Cheap on open.
- **Depth: unlimited.** jar-in-jar-in-zip… each nested archive node is itself
  expandable; recurse on demand to any depth.
- **Merge scope: full.** stage-copy of entries living inside nested archives is
  supported; commit rewrites the nested jar and re-packs it into the parent,
  recursively up the chain.
- **Representation: Approach A — temp-extract on demand.** On expand, extract
  the nested jar bytes to a temp file, open it as a real `Archive`, and register
  it. All existing path-based machinery (`compare`, `read_entry`, decompile
  sidecar, search, `MergePlan`) keeps working because the temp jar is a real
  file with a real path.

### Why Approach A over the alternatives

- **B (virtual in-memory `Archive::open_bytes` + `!/` addressing):** cleaner
  core, no temp files, but the decompile sidecar (`SidecarMain.readEntry`) reads
  a class by `(archivePath, entryName)` from a real file. Supporting nested
  classes would force a sidecar protocol + Java change. Higher risk.
- **C (eager recursive flatten at open):** simplest addressing, but conflicts
  with the lazy decision and slows archive open for deep/large jars.

## Path Addressing

Nested entries use the JAR-URL `!/` archive-boundary marker:

- Top-level entry: `lib/inner.jar`
- Inside it: `lib/inner.jar!/com/x/A.class`
- Deeper: `lib/inner.jar!/nested.zip!/y/B.class`

A path splits on `!/` into a **nesting chain**; each segment is an ordinary
`/`-relative path inside its own archive. The first segment addresses an entry
in the top-level (real, on-disk) archive; each subsequent segment addresses an
entry inside the archive named by the previous segment.

## Components

### 1. Core — `jdiff-core`

**`detect.rs`** — add `EntryKind::Archive`. `detect_entry_kind` maps
`jar | zip | war | ear` to `Archive` instead of `Binary`. This lets the frontend
know a node is expandable without guessing by extension. Existing tests that
assert `Binary` for `.jar` are updated.

**`extract_nested(parent: &Archive, nested_path: &str) -> Result<NestedHandle>`**
— walk the nesting chain. For each segment: read the segment's bytes from the
current archive, write them to a temp file, `Archive::open_validated(temp)`,
then descend. Returns the innermost `Archive` plus the temp paths created. On
any failure (segment is not a valid zip, corrupt, encrypted) returns an error so
callers fall back to binary preview.

**`NestedArchiveCache`** — held per side in `AppState`. Maps a nested key
(e.g. `lib/inner.jar`, `lib/inner.jar!/n.zip`) to `(temp_path, Archive)`.
Populated by `extract_nested`. Evicted when that side's top-level archive is
reloaded or after a commit changes it. Temp files removed on cache eviction and
on app exit.

### 2. IPC — `src-tauri/src/main.rs`

- **`compute_nested_diff(nested_path) -> ArchiveDiff`** — extract the nested
  archive on both sides (handle present-on-one-side → all entries `onlyLeft` /
  `onlyRight`), run the existing `compare()`, return pairs. Caller (frontend)
  prefixes each pair path with `nested_path + "!/"` before grafting.
- **`read_entry` / `disassemble` / `search`** — when `entry_path` contains
  `!/`, resolve the innermost cached temp `Archive` (extracting + caching if
  absent), strip the nesting prefix, and delegate to that archive with the leaf
  path. Decompile works unchanged because the temp jar is a real file.

### 3. Frontend — `src/`

- **`lib/types.ts`** — `EntryKind` gains `"archive"`.
- **`lib/tree.ts` / `components/FileTree.tsx`** — an archive-kind node renders
  folder-like: expandable, archive icon, shows `diffCount` once expanded.
- **Expand handler** — on expanding an archive node, call
  `compute_nested_diff(path)`, run `buildTree` on the returned (prefixed) pairs,
  graft the result as the node's children, and cache in component state.
  Toggling re-uses the cached subtree.
- **`App.tsx`** — nested paths are just longer entry-path strings, so they flow
  through the existing read / stage-copy / commit calls without signature
  changes.
- **`DiffView`** — selecting a leaf inside a nested archive uses `read_entry`
  with the nested path (source / bytecode / text / hex as appropriate).
  Selecting an unexpanded archive node may show a summary rather than hex.

### 4. Merge / commit — `MergePlan`

- `stage_copy` accepts nested source and target paths. `StagedCopy` stores the
  nested source path and the top-level `source_snapshot` (that side's
  `Archive`); reading the source resolves the nesting chain via `extract_nested`.
- **commit — recursive repack:**
  1. Group staged replacements by their top-level segment.
  2. Copies whose target has no `!/` (top-level) use replacement bytes as today.
  3. For copies targeting `X.jar!/rest`: collect all copies under `X.jar`, open
     `X.jar` from the target, apply the inner replacements (recursing for deeper
     nesting), and produce the modified `X.jar` bytes. That blob becomes the
     top-level replacement for entry `X.jar`.
  4. The existing `rewrite_archive` writes the top-level target file with the
     computed top-level replacements.
- **Signatures:** rewriting a signed nested jar surfaces a warning; the parent
  archive signature is invalidated as it is today.
- **`changed_on_disk`** still guards the real top-level files.

## Edge Cases / Fallback

- Nested entry that is not a valid zip / is corrupt / is encrypted →
  `extract_nested` errors → node stays a binary leaf (current hex behavior).
- Cache invalidation on archive reload and post-commit (the file changed on
  disk).
- Large nested jars: extraction reads full bytes to a temp file; acceptable for
  now. A size guard is deferred (YAGNI).

## Testing

**Core:**
- `!/` path parse / normalize.
- `extract_nested` one level and two levels.
- nested `compare()` (including present-on-one-side).
- recursive commit repack: copy a class into a nested jar, assert the parent now
  holds the rewritten nested jar containing the new entry.
- signed-nested invalidation warning.
- non-zip / corrupt nested → fallback error, no panic.

**Frontend:**
- nested-pair graft into the tree under an archive node.
- archive-kind node renders expandable with correct `diffCount`.
- `tree.test` additions for prefixed nested paths.

## Out of Scope

- Editing/adding entirely new entries inside a nested archive (only copy across
  sides is supported, matching the existing merge model).
- Size-based extraction guards / streaming for very large nested archives.
