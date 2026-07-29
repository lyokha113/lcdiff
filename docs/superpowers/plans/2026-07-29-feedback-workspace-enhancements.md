# Feedback and Workspace Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the v0.3.10 Windows and workspace defects, add the approved drop/edit/tree conveniences, and retain each workspace's state while switching modes.

**Architecture:** Keep native/platform access under `src/ipc`, desktop filesystem work under typed Tauri commands, and feature state under its owning frontend feature. Add one atomic two-source backend command for Compare drops, keep View sources independent, and split Compare/View/Free-text state so conditional rendering cannot destroy another mode's session.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Monaco Editor, Tauri 2, Rust, `lcdiff-core`, Node architecture/render verifiers, PowerShell Windows validation.

## Global Constraints

- Decompiled Java remains read-only.
- Archive writes remain staged and atomic; original entry bytes remain the copy source.
- One-sided Compare editing may modify only the pane backed by a real editable text entry.
- Typing in an empty Compare pane must never create a missing entry.
- Compare and Free-text two-file drops are all-or-nothing.
- View multi-file drops permit partial success and process paths sequentially.
- Mode continuity is process-session-only; add no persistence key.
- View tree filters remain hidden; only Expand all and Collapse all are shared with Compare.
- `src/app/App.tsx` remains the composition root.
- Only `src/ipc/**` may import `@tauri-apps/*`.
- Java sidecar behavior and the 30-second watchdog remain unchanged.

---

## Planned File Structure

### Create

- `src/features/free-text/useFreeTextController.ts` — owns draft/history selection across conditional renders.
- `src/features/free-text/useFreeTextController.test.ts` — controller state and clear/load behavior.
- `scripts/verify-windows-gui-subsystem.ps1` — reads the PE subsystem field and rejects console binaries.

### Modify

- `src-tauri/src/main.rs` — exact release-only Windows GUI subsystem attribute.
- `scripts/verify-architecture.mjs` and `scripts/verify-architecture.test.mjs` — allow only that attribute on the thin entrypoint.
- `scripts/build-windows.ps1` — run the PE subsystem verification against the release executable.
- `src/lib/tree.ts` and `src/lib/tree.test.ts` — derive left/right folder presence.
- `src/features/sources/FileTree.tsx` and its test — render gaps for missing folder sides.
- `src/features/workspace/WorkspaceTabs.tsx` and its test — show expansion controls in View.
- `src/features/workspace/DiffView.tsx` and its test — explicit per-side editability and flush filtering.
- `src/features/workspace/useWorkspaceController.ts` and focused tests — independent Compare/View editor state.
- `src/features/merge/useMergeController.ts` and `src/features/merge/staging.test.ts` — stage only real one-sided entries and suppress unchanged View writes.
- `src-tauri/src/archive_access.rs`, `src-tauri/src/commands/archive.rs`, `src-tauri/src/commands/preview.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/ipc_contracts.rs` — atomic Compare open and text-file read commands.
- `src/ipc/types.ts`, `src/ipc/commands.ts`, and `src/ipc/commands.test.ts` — exact frontend facades.
- `src/app/App.tsx` and `src/app/App.test.tsx` — mode-aware drops and state continuity.
- `src/features/free-text/FreeTextWorkspace.tsx` and its test — controlled drafts and Clear drafts action.
- `README.md`, `docs/ARCHITECTURE.md`, and `docs/PLATFORM_VALIDATION.md` — user and validation contracts.

---

### Task 1: Hide the Windows release console

**Files:**
- Modify: `src-tauri/src/main.rs:1-3`
- Modify: `scripts/verify-architecture.mjs:70-92`
- Modify: `scripts/verify-architecture.test.mjs:6-45`
- Create: `scripts/verify-windows-gui-subsystem.ps1`
- Modify: `scripts/build-windows.ps1:55-75`

**Interfaces:**
- Produces: release entrypoint prefix `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`.
- Produces: `scripts/verify-windows-gui-subsystem.ps1 -Path <exe>`; exits non-zero unless PE subsystem is `2` (`IMAGE_SUBSYSTEM_WINDOWS_GUI`).

