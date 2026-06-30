#!/usr/bin/env bash
# Build LCDiff on Linux (Ubuntu / Arch) end to end:
#   1. install the GTK/WebKit system libraries Tauri v2 needs,
#   2. assemble the JVM decompiler sidecar + bundled jlink runtime,
#   3. build the desktop bundles (AppImage + deb by default).
#
# Run on the target Linux machine. Cross-building Linux bundles from macOS is
# not supported. Re-run any time; the dependency step is idempotent.
#
# Usage:
#   scripts/build-linux.sh                 # install deps, then build appimage,deb
#   scripts/build-linux.sh --no-deps       # skip dependency install (deps already present)
#   scripts/build-linux.sh --bundles appimage
#   LCDIFF_JLINK=/path/to/jdk17/bin/jlink scripts/build-linux.sh
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'This script builds Linux bundles and must run on Linux.\n' >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLES="appimage,deb"
INSTALL_DEPS=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deps) INSTALL_DEPS=0; shift ;;
    --bundles) BUNDLES="${2:?--bundles needs a value}"; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

# --- 1. System dependencies (GTK 3 + WebKit2GTK 4.1 stack for Tauri v2) -------
install_deps() {
  if command -v apt-get >/dev/null 2>&1; then
    printf '==> Installing dependencies with apt (Ubuntu/Debian)\n'
    sudo apt-get update
    sudo apt-get install -y \
      build-essential curl wget file \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libxdo-dev \
      libssl-dev \
      patchelf
  elif command -v pacman >/dev/null 2>&1; then
    printf '==> Installing dependencies with pacman (Arch)\n'
    sudo pacman -Sy --needed --noconfirm \
      base-devel curl wget file \
      webkit2gtk-4.1 \
      gtk3 \
      libappindicator-gtk3 \
      librsvg \
      xdotool \
      openssl \
      patchelf
  else
    printf 'No apt-get or pacman found. Install the Tauri v2 Linux deps manually:\n' >&2
    printf '  webkit2gtk-4.1, gtk3, libappindicator(ayatana), librsvg, xdo, openssl, patchelf, a C toolchain.\n' >&2
    exit 1
  fi
}

# --- toolchain sanity (Rust / Node / Java 17+jlink / Maven) -------------------
require() {
  command -v "$1" >/dev/null 2>&1 || { printf 'missing required tool: %s\n' "$1" >&2; exit 1; }
}

if [[ "$INSTALL_DEPS" == "1" ]]; then
  install_deps
fi

require cargo
require node
require npm
require mvn

JLINK="${LCDIFF_JLINK:-jlink}"
command -v "$JLINK" >/dev/null 2>&1 || {
  printf 'jlink not found. Install a Java 17+ JDK or set LCDIFF_JLINK.\n' >&2
  exit 1
}

# --- 2. Frontend deps + sidecar resources ------------------------------------
printf '==> npm install\n'
npm --prefix "$ROOT" install

printf '==> Assembling JVM sidecar + jlink runtime\n'
LCDIFF_JLINK="$JLINK" "$ROOT/scripts/assemble-sidecar-resources.sh"

# --- 3. Build bundles ---------------------------------------------------------
printf '==> Building Linux bundles: %s\n' "$BUNDLES"
npm --prefix "$ROOT" run tauri -- build --bundles "$BUNDLES"

printf '\nDone. Bundles under:\n'
printf '  %s/target/release/bundle/\n' "$ROOT"
find "$ROOT/target/release/bundle" -maxdepth 2 -type f \
  \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) 2>/dev/null \
  | sed 's/^/  /' || true
