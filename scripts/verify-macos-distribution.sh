#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-$(rustc -vV | awk '/host:/ { print $2 }')}"
BUNDLES="${BUNDLES:-app}"
SKIP_INSTALL=0
SKIP_BUILD=0
SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:--}"
OUTPUT_DIR="platform-validation"

usage() {
  cat <<'USAGE'
usage: scripts/verify-macos-distribution.sh [--target <triple>] [--sign-identity <identity>] [--output-dir platform-validation] [--skip-install] [--skip-build]

Runs the macOS distribution validation path: local verifiers, jlink sidecar
assembly, sidecar smoke, Tauri .app build, inside-out signing, optional
Developer ID notarization when Apple credentials are present, final app
promotion, and DMG packaging.

Set JDIFF_JLINK_<TARGET> (for example
JDIFF_JLINK_X86_64_APPLE_DARWIN) to provide a target-specific JDK when
cross-building. The runner verifies the JDK java binary, app executable, and
bundled JRE all match the requested Mach-O architecture.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?--target requires a Rust target triple}"
      shift 2
      ;;
    --sign-identity)
      SIGN_IDENTITY="${2:?--sign-identity requires a codesign identity or -}"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?--output-dir requires a path}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'scripts/verify-macos-distribution.sh must be run on Darwin.\n' >&2
  exit 1
fi

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'required command not found on PATH: %s\n' "$name" >&2
    exit 1
  fi
}

step() {
  printf '==> %s\n' "$1"
}

expected_macho_arch() {
  case "$1" in
    aarch64-apple-darwin)
      printf 'arm64'
      ;;
    x86_64-apple-darwin)
      printf 'x86_64'
      ;;
    *)
      printf 'unsupported macOS target triple for architecture validation: %s\n' "$1" >&2
      exit 1
      ;;
  esac
}

assert_macho_arch() {
  local label="$1"
  local path="$2"
  local expected="$3"

  if [[ ! -f "$path" ]]; then
    printf 'expected %s not found: %s\n' "$label" "$path" >&2
    exit 1
  fi

  local file_output
  file_output="$(file -b "$path")"
  if [[ "$file_output" != *Mach-O* || "$file_output" != *"$expected"* ]]; then
    printf 'expected %s to be a Mach-O %s binary, got: %s\n' "$label" "$expected" "$file_output" >&2
    exit 1
  fi
}

clean_bundle_xattrs() {
  local path="$1"

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    xattr -cr "$path"
    xattr -d com.apple.FinderInfo "$path" 2>/dev/null || true
    xattr -d 'com.apple.fileprovider.fpfs#P' "$path" 2>/dev/null || true
    find "$path" -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
    find "$path" -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
    if ! xattr -lr "$path" | grep -E 'com\.apple\.(FinderInfo|fileprovider\.fpfs#P)' >/dev/null; then
      return 0
    fi
    sleep 0.5
  done

  if xattr -lr "$path" | grep -E 'com\.apple\.(FinderInfo|fileprovider\.fpfs#P)' >/dev/null; then
    printf 'failed to remove strict codesign-blocking xattrs from %s\n' "$path" >&2
    exit 1
  fi
}

require_command npm
require_command cargo
require_command rustc
require_command file
require_command codesign
require_command hdiutil
require_command ditto
require_command xcrun

EXPECTED_ARCH="$(expected_macho_arch "$TARGET")"
TARGET_JLINK_ENV="JDIFF_JLINK_$(printf '%s' "$TARGET" | tr '[:lower:]-' '[:upper:]_')"
TARGET_JLINK="${!TARGET_JLINK_ENV:-}"
if [[ -n "$TARGET_JLINK" ]]; then
  export JDIFF_JLINK="$TARGET_JLINK"
fi

if [[ -z "${JDIFF_JLINK:-}" ]]; then
  if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/jlink" ]]; then
    export JDIFF_JLINK="$JAVA_HOME/bin/jlink"
  elif command -v jlink >/dev/null 2>&1; then
    export JDIFF_JLINK="$(command -v jlink)"
  else
    printf 'JDIFF_JLINK is unset and jlink was not found. Install Java 17 or set JDIFF_JLINK.\n' >&2
    exit 1
  fi
