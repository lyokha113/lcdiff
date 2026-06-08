# Splash Screen — Design Spec

Date: 2026-06-07
Status: Approved (pending implementation)
Component: jdiff (Tauri + React + shadcn/ui)

## Summary

Add a launch splash screen that lets the user pick one of two modes and
re-open recent sessions. The splash shows once per app launch. It surfaces
the two existing modes — **Decompile** (`single`, read-only view of one
archive) and **Compare / Merge** (`compare`, diff two sides + stage merges) —
as two buttons, plus a list of the 20 most recent sessions keyed by mode and
file path(s).

## Decisions (from brainstorming)

- **History entry semantics:** an entry is a full session — `{mode, paths,
  openedAt}`. Clicking re-opens those exact files in that mode, skipping the
  path picker.
- **Navigation:** splash shows on every launch only. After entering a mode the
  user stays in the workspace; switching files uses the existing pickers. No
  return-to-splash control until restart.
- **History limit:** fixed at `20` in a single constant
  (`HISTORY_LIMIT`), structured so it can be made configurable later. A
  **Clear history** button is provided now. (YAGNI: no settings UI for the
  limit yet.)
- **Persistence:** `localStorage` (Approach A). No new dependencies. Swappable
  for `tauri-plugin-store` later if Rust-side access is needed.
- **Layout:** Layout 1 — Stacked. Title + tagline, two mode buttons centered
  on top, full-width recent-sessions list below.

## Architecture

A top-level view gate in the React app:

```
view: "splash" | "workspace"
```

- On launch → `splash`.
- Choosing a mode button → `workspace` with that mode, empty pickers.
- Choosing a history row → `workspace` with `entry.mode`, auto-loading
  `entry.paths` through the existing open pipeline.

`App.tsx` is currently a 903-line monolith. To avoid growing it:

- `src/components/SplashScreen.tsx` — the splash view (presentation +
  click handlers).
- `src/lib/history.ts` — pure history module (read/write `localStorage`,
  dedupe, cap, clear). No React, fully unit-testable.

`App.tsx` owns the `view` state and renders `<SplashScreen>` or the existing
workspace. It passes callbacks: `onPickMode(mode)` and
`onOpenEntry(entry)`.

## Data model

```ts
type Mode = "single" | "compare";   // already defined in App.tsx

interface HistoryEntry {
  id: string;        // stable key, derived from mode + normalized paths
  mode: Mode;
  paths: string[];   // single => [path]; compare => [leftPath, rightPath]
  openedAt: number;  // epoch ms, used for "2h ago" rendering
}
```

- `localStorage` key: `jdiff.history`.
- Stored as a JSON array, newest first.
- Capped at `HISTORY_LIMIT = 20`; oldest entries evicted on overflow.

## history.ts API

```ts
const HISTORY_LIMIT = 20;

function loadHistory(): HistoryEntry[];          // safe parse; [] on malformed JSON
function recordSession(mode: Mode, paths: string[]): HistoryEntry[];
function clearHistory(): void;
function entryKey(mode: Mode, paths: string[]): string;  // dedupe key
```

- **Dedupe:** `recordSession` with the same `mode` + same `paths` removes the
  existing entry and re-inserts it at the top with a fresh `openedAt`
  (move-to-top, no duplicates).
- **Cap:** after insert, truncate to `HISTORY_LIMIT`.
- **Malformed JSON guard:** `loadHistory` returns `[]` rather than throwing if
  `localStorage` holds invalid JSON.

## Flow

1. **Mode button** → `view = "workspace"`, `mode = picked`, pickers empty.
   User proceeds through the existing path-input / native-picker / drop flow.
2. **History row** → `view = "workspace"`, `mode = entry.mode`, auto-load
   `entry.paths` via the existing open pipeline (same `validate_path`
   preflight + archive load used by the pickers).
3. **Recording:** a session is recorded when it successfully opens —
   - `single`: left archive loaded.
   - `compare`: both sides loaded.
   This is wired at the point archives become loaded, so it covers both
   splash-launched sessions and in-workspace picker opens.
4. **Clear** → `clearHistory()` empties the list and re-renders the empty
   state.

## Stale entries (file moved / deleted)

Re-opening a history entry uses the existing `validate_path` preflight. On
failure the app still enters the workspace in the entry's mode and shows the
existing per-panel inline path error. No crash. The history entry is left in
place. (YAGNI: no auto-prune or "file missing" badge in this iteration.)

## Layout — Stacked (Layout 1)

```
        jdiff
  Inspect, compare & merge JAR / ZIP / folders

  [ 🔍 Decompile            ] [ ⇄ Compare / Merge      ]
    Open one archive,           Diff two sides,
    view read-only              stage merges

  Recent sessions                              [ Clear ]
  ───────────────────────────────────────────────────
  CMP   app-v2.jar ↔ app-v3.jar                 2h ago
  VIEW  ~/libs/guava-33.jar                   yesterday
  CMP   build/old.zip ↔ build/new.zip               Mon
  ...
```

- Mode pill per row: `VIEW` (single) or `CMP` (compare).
- Paths in monospace; compare shows `left ↔ right`.
- Time-ago derived from `openedAt`.
- **Empty state:** "No recent sessions yet." when history is empty.
- Built with existing shadcn/ui primitives (Button, Badge) + Tailwind v4 to
  match the current shell.

## Testing

`history.ts` (unit):
- add new entry → appears at top.
- dedupe: re-record same mode+paths → moves to top, length unchanged.
- cap: recording past 20 evicts the oldest.
- clear → empty.
- malformed `localStorage` JSON → `loadHistory()` returns `[]`.

`SplashScreen` (component):
- renders entries with correct pill + path formatting (single vs compare).
- renders empty state when history is empty.
- clicking a mode button calls `onPickMode` with the right mode.
- clicking a row calls `onOpenEntry` with the right entry.
- Clear button calls the clear handler and re-renders empty.

## Out of scope (YAGNI)

- Settings UI for the history limit (kept as a constant).
- Return-to-splash control from the workspace.
- Auto-prune / "missing file" indicators for stale entries.
- `tauri-plugin-store` migration (localStorage now; documented upgrade path).
- Separate native splash window.
