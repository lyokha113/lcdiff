#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'macOS DMG packaging must run on Darwin.\n' >&2
  exit 1
fi

APP="${1:?usage: scripts/package-macos-dmg.sh /path/to/LCDiff.app /path/to/output.dmg [volume-name]}"
DMG="${2:?usage: scripts/package-macos-dmg.sh /path/to/LCDiff.app /path/to/output.dmg [volume-name]}"
VOLUME_NAME="${3:-LCDiff}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lcdiff-dmg.XXXXXX")"
STAGING_DIR="$WORK_DIR/staging"
trap 'rm -rf "$WORK_DIR"' EXIT

clean_app_xattrs() {
  local app="$1"

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    xattr -cr "$app"
    xattr -d com.apple.FinderInfo "$app" 2>/dev/null || true
    xattr -d 'com.apple.fileprovider.fpfs#P' "$app" 2>/dev/null || true
    find "$app" -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
    find "$app" -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
    if ! xattr -lr "$app" | grep -E 'com\.apple\.(FinderInfo|fileprovider\.fpfs#P)' >/dev/null; then
      return 0
    fi
    sleep 0.5
  done

  if xattr -lr "$app" | grep -E 'com\.apple\.(FinderInfo|fileprovider\.fpfs#P)' >/dev/null; then
    printf 'failed to remove strict codesign-blocking xattrs from %s\n' "$app" >&2
    exit 1
  fi
}

create_dmg() {
  hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    "$DMG"
}

if [[ ! -d "$APP" ]]; then
  printf 'app bundle not found: %s\n' "$APP" >&2
  exit 1
fi

case "$APP" in
  *.app) ;;
  *)
    printf 'input must be a .app bundle: %s\n' "$APP" >&2
    exit 1
    ;;
esac

mkdir -p "$(dirname "$DMG")" "$STAGING_DIR"
rm -f "$DMG"
clean_app_xattrs "$APP"
ditto --norsrc "$APP" "$STAGING_DIR/$(basename "$APP")"
clean_app_xattrs "$STAGING_DIR/$(basename "$APP")"
ln -s /Applications "$STAGING_DIR/Applications"

for attempt in 1 2 3 4 5; do
  rm -f "$DMG"
  if create_dmg; then
    break
  fi

  if [[ "$attempt" == "5" ]]; then
    printf 'failed to create macOS DMG after %s attempts\n' "$attempt" >&2
    exit 1
  fi

  printf 'hdiutil create failed; retrying DMG package attempt %s/5\n' "$((attempt + 1))" >&2
  sleep "$((attempt * 2))"
done

hdiutil verify "$DMG"
clean_app_xattrs "$APP"
printf 'packaged macOS DMG from %s: %s\n' "$APP" "$DMG"