- [ ] **Step 1: Add failing architecture tests for the exact Windows attribute**

Update the clean fixture and add a rejection case:

```js
const cleanMain = `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
  lcdiff_desktop::run();
}
`;

test('rejects any extra crate attribute on the desktop entrypoint', () => {
  const errors = verifyPhaseOneArchitecture({
    mainSource: '#![allow(dead_code)]\nfn main() { lcdiff_desktop::run(); }\n',
    coreCargoToml: cleanCoreCargoToml,
  });
  assert.deepEqual(errors, [
    'src-tauri/src/main.rs must be the Windows GUI attribute plus the thin lcdiff_desktop::run() entrypoint',
  ]);
});
```

- [ ] **Step 2: Run the architecture test and confirm RED**

Run: `node --test scripts/verify-architecture.test.mjs`

Expected: FAIL because the current exact-entrypoint rule rejects the approved attribute.

- [ ] **Step 3: Allow only the exact release-only GUI attribute**

Normalize comments/literals as today, then match:

```js
const windowsGuiAttribute =
  String.raw`#!\s*\[\s*cfg_attr\s*\(\s*not\s*\(\s*debug_assertions\s*\)\s*,\s*windows_subsystem\s*=\s*"windows"\s*\)\s*]\s*`;
const thinMain =
  String.raw`fn\s+main\s*\(\s*\)\s*\{\s*lcdiff_desktop\s*::\s*run\s*\(\s*\)\s*;\s*}\s*`;
return !new RegExp(`^\\s*${windowsGuiAttribute}${thinMain}$`).test(code);
```

Set `src-tauri/src/main.rs` to:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lcdiff_desktop::run();
}
```

- [ ] **Step 4: Add the PE subsystem verifier and wire it into release build**

Implement the PowerShell verifier:

```powershell
param([Parameter(Mandatory = $true)][string] $Path)
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path))
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
$optionalHeaderOffset = $peOffset + 24
$subsystem = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset + 68)
if ($subsystem -ne 2) {
  throw "expected IMAGE_SUBSYSTEM_WINDOWS_GUI (2), got $subsystem for $Path"
}
Write-Host "Windows GUI subsystem verified: $Path"
```

After `npm run tauri -- build` in `scripts/build-windows.ps1`, call it with
`target\release\lcdiff-desktop.exe`.

- [ ] **Step 5: Run focused checks**

Run:

```bash
node --test scripts/verify-architecture.test.mjs
npm run verify:architecture
cargo fmt --all -- --check
```

Expected: all commands exit `0`. The PE check is marked as a Windows release-runner gate.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs scripts/verify-architecture.mjs scripts/verify-architecture.test.mjs scripts/verify-windows-gui-subsystem.ps1 scripts/build-windows.ps1
git commit -m "fix: hide Windows release console"
```

---

### Task 2: Render truthful folder sides and expose View tree actions

**Files:**
- Modify: `src/lib/tree.ts:3-105`
- Test: `src/lib/tree.test.ts`
- Modify: `src/features/sources/FileTree.tsx:175-220`
- Test: `src/features/sources/FileTree.test.tsx`
- Modify: `src/features/workspace/WorkspaceTabs.tsx:65-105`
- Test: `src/features/workspace/WorkspaceTabs.test.tsx:70-115`

**Interfaces:**
- Produces: `TreeFolder.hasLeft: boolean` and `TreeFolder.hasRight: boolean`.
- Consumes: existing `expandAllVersion` and `collapseAllVersion` props; no new tree state API.

- [ ] **Step 1: Write failing tree-presence tests**

```ts
it("rolls descendant side presence into folders", () => {
  const [folder] = buildTree([
    { path: "pkg/left.txt", status: "onlyLeft", left: { path: "pkg/left.txt", kind: "text" } },
  ]);
  expect(folder).toMatchObject({ kind: "folder", hasLeft: true, hasRight: false });
});
```

Add a `FileTree` assertion that `pkg` renders once, with one `.tree-gap`, and
change the View test to expect both expansion buttons while still rejecting the
tree-filter group.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- src/lib/tree.test.ts src/features/sources/FileTree.test.tsx src/features/workspace/WorkspaceTabs.test.tsx
```

