# LCDiff Cumulative Temp Merge Design

## Summary

Cumulative Temp Merge extends the existing Compare workspace with a
session-owned target archive. A user can load one source, create a temporary
target on the empty side, apply entries from that source, replace the source
multiple times, and finally export the accumulated target with Save As.

The temporary target is a real archive in an app-owned temporary directory.
This reuses the existing archive reader, merge plan, original-byte copy, and
atomic rewrite contracts while ensuring the user's source files are never
modified.

## Scope Separation

This workflow is independent from the smaller feedback and workspace
enhancements in
`2026-07-29-feedback-workspace-enhancements-design.md`.

It should receive its own implementation plan because it adds backend session
lifecycle, new IPC commands, conflict review, temp cleanup, and Save As
semantics.

## Goals

- Create a temporary merge target from an empty archive or a copy of the
  currently loaded source.
- Keep the target stable while replacing the other Compare source repeatedly.
- Support copying selected entries and merging an entire source.
- Review entry-path conflicts before staging bulk changes.
- Apply changes atomically to the working target between sources.
- Export the result with Save As or abandon it with Discard.
- Treat every archive entry as bytes and file actions only.

## Non-goals

- Interpret, validate, remove, or regenerate JAR signatures.
- Understand Java class semantics or merge file contents automatically.
- Persist or recover a temp merge session after the app process exits.
- Operate more than one temp merge session at the same time.
- Modify the original source used to seed or feed the temp target.
- Add a fourth workspace mode.

## User Flow

### Start

The action is available in Compare when exactly one side contains an opened
archive-compatible file and the other side is empty.

The empty source slot offers `Create temp target...`.

The creation dialog provides two choices:

1. **Empty archive**
   - The user chooses `.jar`, `.zip`, `.war`, or `.ear`.
   - LCDiff creates a valid empty ZIP-compatible archive in its temporary
     directory.
   - This is optimized for selecting only part of each source.

2. **Copy current source**
   - LCDiff copies the current source bytes into its temporary directory.
   - The copy becomes the stable target.
   - This is optimized for using the first archive as a complete base.

The original source stays on its current side. The temporary target occupies
the other side and is visibly labeled `TEMP TARGET - SESSION ONLY`.

### Accumulate

The non-target side remains replaceable. The target side cannot be replaced by
normal Browse, path input, or drop while the session is active.

For each source, the user may:

- copy a selected entry to the target;
- edit an existing target text entry through the normal staged-write flow;
- choose `Merge all` to prepare every source entry for the target; and
- review pending changes before applying them.

`Review & Apply to temp` atomically commits the staged plan to the working
archive. After success, LCDiff refreshes the target tree, clears staged state,
increments the applied-source count, and permits the next source replacement.

### Resolve conflicts

`Merge all` calculates conflicts before staging. A conflict is an entry path
that already exists in the target.

The conflict dialog lists conflicting paths and offers:

- per-entry `Overwrite` or `Skip`;
- `Overwrite all`; and
- `Skip all`.

Unresolved conflicts block staging. Resolved overwrite entries stage the source
bytes for the target path. Skipped entries do not enter the plan.

No entry receives special handling based on path, extension, signature role, or
content.

### Finish

`Save As...` writes the current working archive atomically to a user-selected
destination. It never changes any contributing source.

`Discard temp` clears staged operations and deletes the working target after
confirmation.

Closing the app with an active session offers `Save As`, `Discard`, or
`Cancel`. Save As failure keeps the session open.

## UI Design

The workflow remains inside Compare rather than adding a separate mode.

### Source slots

- The replaceable source slot is labeled `SOURCE - REPLACEABLE`.
- The target slot is labeled `TEMP TARGET - SESSION ONLY`.
- The target summary includes working name, entry count, and number of applied
  sources.
- Normal target replacement controls are disabled while the session is active.

### Actions

The Compare toolbar adds session-aware actions:

- `Copy selected -> temp`
- `Merge all -> temp`
- `Review & Apply to temp`
- `Save As...`
- `Discard temp`

The existing pending-changes surface remains the detailed staging review.

### Status

The status surface communicates:

- that the target is temporary;
- the last source applied;
- staged and conflict counts;
- that the working result has not been exported; and
- recoverable Apply or Save As failures.

## State and Data Contracts

Tauri stored state owns at most one `TempMergeSession`.

The session contains:

- opaque session ID;
- target side;
- app-owned working path;
- creation kind (`empty` or `copyCurrent`);
- output-kind hint derived from the selected extension or source;
- applied-source count; and
- enough lifecycle ownership to clean up the working file.

Frontend DTOs expose display-safe session state. They do not expose a mutable
filesystem handle.

The working archive is installed into the normal target side so existing diff,
preview, search, staging, and tree flows can operate on it.

## Architecture and Ownership

### Core

`lcdiff-core` remains UI- and Tauri-free. It owns:

- a small primitive for creating a valid empty ZIP-compatible archive;
- existing archive opening and entry reads;
- `MergePlan` staging of original source bytes; and
- atomic commit and output-copy primitives.

Core does not know about sessions, source slots, dialogs, or applied-source
counts.

### Tauri state and commands

Stored desktop state owns temp-session lifecycle and enforces:

- only one active session;
- one immutable target side per session;
- no normal replacement of the target side;
- no source replacement with unresolved staged changes;
- cleanup on explicit discard; and
- preservation of the last good working archive after failed operations.

Typed command ownership includes:

- `create_temp_target`
- `preview_merge_all_conflicts`
- `stage_temp_merge_all`
- `apply_temp_merge`
- `save_temp_target_as`
- `discard_temp_target`

Commands orchestrate state and blocking filesystem work without importing
sibling command modules.

### Frontend

A feature-owned temp-merge controller maps IPC state to UI intent. `App.tsx`
only composes it with existing Compare, merge, source, and close-request flows.

Dedicated UI components are:

- `CreateTempTargetDialog`
- `MergeConflictDialog`
- session-aware source-slot presentation; and
- session actions in the existing Compare toolbar/status surfaces.

## Detailed Data Flow

### Create empty

1. Frontend requests target side and archive kind.
2. Tauri creates a unique app-owned temporary directory and archive path.
3. Core writes a valid empty ZIP-compatible archive.
4. Tauri opens it, installs it on the target side, and publishes the session
   summary.
5. Frontend refreshes Compare diff state.

### Copy current

1. Frontend requests the loaded source side as the seed.
2. Tauri copies the complete source file to a unique working path.
3. Tauri opens the copy and installs it on the opposite target side.
4. Source and target roles become fixed for the session.
5. Frontend refreshes Compare diff state.

### Merge all

1. Backend compares source entry paths with target entry paths.
2. Backend returns new paths and conflict paths without mutating the plan.
3. Frontend collects overwrite/skip decisions.
4. Frontend sends the complete decision set to `stage_temp_merge_all`.
5. Backend validates that every reported conflict has exactly one decision,
   then stages original source bytes for new and overwritten paths.
6. Skipped paths are omitted.

### Apply

1. Backend commits the target plan atomically to the working archive.
2. On success, it reopens the target, resets target nested caches, clears
   staged state, and increments applied-source count.
3. Frontend refreshes target summary and Compare diff.
4. Source replacement becomes available.

### Save As

1. Frontend obtains a destination through the platform dialog boundary.
2. Backend writes or replaces the destination atomically from the last good
   working archive.
3. The temp session remains active after Save As so a failed UI follow-up
   cannot destroy the only working result.
4. The user may explicitly Discard or continue merging and export again.

## Error Handling

- Creation failure removes incomplete temp artifacts and leaves both source
  slots unchanged.
- Conflict-preview failure stages nothing.
- Apply failure retains the staged plan for retry and leaves the working
  archive at its last committed version.
- Source replacement with staged changes offers `Apply`, `Discard staged`, or
  `Cancel`.
- Save As failure keeps the working archive and session.
- Discard cleanup failure reports the error and retains the session projection
  rather than claiming it was removed.
- A second create request fails while a session is active.
- A target-side replacement request fails while a session is active.
- App-close cancellation keeps the window and session open.
- Best-effort process cleanup owns only the app-created working directory and
  never deletes a user-selected destination.

## Testing and Validation

### Core

- Empty `.jar`, `.zip`, `.war`, and `.ear` targets open successfully.
- Copy-current preserves the seed file bytes before any Apply.
- Selected copy and Merge all preserve original source entry bytes.
- Overwrite and skip decisions produce the expected target bytes.
- Apply is atomic and leaves the previous target readable on failure.
- Save As produces a reopenable archive.

### Stored state

- Only one session can exist.
- Target side remains fixed.
- Replaceable source can change after a successful Apply.
- Target replacement and unsafe source replacement are rejected.
- Failed Create, Apply, Save As, and Discard preserve the documented state.
- Explicit Discard removes only app-owned temp artifacts.

### IPC

- Rust serialization fixtures and frontend facade tests lock all command names,
  argument keys, enum spelling, null behavior, and summaries.
- Architecture guards cover command ownership and prevent temp-session state
  from leaking into core.

### Frontend

- Create dialog exposes both creation choices.
- Empty and copy-current flows label the target correctly.
- Merge all requires conflict resolution before staging.
- Overwrite all, Skip all, and per-entry choices project correctly.
- Apply success refreshes target and enables Change source.
- Staged Change source offers Apply, Discard staged, and Cancel.
- Save As failure can be retried.
- Discard and app close use the approved confirmations.

### Native smoke

The smoke scenario:

1. Opens a seed JAR.
2. Creates a temp target by copying the seed.
3. Applies selected entries from a second JAR.
4. Applies Merge all with overwrite and skip decisions from a third JAR.
5. Saves the target to a user-owned output path.
6. Reopens the output and verifies entry paths and exact bytes.

`npm run verify:all`, Rust workspace tests, sidecar smoke, and packaged desktop
launch remain the aggregate proof ladder.

## Acceptance Criteria

- A temp target can be created as empty or as a copy of the current source.
- The target survives at least three source replacements in one session.
- Selected and bulk byte copies accumulate only after explicit Apply.
- Every bulk conflict is resolved as overwrite or skip before staging.
- A failed operation never loses the last good working archive.
- Save As creates a reopenable user-owned artifact without changing any source.
- Discard removes the app-owned working target.
- No signature- or content-aware logic participates in temp merge decisions.
