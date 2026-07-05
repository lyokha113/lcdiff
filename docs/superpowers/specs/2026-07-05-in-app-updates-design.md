# In-App Updates Design

## Goal

LCDiff should check for a newer app version from inside the desktop app and let
the user download/install it when native signed updater artifacts are available.
When native update is not available for the current platform or artifact, the
app must fall back to opening the GitHub Releases page instead of blocking the
workspace.

The approved behavior is:

- auto-check once when the app opens;
- stay silent when no update exists;
- show a compact prompt only when an update exists or is ready to restart;
- keep a manual `Check for updates` path in `Preferences > Misc > Updates`;
- use Tauri updater signing, with public key in app config and private key in
  GitHub Actions secrets;
- support native update for every release artifact that can be signed and
  represented in the updater manifest;
- fall back to GitHub Release download for unsupported or misconfigured cases.

## Current Context

LCDiff is a Tauri v2 desktop app with React, shadcn/ui source components,
Tailwind, and Monaco. Releases are built by GitHub Actions workflows for macOS,
Linux, and Windows and uploaded to GitHub Releases. Current release docs publish
DMG, AppImage, deb, Windows installer, install scripts, and AUR metadata, but
there is no updater plugin, updater manifest, signed updater artifact, or
in-app update UI.

The existing app structure should be preserved:

- `App.tsx` owns Tauri-facing orchestration state.
- `MenuBar`, `ConfigDrawer`, and `StatusBar` render workspace controls.
- `Preferences > Misc` already owns app behavior settings.
- Release behavior is documented in `docs/RELEASING.md`,
  `docs/PLATFORM_VALIDATION.md`, and `docs/ARCHITECTURE.md`.

## Recommended Approach

Use Tauri's updater plugin as the native update path, plus a GitHub Release
fallback.

Add:

- `@tauri-apps/plugin-updater` for `check()` and `downloadAndInstall()`;
- `tauri-plugin-updater` in the Rust desktop app;
- `@tauri-apps/plugin-process` and `tauri-plugin-process` for `relaunch()`;
- updater permissions in `src-tauri/capabilities/default.json`;
- updater config in `src-tauri/tauri.conf.json`, including `pubkey`, endpoint,
  and updater artifact generation;
- frontend update orchestration in a small update module/hook used by `App.tsx`;
- a Preferences updates section and compact status-bar prompt;
- release workflow steps that sign updater artifacts and upload `latest.json`.

Do not build a custom updater service or custom installer logic. GitHub Releases
remain the source of truth.

## User Experience

### Auto-Check

On app startup, if `Automatically check for updates` is enabled, the frontend
checks once after the desktop shell is ready.

State behavior:

- no update: no visible interruption;
- checking: no startup modal and no blocking UI;
- update available: compact status prompt with latest version and action;
- install ready: compact status prompt with restart action;
- error: no startup interruption; error is visible in Preferences.

The app must not auto-download updates. Download/install starts only from a user
action.

### Manual Check

`Preferences > Misc > Updates` includes:

- `Automatically check for updates` toggle, default on;
- current version;
- latest checked version when known;
- last checked time when known;
- status/error message when relevant;
- `Check for updates`;
- `Download and install` when native update is available;
- `Restart to update` when install completes;
- `Open release page` when fallback is needed or the user wants manual access.

The command bar should not get a permanent update button. Updates are a
maintenance action, not a primary diff workflow action.

### Fallback

Fallback opens `https://github.com/lyokha113/lcdiff/releases/latest`.

Fallback is required when:

- network check fails;
- updater manifest is missing or malformed;
- current platform is missing from `latest.json`;
- signature validation fails;
- native install/download fails;
- release workflow cannot produce a signed updater artifact for the platform;
- the platform uses an install path that Tauri updater cannot safely replace.

Fallback must not hide the error. Preferences should preserve a short status
such as `Native update is not available for this build.`

## Frontend Design

Create a narrow update state model:

