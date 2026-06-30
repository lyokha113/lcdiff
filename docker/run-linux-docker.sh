#!/usr/bin/env bash
# Run the built Linux LCDiff bundle inside Docker, headlessly, on a virtual X
# display (Xvfb), and grab a screenshot to prove the GUI renders.
#
# macOS cannot run Linux GUI binaries natively, so we launch inside the same
# Ubuntu image used to build, under Xvfb + software GL. The window is captured
# to docker/last-run-screenshot.png on the host.
#
# Usage:
#   docker/run-linux-docker.sh                         # Ubuntu 24.04 amd64
#   docker/run-linux-docker.sh --ubuntu 26.04          # run that build floor
#   docker/run-linux-docker.sh --arch arm64            # run arm64 build volume
#   docker/run-linux-docker.sh --secs 12               # keep app up before shot
#   docker/run-linux-docker.sh shell                   # X-enabled shell
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="amd64"
UBUNTU="${LCDIFF_UBUNTU:-24.04}"
SECS=8

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="${2:?--arch needs amd64|arm64}"; shift 2 ;;
    --ubuntu) UBUNTU="${2:?--ubuntu needs e.g. 24.04}"; shift 2 ;;
    --secs) SECS="${2:?}"; shift 2 ;;
    shell)  MODE=shell; shift ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; exit 1 ;;
  esac
done

IMAGE="lcdiff-linux-build-$ARCH-u${UBUNTU//./}"
TARGET_VOL="lcdiff-linux-$ARCH-u${UBUNTU//./}-target"
TARGET_DIR="/work/target-$ARCH"
PLATFORM="linux/$ARCH"

docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  printf 'image %s missing - run docker/build-linux-docker.sh first\n' "$IMAGE" >&2
  exit 1
}

# --device /dev/fuse + SYS_ADMIN let the AppImage self-mount; software GL via
# LLVMpipe so it renders without a GPU.
RUN_ARGS=(
  --rm -it
  --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined
  --platform "$PLATFORM"
  -e LIBGL_ALWAYS_SOFTWARE=1
  -e WEBKIT_DISABLE_COMPOSITING_MODE=1
  -e WEBKIT_DISABLE_DMABUF_RENDERER=1
  -v "$TARGET_VOL:$TARGET_DIR:ro"
  -v "$ROOT/docker:/out"
  -w /work
  "$IMAGE"
)

if [[ "${MODE:-}" == "shell" ]]; then
  exec docker run "${RUN_ARGS[@]}" bash -lc \
    'Xvfb :99 -screen 0 1280x900x24 >/dev/null 2>&1 & sleep 1; export DISPLAY=:99; exec bash'
fi

# Non-interactive run + screenshot (no TTY).
RUN_ARGS=("${RUN_ARGS[@]/-it/}")

docker run "${RUN_ARGS[@]}" bash -lc '
set -e
export DISPLAY=:99
Xvfb :99 -screen 0 1280x900x24 >/tmp/xvfb.log 2>&1 &
sleep 2
eval "$(dbus-launch --sh-syntax)"

APP=$(ls '"$TARGET_DIR"'/release/bundle/appimage/*.AppImage | head -1)
echo "==> launching $APP"
chmod +x "$APP" || true
# AppImages cant run as root via FUSE without this; extract+run side-steps it.
APPIMAGE_EXTRACT_AND_RUN=1 "$APP" >/tmp/app.log 2>&1 &
APP_PID=$!

sleep '"$SECS"'
if kill -0 $APP_PID 2>/dev/null; then
  echo "==> app alive after '"$SECS"'s (pid $APP_PID) — launch OK"
else
  echo "==> app exited early; log:"; tail -40 /tmp/app.log; exit 1
fi

import -window root /out/last-run-screenshot.png 2>/dev/null \
  || xwd -root -silent | convert xwd:- /out/last-run-screenshot.png
echo "==> screenshot -> docker/last-run-screenshot.png"
kill $APP_PID 2>/dev/null || true
'
printf '\nScreenshot saved: %s/docker/last-run-screenshot.png\n' "$ROOT"
