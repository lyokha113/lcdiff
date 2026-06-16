# Hide Java inner classes from the file tree

## Problem

The file tree currently renders every `.class` entry from a JAR. Java compiler
artifacts such as `MarketSSEventListener$1.class` appear next to
`MarketSSEventListener.class`, which makes the tree noisy. The expected tree
should show the parent class entry only when that parent class exists in the
same folder/package.

The file icon is also visually shifted left compared with folder/archive icons
because file rows do not reserve the same chevron slot.

## Decision

Use frontend tree projection. Keep archive indexing, preview, decompile, search,
merge, and copy semantics unchanged.

`buildTree` will suppress Java nested/anonymous class leaves only when the
matching parent class exists in the same folder:

- show `pkg/Outer.class`
- hide `pkg/Outer$Inner.class` and `pkg/Outer$1.class` when `pkg/Outer.class`
  exists
- keep `pkg/Outer$Inner.class` visible when `pkg/Outer.class` is absent
- keep non-class files containing `$` visible

This is not a decompiler issue. The decompiler path only runs when a class is
inspected through `read_entry`; the file tree is built from archive entry paths
before decompilation.

## Architecture

The change stays in the React adapter:

```text
Archive entries / diff pairs
  -> App.tsx visiblePairs filter (existing directory/search/status filtering)
  -> buildTree projection
       hides Parent$*.class only when Parent.class exists in the same folder
  -> FileTree render
       uses a chevron spacer for file rows so icons align with folder rows
```

`ldiff-core`, Tauri IPC, and the JVM sidecar continue to see the complete set of
archive entries. Decompiled Java remains a read-only preview, and merge writes
continue to copy original entry bytes.

## Components

### `src/lib/tree.ts`

Add a small helper for Java nested class leaf names:

- input: leaf name such as `Outer$Inner.class`
- output: parent leaf name `Outer.class`
- returns no parent for names without `$`, names not ending in `.class`, or names
  whose `$` appears before an empty parent segment

Apply the helper inside `buildTree` per folder. For each folder, compute the set
of visible parent `.class` leaf names in that folder before finalizing file
children. A file is hidden only when its computed parent leaf name exists in
that same folder.

### `src/components/FileTree.tsx`

Render file cells with a fixed-width chevron spacer before the file icon. Folder
and archive rows keep their real chevrons. In compare mode, the spacer appears
inside each populated side cell so left and right columns align independently.
Single mode uses the same spacer so the file icon column matches folders.

### `src/styles.css`

Reuse the existing `.tree-chevron-spacer` class if sufficient. If the current
class is too tied to folder rows, add a small explicit file spacer class with
the same width as `.tree-chevron`.

No color, status chip, selection, or two-pane column behavior changes.

## Edge Cases

- `Outer$Inner.class` with no `Outer.class` in the same folder remains visible.
- `a/Outer.class` does not hide `b/Outer$Inner.class`.
- `$Proxy.class` remains visible because there is no non-empty parent class leaf.
- `assets/foo$bar.txt` remains visible because it is not a class file.
- Nested archives reuse `buildTree`, so the same projection applies inside
  expanded nested JARs.
- If only a hidden inner class differs while the parent class is identical, the
  tree does not add a visible synthetic row. The raw diff pair remains available
  to lower layers, but the tree follows the parent-only display rule.

## Testing

Add focused tests before implementation:

- `src/lib/tree.test.ts`
  - parent class plus anonymous/nested class renders only the parent class
  - orphan nested class remains visible
  - non-class `$` filename remains visible
  - same-folder rule is enforced
- `src/components/FileTree.test.tsx`
  - file rows render the chevron spacer/alignment marker
  - existing two-pane and nested archive tests remain green

Verification after implementation:

```bash
npm test -- src/lib/tree.test.ts src/components/FileTree.test.tsx
npm test
```

Run `npm run verify:all` before release or broader UI handoff.