Expected: FAIL because folders have no side-presence fields and View hides the actions.

- [ ] **Step 3: Derive folder presence in `buildTree`**

Extend both immutable and mutable folder shapes:

```ts
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  diffCount: number;
  hasLeft: boolean;
  hasRight: boolean;
}
```

While walking each file pair, set `hasLeft`/`hasRight` on every ancestor from
`Boolean(pair.left)` and `Boolean(pair.right)`. Copy the values through
`finalize`.

- [ ] **Step 4: Render folder sides through `SideCell`**

Replace unconditional left/right folder markup with:

```tsx
<SideCell present={node.hasLeft} chevron={chevron} icon={folderIcon} name={node.name} />
<SideCell
  present={node.hasRight}
  chevron={<span className="tree-chevron tree-chevron-spacer" aria-hidden="true" />}
  icon={folderIcon}
  name={node.name}
/>
```

Keep a single aligned row and the existing center rollup.

- [ ] **Step 5: Separate Compare filter visibility from expansion visibility**

Render the filter only for `mode === "compare"`, then render
`.workspace-tree-actions` for `mode !== "text"`.

- [ ] **Step 6: Run focused tests and render verification**

Run:

```bash
npm test -- src/lib/tree.test.ts src/features/sources/FileTree.test.tsx src/features/workspace/WorkspaceTabs.test.tsx
npm run verify:frontend-render
```

Expected: tests pass; both themes render without duplicated one-sided folder names.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tree.ts src/lib/tree.test.ts src/features/sources/FileTree.tsx src/features/sources/FileTree.test.tsx src/features/workspace/WorkspaceTabs.tsx src/features/workspace/WorkspaceTabs.test.tsx
git commit -m "fix: render truthful source trees"
```

---

### Task 3: Correct View dirty state and allow one-sided Compare edits

**Files:**
- Modify: `src/features/workspace/DiffView.tsx:15-265`
- Test: `src/features/workspace/DiffView.test.tsx`
- Modify: `src/app/App.tsx:1025-1070,1250-1280`
- Test: `src/app/App.test.tsx`
- Modify: `src/features/merge/useMergeController.ts:226-302`
- Test: `src/features/merge/staging.test.ts`

**Interfaces:**
- Produces: `DiffEditableSides = { left: boolean; right: boolean }`.
- `DiffView` consumes `diffEditableSides` instead of a single `diffEditable`.
- Existing `stageWrite(side, entryPath, content)` remains the backend write path.

- [ ] **Step 1: Add failing one-sided and flush-event tests**

Add `DiffView` tests that mount a one-sided preview and assert:

```ts
expect(diffOptions()).toMatchObject({
  originalEditable: true,
  readOnly: true,
});
```

for `onlyLeft`, and:

```ts
expect(diffOptions()).toMatchObject({
  originalEditable: false,
  readOnly: false,
});
```

for `onlyRight`.

Add an App regression that fires a View editor `onChange` event with
`{ isFlush: true }`, switches View sources, and asserts no `stage_view_write`
call and no `1 pending` status.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- src/features/workspace/DiffView.test.tsx src/app/App.test.tsx src/features/merge/staging.test.ts
```

Expected: FAIL because editability is currently all-or-nothing and View forwards flush changes.

- [ ] **Step 3: Add explicit per-side editability**

Define:

```ts
export interface DiffEditableSides {
  left: boolean;
  right: boolean;
}
```

Use:

```tsx
options={{
  ...editorOptions,
  originalEditable: diffEditableSides.left,
  readOnly: !diffEditableSides.right,
}}
```

Gate model listeners independently:

```ts
if (!event.isFlush && editableSidesRef.current.left) {
  onDiffEditEitherRef.current("left", orig.getValue());
}
```

and equivalently for the right editor.

