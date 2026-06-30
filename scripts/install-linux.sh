#!/usr/bin/env bash
# Install LCDiff on Linux (Ubuntu 22.04+ / other glibc 2.35+ distros).
#
# Two modes, auto-detected from the artifact you point it at:
#   * .AppImage -> installs a portable launcher to ~/.local/bin/lcdiff and a
#                  desktop entry, so `lcdiff` works on PATH and it shows in the
#                  app menu. No root needed.
#   * .deb      -> installs system-wide via apt (needs sudo).
#
# Usage:
#   scripts/install-linux.sh                       # auto-find AppImage/deb next to script or CWD
#   scripts/install-linux.sh path/to/LCDiff_0.2.0_amd64.AppImage
#   scripts/install-linux.sh path/to/LCDiff_0.2.0_amd64.deb
#   LCDIFF_PREFIX=/usr/local scripts/install-linux.sh app.AppImage   # system-wide AppImage (sudo)
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
  printf 'No .AppImage or .deb found. Pass the path: scripts/install-linux.sh path/to/LCDiff*.AppImage\n' >&2
  exit 1
fi

case "$ART" in
  *.deb)
    printf '==> Installing %s via apt (needs sudo)\n' "$ART"
    sudo apt-get update
    sudo apt-get install -y "$ART"
    printf '\nDone. Launch from the app menu or run: lcdiff\n'
    ;;
  *.AppImage)
    PREFIX="${LCDIFF_PREFIX:-$HOME/.local}"
    BIN="$PREFIX/bin"
    APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    OPT="$PREFIX/lib/lcdiff"
    SUDO=""
    [[ -w "$PREFIX" || "$PREFIX" == "$HOME/.local" ]] || SUDO="sudo"
    [[ "$PREFIX" != "$HOME/.local" ]] && APPS_DIR="/usr/share/applications"

    printf '==> Installing AppImage to %s/LCDiff.AppImage\n' "$OPT"
    $SUDO mkdir -p "$OPT" "$BIN" "$APPS_DIR"
    $SUDO cp "$ART" "$OPT/LCDiff.AppImage"
    $SUDO chmod +x "$OPT/LCDiff.AppImage"
    $SUDO ln -sf "$OPT/LCDiff.AppImage" "$BIN/lcdiff"

    printf '==> Writing desktop entry\n'
    DESKTOP="$APPS_DIR/lcdiff.desktop"
    $SUDO tee "$DESKTOP" >/dev/null <<EOF
[Desktop Entry]
Type=Application
Name=LCDiff
Comment=Inspect, compare, and merge JAR/ZIP archives and folders
Exec=$OPT/LCDiff.AppImage %F
Terminal=false
Categories=Development;Utility;
MimeType=application/java-archive;application/zip;
EOF

    if ! printf '%s' ":$PATH:" | grep -q ":$BIN:"; then
      printf '\nNote: %s is not on your PATH. Add this to your shell rc:\n  export PATH="%s:$PATH"\n' "$BIN" "$BIN"
    fi
    printf '\nDone. Launch from the app menu or run: lcdiff\n'
    printf 'On Wayland, if drag-and-drop misbehaves: GDK_BACKEND=x11 lcdiff\n'
    ;;
  *)
    printf 'Unsupported artifact: %s (expected .AppImage or .deb)\n' "$ART" >&2
    exit 1
    ;;
esac
