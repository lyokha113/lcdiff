#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mvn -f "$ROOT/sidecar/pom.xml" clean package -DskipTests
mkdir -p "$ROOT/src-tauri/resources/sidecar"
cp \
  "$ROOT/sidecar/target/ldiff-sidecar-0.1.0.jar" \
  "$ROOT/src-tauri/resources/sidecar/ldiff-sidecar.jar"

"$ROOT/scripts/build-jlink-runtime.sh"
printf 'sidecar resources assembled under %s\n' "$ROOT/src-tauri/resources"
