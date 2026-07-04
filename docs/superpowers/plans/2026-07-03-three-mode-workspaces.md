# Three Mode Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three distinct LCDiff workspaces: Compare and Merge, multi-source View, and confirm-to-diff Free text with local temporary result history.

**Architecture:** Keep Compare and Merge on the existing left/right source model. Add View-specific frontend state and backend source handles so multiple folders or archives can be inspected without overloading `Side`. Split Free text into editable draft buffers, explicit confirmed result snapshots, and local-persistent temporary history.

**Tech Stack:** React 19, TypeScript, shadcn/ui source components, Tailwind v4, Monaco via `@monaco-editor/react`, Tauri v2 IPC, Rust `lcdiff-core`, Vitest, Testing Library, Playwright render verifier.

---

## File Structure

Create:

- `src/lib/free-text-history.ts`: local-persistent confirmed Free text result storage, parsing, limit enforcement, clear helper.
- `src/lib/free-text-history.test.ts`: unit tests for storage parsing, persistence, limit, corrupt storage fallback, and clear.
- `src/lib/view-workspace.ts`: pure View workspace reducers/helpers for source tab state and per-source entry tabs.
- `src/lib/view-workspace.test.ts`: unit tests for View source/tab state isolation.
- `src/components/ViewSourceTabs.tsx`: source tab strip for opened View sources.
- `src/components/ViewSourceTabs.test.tsx`: component tests for source selection and close actions.
- `src/components/FreeTextWorkspace.tsx`: Free text draft editors, compare action, local result history, and readonly diff result wrapper.
- `src/components/FreeTextWorkspace.test.tsx`: component tests for confirm-only result behavior and history actions.

Modify:

- `src/lib/types.ts`: add View source/result types used by frontend and IPC.
- `src/App.tsx`: route `single` mode to View workspace state and `text` mode to `FreeTextWorkspace`; preserve Compare and Merge behavior.
- `src/components/SplashScreen.tsx`: user-facing labels for `Compare and Merge`, `View`, and `Free text`.
- `src/components/SplashScreen.test.tsx`: update expected labels.
- `src/components/MenuBar.tsx`: mode selector labels and refresh behavior text.
- `src/components/MenuBar.test.tsx`: update expected labels and disabled refresh behavior.
- `src-tauri/src/main.rs`: add `view_sources` state and commands `open_view_source`, `read_view_entry`, `compute_view_nested_entries`, and `close_view_source`.
- `scripts/verify-frontend-invariants.mjs`: update assertions that currently assume View is single-left through `archives.left`.
- `scripts/verify-frontend-render.mjs`: add render checks for View source tabs and Free text confirm-only result.
- `README.md`: document the three modes and their behavior.
- `docs/ARCHITECTURE.md`: document mode-isolated workspaces, View multi-source inspector, and Free text draft/result split.

Do not stage or revert unrelated existing worktree changes in `aur/`, `scripts/install-*`, `scripts/verify-packaging-scripts.mjs`, or `sidecar/src/main/java/dev/lcdiff/sidecar/SidecarMain.java`.

---

### Task 1: Free Text History Storage

**Files:**
- Create: `src/lib/free-text-history.ts`
- Create: `src/lib/free-text-history.test.ts`

- [ ] **Step 1: Write failing tests for confirmed result history**

Create `src/lib/free-text-history.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFreeTextHistory,
  FREE_TEXT_HISTORY_LIMIT,
  FREE_TEXT_HISTORY_STORAGE_KEY,
  loadFreeTextHistory,
  recordFreeTextResult,
} from "./free-text-history";

beforeEach(() => {
  localStorage.clear();
});

describe("free text history", () => {
  it("stores confirmed results newest first", () => {
    const first = recordFreeTextResult({ left: "a", right: "b", createdAt: 1000 });
    const second = recordFreeTextResult({ left: "c", right: "d", createdAt: 2000 });

    expect(second.map((entry) => entry.id)).toEqual([
      "free-text:2000:1:1",
      "free-text:1000:1:1",
    ]);
    expect(first[0]).toMatchObject({
      id: "free-text:1000:1:1",
      left: "a",
      right: "b",
      title: "1 char vs 1 char",
      summary: "Left 1 char, right 1 char",
    });
  });

  it("persists through localStorage", () => {
    recordFreeTextResult({ left: "left text", right: "right text", createdAt: 3000 });

    expect(loadFreeTextHistory()).toEqual([
      {
        id: "free-text:3000:9:10",
        left: "left text",
        right: "right text",
        createdAt: 3000,
        title: "9 chars vs 10 chars",
        summary: "Left 9 chars, right 10 chars",
      },
    ]);
  });

  it("limits history to the newest confirmed results", () => {
    for (let i = 0; i < FREE_TEXT_HISTORY_LIMIT + 3; i += 1) {
      recordFreeTextResult({ left: `L${i}`, right: `R${i}`, createdAt: i });
    }

    const list = loadFreeTextHistory();
    expect(list).toHaveLength(FREE_TEXT_HISTORY_LIMIT);
    expect(list[0].createdAt).toBe(FREE_TEXT_HISTORY_LIMIT + 2);
    expect(list.at(-1)?.createdAt).toBe(3);
  });

  it("discards corrupt storage", () => {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, "{broken");

    expect(loadFreeTextHistory()).toEqual([]);
  });

  it("filters malformed entries from valid JSON arrays", () => {
    localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify([
      { id: "bad", left: 1, right: "r", createdAt: 1, title: "bad", summary: "bad" },
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Empty vs 1 char", summary: "Left empty, right 1 char" },
    ]));

    expect(loadFreeTextHistory()).toEqual([
      { id: "ok", left: "", right: "r", createdAt: 2, title: "Empty vs 1 char", summary: "Left empty, right 1 char" },
    ]);
  });

  it("clears only free text history storage", () => {
    localStorage.setItem("lcdiff.history", "keep");
    recordFreeTextResult({ left: "a", right: "b", createdAt: 4000 });

    clearFreeTextHistory();

    expect(loadFreeTextHistory()).toEqual([]);
    expect(localStorage.getItem("lcdiff.history")).toBe("keep");
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
rtk npm test -- src/lib/free-text-history.test.ts
```

Expected: FAIL with module resolution error for `./free-text-history`.

- [ ] **Step 3: Implement Free text history storage**

Create `src/lib/free-text-history.ts`:

```ts
export interface FreeTextHistoryEntry {
  id: string;
  left: string;
  right: string;
  createdAt: number;
  title: string;
  summary: string;
}

export interface FreeTextResultInput {
  left: string;
  right: string;
  createdAt: number;
}

export const FREE_TEXT_HISTORY_STORAGE_KEY = "lcdiff.freeTextHistory.v1";
export const FREE_TEXT_HISTORY_LIMIT = 20;

function charLabel(count: number): string {
  if (count === 0) return "empty";
  if (count === 1) return "1 char";
  return `${count} chars`;
}

function buildEntry(input: FreeTextResultInput): FreeTextHistoryEntry {
  const leftLabel = charLabel(input.left.length);
  const rightLabel = charLabel(input.right.length);
  return {
    id: `free-text:${input.createdAt}:${input.left.length}:${input.right.length}`,
    left: input.left,
    right: input.right,
    createdAt: input.createdAt,
    title: `${leftLabel[0].toUpperCase()}${leftLabel.slice(1)} vs ${rightLabel}`,
    summary: `Left ${leftLabel}, right ${rightLabel}`,
  };
}

function isEntry(value: unknown): value is FreeTextHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.left === "string" &&
    typeof entry.right === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.title === "string" &&
    typeof entry.summary === "string"
  );
}

function saveFreeTextHistory(entries: FreeTextHistoryEntry[]): void {
  localStorage.setItem(FREE_TEXT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

export function loadFreeTextHistory(): FreeTextHistoryEntry[] {
  const raw = localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, FREE_TEXT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function recordFreeTextResult(input: FreeTextResultInput): FreeTextHistoryEntry[] {
  const entry = buildEntry(input);
  const next = [entry, ...loadFreeTextHistory().filter((candidate) => candidate.id !== entry.id)]
    .slice(0, FREE_TEXT_HISTORY_LIMIT);
  saveFreeTextHistory(next);
  return next;
}

export function clearFreeTextHistory(): void {
  localStorage.removeItem(FREE_TEXT_HISTORY_STORAGE_KEY);
}
```

- [ ] **Step 4: Run the Free text history test**

Run:

```bash
rtk npm test -- src/lib/free-text-history.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
rtk git add src/lib/free-text-history.ts src/lib/free-text-history.test.ts
rtk git commit -m "Add free text history storage"
```

Expected: commit succeeds with only the two Free text history files staged.

---

### Task 2: View Workspace Pure State

**Files:**
- Create: `src/lib/view-workspace.ts`
- Create: `src/lib/view-workspace.test.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Write failing tests for per-source View state**

Create `src/lib/view-workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EntryPreview, ViewEntryTab, ViewSource } from "./types";
import {
  closeViewSource,
  focusViewEntryTab,
  openViewSource,
  upsertViewEntryTab,
} from "./view-workspace";

function source(id: string, path: string): ViewSource {
  return {
    sourceId: id,
    path,
    metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
    entries: [],
    nestedPairs: {},
    entryTabs: [],
  };
}

function preview(path: string): EntryPreview {
  return { path, kind: "text", language: "plaintext", content: path };
}

function tab(path: string, lastFocus: number): ViewEntryTab {
  return {
    entryPath: path,
    preview: preview(path),
    viewMode: "source",
    lastFocus,
  };
}