```text
idle
checking
upToDate
available
downloading
readyToRestart
fallback
error
```

The state stores:

- current app version;
- latest version when known;
- last checked timestamp when known;
- whether the check was automatic or manual;
- update object reference when available;
- user-facing message;
- fallback URL.

`App.tsx` should own the live update state because it already coordinates
desktop APIs and status messaging. The updater-specific calls should live in a
small frontend module so tests can mock it without loading all of `App.tsx`.

`StatusBar` receives an optional update prompt model. It shows update
availability only when the update state is `available` or `readyToRestart`.

`MiscPreferences` receives update state and callbacks from `App.tsx` through
`ConfigDrawer`. Keep the Preferences layout flat; only split Updates into a
new Preferences category if the implemented Misc panel becomes visually too
crowded.

Persist only the auto-check preference. Do not persist transient update
results; stale update state after app restart is worse than a fresh check.

## Tauri Design

Configure the Tauri updater plugin with:

- committed public signing key;
- GitHub Release endpoint for `latest.json`;
- updater artifact generation during bundle build;
- required updater and process permissions.

The frontend should call the official updater API instead of custom IPC. Rust
changes should be limited to plugin registration and config unless platform
testing exposes a missing native capability.

The update flow should relaunch only after install completes and the user
chooses restart.

## Release Design

GitHub Actions release workflows should:

- read updater private key and password from GitHub secrets;
- fail release builds clearly when updater signing secrets are missing;
- build existing release artifacts as today;
- produce signed updater artifacts for every platform/package Tauri supports;
- generate and upload `latest.json` to the matching GitHub Release;
- keep existing installer assets and install scripts available for fallback;
- preserve existing platform-specific artifact names.

The release contract should document which artifacts are native-updatable and
which are fallback-only after implementation verifies actual Tauri support.

The initial design policy is to fail tagged releases if updater signing secrets
are absent. This avoids shipping a release that claims in-app native updates but
cannot be installed by the updater.

## Error Handling

Update errors are non-fatal. They must never block viewing, comparing, text
diffing, searching, staging, or saving.

Use short user-facing messages:

- `You are up to date.`
- `LCDiff vX.Y.Z is available.`
- `Update downloaded. Restart to finish.`
- `Native update is not available for this build.`
- `Could not check for updates.`
- `Could not install the update.`

Detailed errors can stay in console/dev logs unless an existing logging surface
is added later.

## Tests And Verification

Frontend tests:

- auto-check no update stays silent;
- auto-check update available shows the compact status prompt;
- manual check shows up-to-date result in Preferences;
- install success transitions to restart state;
- install failure shows fallback action;
- disabling auto-check prevents startup check;
- Preferences persists only the auto-check setting.

Render verifier:

- mock updater API;
- open Preferences;
- run manual check;
- see update available;
- click download/install;
- see restart action;
- verify fallback action on mocked failure.

Packaging/docs verification:

- verify Tauri config contains updater endpoint, public key, and updater artifact
  generation;
- verify capabilities allow updater and process commands;
- verify release docs mention `latest.json`, updater signatures, signing
  secrets, and fallback behavior;
- verify release workflows include updater signing environment.

External platform gates:

- install an older released app;
- publish or stage a newer signed updater manifest/artifact;
- verify check detects the newer version;
- verify download/install completes;
- verify restart launches the newer version;
- verify fallback opens GitHub Releases on unsupported package/platform.

## Out Of Scope

- custom update server;
- custom GitHub asset downloader;
- background polling during a session;
- automatic download without user action;
- forced update modals;
- update channels such as beta/stable;
- rollback UI;
- AUR self-update inside the app.

## Implementation Notes

Use the existing verification ladder after implementation:

- focused frontend tests for update state and Preferences;
- `rtk npm run verify:all`;
- Rust compile/check for plugin registration;
- release-script/docs verifier updates;
- platform release validation when updater artifacts are generated.

The smallest working version is native updater where Tauri supports it, plus
explicit fallback everywhere else.