fi

JLINK_JAVA="$(dirname "$JDIFF_JLINK")/java"
step "verify jlink architecture"
assert_macho_arch "JDIFF_JLINK java" "$JLINK_JAVA" "$EXPECTED_ARCH"

if [[ "$SKIP_INSTALL" == "0" ]]; then
  step "npm ci"
  npm ci
fi
INSTALL_STATUS="$([[ "$SKIP_INSTALL" == "0" ]] && printf executed || printf skipped)"

step "local aggregate verifiers"
npm run verify:all

step "assemble bundled Java runtime resources"
scripts/assemble-sidecar-resources.sh

step "sidecar smoke"
scripts/test-sidecar-smoke.sh

if [[ "$SKIP_BUILD" == "0" ]]; then
  step "build macOS app bundle"
  npm run tauri -- build --target "$TARGET" --bundles "$BUNDLES"
fi
BUILD_STATUS="$([[ "$SKIP_BUILD" == "0" ]] && printf executed || printf skipped)"

APP_PATH="target/$TARGET/release/bundle/macos/jdiff.app"
DMG_PATH="target/$TARGET/release/bundle/dmg/jdiff-$TARGET.dmg"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
VALIDATION_DIR="${TMPDIR:-/tmp}/jdiff-macos-validation-$TARGET-$timestamp"
SIGNED_APP_PATH="$VALIDATION_DIR/jdiff-signed.app"
FINAL_APP_PATH="$VALIDATION_DIR/jdiff.app"
mkdir -p "$OUTPUT_DIR"
rm -rf "$VALIDATION_DIR"
mkdir -p "$VALIDATION_DIR"
REPORT_PATH="$OUTPUT_DIR/macos-distribution-$TARGET-$timestamp.md"

if [[ ! -d "$APP_PATH" ]]; then
  printf 'expected macOS app bundle not found: %s\n' "$APP_PATH" >&2
  exit 1
fi

APP_EXECUTABLE="$APP_PATH/Contents/MacOS/jdiff-desktop"
BUNDLED_JAVA="$APP_PATH/Contents/Resources/resources/jre/bin/java"

step "verify macOS bundle architecture"
assert_macho_arch "app executable" "$APP_EXECUTABLE" "$EXPECTED_ARCH"
assert_macho_arch "bundled Java runtime" "$BUNDLED_JAVA" "$EXPECTED_ARCH"

step "inside-out sign macOS app"
scripts/sign-macos-bundle.sh "$APP_PATH" "$SIGN_IDENTITY" "$SIGNED_APP_PATH"
sleep 5
clean_bundle_xattrs "$SIGNED_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$SIGNED_APP_PATH"
codesign -d --entitlements - "$SIGNED_APP_PATH"

NOTARIZATION_STATUS="skipped"
if [[
  -n "${APPLE_ID:-}" &&
  -n "${APPLE_TEAM_ID:-}" &&
  -n "${APPLE_APP_PASSWORD:-}" &&
  "$SIGN_IDENTITY" != "-"
]]; then
  step "notarize signed macOS app"
  scripts/notarize-macos-app.sh "$SIGNED_APP_PATH"
  NOTARIZATION_STATUS="completed"
else
  printf 'Skipping notarization: APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD missing or signing identity is ad-hoc.\n'
fi

step "promote final macOS app"
rm -rf "$FINAL_APP_PATH"
ditto --norsrc "$SIGNED_APP_PATH" "$FINAL_APP_PATH"
clean_bundle_xattrs "$FINAL_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"
codesign -d --entitlements - "$FINAL_APP_PATH"

step "package macOS DMG"
scripts/package-macos-dmg.sh "$FINAL_APP_PATH" "$DMG_PATH"
clean_bundle_xattrs "$FINAL_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"
codesign -d --entitlements - "$FINAL_APP_PATH"