- [ ] **Step 4: Compute the approved edit matrix in App**

```ts
const leftText = isEditableTextPreview(preview.left);
const rightText = isEditableTextPreview(preview.right);
const oneSided = Boolean(preview.left) !== Boolean(preview.right);
const diffEditableSides = {
  left: mode === "compare" && leftText && (rightText || oneSided),
  right: mode === "compare" && rightText && (leftText || oneSided),
};
const isTextMerge = mode === "compare" && leftText && rightText;
```

Continue to derive hunk actions only from `isTextMerge`.

- [ ] **Step 5: Suppress View model flushes and unchanged writes**

Accept Monaco's second `onChange` argument:

```tsx
onChange={(value, event) => {
  if (!editable || event.isFlush) return;
  onEditChange(value);
}}
```

Keep the existing `stageEdit` content-equals-original early return and add a
regression for switching source while a late unchanged event arrives.

- [ ] **Step 6: Run focused and aggregate frontend tests**

Run:

```bash
npm test -- src/features/workspace/DiffView.test.tsx src/app/App.test.tsx src/features/merge/staging.test.ts
npm run build
```

Expected: one-sided edit tests pass; no unchanged View open stages a write.

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/DiffView.tsx src/features/workspace/DiffView.test.tsx src/app/App.tsx src/app/App.test.tsx src/features/merge/useMergeController.ts src/features/merge/staging.test.ts
git commit -m "fix: preserve one-sided editor boundaries"
```

---

### Task 4: Add typed text-file reading and atomic Compare source opening

**Files:**
- Modify: `src-tauri/src/archive_access.rs`
- Modify: `src-tauri/src/state.rs:280-330`
- Modify: `src-tauri/src/commands/archive.rs:1-50`
- Modify: `src-tauri/src/commands/preview.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs:15-205`
- Test: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ipc_contracts.rs`
- Modify: `src/ipc/types.ts`
- Modify: `src/ipc/commands.ts`
- Test: `src/ipc/commands.test.ts`
- Modify: `scripts/verify-architecture.mjs`
- Test: `scripts/verify-architecture.test.mjs`

**Interfaces:**
- Produces Rust/TypeScript `TextFileContent { path: string; content: string }`.
- Produces Rust/TypeScript `CompareSourcesResult { left: ArchiveSummary; right: ArchiveSummary; diff: ArchiveDiff }`.
- Produces frontend `readTextFile(path)` and `openCompareSources(leftPath, rightPath)`.

- [ ] **Step 1: Add failing Rust tests**

Cover valid UTF-8, binary rejection, directory rejection, and atomic two-source
installation:

```rust
#[test]
fn compare_pair_install_is_atomic_when_right_open_fails() {
    let mut state = AppState::new(None);
    let before = state.left.clone();
    let result = open_compare_sources_through_production(
        &mut state,
        valid_left_path(),
        missing_right_path(),
    );
    assert!(result.is_err());
    assert_eq!(state.left.as_ref().map(Archive::path), before.as_ref().map(Archive::path));
}
```

- [ ] **Step 2: Run Rust tests and confirm RED**

Run:

```bash
cargo test -p lcdiff-desktop read_text_file
cargo test -p lcdiff-desktop compare_pair_install
```

Expected: FAIL because the commands and state install method do not exist.

- [ ] **Step 3: Implement backend DTOs and state atomic install**

Add:

```rust
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFileContent {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareSourcesResult {
    pub(crate) left: ArchiveSummary,
    pub(crate) right: ArchiveSummary,
    pub(crate) diff: ArchiveDiff,
}
```

Implement `AppState::install_compare_archives(left, right)` so it checks
`any_pending()` once, builds both summaries and fresh caches, then publishes
both sides together.

- [ ] **Step 4: Implement commands**

`open_compare_sources` opens both archives in one blocking job, computes the
diff, then installs both under one state lock.

`read_text_file` canonicalizes a regular file, reads bytes, rejects NUL or
invalid UTF-8, and returns:

```rust
Ok(TextFileContent {
    path: canonical.display().to_string(),
    content: String::from_utf8(bytes)
        .map_err(|_| "file is not valid UTF-8 text".to_owned())?,
})
```

- [ ] **Step 5: Add IPC wrappers and contract guard entries**

```ts
export interface TextFileContent {
  path: string;
  content: string;
}

export interface CompareSourcesResult {
  left: ArchiveSummary;
  right: ArchiveSummary;
  diff: ArchiveDiff;
}

export function readTextFile(path: string): Promise<TextFileContent> {
  return invoke("read_text_file", { path });
}

export function openCompareSources(leftPath: string, rightPath: string): Promise<CompareSourcesResult> {
  return invoke("open_compare_sources", { leftPath, rightPath });
}
```

Add both exact command names to handler/architecture/IPC fixtures.

- [ ] **Step 6: Run backend, facade, and architecture tests**

Run:

```bash
cargo test -p lcdiff-desktop
npm test -- src/ipc/commands.test.ts
npm run verify:architecture
```

Expected: all pass and the registered handler list matches the updated allowlist.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/archive_access.rs src-tauri/src/state.rs src-tauri/src/commands/archive.rs src-tauri/src/commands/preview.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/ipc_contracts.rs src/ipc/types.ts src/ipc/commands.ts src/ipc/commands.test.ts scripts/verify-architecture.mjs scripts/verify-architecture.test.mjs
git commit -m "feat: add atomic source drop commands"
```

---

### Task 5: Route native drops by workspace

**Files:**
- Modify: `src/app/App.tsx:630-670`
- Test: `src/app/App.test.tsx:825-930`

**Interfaces:**
- Consumes: `openCompareSources(leftPath, rightPath)`.
- Consumes: `readTextFile(path)`.
- Consumes: existing sequential `openViewPath(path)`.
- Produces: mode-specific one/two/N-path drop behavior.

- [ ] **Step 1: Replace the old Free-text rejection test with failing routing tests**

Add cases for:

```ts
dragDropHandler?.({
  payload: {
    type: "drop",
    paths: ["/tmp/left.jar", "/tmp/right.jar"],
    position: { x: 10, y: 10 },
  },
});
expect(invoke).toHaveBeenCalledWith("open_compare_sources", {
  leftPath: "/tmp/left.jar",
  rightPath: "/tmp/right.jar",
});
```

Also assert View opens `a.jar`, `b.jar`, `c.jar` in order and Free text calls
`read_text_file` for one/two files.

- [ ] **Step 2: Run App tests and confirm RED**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because the current handler consumes only `paths[0]` and rejects Free text.

- [ ] **Step 3: Implement Compare and View routing**

Use an async handler:

```ts
if (mode === "compare" && paths.length === 2) {
  await openDroppedComparePair(paths[0], paths[1]);
  return;
}
if (mode === "single") {
  const failures: string[] = [];
  for (const path of paths) {
    const error = await openViewPath(path);
    if (error) failures.push(`${path}: ${error}`);
  }
  setMessage(`${paths.length - failures.length} opened, ${failures.length} failed`);
  return;
}
```

Preserve one-file Compare position routing and reject more than two.

- [ ] **Step 4: Implement Free-text routing against the controller contract**

For one file, use `dropSideForPosition`. For two files, load both with
`Promise.all`, then publish both draft values in one controller update. Reject
more than two without changing drafts.

- [ ] **Step 5: Run App tests**

Run: `npm test -- src/app/App.test.tsx`

Expected: all drop mappings pass, including Compare/Text atomic-failure cases and View partial success.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: route multi-file workspace drops"
```

---

### Task 6: Make Free-text state mode-owned and add Clear drafts

