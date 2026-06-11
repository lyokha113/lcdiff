#!/usr/bin/env bash
# Install LDiff on Linux (Ubuntu 22.04+ / other glibc 2.35+ distros).
#
# Two modes, auto-detected from the artifact you point it at:
#   * .AppImage -> installs a portable launcher to ~/.local/bin/ldiff and a
#                  desktop entry, so `ldiff` works on PATH and it shows in the
#                  app menu. No root needed.
#   * .deb      -> installs system-wide via apt (needs sudo).
#
# Usage:
#   scripts/install-linux.sh                       # auto-find AppImage/deb next to script or CWD
#   scripts/install-linux.sh path/to/LDiff_0.1.0_amd64.AppImage
#   scripts/install-linux.sh path/to/LDiff_0.1.0_amd64.deb
#   LDIFF_PREFIX=/usr/local scripts/install-linux.sh app.AppImage   # system-wide AppImage (sudo)
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'This installer is for Linux. On macOS use scripts/install-macos.sh.\n' >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- locate the artifact -----------------------------------------------------
ART="${1:-}"
if [[ -z "$ART" ]]; then
  ART="$(ls -1 "$HERE"/*.AppImage "$PWD"/*.AppImage "$HERE"/*.deb "$PWD"/*.deb 2>/dev/null | head -1 || true)"
fi
if [[ -z "$ART" || ! -f "$ART" ]]; then
  printf 'No .AppImage or .deb found. Pass the path: scripts/install-linux.sh path/to/LDiff*.AppImage\n' >&2
  exit 1
fi

case "$ART" in
  *.deb)
    printf '==> Installing %s via apt (needs sudo)\n' "$ART"
    sudo apt-get update
    sudo apt-get install -y "$ART"
    printf '\nDone. Launch from the app menu or run: ldiff\n'
    ;;
  *.AppImage)
    PREFIX="${LDIFF_PREFIX:-$HOME/.local}"
    BIN="$PREFIX/bin"
    APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    OPT="$PREFIX/lib/ldiff"
    SUDO=""
    [[ -w "$PREFIX" || "$PREFIX" == "$HOME/.local" ]] || SUDO="sudo"
    [[ "$PREFIX" != "$HOME/.local" ]] && APPS_DIR="/usr/share/applications"

    printf '==> Installing AppImage to %s/LDiff.AppImage\n' "$OPT"
    $SUDO mkdir -p "$OPT" "$BIN" "$APPS_DIR"
    $SUDO cp "$ART" "$OPT/LDiff.AppImage"
    $SUDO chmod +x "$OPT/LDiff.AppImage"
    $SUDO ln -sf "$OPT/LDiff.AppImage" "$BIN/ldiff"

    printf '==> Writing desktop entry\n'
    DESKTOP="$APPS_DIR/ldiff.desktop"
    $SUDO tee "$DESKTOP" >/dev/null <<EOF
[Desktop Entry]
Type=Application
Name=LDiff
Comment=Inspect, compare, and merge JAR/ZIP archives and folders
Exec=$OPT/LDiff.AppImage %F
Terminal=false
Categories=Development;Utility;
MimeType=application/java-archive;application/zip;
EOF

    if ! printf '%s' ":$PATH:" | grep -q ":$BIN:"; then
      printf '\nNote: %s is not on your PATH. Add this to your shell rc:\n  export PATH="%s:$PATH"\n' "$BIN" "$BIN"
    fi
    printf '\nDone. Launch from the app menu or run: ldiff\n'
    printf 'On Wayland, if drag-and-drop misbehaves: GDK_BACKEND=x11 ldiff\n'
    ;;
  *)
    printf 'Unsupported artifact: %s (expected .AppImage or .deb)\n' "$ART" >&2
    exit 1
    ;;
esac
