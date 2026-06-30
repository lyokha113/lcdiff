#!/usr/bin/env bash
set -euo pipefail

APP="${1:?usage: scripts/launch-linux-xwayland.sh /path/to/LCDiff [args...]}"
shift || true

if [[ ! -x "$APP" ]]; then
  printf 'LCDiff executable not found or not executable: %s\n' "$APP" >&2
  exit 1
fi

if [[ -n "${WAYLAND_DISPLAY:-}" && "${LCDIFF_FORCE_XWAYLAND:-0}" == "1" ]]; then
  export GDK_BACKEND=x11
  printf 'Wayland detected; launching with GDK_BACKEND=x11 for file-drop fallback.\n' >&2
fi

exec "$APP" "$@"