**Files:**
- Create: `src/features/free-text/useFreeTextController.ts`
- Create: `src/features/free-text/useFreeTextController.test.ts`
- Modify: `src/features/free-text/FreeTextWorkspace.tsx`
- Test: `src/features/free-text/FreeTextWorkspace.test.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `FreeTextController` with `draftLeft`, `draftRight`, `history`, `activeResultId`, `setDraft(side, content)`, `setDrafts(left, right)`, `clearDrafts()`, `confirmDiff()`, `clearHistory()`, and `selectResult(id)`.
- `FreeTextWorkspace` becomes controlled by this interface.

- [ ] **Step 1: Write failing controller and UI tests**

```ts
it("clears drafts without clearing history", () => {
  const { result } = renderHook(() => useFreeTextController(vi.fn()));
  act(() => result.current.setDrafts("left", "right"));
  act(() => result.current.confirmDiff());
  act(() => result.current.clearDrafts());
  expect(result.current.draftLeft).toBe("");
  expect(result.current.draftRight).toBe("");
  expect(result.current.history).toHaveLength(1);
});
```

Add a component test that canceling `confirm()` leaves both drafts intact.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- src/features/free-text/useFreeTextController.test.ts src/features/free-text/FreeTextWorkspace.test.tsx
```

Expected: FAIL because the controller and controlled props do not exist.

- [ ] **Step 3: Implement the feature-owned controller**

Move the existing draft/history state and actions without changing storage
format:

```ts
export function useFreeTextController(onMessage: (message: string) => void) {
  const [draftLeft, setDraftLeft] = useState("");
  const [draftRight, setDraftRight] = useState("");
  // existing history and activeResultId initialization
  const setDraft = (side: Side, content: string) =>
    side === "left" ? setDraftLeft(content) : setDraftRight(content);
  const setDrafts = (left: string, right: string) => {
    setDraftLeft(left);
    setDraftRight(right);
  };
  return { draftLeft, draftRight, setDraft, setDrafts, clearDrafts, /* existing actions */ };
}
```

- [ ] **Step 4: Make `FreeTextWorkspace` controlled**

Replace internal state with props and add:

```tsx
<Button
  variant="outline"
  disabled={!draftLeft && !draftRight}
  onClick={() => {
    if ((draftLeft || draftRight) && !globalThis.confirm("Clear both free text drafts?")) return;
    onClearDrafts();
  }}
>
  Clear drafts
</Button>
```

- [ ] **Step 5: Mount the controller above mode-conditional rendering**

Create it once in `App`, pass it to the Text workspace, and use `setDraft` /
`setDrafts` from Task 5's drop handler.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/features/free-text/useFreeTextController.test.ts src/features/free-text/FreeTextWorkspace.test.tsx src/app/App.test.tsx
```

Expected: drafts survive unmount/remount; Clear drafts preserves history.

- [ ] **Step 7: Commit**

```bash
git add src/features/free-text/useFreeTextController.ts src/features/free-text/useFreeTextController.test.ts src/features/free-text/FreeTextWorkspace.tsx src/features/free-text/FreeTextWorkspace.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: preserve free text drafts"
```

---

### Task 7: Preserve independent Compare and View workspaces across mode changes

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/features/workspace/compare-workspace.ts`
- Create: `src/features/workspace/compare-workspace.test.ts`
- Modify: `src/features/workspace/useWorkspaceController.ts`
- Test: `src/app/App.test.tsx`
- Modify: `src/app/App.tsx:560-615,829-875`

**Interfaces:**
- Produces: `CompareWorkspaceState` containing `selected`, `preview`, `openTabs`, `activeTab`, `editBuffer`, and `viewMode`.
- `useWorkspaceController` selects Compare or View projections without clearing the inactive state.
- Existing staged-change guards remain authoritative.

- [ ] **Step 1: Add the failing full mode-cycle regression**

Open two Compare sources and an entry, open View source A and an entry, type
Free-text drafts, then cycle:

```ts
await switchMode("Compare");
expect(screen.getByText(/left\.jar/)).toBeInTheDocument();
expect(screen.getByRole("tab", { name: /config\.json/ })).toBeInTheDocument();
await switchMode("View");
expect(screen.getByRole("tab", { name: /alpha\.jar/ })).toBeInTheDocument();
await switchMode("Text");
expect(screen.getByLabelText("Left free text input")).toHaveValue("left draft");
```

