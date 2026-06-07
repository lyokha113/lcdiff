#!/usr/bin/env bash
set -euo pipefail

WORKFLOW="release.yml"
REF=""
DISPATCH=0
OUTPUT_DIR="platform-validation"
RUN_ID=""

usage() {
  cat <<'USAGE'
usage: scripts/verify-remote-release-workflow.sh [--dispatch] [--ref <git-ref>] [--run-id <id>] [--output-dir platform-validation]

Records GitHub Actions release-workflow evidence. With --dispatch, it starts
.github/workflows/release.yml on the selected ref, waits for completion, then
writes a Markdown report with run status and uploaded artifacts. Without
--dispatch, pass --run-id or the script inspects the latest release workflow run.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dispatch)
      DISPATCH=1
      shift
      ;;
    --ref)
      REF="${2:?--ref requires a git ref}"
      shift 2
      ;;
    --run-id)
      RUN_ID="${2:?--run-id requires a workflow run id}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?--output-dir requires a path}"
      shift 2
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

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'required command not found on PATH: %s\n' "$name" >&2
    exit 1
  fi
}

require_command gh
require_command git

gh auth status >/dev/null

if [[ -z "$REF" ]]; then
  REF="$(git branch --show-current)"
  if [[ -z "$REF" ]]; then
    REF="$(git rev-parse --short HEAD)"
  fi
fi

mkdir -p "$OUTPUT_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$DISPATCH" == "1" ]]; then
  if [[ -n "$RUN_ID" ]]; then
    printf -- '--run-id cannot be combined with --dispatch\n' >&2
    exit 2
  fi
  printf 'Dispatching %s on ref %s...\n' "$WORKFLOW" "$REF"
  gh workflow run "$WORKFLOW" --ref "$REF"
  printf 'Waiting for workflow run to appear...\n'
  for _ in {1..30}; do
    RUN_ID="$(gh run list --workflow "$WORKFLOW" --branch "$REF" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
    if [[ -n "$RUN_ID" ]]; then
      break
    fi
    sleep 5
  done
  if [[ -z "$RUN_ID" ]]; then
    printf 'workflow run did not appear for %s on %s\n' "$WORKFLOW" "$REF" >&2
    exit 1
  fi
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
fi

if [[ -z "$RUN_ID" ]]; then
  printf 'no workflow run found for %s\n' "$WORKFLOW" >&2
  exit 1
fi

printf 'Watching workflow run %s...\n' "$RUN_ID"
gh run watch "$RUN_ID" --exit-status

run_json="$(gh run view "$RUN_ID" --json databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,createdAt,updatedAt)"
artifacts_json="$(gh run view "$RUN_ID" --json artifacts --jq '.artifacts')"
report="$OUTPUT_DIR/remote-release-$RUN_ID-$timestamp.md"

{
  printf '# Remote Release Workflow Evidence\n\n'
  printf '## Run\n\n'
  printf '```json\n%s\n```\n\n' "$run_json"
  printf '## Artifacts\n\n'
  printf '```json\n%s\n```\n\n' "$artifacts_json"
  printf '## Required Artifact Names\n\n'
  printf -- '- `jdiff-aarch64-apple-darwin`\n'
  printf -- '- `jdiff-x86_64-apple-darwin`\n'
  printf -- '- `jdiff-x86_64-unknown-linux-gnu`\n'
  printf -- '- `jdiff-x86_64-pc-windows-msvc`\n'
} > "$report"

for artifact in \
  jdiff-aarch64-apple-darwin \
  jdiff-x86_64-apple-darwin \
  jdiff-x86_64-unknown-linux-gnu \
  jdiff-x86_64-pc-windows-msvc
do
  if ! printf '%s' "$artifacts_json" | grep -F "\"name\":\"$artifact\"" >/dev/null; then
    printf 'required artifact missing from run %s: %s\n' "$RUN_ID" "$artifact" >&2
    printf 'report written before failure: %s\n' "$report" >&2
    exit 1
  fi
done

printf 'remote release workflow validation passed: %s\n' "$report"
