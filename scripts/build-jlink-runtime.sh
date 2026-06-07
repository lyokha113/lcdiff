#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${JDIFF_JRE_OUT:-$ROOT/src-tauri/resources/jre}"
JLINK="${JDIFF_JLINK:-jlink}"

if ! command -v "$JLINK" >/dev/null 2>&1; then
  printf 'jlink not found. Set JDIFF_JLINK to a Java 17+ jlink executable.\n' >&2
  exit 1
fi

VERSION="$("$JLINK" --version)"
MAJOR="${VERSION%%.*}"
if [[ "$MAJOR" -lt 17 ]]; then
  printf 'jlink Java 17+ required, found %s\n' "$VERSION" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
"$JLINK" \
  --add-modules java.base,java.desktop,java.sql,jdk.zipfs \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output "$OUT"

while IFS= read -r link; do
  cp -L "$link" "$link.materialized"
  rm "$link"
  mv "$link.materialized" "$link"
done < <(find "$OUT" -type l)

chmod -R u+rwX "$OUT"

tar -czf "$OUT-legal.tar.gz" -C "$OUT" legal
rm -rf "$OUT/legal"

JAVA="$OUT/bin/java"
if [[ -x "$OUT/bin/java.exe" ]]; then
  JAVA="$OUT/bin/java.exe"
fi
"$JAVA" -version
printf 'jlink runtime created: %s\n' "$OUT"