step "verify mounted macOS DMG app"
MOUNT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jdiff-dmg-mount.XXXXXX")"
cleanup_mount() {
  if mount | grep -F "$MOUNT_DIR" >/dev/null 2>&1; then
    hdiutil detach "$MOUNT_DIR" >/dev/null
  fi
  rmdir "$MOUNT_DIR" 2>/dev/null || true
}
trap cleanup_mount EXIT
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -readonly >/dev/null
test -d "$MOUNT_DIR/jdiff.app"
test -L "$MOUNT_DIR/Applications"
codesign --verify --deep --strict --verbose=2 "$MOUNT_DIR/jdiff.app"
cleanup_mount
trap - EXIT

step "verify final macOS app after DMG mount"
clean_bundle_xattrs "$FINAL_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"
codesign -d --entitlements - "$FINAL_APP_PATH"

cat > "$REPORT_PATH" <<REPORT
# macOS Distribution Evidence

- Target: \`$TARGET\`
- Bundles: \`$BUNDLES\`
- Signing identity: \`$SIGN_IDENTITY\`
- Notarization: \`$NOTARIZATION_STATUS\`
- npm install: \`$INSTALL_STATUS\`
- App build: \`$BUILD_STATUS\`
- App: \`$APP_PATH\`
- Validation app: \`$FINAL_APP_PATH\`
- DMG: \`$DMG_PATH\`
- Target-specific JLINK env: \`$TARGET_JLINK_ENV\`
- JLINK: \`$JDIFF_JLINK\`
- Expected Mach-O arch: \`$EXPECTED_ARCH\`
- Timestamp UTC: \`$timestamp\`

## Completed Checks

- \`npm run verify:all\`
- JLINK java at \`$JLINK_JAVA\` is Mach-O \`$EXPECTED_ARCH\`
- \`scripts/assemble-sidecar-resources.sh\`
- \`scripts/test-sidecar-smoke.sh\`
- app bundle present at \`$APP_PATH\`
- app executable at \`$APP_EXECUTABLE\` is Mach-O \`$EXPECTED_ARCH\`
- bundled Java runtime at \`$BUNDLED_JAVA\` is Mach-O \`$EXPECTED_ARCH\`
- \`scripts/sign-macos-bundle.sh "$APP_PATH" "$SIGN_IDENTITY" "$SIGNED_APP_PATH"\`
- \`clean_bundle_xattrs "$SIGNED_APP_PATH"\`
- \`codesign --verify --deep --strict --verbose=2 "$SIGNED_APP_PATH"\`
- \`codesign -d --entitlements - "$SIGNED_APP_PATH"\`
- \`ditto --norsrc "$SIGNED_APP_PATH" "$FINAL_APP_PATH"\`
- \`clean_bundle_xattrs "$FINAL_APP_PATH"\`
- \`codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"\`
- \`codesign -d --entitlements - "$FINAL_APP_PATH"\`
- \`scripts/package-macos-dmg.sh "$FINAL_APP_PATH" "$DMG_PATH"\`
- \`clean_bundle_xattrs "$FINAL_APP_PATH"\` after DMG packaging
- post-DMG \`codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"\`
- post-DMG \`codesign -d --entitlements - "$FINAL_APP_PATH"\`
- mounted DMG contains \`jdiff.app\`
- mounted DMG contains \`Applications\` symlink
- mounted DMG \`codesign --verify --deep --strict --verbose=2 jdiff.app\`
- post-mount \`clean_bundle_xattrs "$FINAL_APP_PATH"\`
- post-mount \`codesign --verify --deep --strict --verbose=2 "$FINAL_APP_PATH"\`
- post-mount \`codesign -d --entitlements - "$FINAL_APP_PATH"\`
REPORT

if [[ "$NOTARIZATION_STATUS" == "completed" ]]; then
  cat >> "$REPORT_PATH" <<REPORT
- \`scripts/notarize-macos-app.sh "$SIGNED_APP_PATH"\`
REPORT
fi

printf 'macOS distribution validation passed: %s\n' "$DMG_PATH"
printf 'macOS distribution report written: %s\n' "$REPORT_PATH"
