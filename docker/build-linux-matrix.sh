#!/usr/bin/env bash
# Build release Linux bundles for the supported Ubuntu LTS floors separately.
#
# The Tauri/WebKit/GTK stack links against system libraries from the build
# image, so each Ubuntu floor gets its own Docker image, target volume, and
# copied artifact directory. That prevents 24.04/26.04 binaries from being
# mixed or overwritten.
#
# Usage:
#   docker/build-linux-matrix.sh
#   docker/build-linux-matrix.sh --arch amd64
#   docker/build-linux-matrix.sh --bundles appimage,deb
#   docker/build-linux-matrix.sh --ubuntu 24.04 --ubuntu 26.04
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="amd64"
BUNDLES="appimage,deb"
REBUILD=0
UBUNTUS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="${2:?--arch needs amd64|arm64}"; shift 2 ;;
    --bundles) BUNDLES="${2:?--bundles needs a value}"; shift 2 ;;
    --ubuntu) UBUNTUS+=("${2:?--ubuntu needs e.g. 24.04}"); shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if [[ "${#UBUNTUS[@]}" -eq 0 ]]; then
  UBUNTUS=(24.04 26.04)
fi

mkdir -p "$ROOT/artifacts/linux"

for ubuntu in "${UBUNTUS[@]}"; do
  label="ubuntu${ubuntu}"
  out_dir="$ROOT/artifacts/linux/$label-$ARCH"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  args=(--arch "$ARCH" --ubuntu "$ubuntu")
  if [[ "$REBUILD" == "1" ]]; then
    args=(--rebuild "${args[@]}")
  fi
  args+=(--bundles "$BUNDLES")

  printf '==> Building Linux %s bundles on Ubuntu %s\n' "$ARCH" "$ubuntu"
  "$ROOT/docker/build-linux-docker.sh" "${args[@]}"

  image="lcdiff-linux-build-$ARCH-u${ubuntu//./}"
  target_vol="lcdiff-linux-$ARCH-u${ubuntu//./}-target"
  platform="linux/$ARCH"
  cid="$(docker create --platform "$platform" -v "$target_vol:/t" "$image")"
  cleanup() { docker rm "$cid" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  docker cp "$cid":/t/release/bundle/. "$out_dir/"
  docker rm "$cid" >/dev/null
  trap - EXIT

  printf '==> Copied Ubuntu %s bundles to %s\n' "$ubuntu" "$out_dir"
  find "$out_dir" -maxdepth 2 -type f \
    \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) \
    | sort | sed 's/^/  /'
done
