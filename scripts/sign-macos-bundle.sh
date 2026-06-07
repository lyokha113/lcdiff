#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'macOS codesigning must run on Darwin.\n' >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_APP="${1:?usage: scripts/sign-macos-bundle.sh /path/to/jdiff.app [identity] [output.app]}"
IDENTITY="${2:-${MACOS_SIGN_IDENTITY:--}}"
OUTPUT_APP="${3:-${JDIFF_SIGNED_APP_OUT:-}}"
ENTITLEMENTS="${MACOS_ENTITLEMENTS:-$ROOT/src-tauri/Entitlements.plist}"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jdiff-codesign.XXXXXX")"
APP="$STAGING_DIR/$(basename "$INPUT_APP")"

clean_bundle_xattrs() {
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
    return 1
  fi
}

if [[ ! -f "$ENTITLEMENTS" ]]; then
  printf 'macOS entitlements file not found: %s\n' "$ENTITLEMENTS" >&2
  exit 1
fi

ditto --norsrc "$INPUT_APP" "$APP"
clean_bundle_xattrs "$APP"

sign() {
  local target="$1"
  local args=(--force --options runtime --sign "$IDENTITY")
  if [[ "$IDENTITY" != "-" ]]; then
    args+=(--timestamp)
  fi
  if [[ -n "$ENTITLEMENTS" ]]; then
    args+=(--entitlements "$ENTITLEMENTS")
  fi
  codesign "${args[@]}" "$target"
}

while IFS= read -r binary; do
  sign "$binary"
done < <(
  find "$APP" -type f -print0 \
    | xargs -0 file \
    | awk -F: '/Mach-O/ { print $1 }' \
    | awk '{ print length, $0 }' \
    | sort -rn \
    | cut -d" " -f2-
)

sign "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
if [[ -n "$OUTPUT_APP" ]]; then
  rm -rf "$OUTPUT_APP"
  mkdir -p "$(dirname "$OUTPUT_APP")"
  ditto --norsrc "$APP" "$OUTPUT_APP"
  sleep 5
  clean_bundle_xattrs "$OUTPUT_APP" || printf 'warning: output bundle still has strict codesign-blocking xattrs; caller must clean before verification: %s\n' "$OUTPUT_APP" >&2
  printf 'signed macOS bundle copied for notarization: %s\n' "$OUTPUT_APP"
else
  printf 'signed macOS bundle staged for notarization: %s\n' "$APP"
fi