describe("view workspace state", () => {
  it("opens sources and makes the newest source active", () => {
    const first = openViewSource({ sources: [], activeSourceId: undefined }, source("s1", "/a.jar"));
    const second = openViewSource(first, source("s2", "/b.jar"));

    expect(second.sources.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
    expect(second.activeSourceId).toBe("s2");
  });

  it("replaces an existing source without moving it", () => {
    const state = {
      sources: [source("s1", "/old.jar"), source("s2", "/b.jar")],
      activeSourceId: "s2",
    };

    const next = openViewSource(state, source("s1", "/new.jar"));

    expect(next.sources.map((item) => item.path)).toEqual(["/new.jar", "/b.jar"]);
    expect(next.activeSourceId).toBe("s1");
  });

  it("keeps entry tabs isolated by source", () => {
    const state = {
      sources: [
        { ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] },
        { ...source("s2", "/b.jar"), entryTabs: [tab("B.class", 2)] },
      ],
      activeSourceId: "s1",
    };

    const next = upsertViewEntryTab(state, "s1", tab("C.class", 3), 10);

    expect(next.sources[0].entryTabs.map((entry) => entry.entryPath)).toEqual(["A.class", "C.class"]);
    expect(next.sources[1].entryTabs.map((entry) => entry.entryPath)).toEqual(["B.class"]);
  });

  it("evicts least recently focused tabs within one source only", () => {
    const state = {
      sources: [
        { ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1), tab("B.class", 2)] },
        { ...source("s2", "/b.jar"), entryTabs: [tab("Other.class", 1)] },
      ],
      activeSourceId: "s1",
    };

    const next = upsertViewEntryTab(state, "s1", tab("C.class", 3), 2);

    expect(next.sources[0].entryTabs.map((entry) => entry.entryPath)).toEqual(["B.class", "C.class"]);
    expect(next.sources[1].entryTabs.map((entry) => entry.entryPath)).toEqual(["Other.class"]);
  });

  it("focuses one entry tab for the active source", () => {
    const state = {
      sources: [{ ...source("s1", "/a.jar"), entryTabs: [tab("A.class", 1)] }],
      activeSourceId: "s1",
      activeEntryPath: undefined,
    };

    expect(focusViewEntryTab(state, "s1", "A.class", 4)).toMatchObject({
      activeSourceId: "s1",
      activeEntryPath: "A.class",
    });
  });

  it("closes a source and activates a neighbor", () => {
    const state = {
      sources: [source("s1", "/a.jar"), source("s2", "/b.jar"), source("s3", "/c.jar")],
      activeSourceId: "s2",
      activeEntryPath: "B.class",
    };

    const next = closeViewSource(state, "s2");

    expect(next.sources.map((item) => item.sourceId)).toEqual(["s1", "s3"]);
    expect(next.activeSourceId).toBe("s3");
    expect(next.activeEntryPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the View workspace state test to verify it fails**

Run:

```bash
rtk npm test -- src/lib/view-workspace.test.ts
```

Expected: FAIL because `ViewSource`, `ViewEntryTab`, and `./view-workspace` do not exist.

- [ ] **Step 3: Add View workspace types**

In `src/lib/types.ts`, after `export type ViewMode = "source" | "bytecode";`, add:

```ts
export interface ViewEntryTab {
  entryPath: string;
  preview: EntryPreview;
  viewMode: ViewMode;
  lastFocus: number;
}

export interface ViewSource {
  sourceId: string;
  path: string;
  metadata: ArchiveSummary["metadata"];
  entries: ArchiveSummary["entries"];
  nestedPairs: Record<string, ComparePair[]>;
  entryTabs: ViewEntryTab[];
}

export interface ViewWorkspaceState {
  sources: ViewSource[];
  activeSourceId?: string;
  activeEntryPath?: string;
}
```

- [ ] **Step 4: Implement View workspace helpers**

Create `src/lib/view-workspace.ts`:

```ts
import type { ViewEntryTab, ViewSource, ViewWorkspaceState } from "./types";

function evictLeastRecentlyFocused(tabs: ViewEntryTab[], cap: number): ViewEntryTab[] {
  if (tabs.length <= cap) return tabs;
  let lru = tabs[0];
  for (const tab of tabs) {
    if (tab.lastFocus < lru.lastFocus) lru = tab;
  }
  return tabs.filter((tab) => tab.entryPath !== lru.entryPath);
}

export function openViewSource(state: ViewWorkspaceState, source: ViewSource): ViewWorkspaceState {
  const idx = state.sources.findIndex((candidate) => candidate.sourceId === source.sourceId);
  const sources = state.sources.slice();
  if (idx === -1) sources.push(source);
  else sources[idx] = { ...source, entryTabs: sources[idx].entryTabs };
  return {
    ...state,
    sources,
    activeSourceId: source.sourceId,
    activeEntryPath: undefined,
  };
}

export function upsertViewEntryTab(
  state: ViewWorkspaceState,
  sourceId: string,
  tab: ViewEntryTab,
  cap: number,
): ViewWorkspaceState {
  return {
    ...state,
    activeSourceId: sourceId,
    activeEntryPath: tab.entryPath,
    sources: state.sources.map((source) => {
      if (source.sourceId !== sourceId) return source;
      const idx = source.entryTabs.findIndex((candidate) => candidate.entryPath === tab.entryPath);
      const tabs = source.entryTabs.slice();
      if (idx === -1) tabs.push(tab);
      else tabs[idx] = tab;
      return { ...source, entryTabs: evictLeastRecentlyFocused(tabs, cap) };
    }),
  };
}

export function focusViewEntryTab(
  state: ViewWorkspaceState,
  sourceId: string,
  entryPath: string,
  lastFocus: number,
): ViewWorkspaceState {
  return {
    ...state,
    activeSourceId: sourceId,
    activeEntryPath: entryPath,
    sources: state.sources.map((source) => {
      if (source.sourceId !== sourceId) return source;
      return {
        ...source,
        entryTabs: source.entryTabs.map((tab) =>
          tab.entryPath === entryPath ? { ...tab, lastFocus } : tab,
        ),
      };
    }),
  };
}

export function closeViewSource(state: ViewWorkspaceState, sourceId: string): ViewWorkspaceState {
  const index = state.sources.findIndex((source) => source.sourceId === sourceId);
  if (index === -1) return state;
  const sources = state.sources.filter((source) => source.sourceId !== sourceId);
  if (state.activeSourceId !== sourceId) return { ...state, sources };
  const next = sources[index] ?? sources[index - 1];
  return {
    sources,
    activeSourceId: next?.sourceId,
    activeEntryPath: undefined,
  };
}
```

- [ ] **Step 5: Run the View workspace state test**

Run:

```bash
rtk npm test -- src/lib/view-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
rtk git add src/lib/types.ts src/lib/view-workspace.ts src/lib/view-workspace.test.ts
rtk git commit -m "Add view workspace state helpers"
```

Expected: commit succeeds with only the View workspace type/helper files staged.

---

### Task 3: Backend View Source Commands

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add failing Rust tests for independent View sources**

In the `#[cfg(test)]` module in `src-tauri/src/main.rs`, add these tests near existing archive command/state tests:

```rust
#[test]
fn view_sources_open_read_and_close_independently() {
    let dir = tempfile::tempdir().expect("temp dir");
    let first_path = dir.path().join("first.jar");
    let second_path = dir.path().join("second.jar");
    write_zip(&first_path, &[("a.txt", b"first")]);
    write_zip(&second_path, &[("a.txt", b"second")]);

    let mut state = AppState::new(None);
    let first = state
        .open_view_source(first_path.display().to_string())
        .expect("open first view source");
    let second = state
        .open_view_source(second_path.display().to_string())
        .expect("open second view source");

    assert_ne!(first.source_id, second.source_id);
    assert_eq!(state.view_sources.len(), 2);

    let first_entry = state
        .view_source_archive(&first.source_id)
        .expect("first source")
        .read_entry("a.txt")
        .expect("read first");
    let second_entry = state
        .view_source_archive(&second.source_id)
        .expect("second source")
        .read_entry("a.txt")
        .expect("read second");

    assert_eq!(first_entry, b"first");
    assert_eq!(second_entry, b"second");

    state.close_view_source(&first.source_id).expect("close first");
    assert!(state.view_source_archive(&first.source_id).is_err());
    assert!(state.view_source_archive(&second.source_id).is_ok());
}

#[test]
fn view_source_ids_are_stable_for_canonical_paths() {
    let dir = tempfile::tempdir().expect("temp dir");
    let archive_path = dir.path().join("app.jar");
    write_zip(&archive_path, &[("a.txt", b"content")]);

    let mut state = AppState::new(None);
    let first = state
        .open_view_source(archive_path.display().to_string())
        .expect("first open");
    let second = state
        .open_view_source(archive_path.display().to_string())
        .expect("second open");

    assert_eq!(first.source_id, second.source_id);
    assert_eq!(state.view_sources.len(), 1);
}
```

- [ ] **Step 2: Run focused Rust tests to verify they fail**

Run:

```bash
rtk cargo test -p lcdiff-desktop view_sources_open_read_and_close_independently view_source_ids_are_stable_for_canonical_paths
```

Expected: FAIL because `view_sources`, `open_view_source`, `view_source_archive`, and `close_view_source` are not defined.

- [ ] **Step 3: Add backend View data structures**

In `src-tauri/src/main.rs`, near `struct AppState`, add:

```rust
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewSourceSummary {
    source_id: String,
    path: String,
    metadata: ArchiveMetadata,
    entries: Vec<ArchiveEntry>,
}

struct ViewSourceState {
    archive: Archive,
    nested: NestedArchiveCache,
}
```

In `struct AppState`, add:

```rust
view_sources: std::collections::BTreeMap<String, ViewSourceState>,
```

In `AppState::new`, initialize it:

```rust
view_sources: std::collections::BTreeMap::new(),
```

- [ ] **Step 4: Add AppState methods for View sources**

In `impl AppState`, add:

```rust
fn view_source_id(path: &std::path::Path) -> String {
    format!("view:{}", path.display())
}

fn open_view_source(&mut self, path: String) -> Result<ViewSourceSummary, String> {
    let archive = Archive::open(path).map_err(|error| error.to_string())?;
    let source_id = Self::view_source_id(archive.path());
    let summary = ViewSourceSummary {
        source_id: source_id.clone(),
        path: archive.path().display().to_string(),
        metadata: archive.metadata().clone(),
        entries: archive.entries().cloned().collect(),
    };
    self.view_sources.insert(
        source_id,
        ViewSourceState {
            archive,
            nested: NestedArchiveCache::new().map_err(|error| error.to_string())?,
        },
    );
    Ok(summary)
}

fn view_source_archive(&self, source_id: &str) -> Result<&Archive, String> {
    self.view_sources
        .get(source_id)
        .map(|source| &source.archive)
        .ok_or_else(|| format!("view source is not loaded: {source_id}"))
}

fn view_source_archive_mut(&mut self, source_id: &str) -> Result<&mut ViewSourceState, String> {
    self.view_sources
        .get_mut(source_id)
        .ok_or_else(|| format!("view source is not loaded: {source_id}"))
}

fn close_view_source(&mut self, source_id: &str) -> Result<(), String> {
    self.view_sources
        .remove(source_id)
        .map(|_| ())
        .ok_or_else(|| format!("view source is not loaded: {source_id}"))
}
```

- [ ] **Step 5: Add Tauri commands**

In `src-tauri/src/main.rs`, add:

```rust
#[tauri::command]
async fn open_view_source(
    path: String,
    state: State<'_, SharedState>,
) -> Result<ViewSourceSummary, String> {
    let archive = tauri::async_runtime::spawn_blocking(move || {
        Archive::open(path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    let source_id = AppState::view_source_id(archive.path());
    let summary = ViewSourceSummary {
        source_id: source_id.clone(),
        path: archive.path().display().to_string(),
        metadata: archive.metadata().clone(),
        entries: archive.entries().cloned().collect(),
    };
    state.view_sources.insert(
        source_id,
        ViewSourceState {
            archive,
            nested: NestedArchiveCache::new().map_err(|error| error.to_string())?,
        },
    );
    Ok(summary)
}

#[tauri::command]
async fn read_view_entry(
    source_id: String,
    entry_path: String,
    state: State<'_, SharedState>,
) -> Result<EntryPreview, String> {
    let (archive, leaf, engine, sidecar) = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let engine = state.engine;
        let sidecar = Arc::clone(&state.sidecar);
        let source = state.view_source_archive_mut(&source_id)?;
        let (archive, leaf) = resolve_view_entry(source, &entry_path)?;
        (archive, leaf, engine, sidecar)
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_entry_preview(&archive, engine, &sidecar, leaf)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn compute_view_nested_entries(
    source_id: String,
    nested_path: String,
    state: State<'_, SharedState>,
) -> Result<ArchiveDiff, String> {
    let archive = {
        let mut state = state
            .lock()
            .map_err(|_| "state lock is poisoned".to_owned())?;
        let source = state.view_source_archive_mut(&source_id)?;
        source
            .nested
            .resolve_archive(&source.archive, &nested_path)
            .map_err(|error| error.to_string())?
    };
    Ok(one_sided_diff(&archive, Side::Left))
}

#[tauri::command]
fn close_view_source(source_id: String, state: State<'_, SharedState>) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "state lock is poisoned".to_owned())?;
    state.close_view_source(&source_id)
}
```

Add this helper near `resolve_side_entry`:

```rust
fn resolve_view_entry(source: &mut ViewSourceState, entry_path: &str) -> Result<(Archive, String), String> {
    if let Some((root, leaf)) = entry_path.rsplit_once("!/") {
        let archive = source
            .nested
            .resolve_archive(&source.archive, root)
            .map_err(|error| error.to_string())?;
        return Ok((archive, leaf.to_owned()));
    }
    Ok((source.archive.clone(), entry_path.to_owned()))
}
```

Register the commands in `tauri::generate_handler!`:

```rust
open_view_source,
read_view_entry,
compute_view_nested_entries,
close_view_source,
```

- [ ] **Step 6: Run focused Rust tests**

Run:

```bash
rtk cargo test -p lcdiff-desktop view_sources_open_read_and_close_independently view_source_ids_are_stable_for_canonical_paths
```

Expected: PASS.

- [ ] **Step 7: Run TypeScript build to catch IPC type fallout later**

Run:

```bash
rtk npm run build
```

Expected: existing frontend still builds. A failure here should be from the TypeScript type additions in Task 2 or unrelated current worktree changes; fix type errors before committing.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
rtk git add src-tauri/src/main.rs
rtk git commit -m "Add backend view source handles"
```

Expected: commit succeeds with only `src-tauri/src/main.rs` staged.

---

### Task 4: View Workspace UI

**Files:**
- Create: `src/components/ViewSourceTabs.tsx`
- Create: `src/components/ViewSourceTabs.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SourceChips.tsx` only if the existing source picker cannot support adding another View source cleanly.
- Modify: `src/components/FileTree.tsx` only if single-column View tree needs a clearer prop than `mode="single"`.
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write component tests for View source tabs**

Create `src/components/ViewSourceTabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewSource } from "@/lib/types";
import { ViewSourceTabs } from "./ViewSourceTabs";

function source(sourceId: string, path: string): ViewSource {
  return {
    sourceId,
    path,
    metadata: { sourceKind: "archive", signed: false, multiRelease: false, zip64: false },
    entries: [],
    nestedPairs: {},
    entryTabs: [],
  };
}

describe("ViewSourceTabs", () => {
  it("renders opened source tabs with basenames", () => {
    render(
      <ViewSourceTabs
        sources={[source("a", "/tmp/mrjar.jar"), source("b", "/tmp/workspace")]}
        activeSourceId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /mrjar\.jar/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /workspace/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selects and closes source tabs", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <ViewSourceTabs
        sources={[source("a", "/tmp/a.jar"), source("b", "/tmp/b.jar")]}
        activeSourceId="a"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /b\.jar/ }));
    expect(onSelect).toHaveBeenCalledWith("b");

    await user.click(screen.getByLabelText("Close b.jar"));
    expect(onClose).toHaveBeenCalledWith("b");
  });
});
```

- [ ] **Step 2: Run the source tabs test to verify it fails**

Run:

```bash
rtk npm test -- src/components/ViewSourceTabs.test.tsx
```

Expected: FAIL because `ViewSourceTabs` does not exist.

- [ ] **Step 3: Implement ViewSourceTabs**

Create `src/components/ViewSourceTabs.tsx`:

```tsx
import { FileArchive, Folder, X } from "lucide-react";
import type { ViewSource } from "@/lib/types";

