# Updater Downloading Status Design

## Goal

Keep the in-app updater visible and clearly busy after the user starts a native
update download.

## Design

`App` remains the owner of updater state. When its existing install callback
changes the state from `available` to `downloading`, it will map that state to a
StatusBar prompt instead of omitting the prompt. The prompt will show the
existing `Downloading update...` message and a disabled `Downloading...`
button. It will not expose the release fallback while the native operation is
in flight.

`StatusBarUpdatePrompt` will accept the `downloading` status and an explicit
disabled flag for its primary action. No updater-native API, release manifest,
dependency, or progress reporting behavior changes.

## Error Handling

The existing updater client continues to transition successful downloads to
`readyToRestart` and failed downloads to `fallback`. Those states retain their
existing Restart and Open release page actions.

## Testing

An App integration test will hold the mocked download promise pending, click
Download and install, and assert that `Downloading...` remains visible and
disabled. The test then resolves the promise and confirms the existing
ready-to-restart state.
