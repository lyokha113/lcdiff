# Resume-first Splash History Design

Date: 2026-07-27

## Objective

Make recent LCDiff sessions the primary action on the splash screen so returning
users can identify and reopen prior work quickly. Starting a new Compare, View,
or Text task remains immediately available but becomes visually secondary.

## Scope

This change is limited to the splash screen presentation and interaction
hierarchy:

- Redesign the splash as a resume-first split desk.
- Improve the readability and affordance of recent-session rows.
- Preserve the existing history storage, ordering, limit, and reopen callbacks.
- Preserve the current Compare, View, and Text mode entry points.
- Preserve the existing workspace and Tauri boundaries.

The change does not add pinning, per-entry deletion, new history metadata,
filesystem validation, or a new persistence format.

## Layout

### Sessions available

The main splash content uses a split layout:

- `Recent work` occupies approximately 70–75% of the action area.
- A compact secondary column contains `Compare`, `View`, and `Text` actions.
- The headline is reduced so useful history appears within the initial viewport.
- The existing identity and local-first message remain present but do not
  compete with the resume action.

The recent panel shows five sessions by default. `View all` expands the panel to
the complete stored list, currently capped at 20 entries. `Show less` returns to
five entries.

### No sessions available

The recent panel remains in the primary position and presents a concise
explanation that sessions appear after a source is opened. No fabricated sample
history is shown. The secondary mode actions become the natural starting point.

### Responsive layout

On wide windows, history and mode actions appear side by side. On narrow
windows, the history panel appears first and the mode actions follow it. The
content remains usable without horizontal scrolling.

## Recent Session Rows

Each recent-session row is one keyboard-accessible button. Activating any part
of the row immediately invokes the existing reopen callback.

Each row presents:

- A small pastel mode badge for Compare, View, or Text.
- A prominent source label.
- Full source path information in secondary monospace text.
- Relative time aligned at the trailing edge.
- A restrained reopen affordance at the trailing edge.

Compare sessions present the left and right source names as distinct values
rather than compressing the pair into an ambiguous sentence. The corresponding
paths remain identifiable as left and right. Long names and paths truncate
visually with ellipsis while retaining the complete value in a native tooltip.

The clear-history action remains available in the recent-panel header but uses
secondary styling to reduce accidental activation. It continues to clear all
stored recent sessions through the existing callback.

## Visual Direction

The splash follows premium utilitarian minimalism:

- Warm monochrome canvas and flat white or near-white surfaces.
- One-pixel structural borders and crisp radii no larger than 12 px.
- No gradients, heavy shadows, glass effects, or large saturated areas.
- Self-hosted LCDiff typography with strong size and weight contrast.
- Muted pastel accents used only for mode semantics.
- Compact, consistent SVG or CSS primitives instead of Lucide icons on this
  screen.
- Subtle hover background changes and transform/opacity-only entry motion.
- Reduced-motion preferences suppress nonessential animation.

## Data and Control Flow

`App.tsx` remains the orchestration owner:

```text
localStorage history
  -> loadHistory()
  -> App history state
  -> SplashScreen rows
  -> onOpenEntry(entry)
  -> existing View or Compare open flow
```

`SplashScreen` continues to receive `history`, `now`, `onPickMode`,
`onOpenEntry`, `onClear`, and `motion`. The `HistoryEntry` type, storage key,
20-entry limit, deduplication, and ordering remain unchanged.

The splash does not perform filesystem access. If a stored path can no longer be
opened, the existing workspace open flow remains responsible for reporting the
error.

## Accessibility

- The splash retains its named main landmark.
- The recent list retains a named navigation landmark.
- Every recent row has a descriptive accessible name including its mode and
  source names.
- Mode actions remain native buttons with explicit accessible names.
- Keyboard focus is clearly visible against all surfaces.
- Visual truncation does not remove full path information from `title`
  attributes or accessible labels.
- Layout and content order remain meaningful at narrow widths.
- Nonessential motion respects reduced-motion preferences.

## Verification

Implementation follows test-driven development. Component tests are written or
updated first and observed failing for the new contract before production code
changes.

Required component coverage:

- Resume-first hierarchy with recent history before secondary mode actions.
- Compare sessions expose left and right names and paths distinctly.
- Clicking a history row invokes `onOpenEntry` with the exact entry.
- Five-row default limit and expansion to the stored list.
- Collapse back to five rows.
- Clear-history callback.
- Empty-history state.
- Accessible names for landmarks and buttons.

After targeted tests pass, run the frontend render gate and production build.
Launch the desktop app and visually inspect the splash at wide and narrow window
sizes, with populated and empty history where practical. Confirm readable
truncation, keyboard focus, hover treatment, direct reopen behavior, and reduced
motion.

## Approved Direction

The selected direction is option A, `Split desk`: history is the dominant
surface and the three new-task modes form a compact secondary column. The user
approved the layout, interaction behavior, visual direction, accessibility, and
verification approach on 2026-07-27.