- [ ] **Step 2: Run App tests and confirm RED**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because `openTextMode` and `changeMode` clear Compare data and the workspace controller shares active editor state.

- [ ] **Step 3: Add a focused Compare state module**

```ts
export interface CompareWorkspaceState {
  selected?: ComparePair;
  preview: Partial<Record<Side, EntryPreview>>;
  openTabs: DiffTab[];
  activeTab: "files" | string;
  editBuffer: string;
  viewMode: ViewMode;
}

export const emptyCompareWorkspace = (): CompareWorkspaceState => ({
  preview: {},
  openTabs: [],
  activeTab: "files",
  editBuffer: "",
  viewMode: "source",
});
```

Add pure update tests before integrating it.

- [ ] **Step 4: Refactor `useWorkspaceController` to keep both slices**

Keep `compareWorkspace` and existing `viewWorkspace` independently. Derive
active `selected`, `preview`, `activeTab`, and `viewMode` from `mode`, and route
all mutations to the active slice. Preserve current request-generation and LRU
rules.

- [ ] **Step 5: Remove destructive mode-switch resets**

`openTextMode` and `changeMode` must stop clearing Compare `paths`, `archives`,
`pairs`, nested pairs, and tabs. Keep:

- search cancellation;
- onboarding selection;
- View request invalidation when leaving View; and
- staged-change blocking.

- [ ] **Step 6: Run state and App tests**

Run:

```bash
npm test -- src/features/workspace/compare-workspace.test.ts src/features/workspace/view-workspace.test.ts src/app/App.test.tsx
npm run build
```

Expected: all mode-owned state survives the cycle and stale async responses remain ignored.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/features/workspace/compare-workspace.ts src/features/workspace/compare-workspace.test.ts src/features/workspace/useWorkspaceController.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: retain mode workspace state"
```

---

### Task 8: Synchronize docs and run the complete validation ladder

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PLATFORM_VALIDATION.md`
- Modify: `scripts/verify-frontend-render.mjs`

**Interfaces:**
- Consumes every prior task.
- Produces the final documented product contract and render assertions.

- [ ] **Step 1: Update user-facing behavior**

Document:

- Compare two-file drop and one-sided text editing;
- View multi-file drop and expansion controls;
- Free-text file drop and Clear drafts;
- in-session mode continuity; and
- Windows release launch without a console.

- [ ] **Step 2: Update architecture and platform validation**

Record `open_compare_sources`, `read_text_file`, feature-owned Free-text state,
independent workspace state, and the PE GUI subsystem check.

- [ ] **Step 3: Extend render verification**

Assert in rendered fixtures that:

- View has `Expand all folders` and `Collapse all folders`;
- View has no `Tree filter`;
- one-sided folder markup contains one `.tree-gap`; and
- Free text has `Clear drafts`.

- [ ] **Step 4: Run the complete frontend and architecture gate**

Run:

```bash
npm run verify:all
```

Expected: architecture, TypeScript build, all Vitest files, render, branding, and docs checks pass.

- [ ] **Step 5: Run Rust workspace gates**

Run:

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all exit `0`.

- [ ] **Step 6: Run the Java 17 sidecar smoke**

Run with Java 17 and no missing sccache wrapper:

```bash
env -u RUSTC_WRAPPER JAVA_HOME=/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8 PATH="/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin:$PATH" bash scripts/test-sidecar-smoke.sh
```

Expected: ping, decompilers, ASM, inner/anonymous classes, and malformed fallback pass.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/ARCHITECTURE.md docs/PLATFORM_VALIDATION.md scripts/verify-frontend-render.mjs
git commit -m "docs: describe workspace feedback enhancements"
```

- [ ] **Step 8: Record the Windows external gate**

On the Windows release runner:

```powershell
scripts\build-windows.ps1 -Bundles nsis
scripts\verify-windows-gui-subsystem.ps1 -Path target\release\lcdiff-desktop.exe
```

Expected: packaged app launches without a console and the PE subsystem equals `2`.
