#!/usr/bin/env bash
# Install LCDiff on macOS from the release DMG.
#
# LCDiff is distributed unsigned / ad-hoc signed (no Apple Developer ID), so
# this script also clears the Gatekeeper quarantine flag — otherwise macOS
# refuses to open it ("LCDiff is damaged / cannot be opened").
#
# Usage:
#   scripts/install-macos.sh                 # auto-find the DMG next to this script or in CWD
#   scripts/install-macos.sh path/to/LCDiff-0.2.0-aarch64.dmg
#   LCDIFF_LINK_CLI=1 scripts/install-macos.sh   # also add an `lcdiff` launcher to /usr/local/bin
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This installer is for macOS. On Linux use scripts/install-linux.sh.\n' >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS="/Applications"
APP_NAME="LCDiff.app"

quit_running_lcdiff() {
  printf '==> Stopping any running LCDiff app\n'
  osascript -e 'tell application "LCDiff" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -f "lcdiff-desktop" >/dev/null 2>&1 || true
}

# --- locate the DMG ----------------------------------------------------------
DMG="${1:-}"
if [[ -z "$DMG" ]]; then
  DMG="$(ls -1 "$HERE"/LCDiff-*.dmg "$PWD"/LCDiff-*.dmg 2>/dev/null | head -1 || true)"
fi
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  printf 'No DMG found. Pass the path: scripts/install-macos.sh path/to/LCDiff-*.dmg\n' >&2
  exit 1
fi
printf '==> Installing from %s\n' "$DMG"
quit_running_lcdiff

# --- mount, copy, unmount ----------------------------------------------------
MNT="$(mktemp -d /tmp/lcdiff-dmg.XXXXXX)"
cleanup() { hdiutil detach "$MNT" >/dev/null 2>&1 || true; rmdir "$MNT" 2>/dev/null || true; }
trap cleanup EXIT

hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$MNT"
SRC="$MNT/$APP_NAME"
if [[ ! -d "$SRC" ]]; then
  # Fall back to the first .app in the image (e.g. LCDiff-signed.app).
  SRC="$(ls -1d "$MNT"/*.app 2>/dev/null | head -1 || true)"
fi
[[ -n "$SRC" && -d "$SRC" ]] || { printf 'No .app bundle inside the DMG.\n' >&2; exit 1; }

if [[ -d "$APPS/$APP_NAME" ]]; then
  printf '==> Removing existing %s/%s\n' "$APPS" "$APP_NAME"
  rm -rf "$APPS/$APP_NAME"
fi
printf '==> Copying %s to %s\n' "$APP_NAME" "$APPS"
/usr/bin/ditto "$SRC" "$APPS/$APP_NAME"

# --- clear quarantine so Gatekeeper allows the unsigned app ------------------
printf '==> Clearing Gatekeeper quarantine\n'
xattr -dr com.apple.quarantine "$APPS/$APP_NAME" 2>/dev/null || true

# --- optional CLI launcher ---------------------------------------------------
if [[ "${LCDIFF_LINK_CLI:-0}" == "1" ]]; then
  BIN="/usr/local/bin/lcdiff"
  printf '==> Installing CLI launcher at %s (may prompt for sudo)\n' "$BIN"
  TMP="$(mktemp)"
  cat > "$TMP" <<EOF
#!/usr/bin/env bash
exec open -a "$APPS/$APP_NAME" --args "\$@"
EOF
  chmod +x "$TMP"
  if [[ -w "$(dirname "$BIN")" ]]; then mv "$TMP" "$BIN"; else sudo mv "$TMP" "$BIN"; fi
fi

printf '\nDone. Launch LCDiff from Spotlight/Launchpad, or run: open -a LCDiff\n'
