#!/usr/bin/env bash
set -euo pipefail

APP=""
SAMPLE_ARCHIVE=""
OUTPUT_DIR="platform-validation"
NO_LAUNCH=0

usage() {
  cat <<'USAGE'
usage: scripts/verify-linux-display-matrix.sh --app /path/to/jdiff [--sample /path/to/sample.jar] [--output-dir platform-validation] [--no-launch]

Runs the Linux display-server validation checklist for the current compositor
session and writes a Markdown evidence report. This script records manual
desktop checks that cannot be proven from a headless CI job: Browse open, path
input open, OS file drop, and Wayland XWayland fallback.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP="${2:?--app requires a path}"
      shift 2
      ;;
    --sample)
      SAMPLE_ARCHIVE="${2:?--sample requires a path}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?--output-dir requires a path}"
      shift 2
      ;;
    --no-launch)
      NO_LAUNCH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'scripts/verify-linux-display-matrix.sh must be run on Linux.\n' >&2
  exit 1
fi

if [[ -z "$APP" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -x "$APP" ]]; then
  printf 'jdiff executable not found or not executable: %s\n' "$APP" >&2
  exit 1
fi

if [[ -n "$SAMPLE_ARCHIVE" && ! -f "$SAMPLE_ARCHIVE" ]]; then
  printf 'sample archive not found: %s\n' "$SAMPLE_ARCHIVE" >&2
  exit 1
fi

session_type="${XDG_SESSION_TYPE:-unknown}"
desktop="${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}"
wayland_display="${WAYLAND_DISPLAY:-}"
display="${DISPLAY:-}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
safe_desktop="$(printf '%s' "$desktop" | tr -cs 'A-Za-z0-9._-' '-')"
safe_session="$(printf '%s' "$session_type" | tr -cs 'A-Za-z0-9._-' '-')"
mkdir -p "$OUTPUT_DIR"
report="$OUTPUT_DIR/linux-display-${safe_desktop}-${safe_session}-${timestamp}.md"

app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

launch_app() {
  local mode="$1"
  if [[ "$NO_LAUNCH" == "1" ]]; then
    printf 'Skipping launch for %s mode because --no-launch was provided.\n' "$mode"
    return
  fi

  if [[ "$mode" == "xwayland" ]]; then
    JDIFF_FORCE_XWAYLAND=1 scripts/launch-linux-xwayland.sh "$APP" &
  else
    "$APP" &
  fi
  app_pid="$!"
  printf 'Launched jdiff (%s) with pid %s. Use the window for the checks below.\n' "$mode" "$app_pid"
  sleep 2
}

ask_result() {
  local label="$1"
  local value notes
  while true; do
    printf '%s [pass/fail/skipped]: ' "$label"
    read -r value
    case "$value" in
      pass|fail|skipped) break ;;
      *) printf 'Please enter pass, fail, or skipped.\n' ;;
    esac
  done
  printf 'Notes for %s: ' "$label"
  read -r notes
  printf '| %s | %s | %s |\n' "$label" "$value" "${notes//|/ }" >> "$report"
}

cat > "$report" <<REPORT
# Linux Display Matrix Evidence

- App: \`$APP\`
- Sample archive: \`${SAMPLE_ARCHIVE:-not provided}\`
- Desktop: \`$desktop\`
- Session type: \`$session_type\`
- WAYLAND_DISPLAY: \`${wayland_display:-unset}\`
- DISPLAY: \`${display:-unset}\`
- Timestamp UTC: \`$timestamp\`

## Native Session Checks

| Check | Result | Notes |
| --- | --- | --- |
REPORT

launch_app "native"

printf '\nNative session checks for %s / %s\n' "$desktop" "$session_type"
printf 'Use the same valid .jar/.zip for Browse, path input, and file drop.\n'
if [[ -n "$SAMPLE_ARCHIVE" ]]; then
  printf 'Suggested sample archive: %s\n' "$SAMPLE_ARCHIVE"
fi

ask_result "Browse open"
ask_result "Path input open"
ask_result "OS file drop"

cleanup
app_pid=""

if [[ -n "$wayland_display" ]]; then
  cat >> "$report" <<'REPORT'

## XWayland Fallback Checks

| Check | Result | Notes |
| --- | --- | --- |
REPORT
  launch_app "xwayland"
  printf '\nWayland detected. XWayland fallback checks with JDIFF_FORCE_XWAYLAND=1.\n'
  ask_result "XWayland fallback launch"
  ask_result "XWayland Browse open"
  ask_result "XWayland path input open"
  ask_result "XWayland OS file drop"
else
  cat >> "$report" <<'REPORT'

## XWayland Fallback Checks

Skipped because WAYLAND_DISPLAY is unset.
REPORT
fi

printf '\nLinux display validation report written: %s\n' "$report"
