#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'macOS notarization must run on Darwin.\n' >&2
  exit 1
fi

APP="${1:?usage: scripts/notarize-macos-app.sh /path/to/LDiff-signed.app}"

if [[ ! -d "$APP" ]]; then
  printf 'signed app bundle not found: %s\n' "$APP" >&2
  exit 1
fi

APPLE_ID="${APPLE_ID:?APPLE_ID is required for xcrun notarytool}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for xcrun notarytool}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD is required for xcrun notarytool}"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ldiff-notary.XXXXXX")"
ZIP_PATH="$WORK_DIR/$(basename "$APP").zip"

ditto -c -k --keepParent "$APP" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose=4 "$APP"
printf 'notarized and stapled macOS bundle: %s\n' "$APP"
