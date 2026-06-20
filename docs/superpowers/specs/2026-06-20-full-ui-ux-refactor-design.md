# LDiff full UI/UX refactor design

## Objective

Refactor the complete desktop frontend around one primary workflow: open two sources, locate meaningful differences, inspect content, stage changes, and save deliberately. Preserve all backend contracts and product capabilities. View mode remains available but secondary to Compare mode.

The change is a frontend information-architecture and visual-system refactor, not a backend rewrite.

## Design direction

LDiff becomes a focused “precision workspace” rather than a stack of unrelated controls. The visual language uses Geist for interface typography, JetBrains Mono for paths and data, deep graphite surfaces, warm brass as the only accent, cool neutral status colors, restrained grain, and clear optical hierarchy. Geist is the bundled fallback for the RNG-selected Satoshi because no maintained Fontsource package exists for an offline desktop bundle.

The selected composition is editorial asymmetry: strong identity and task framing on the left, operational content on the right. Motion is purposeful and reduced in the dense workspace. GSAP drives startup text reveals and image/surface scale-fade transitions; controls use short CSS transitions for immediate feedback. Reduced-motion preferences disable nonessential animation.

## Startup experience

The startup screen follows an app-appropriate AIDA sequence without becoming a marketing page:

- Attention: an editorial split hero states what LDiff does in no more than three lines.
- Interest: a dense 12-column mode grid prioritizes Compare while keeping View and recent work visible.
- Desire: recent comparisons communicate continuity and make resuming work immediate.
- Action: the primary CTA opens Compare; secondary actions open View or a recent session.

Grid proof: 12 columns by 2 rows provides 24 cells. Compare occupies 8×2 (16 cells), View occupies 4×1 (4 cells), and Recent occupies 4×1 (4 cells). Total occupancy is 24/24 with dense grid flow and no dead cell.

The startup headline uses an ultra-wide container equivalent to `max-w-6xl`, responsive type, and a two-to-three-line cap. It contains no decorative stamps, badge clutter, raw metrics, or cheap section labels.

## Workspace information architecture

The workspace has five stable zones:

1. **Command bar** — product identity, View/Compare mode, global search, refresh, preferences, and staged-save status. Controls are grouped by intent rather than rendered as a flat sequence.
2. **Source rail** — two explicit source slots with side identity, source path, open/replace actions, validation, and swap affordance. In View mode, the right slot disappears rather than remaining disabled.
3. **Workspace navigator** — Files plus open diff tabs. The tree filter belongs with the Files view. Tabs keep current close, middle-click, keyboard, LRU, and status semantics.
4. **Primary canvas** — file tree or Monaco diff/editor. Diff-specific merge controls remain adjacent to the content they affect.
5. **Context layer** — search results and preferences use bounded contextual surfaces instead of permanently shrinking the primary canvas. Status and errors appear in a persistent bottom bar.

This hierarchy reduces top-of-window fragmentation and leaves the editor as the dominant visual region.

## Component boundaries

`App.tsx` continues to own orchestration and backend-facing state in this refactor, but its presentation is decomposed into focused units:

- `AppShell`: stable layout and global accessibility structure.
- `CommandBar`: global commands and staged-save summary.
- `SourceRail`: source identity and open/replace operations.
- `WorkspaceTabs`: Files/filter and open document navigation.
- `FileTree`: hierarchical selection and copy intent.
- `DiffView`: content inspection and merge intent.
- `SearchSurface`: contextual query controls and results.
- `PreferencesPanel`: grouped customization controls.
- `StatusBar`: operational status, errors, and background activity.
- `SplashScreen`: startup workflow and recent sessions.

Existing props and callbacks are preserved where practical. New presentational wrappers must not duplicate archive, search, staging, save, or editor state.

## Interaction model

- Compare is the default and visually dominant mode.
- Opening or replacing a source is always available from its source slot.
- Search opens as a focused command surface. Files search and in-diff find keep their existing distinct semantics.
- Staged changes are represented by one persistent summary. The user can inspect, unstage, clear, and save without hunting across controls.
- Preferences open as an overlay panel with a section index and live preview behavior. Closing it returns the full canvas width.
- Destructive or signature-sensitive operations keep explicit confirmation dialogs.
- Every interactive element has hover, pressed, disabled, and visible keyboard-focus states.
- Compact-height and narrow-window layouts preserve the workflow by collapsing labels before collapsing structure.

## Motion

Use real GSAP with `@gsap/react` for:

- startup headline word reveal with scrub-like sequencing on entry;
- startup visual surfaces scaling from 0.8 to 1.0 while fading into place;
- restrained workspace entry choreography after source selection.

Do not animate layout dimensions during normal work. Use transforms and opacity only. Disable nonessential GSAP timelines when reduced motion is selected.

## Visual system

- Typography: Geist for UI and headings; JetBrains Mono for paths, counts, keycaps, and code-adjacent labels.
- Palette: graphite base, warm brass accent, one cool gray family, semantic status colors that remain distinguishable without relying only on hue.
- Surfaces: minimal borders, subtle inner highlights, consistent top-left lighting, low-opacity grain, no generic purple/blue gradients.
- Radius: small for controls, medium for contextual surfaces, larger only for startup composition.
- Labels: sentence case. Remove decorative uppercase zone labels and redundant repeated headings.
- Icons: keep the existing icon package during this refactor to avoid an unrelated dependency migration; standardize size and stroke visually.

## Accessibility and state coverage

- Preserve keyboard shortcuts, tab semantics, and native-menu dispatch.
- Add a skip-to-workspace link and stable landmarks (`header`, `nav`, `main`, `aside`, `footer`).
- Preserve readable focus rings and sufficient text/button contrast in every theme.
- Keep inline path errors, search cancellation, loading feedback, empty tree/search states, signed-save warning, unsaved-tab warning, and status messages.
- Preserve user-configured density, radius, typography, editor, search, decompiler, and save preferences.

## Testing and verification

Update component tests and frontend invariants alongside markup changes. Verification must include:

- existing Vitest suite plus new tests for command grouping, contextual surfaces, hidden compare-only controls, and accessibility landmarks;
- `npm run build`;
- `npm run verify:frontend-invariants`;
- `npm run verify:frontend-render` at desktop and compact viewport heights;
- `npm run verify:all`;
- browser visual QA of startup, Compare workspace, View workspace, search, preferences, pending changes, dialogs, narrow width, and reduced motion.

## Non-goals

- No Rust, Tauri IPC, archive, decompiler, search-contract, merge, or save-semantics changes.
- No framework migration.
- No replacement of Monaco, shadcn/ui, Tailwind, or existing theme persistence.
- No marketing website or scroll-heavy interaction inside the working editor surface.