interface ViewSourceTabsProps {
  sources: ViewSource[];
  activeSourceId?: string;
  onSelect: (sourceId: string) => void;
  onClose: (sourceId: string) => void;
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || path;
}

export function ViewSourceTabs({ sources, activeSourceId, onSelect, onClose }: ViewSourceTabsProps) {
  return (
    <nav className="view-source-tabs" aria-label="Opened sources">
      <div className="view-source-tabs__scroll" role="tablist" aria-label="Opened View sources">
        {sources.map((source) => {
          const label = basename(source.path);
          const Icon = source.metadata.sourceKind === "directory" ? Folder : FileArchive;
          return (
            <button
              key={source.sourceId}
              type="button"
              role="tab"
              aria-selected={activeSourceId === source.sourceId}
              className={`view-source-tab${activeSourceId === source.sourceId ? " active" : ""}`}
              title={source.path}
              onClick={() => onSelect(source.sourceId)}
            >
              <Icon aria-hidden="true" />
              <span className="view-source-tab__label">{label}</span>
              <span
                role="button"
                tabIndex={0}
                className="view-source-tab__close"
                aria-label={`Close ${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(source.sourceId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(source.sourceId);
                  }
                }}
              >
                <X aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run the source tabs test**

Run:

```bash
rtk npm test -- src/components/ViewSourceTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write App tests for multi-source View behavior**

In `src/App.test.tsx`, add tests after the existing View mode tests:

```tsx
it("opens multiple View sources and remembers entry tabs per source", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Open one source" }));
  await user.click(screen.getByLabelText("Change source"));
  await user.click(await screen.findByText("Browse file"));
  await screen.findByRole("tab", { name: /view-1\.jar/ });

  await user.click(screen.getByRole("button", { name: "Add source" }));
  await user.click(await screen.findByText("Browse file"));
  await screen.findByRole("tab", { name: /view-2\.jar/ });

  await user.click(await screen.findByText("config.json"));
  expect(await screen.findByRole("tab", { name: /config\.json/ })).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /view-1\.jar/ }));
  expect(screen.queryByRole("tab", { name: /config\.json/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /view-2\.jar/ }));
  expect(screen.getByRole("tab", { name: /config\.json/ })).toBeInTheDocument();
});

it("hides compare-only controls in multi-source View", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Open one source" }));

  expect(screen.queryByRole("combobox", { name: "Tree filter" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Copy file to right")).not.toBeInTheDocument();
});
```

Before adding these tests, update the existing `App.test.tsx` mocks. Add this helper near `summarySourceKind`:

```ts
let mockViewSummaryCount = 0;

function viewSummary(path = `/fixtures/view-${mockViewSummaryCount += 1}.jar`) {
  return {
    sourceId: `view:${path}`,
    path,
    metadata: { sourceKind: "archive" as const, signed: false, multiRelease: false, zip64: false },
    entries: [FILE_ENTRY],
    nestedPairs: {},
    entryTabs: [],
  };
}
```

Add these cases to `defaultInvoke`:

```ts
case "open_view_source":
  return viewSummary();
case "read_view_entry":
  return entryPreview("left");
case "compute_view_nested_entries":
  return { pairs: [{ path: "nested.txt", status: "onlyLeft" as const, left: { path: "nested.txt", kind: "text" as const } }] };
case "close_view_source":
  return undefined;
```

- [ ] **Step 6: Run the new App View tests to verify they fail**

Run:

```bash
rtk npm test -- src/App.test.tsx -t "View"
```

Expected: FAIL because View does not render source tabs or per-source entry tabs yet.

- [ ] **Step 7: Integrate View state into App**

In `src/App.tsx`:

Add imports:

```ts
import { ViewSourceTabs } from "@/components/ViewSourceTabs";
import {
  closeViewSource,
  focusViewEntryTab,
  openViewSource,
  upsertViewEntryTab,
} from "@/lib/view-workspace";
import type { ViewSource, ViewWorkspaceState } from "@/lib/types";
```

Add state near existing archive/tab state:

```ts
const [viewWorkspace, setViewWorkspace] = useState<ViewWorkspaceState>({ sources: [] });
const activeViewSource = viewWorkspace.sources.find((source) => source.sourceId === viewWorkspace.activeSourceId);
const activeViewEntryTab = activeViewSource?.entryTabs.find((tab) => tab.entryPath === viewWorkspace.activeEntryPath);
```

Add `openViewPath`:

```ts
const openViewPath = useCallback(async (path: string) => {
  try {
    const validatedPath = await invoke<string>("validate_path", { raw: path });
    const summary = await invoke<ViewSource>("open_view_source", { path: validatedPath });
    const nextSource: ViewSource = { ...summary, nestedPairs: {}, entryTabs: [] };
    setViewWorkspace((current) => openViewSource(current, nextSource));
    setPathErrors({});
    setMessage(`Opened ${summary.path}`);
  } catch (error) {
    const message = String(error);
    setPathErrors((current) => ({ ...current, left: message }));
    setMessage(message);
  }
}, []);
```

Add `inspectViewEntry`:

```ts
async function inspectViewEntry(pair: ComparePair) {
  if (!activeViewSource) return;
  const requestId = previewRequestId.current + 1;
  previewRequestId.current = requestId;
  const nextPreview = await invoke<EntryPreview>("read_view_entry", {
    sourceId: activeViewSource.sourceId,
    entryPath: pair.path,
  });
  if (previewRequestId.current !== requestId) return;
  focusCounter.current += 1;
  setViewWorkspace((current) =>
    upsertViewEntryTab(
      current,
      activeViewSource.sourceId,
      {
        entryPath: pair.path,
        preview: nextPreview,
        viewMode: "source",
        lastFocus: focusCounter.current,
      },
      MAX_DIFF_TABS,
    ),
  );
}
```

Add `closeActiveViewSource`:

```ts
function closeActiveViewSource(sourceId: string) {
  void invoke("close_view_source", { sourceId }).catch(() => undefined);
  setViewWorkspace((current) => closeViewSource(current, sourceId));
}
```

Change `openFromOs` so View uses `openViewPath`:

```ts
const openFromOs = useCallback((path: string) => {
  if (!path) return;
  setMode("single");
  setView("workspace");
  void openViewPath(path);
}, [openViewPath]);
```

For `mode === "single"` render:

```tsx
<ViewSourceTabs
  sources={viewWorkspace.sources}
  activeSourceId={viewWorkspace.activeSourceId}
  onSelect={(sourceId) => setViewWorkspace((current) => ({ ...current, activeSourceId: sourceId, activeEntryPath: undefined }))}
  onClose={closeActiveViewSource}
/>
```

Use `activeViewSource.entries` to build single-column View pairs:

```ts
const viewPairs = useMemo<ComparePair[]>(
  () => (activeViewSource?.entries ?? []).map((entry) => ({
    path: entry.path,
    status: "onlyLeft" as const,
    left: entry,
    right: undefined,
  })),
  [activeViewSource?.entries],
);
```

Use `viewPairs` for the View `FileTree`, and wire `onInspect={(pair) => void inspectViewEntry(pair)}`. Render `activeViewEntryTab.preview` in a single-editor preview. The simplest first integration can adapt existing `DiffView` by setting:

```tsx
<DiffView
  mode="single"
  selected={activeViewEntryTab ? {
    path: activeViewEntryTab.entryPath,
    status: "onlyLeft",
    left: {
      path: activeViewEntryTab.entryPath,
      kind: activeViewEntryTab.preview.kind,
    },
  } : undefined}
  preview={activeViewEntryTab ? { left: activeViewEntryTab.preview } : {}}
  preferences={preferences}
  effectiveColorPattern={activeColorPattern}
  ignoreTrimWhitespace={ignoreTrimWhitespace}
  onCopy={() => undefined}
  onEditorMount={handleEditorMount}
  onDiffMount={handleDiffMount}
  editable={false}
  editValue=""
  onEditChange={() => undefined}
  onEditBlur={() => undefined}
  fileMerge={false}
  entryCopyEnabled={false}
  diffEditable={false}
  hunkMerge={false}
  onDiffEditEither={() => undefined}
  onTakeAll={() => undefined}
  onMoveHunk={() => undefined}
/>
```

- [ ] **Step 8: Run View tests**

Run:

```bash
rtk npm test -- src/components/ViewSourceTabs.test.tsx src/lib/view-workspace.test.ts src/App.test.tsx -t "View"
```

Expected: PASS for View-related tests.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
rtk git add src/App.tsx src/App.test.tsx src/components/ViewSourceTabs.tsx src/components/ViewSourceTabs.test.tsx src/components/SourceChips.tsx src/components/FileTree.tsx
rtk git diff --cached --name-only
rtk git commit -m "Add multi-source view workspace"
```

Expected: staged file list contains only files touched for View UI. Git ignores unchanged pathspecs.

---

### Task 5: Free Text Workspace UI

**Files:**
- Create: `src/components/FreeTextWorkspace.tsx`
- Create: `src/components/FreeTextWorkspace.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write FreeTextWorkspace component tests**

Create `src/components/FreeTextWorkspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PREFERENCES } from "@/lib/preferences";
import { FREE_TEXT_HISTORY_STORAGE_KEY } from "@/lib/free-text-history";
import { FreeTextWorkspace } from "./FreeTextWorkspace";

vi.mock("@monaco-editor/react", () => ({
  Editor: ({ value, onChange, options }: any) => (
    <textarea aria-label={options?.ariaLabel} value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
  DiffEditor: ({ original, modified }: any) => (
    <div>
      <pre data-testid="diff-original">{original}</pre>
      <pre data-testid="diff-modified">{modified}</pre>
    </div>
  ),
}));

beforeEach(() => {
  localStorage.clear();
});

describe("FreeTextWorkspace", () => {
  it("does not render a diff result until user confirms", async () => {
    const user = userEvent.setup();
    render(
      <FreeTextWorkspace
        preferences={DEFAULT_UI_PREFERENCES}
        effectiveColorPattern="dark"
        ignoreTrimWhitespace={false}
        onMessage={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Left free text input"), "left draft");
    await user.type(screen.getByLabelText("Right free text input"), "right draft");

    expect(screen.queryByTestId("diff-original")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Compare free text" }));

    expect(screen.getByTestId("diff-original")).toHaveTextContent("left draft");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("right draft");
  });

  it("keeps confirmed result stable while draft changes", async () => {
    const user = userEvent.setup();
    render(
      <FreeTextWorkspace
        preferences={DEFAULT_UI_PREFERENCES}
        effectiveColorPattern="dark"
        ignoreTrimWhitespace={false}
        onMessage={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Left free text input"), "first");
    await user.type(screen.getByLabelText("Right free text input"), "second");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    await user.clear(screen.getByLabelText("Left free text input"));
    await user.type(screen.getByLabelText("Left free text input"), "changed");

    expect(screen.getByTestId("diff-original")).toHaveTextContent("first");
  });

  it("persists confirmed results and clears history", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <FreeTextWorkspace
        preferences={DEFAULT_UI_PREFERENCES}
        effectiveColorPattern="dark"
        ignoreTrimWhitespace={false}
        onMessage={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Left free text input"), "left");
    await user.type(screen.getByLabelText("Right free text input"), "right");
    await user.click(screen.getByRole("button", { name: "Compare free text" }));
    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toContain("left");

    unmount();
    render(
      <FreeTextWorkspace
        preferences={DEFAULT_UI_PREFERENCES}
        effectiveColorPattern="dark"
        ignoreTrimWhitespace={false}
        onMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /4 chars vs 5 chars/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear free text history" }));
    expect(localStorage.getItem(FREE_TEXT_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run FreeTextWorkspace tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/FreeTextWorkspace.test.tsx
```

Expected: FAIL because `FreeTextWorkspace` does not exist.

- [ ] **Step 3: Implement FreeTextWorkspace**

Create `src/components/FreeTextWorkspace.tsx`:

```tsx
import Editor, { DiffEditor } from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearFreeTextHistory,
  loadFreeTextHistory,
  recordFreeTextResult,
  type FreeTextHistoryEntry,
} from "@/lib/free-text-history";
import { editorFontFamilyForCss, type EffectiveColorPattern, type UiPreferences } from "@/lib/preferences";

interface FreeTextWorkspaceProps {
  preferences: UiPreferences;
  effectiveColorPattern: EffectiveColorPattern;
  ignoreTrimWhitespace: boolean;
  onMessage: (message: string) => void;
}

export function FreeTextWorkspace({
  preferences,
  effectiveColorPattern,
  ignoreTrimWhitespace,
  onMessage,
}: FreeTextWorkspaceProps) {
  const [draftLeft, setDraftLeft] = useState("");
  const [draftRight, setDraftRight] = useState("");
  const [history, setHistory] = useState<FreeTextHistoryEntry[]>(() => loadFreeTextHistory());
  const [activeResultId, setActiveResultId] = useState<string | undefined>(() => history[0]?.id);
  const activeResult = history.find((entry) => entry.id === activeResultId);
  const monacoTheme = effectiveColorPattern === "light" ? "light" : "vs-dark";
  const editorOptions = useMemo(() => ({
    fontFamily: editorFontFamilyForCss(preferences.editor.fontFamily),
    fontSize: preferences.editor.fontSize,
    fontLigatures: true,
    minimap: preferences.editor.minimap === "on"
      ? { enabled: true as const, side: "right" as const, size: "proportional" as const, showSlider: "mouseover" as const }
      : { enabled: false as const },
    wordWrap: preferences.editor.wordWrap,
    lineNumbers: preferences.editor.lineNumbers,
    automaticLayout: true,
  }), [preferences]);

  function confirmDiff() {
    const next = recordFreeTextResult({ left: draftLeft, right: draftRight, createdAt: Date.now() });
    setHistory(next);
    setActiveResultId(next[0]?.id);
    onMessage("Free text diff result saved to temporary history.");
  }

  function clearHistory() {
    clearFreeTextHistory();
    setHistory([]);
    setActiveResultId(undefined);
    onMessage("Free text history cleared.");
  }

  return (
    <div className="free-text-workspace">
      <section className="free-text-drafts" aria-label="Free text inputs">
        <div className="free-text-draft-pane">
          <Editor
            height="100%"
            language="plaintext"
            value={draftLeft}
            theme={monacoTheme}
            options={{ ...editorOptions, ariaLabel: "Left free text input" }}
            onChange={(value) => setDraftLeft(value ?? "")}
          />
        </div>
        <div className="free-text-draft-pane">
          <Editor
            height="100%"
            language="plaintext"
            value={draftRight}
            theme={monacoTheme}
            options={{ ...editorOptions, ariaLabel: "Right free text input" }}
            onChange={(value) => setDraftRight(value ?? "")}
          />
        </div>
      </section>

      <div className="free-text-actions">
        <Button onClick={confirmDiff}>Compare free text</Button>
        <Button variant="outline" onClick={clearHistory} disabled={history.length === 0}>
          Clear free text history
        </Button>
      </div>

      <section className="free-text-results" aria-label="Free text results">
        <nav className="free-text-history" aria-label="Free text temporary history">
          {history.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`free-text-history__item${entry.id === activeResultId ? " active" : ""}`}
              aria-pressed={entry.id === activeResultId}
              onClick={() => setActiveResultId(entry.id)}
            >
              <span>{entry.title}</span>
              <small>{entry.summary}</small>
            </button>
          ))}
        </nav>
        <div className="free-text-result-panel">
          {activeResult ? (
            <DiffEditor
              height="100%"
              language="plaintext"
              original={activeResult.left}
              modified={activeResult.right}
              theme={monacoTheme}
              options={{
                ...editorOptions,
                readOnly: true,
                renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: false,
                ignoreTrimWhitespace,
              }}
            />
          ) : (
            <div className="free-text-empty" role="status">
              Confirm a comparison to create a temporary diff result.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Wire FreeTextWorkspace into App**

In `src/App.tsx`, import:

```ts
import { FreeTextWorkspace } from "@/components/FreeTextWorkspace";
```

Replace the `mode === "text"` workspace panel body:

```tsx
{mode === "text" ? (
  <div className="workspace-tabpanel" role="tabpanel">
    <FreeTextWorkspace
      preferences={preferences}
      effectiveColorPattern={activeColorPattern}
      ignoreTrimWhitespace={ignoreTrimWhitespace}
      onMessage={setMessage}
    />
  </div>
) : (
  ...
)}
```

Update `openTextMode` so it no longer creates `freeTextSummary`, `freeTextPair`, `preview`, or `openTabs`:

```ts
const openTextMode = useCallback(() => {
  if (stagedTarget) {
    setMessage("Save or clear unsaved changes before switching to Free text.");
    return;
  }
  previewRequestId.current += 1;
  searchStreamId.current += 1;
  setSearching(false);
  setMode("text");
  setView("workspace");
  setPaths(emptyPaths);
  setPathErrors({});
  setArchives({});
  setPairs([]);
  setNestedPairs({});
  setSelected(undefined);
  setActiveTab("files");
  setOpenTabs([]);
  setPreview({});
  setSearchPaths(undefined);
  setSearchResults([]);
  setSelectedSearchResult(undefined);
  setMessage("Free text is ready. Edit both sides, then compare when you want a result.");
}, [stagedTarget]);
```

Remove obsolete `freeText`, `setFreeText`, `freeTextPreview`, `freeTextSummary`, and `freeTextPair` state/helpers after all references are gone.

- [ ] **Step 5: Update App tests for confirm-only Free text**

Replace the current App test named `opens editable Text mode without source pickers, tree controls, merge controls, or staging` with:

```tsx
it("opens Free text with draft editors and no diff result until confirm", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "Compare free text" }));

  expect(screen.getByRole("main", { name: "Text comparison workspace" })).toBeInTheDocument();
  expect(screen.queryByText("File/Folder")).not.toBeInTheDocument();
  expect(screen.queryByText("Files")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Copy file to left")).not.toBeInTheDocument();
  expect(screen.queryByText("Pending changes")).not.toBeInTheDocument();
  expect(screen.getByText("Confirm a comparison to create a temporary diff result.")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Left free text input"), "left pasted text");
  await user.type(screen.getByLabelText("Right free text input"), "right typed text");
  expect(screen.queryByTestId("diff-original")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Compare free text" }));
  expect(await screen.findByTestId("diff-original")).toHaveTextContent("left pasted text");
  expect(screen.getByTestId("diff-modified")).toHaveTextContent("right typed text");
});
```

- [ ] **Step 6: Run Free text tests**

Run:

```bash
rtk npm test -- src/lib/free-text-history.test.ts src/components/FreeTextWorkspace.test.tsx src/App.test.tsx -t "Free text|Text mode"
```

Expected: PASS for Free text related tests.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
rtk git add src/App.tsx src/App.test.tsx src/components/FreeTextWorkspace.tsx src/components/FreeTextWorkspace.test.tsx src/lib/free-text-history.ts src/lib/free-text-history.test.ts
rtk git commit -m "Add confirm-only free text workspace"
```

Expected: commit succeeds with Free text implementation and tests staged.

---

### Task 6: User-Facing Labels, Docs, And Invariants

**Files:**
- Modify: `src/components/SplashScreen.tsx`
- Modify: `src/components/SplashScreen.test.tsx`
- Modify: `src/components/MenuBar.tsx`
- Modify: `src/components/MenuBar.test.tsx`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `scripts/verify-frontend-invariants.mjs`

- [ ] **Step 1: Update failing tests for labels**

In `src/components/SplashScreen.test.tsx`, update mode button assertions:

```tsx
expect(screen.getByRole("button", { name: "Compare free text" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Compare and merge sources" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Open one source" })).toBeInTheDocument();
expect(screen.getByText("Free text")).toBeInTheDocument();
expect(screen.getByText("Compare and Merge")).toBeInTheDocument();
expect(screen.getByText("View")).toBeInTheDocument();
```

In `src/components/MenuBar.test.tsx`, add or update a test:

```tsx
it("labels the three workspace modes clearly", () => {
  setup();

  expect(screen.getByRole("combobox", { name: "Workspace mode" })).toHaveTextContent("Compare and Merge");
});
```

- [ ] **Step 2: Run label tests to verify they fail**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx src/components/MenuBar.test.tsx
```

Expected: FAIL where old labels still render.

- [ ] **Step 3: Update SplashScreen labels**

In `src/components/SplashScreen.tsx`:

Replace the Text card title:

```tsx
<span className="launch-card__title">Free text</span>
```

Replace Compare card aria label and title:

```tsx
aria-label="Compare and merge sources"
...
<span className="launch-card__title">Compare and Merge</span>
```

Replace View card title:

```tsx
<span className="launch-card__title">View</span>
<span className="launch-card__description">Browse one or more sources without merge controls.</span>
```

Update history mode label:

```tsx
{entry.mode === "compare" ? "Compare and Merge" : entry.mode === "text" ? "Free text" : "View"}
```

- [ ] **Step 4: Update MenuBar labels**

In `src/components/MenuBar.tsx`, update mode selector items:

```tsx
<SelectItem value="single">View</SelectItem>
<SelectItem value="compare">Compare and Merge</SelectItem>
<SelectItem value="text">Free text</SelectItem>
```

Update refresh tooltip text:

```tsx
<p>{mode === "compare" ? "Reload both compare sources from disk" : mode === "text" ? "Free text has no disk sources" : "Reload opened View sources from disk"}</p>
```

- [ ] **Step 5: Update docs**

In `README.md`:

Replace heading `### 1. Open Something Suspicious` with:

```md
### 1. View One Or More Sources
```

Replace the Single mode paragraph with:

```md
Opening a supported archive or text file from Finder, Explorer, or a file
manager launches LCDiff directly into **View** mode and loads that source.

In **View** mode, LCDiff is a multi-source inspector:

- open multiple folders, JARs, ZIPs, WARs, or EARs as source tabs;
- browse the active source tree on the left;
- open entries as tabs on the right;
- preview Java source, bytecode, text, binary metadata, and hex;
- inspect folders with the same mental model as archives.
```

Replace heading `### 2. Compare Two Things That Claim To Be The Same` with:

```md
### 2. Compare And Merge Two Things That Claim To Be The Same
```

Replace the Free text paragraph with:

```md
Switch to **Free text** when you want to paste or type two snippets without
making files. Edit the left and right drafts, then click Compare to create a
readonly diff result. Confirmed results stay in local temporary history so you
can reopen them during the session or after restarting the app.
```

In `docs/ARCHITECTURE.md`, replace the Frontend Interaction Zones paragraph that describes View and Text with:

```md
View mode is a multi-source inspector with source tabs, a single-column tree
for the active source, and per-source entry tabs. It uses View-specific state
and backend source handles instead of the Compare left/right slots. Compare-only
tree filters, merge staging, and save controls do not render in View.

Free text mode is a frontend workspace for ad hoc paste/type comparison. It
keeps editable left/right draft buffers separate from readonly confirmed diff
results. A result is created only when the user confirms comparison, and
confirmed results are stored in local temporary history with a fixed limit and
clear action.
```

- [ ] **Step 6: Update frontend invariant script**

In `scripts/verify-frontend-invariants.mjs`, replace assertions that require View to be backed by `archives.left` with assertions for `viewWorkspace` and `open_view_source`. Add:

```js
if (!frontend.includes("viewWorkspace") || !frontend.includes("open_view_source")) {
  failures.push("src/App.tsx: View mode must use dedicated multi-source workspace state and open_view_source");
}

if (!frontend.includes("FreeTextWorkspace") || !frontend.includes("recordFreeTextResult")) {
  failures.push("src/App.tsx: Free text must render FreeTextWorkspace and persist confirmed results");
}
```

Remove or update checks that state `single` mode must always read from `archives.left`.

- [ ] **Step 7: Run docs and label checks**

Run:

```bash
rtk npm test -- src/components/SplashScreen.test.tsx src/components/MenuBar.test.tsx
rtk npm run verify:frontend-invariants
rtk npm run verify:docs
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
rtk git add src/components/SplashScreen.tsx src/components/SplashScreen.test.tsx src/components/MenuBar.tsx src/components/MenuBar.test.tsx README.md docs/ARCHITECTURE.md scripts/verify-frontend-invariants.mjs
rtk git commit -m "Clarify three workspace mode contract"
```

Expected: commit succeeds with labels, docs, and invariant script staged.

---

### Task 7: Render Verification And Full Gate

**Files:**
- Modify: `scripts/verify-frontend-render.mjs`
- Modify: `src/styles.css`

- [ ] **Step 1: Add render verifier assertions**

In `scripts/verify-frontend-render.mjs`, update startup interactions:

```js
await page.getByRole("button", { name: "Compare and merge sources" }).waitFor({ timeout: 5_000 });
await page.getByRole("button", { name: "Open one source" }).waitFor({ timeout: 5_000 });
await page.getByRole("button", { name: "Compare free text" }).waitFor({ timeout: 5_000 });
```

Add a View verification block near the existing Single/View render block:

```js
await mockedPage.getByRole("button", { name: "Open one source" }).click();
await mockedPage.getByRole("button", { name: /Change source/ }).click();
await mockedPage.getByText("Browse file", { exact: true }).click();
await mockedPage.getByRole("tablist", { name: "Opened View sources" }).waitFor({ timeout: 5_000 });
if (await mockedPage.getByRole("combobox", { name: "Tree filter" }).count()) {
  throw new Error("View mode still rendered the compare-only tree filter");
}
```

Add a Free text verification block:

```js
await mockedPage.getByRole("button", { name: "Compare free text" }).click();
await mockedPage.getByText("Confirm a comparison to create a temporary diff result.", { exact: true }).waitFor({ timeout: 5_000 });
if (await mockedPage.locator("[data-testid='diff-original']").count()) {
  throw new Error("Free text rendered a diff result before confirmation");
}
```

- [ ] **Step 2: Add styles for new View and Free text surfaces**

In the existing app stylesheet, add:

```css
.view-source-tabs,
.free-text-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.view-source-tabs__scroll,
.free-text-history {
  display: flex;
  gap: 0.375rem;
  min-width: 0;
  overflow-x: auto;
}

.view-source-tab,
.free-text-history__item {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  border-radius: 6px;
}

.view-source-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-source-tab__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.free-text-workspace {
  display: grid;
  grid-template-rows: minmax(12rem, 1fr) auto minmax(12rem, 1fr);
  gap: 0.75rem;
  min-height: 0;
  height: 100%;
}

.free-text-drafts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 0;
}

.free-text-draft-pane,
.free-text-result-panel {
  min-height: 0;
}

.free-text-results {
  display: grid;
  grid-template-columns: minmax(10rem, 16rem) minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 0;
}

.free-text-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 10rem;
}

@media (max-width: 760px) {
  .free-text-drafts,
  .free-text-results {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 3: Run render verifier to verify failures or pass**

Run:

```bash
rtk npm run verify:frontend-render
```

Expected: PASS after style and verifier updates.

- [ ] **Step 4: Run focused frontend suite**

Run:

```bash
rtk npm test -- src/lib/free-text-history.test.ts src/lib/view-workspace.test.ts src/components/ViewSourceTabs.test.tsx src/components/FreeTextWorkspace.test.tsx src/components/SplashScreen.test.tsx src/components/MenuBar.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run backend focused tests**

Run:

```bash
rtk cargo test -p lcdiff-desktop view_sources
```

Expected: PASS.

- [ ] **Step 6: Run full gate**

Run:

```bash
rtk npm run verify:all
```

Expected: PASS.

- [ ] **Step 7: Check worktree scope**

Run:

```bash
rtk git status --short
```

Expected: only intended implementation files are modified, plus pre-existing unrelated unstaged files if they remain from before this plan. Do not stage unrelated AUR, installer, packaging verifier, or sidecar Java deletions unless the user explicitly brings them into scope.

- [ ] **Step 8: Commit Task 7**

Run:

```bash
rtk git add scripts/verify-frontend-render.mjs src/styles.css
rtk git commit -m "Verify three workspace rendering"
```

Expected: commit succeeds with render verifier and style files staged.

---

## Final Review Checklist

- [ ] `Compare and Merge` still opens two sources, compares, stages, and saves through the existing left/right flow.
- [ ] `View` can open more than one folder/archive source in one workspace.
- [ ] `View` source tabs switch the tree and entry tab list.
- [ ] `View` entry tabs are remembered separately for each source.
- [ ] `View` does not render compare-only tree filters, copy actions, staging, or save controls.
- [ ] OS open-with still launches into View and loads the opened path.
- [ ] `Free text` has two draft editors.
- [ ] `Free text` does not render a diff result before confirmation.
- [ ] Confirming Free text creates a readonly diff result snapshot.
- [ ] Confirmed Free text results persist in local temporary history and can be cleared.
- [ ] `README.md` and `docs/ARCHITECTURE.md` describe the new behavior.
- [ ] Focused tests pass.
- [ ] `rtk npm run verify:all` passes.
- [ ] No unrelated dirty worktree files are staged.
