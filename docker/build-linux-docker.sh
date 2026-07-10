#!/usr/bin/env bash
# Build LCDiff Linux bundles inside Docker from a macOS (or any) host.
#
# Linux bundles cannot be cross-built from macOS, so we run the real
# scripts/build-linux.sh inside an Ubuntu container that already has every
# dependency baked in (hence --no-deps).
#
# Cross-ARCH: on Apple Silicon, --arch amd64 builds an x86_64 bundle via Docker
# QEMU emulation (slower: cargo compiles under emulation). Default = host arch.
#
# Host files are protected: named volumes shadow node_modules and the cargo
# target dir (both per-arch), so your macOS node_modules/ and target/ are
# never touched.
#
# Usage:
#   docker/build-linux-docker.sh                 # build for host arch (arm64 on Apple Silicon)
#   docker/build-linux-docker.sh --arch amd64    # x86_64 bundle (Intel/AMD Linux)
#   docker/build-linux-docker.sh --bundles appimage
#   docker/build-linux-docker.sh --arch amd64 shell   # shell in the amd64 env
#   docker/build-linux-docker.sh --rebuild       # force rebuild the image
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- parse leading flags (--rebuild / --arch); rest passes to build-linux.sh --
REBUILD=0
ARCH=""
# glibc floor of the produced binaries. Release builds use the matrix wrapper
# for every supported Ubuntu LTS floor; direct single-target builds default to
# the oldest supported floor.
UBUNTU="${LCDIFF_UBUNTU:-22.04}"
while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --rebuild) REBUILD=1; shift ;;
    --arch)    ARCH="${2:?--arch needs amd64|arm64}"; shift 2 ;;
    --ubuntu)  UBUNTU="${2:?--ubuntu needs e.g. 22.04}"; shift 2 ;;
    *) break ;;
  esac
done

# Default to host arch.
if [[ -z "$ARCH" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64)  ARCH=amd64 ;;
    *) printf 'unknown host arch %s; pass --arch amd64|arm64\n' "$(uname -m)" >&2; exit 1 ;;
  esac
fi
case "$ARCH" in amd64|arm64) ;; *) printf 'bad --arch %s (amd64|arm64)\n' "$ARCH" >&2; exit 1 ;; esac

PLATFORM="linux/$ARCH"
IMAGE="lcdiff-linux-build-$ARCH-u${UBUNTU//./}"
# Target dir holds compiled binaries -> must be per glibc floor (ubuntu ver)
# too, else stale artifacts from another base leak in with the wrong GLIBC req.
TARGET_VOL="lcdiff-linux-$ARCH-u${UBUNTU//./}-target"
NODE_VOL="lcdiff-linux-$ARCH-node-modules"
CARGO_VOL="lcdiff-linux-$ARCH-cargo-registry"
M2_VOL="lcdiff-linux-$ARCH-m2"
TARGET_DIR="/work/target-$ARCH"

# --- build the image if missing or forced ------------------------------------
if [[ "$REBUILD" == "1" ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf '==> Building Docker image %s (%s, ubuntu %s)\n' "$IMAGE" "$PLATFORM" "$UBUNTU"
  docker build --platform "$PLATFORM" --build-arg "UBUNTU_VERSION=$UBUNTU" \
    -t "$IMAGE" -f "$ROOT/docker/Dockerfile" "$ROOT/docker"
fi

# Use a TTY only when attached to one (background/CI runs have no TTY).
TTY_ARGS=()
if [[ -t 0 && -t 1 ]]; then TTY_ARGS=(-it); fi

# Named volumes persist across runs (faster rebuilds) and shadow host dirs.
COMMON_ARGS=(
  --rm ${TTY_ARGS[@]+"${TTY_ARGS[@]}"}
  --platform "$PLATFORM"
  -e APPIMAGE_EXTRACT_AND_RUN=1
  -e CARGO_TARGET_DIR="$TARGET_DIR"
  -e TAURI_SIGNING_PRIVATE_KEY
  -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  # linuxdeploy scans the bundled jlink JRE's ELFs; libjvm.so lives in
  # jre/lib/server, off the default linker path -> point LD_LIBRARY_PATH at it
  # so AppImage dependency resolution finds it.
  -e LD_LIBRARY_PATH=/work/src-tauri/resources/jre/lib/server:/work/src-tauri/resources/jre/lib
  -v "$ROOT:/work"
  -v "$TARGET_VOL:$TARGET_DIR"
  -v "$NODE_VOL:/work/node_modules"
  -v "$CARGO_VOL:/opt/cargo/registry"
  -v "$M2_VOL:/root/.m2"
  -w /work
  "$IMAGE"
)

# --- interactive shell --------------------------------------------------------
if [[ "${1:-}" == "shell" ]]; then
  exec docker run "${COMMON_ARGS[@]}" bash
fi

# --- build (--no-deps: image already has them) -------------------------------
printf '==> Running scripts/build-linux.sh --no-deps inside %s\n' "$IMAGE"
docker run "${COMMON_ARGS[@]}" bash -lc "scripts/build-linux.sh --no-deps $*"

printf '\n==> Bundles (in %s, mounted at %s):\n' "$TARGET_VOL" "$TARGET_DIR"
docker run --rm --platform "$PLATFORM" \
  -v "$TARGET_VOL:$TARGET_DIR" \
  "$IMAGE" bash -lc \
  "find $TARGET_DIR/release/bundle -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*.deb' \) 2>/dev/null || true"

cat <<EOF

To copy bundles out of the volume to the host:
  cid=\$(docker create --platform $PLATFORM -v $TARGET_VOL:/t $IMAGE)
  docker cp "\$cid":/t/release/bundle ./linux-bundle-$ARCH && docker rm "\$cid"
EOF
