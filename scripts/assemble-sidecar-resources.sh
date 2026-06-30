#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mvn -f "$ROOT/sidecar/pom.xml" clean package -DskipTests
mkdir -p "$ROOT/src-tauri/resources/sidecar"
cp \
  "$ROOT/sidecar/target/lcdiff-sidecar-0.2.1.jar" \
  "$ROOT/src-tauri/resources/sidecar/lcdiff-sidecar.jar"

"$ROOT/scripts/build-jlink-runtime.sh"
printf 'sidecar resources assembled under %s\n' "$ROOT/src-tauri/resources"
