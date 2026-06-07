# jdiff

`jdiff` is a Tauri desktop tool for inspecting, comparing, and staging merges
between JAR/ZIP archives and folders. Decompiled Java is always read-only;
merge copies the original entry bytes.

Current implementation:

- Rust `jdiff-core`: validated open for JAR/ZIP files and folders, lazy
  index/read, CRC tree diff, normalized-path duplicate rejection, constant-pool
  search, text search, staged copy, signed-JAR detection, atomic archive save,
  folder target copy, `.bak`.
- Rust `jdiff-cli`: list, diff, read, search, and copy smoke adapter.
- Tauri + React + shadcn/ui + Tailwind v4 shell: active bundle config, app
  icon, path preflight with per-panel inline errors, native picker, file drop,
  resizable tree/editor panels, shadcn context-menu merge actions, aligned diff
  rows, Monaco `DiffEditor`, text/hex preview, detected text languages, binary
  size/CRC details, staged copy, signed-save Dialog confirmation with
  per-session suppression, action tooltips, and async adapters for
  ZIP/folder/decompiler long operations.
- JVM decompiler sidecar: CFR decompile, Vineflower adapter, ASM bytecode,
  framed stdio, async warm start, 30-second watchdog, one retry, 128 MB
  canonical-path, metadata, options, mode, and engine-version keyed LRU cache,
  typed decompile-options boundary, and bundled Java 17 jlink JRE assembly.
- Search: path/text/constant-pool tier plus opt-in cached deep source search with
  left/right/both scope, tagged clickable streaming results, progress, cancel,
  binary payload skipping in the cheap tier, and a dedicated background JVM
  worker.
- Navigation prefetch: a low-priority JVM worker warms the shared cache without
  blocking interactive decompile requests.
- Save safety: staged batches, dirty-close confirmation, changed-on-disk
  rejection, directory-copy guard, writable-target preflight, optional `.bak`,
  archive atomic replacement, and folder target file replacement.
- Merge UI: arrow buttons and a row context menu stage original entry bytes;
  pending badges show the current target before explicit save, and rows can be
  unstaged individually.

macOS-first build status:

- The primary local target is `aarch64-apple-darwin`.
- The latest local arm64 distribution report is
  `platform-validation/macos-distribution-aarch64-apple-darwin-20260606T051217Z.md`.
- The macOS operator runbook is `docs/OPERATIONS_MACOS.md`.
- Intel macOS builds require `JDIFF_JLINK_X86_64_APPLE_DARWIN` to point at an
  x86_64 JDK/jlink.
- Developer ID notarization requires Apple certificate and notary credentials;
  otherwise local validation uses ad-hoc signing and records notarization as
  skipped.

Developer checks:

```bash
rtk cargo fmt --all -- --check
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk npm run verify:all
rtk npm run verify:frontend-render
rtk mvn -f sidecar/pom.xml clean package -DskipTests
JDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  rtk scripts/assemble-sidecar-resources.sh
rtk scripts/test-sidecar-smoke.sh
rtk npm run tauri -- dev
rtk npm run tauri -- build --debug --bundles app
rtk scripts/sign-macos-bundle.sh \
  "$PWD/target/debug/bundle/macos/jdiff.app" \
  - \
  "$PWD/target/debug/bundle/macos/jdiff-signed.app"
APPLE_ID=you@example.com \
APPLE_TEAM_ID=TEAMID1234 \
APPLE_APP_PASSWORD=app-specific-password \
  rtk scripts/notarize-macos-app.sh "$PWD/target/debug/bundle/macos/jdiff-signed.app"
rtk scripts/package-macos-dmg.sh \
  "$PWD/target/debug/bundle/macos/jdiff-signed.app" \
  "$PWD/target/debug/bundle/dmg/jdiff-signed.dmg"
rtk scripts/verify-macos-distribution.sh --skip-install
```

Windows platform validation:

```powershell
scripts\verify-windows-platform.ps1
scripts\verify-windows-platform.ps1 -SkipInstall -SignIfSecretsPresent
```

Remote release workflow validation:

```bash
rtk scripts/verify-remote-release-workflow.sh --dispatch --ref main
```

Linux Wayland file-drop fallback:

```bash
JDIFF_FORCE_XWAYLAND=1 \
  rtk scripts/launch-linux-xwayland.sh /path/to/jdiff
rtk scripts/verify-linux-display-matrix.sh --app /path/to/jdiff --sample /path/to/sample.jar
```

This sets `GDK_BACKEND=x11` only when a Wayland session is detected. Browse and
path input remain the primary reliable open paths. The display-matrix verifier
writes per-compositor/session evidence under `platform-validation/`.

Optional macOS release signing secrets:

- `MACOS_CERTIFICATE_BASE64`: base64-encoded Developer ID Application `.p12`.
- `MACOS_CERTIFICATE_PASSWORD`: password for that `.p12`.
- `MACOS_KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `MACOS_SIGN_IDENTITY`: Developer ID Application identity name.
- `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`: `notarytool`
  credentials.

Optional Windows release signing secrets:

- `WINDOWS_CERTIFICATE_BASE64`: base64-encoded Authenticode `.pfx`.
- `WINDOWS_CERTIFICATE_PASSWORD`: password for that `.pfx`.
- `WINDOWS_TIMESTAMP_URL`: timestamp server URL; defaults to DigiCert when
  omitted.

Product contract: `docs/product/jdiff-product-contract.md`.
Implementation plan: `docs/JDIFF_IMPLEMENTATION_PLAN.md`.
Completion audit: `docs/JDIFF_COMPLETION_AUDIT.md`.
External platform gates: `docs/PLATFORM_VALIDATION.md`.
macOS operations: `docs/OPERATIONS_MACOS.md`.

## Harness Source

This repo started from `harness-experimental`.

Turn any software repo into an agent-ready workspace.

`harness-experimental` is a repository-level operating harness for Claude Code,
Codex, Cursor, and other coding agents. It gives agents the missing project
context they need before they change code: where to start, what the product
contract says, how risky the work is, what proof is required, and which
decisions future agents should inherit.

The app is what users touch. The harness is what agents touch.

## Why Star This Repo

Star this repo if you want practical, reusable patterns for making AI-assisted
software development more reliable, inspectable, and easier for humans to steer.

This project is exploring a simple idea:

> Coding agents do not only need better prompts. They need better repositories.

## The Problem

Most repos are built for humans reading code in a familiar codebase. Coding
agents usually enter with only a chat prompt and a shallow snapshot of files.
That leads to common failure modes:

- The agent edits code before understanding product intent.
- Important constraints live only in chat history or in someone's head.
- Validation expectations are vague or discovered too late.
- Architecture tradeoffs are repeated instead of inherited.
- Large requests do not get broken into reviewable story-sized work.

## The Harness Approach

A repository starts to have a harness when it helps an agent answer practical
engineering questions without relying only on chat history:

- What should I read first?
- What type of work is this?
- Which product contract does it affect?
- How risky is the change?
- What proof will show the work is done?
- What decision or lesson should future agents inherit?

In this repo, those answers live in:

- `AGENTS.md` — the stable agent shim with local project notes and Harness
  doc links.
- `docs/HARNESS.md` — the human-agent collaboration model.
- `docs/FEATURE_INTAKE.md` — tiny, normal, and high-risk work classification.
- `docs/ARCHITECTURE.md` — architecture discovery and boundary rules.
- `docs/TEST_MATRIX.md` — behavior-to-proof validation expectations.
- `docs/stories/` — story packets and backlog items.
- `docs/decisions/` — durable decisions and tradeoffs.
- `docs/templates/` — reusable spec, story, decision, and validation templates.

OpenAI describes this shift as an agent-first world where humans steer and
agents execute:

https://openai.com/index/harness-engineering/

## Install Harness Into A Project

From a target project directory, run:

```bash
curl -fsSL "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.sh?$(date +%s)" | bash -s -- --yes
```

On Windows PowerShell, run:

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.ps1"))) -Yes
```

If the target already has `AGENTS.md`, `docs/`, or `scripts/`, choose one:

```bash
# Update an existing Harness repo without moving existing files
curl -fsSL "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.sh?$(date +%s)" | bash -s -- --merge --yes

# Back up and replace AGENTS.md, docs/, and scripts/
curl -fsSL "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.sh?$(date +%s)" | bash -s -- --override --yes
```

```powershell
# Update an existing Harness repo without moving existing files
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.ps1"))) -Merge -Yes

# Back up and replace AGENTS.md, docs/, and scripts/
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.ps1"))) -Override -Yes
```

Use `--merge` when a project already has Harness and you want to append newly
added Harness files without moving the existing `AGENTS.md`, `docs/`, or
`scripts/` paths into backup. Existing files stay untouched; only missing
Harness files are created.

For older Harness installs whose `AGENTS.md` still contains the full generated
operating guide, refresh it into the small stable shim:

```bash
curl -fsSL "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.sh?$(date +%s)" | bash -s -- --merge --refresh-agent-shim --yes
```

The refresh backs up the existing file. If it detects the old
Harness-generated guide, it replaces it with the shim. If the file appears
custom, it appends or updates a marked Harness block instead of overwriting the
project's local instructions.

Or install into a specific path:

```bash
curl -fsSL "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.sh?$(date +%s)" | bash -s -- --directory /path/to/project --yes
```

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/hoangnb24/harness-experimental/main/scripts/install-harness.ps1"))) -Directory C:\path\to\project -Yes
```

Use `--dry-run` on Bash or `-DryRun` on PowerShell to preview changes before
writing files.

The installer also downloads the prebuilt Harness CLI for the current platform,
verifies its `.sha256` checksum, and installs it at
`scripts/bin/harness-cli` on macOS/Linux or `scripts/bin/harness-cli.exe` on
Windows. The Rust CLI is the main Harness tool and stable command path.

Harness CLI release assets are published from tags by the
`Harness CLI Release` GitHub Actions workflow. The installer expects each
release to include `harness-cli-<platform>` and
`harness-cli-<platform>.sha256` assets for macOS arm64, macOS x64, Linux x64,
Linux arm64, and Windows x64. The Windows asset is
`harness-cli-windows-x64.exe` plus `harness-cli-windows-x64.exe.sha256`.

## Try The Flow

The fastest way to understand the harness is to inspect the tiny demo:

- `docs/demo/README.md`: shows how a simple product idea becomes product docs,
  stories, validation expectations, and decisions before implementation starts.

A typical flow looks like this:

```text
human intent or product spec
  -> product contract
  -> feature intake
  -> story packet
  -> validation expectations
  -> implementation work
  -> decision or lesson captured for future agents
```

Implementation prompts do not go straight to code. They first pass through
feature intake, become story-sized work when needed, and then carry both product
validation and harness maintenance expectations.

## Current State

This repository is in Harness v0.

There is no application implementation and no baked-in product specification
yet. The current work is the reusable project harness: the file structure,
agent operating model, feature intake process, story templates, and validation
expectations that help humans and agents turn a future user-provided spec into
implementation work.

## Product Sources

No product contract is currently defined.

When a user provides a project specification, add or reference it as the input
spec for the first buildout, then derive smaller living artifacts from it:

- `docs/product/`: current product contract files, created from the spec.
- `docs/stories/`: story packets and backlog created from selected work.
- `docs/TEST_MATRIX.md`: behavior-to-proof control panel.
- `docs/decisions/`: durable decisions and tradeoffs.

Do not keep a project-specific spec or product breakdown in this harness until
a real project supplies one.

## Repository Structure

```text
project/
  AGENTS.md
  README.md
  docs/
    HARNESS.md
    FEATURE_INTAKE.md
    ARCHITECTURE.md
    TEST_MATRIX.md
    HARNESS_BACKLOG.md
    product/
    stories/
    decisions/
    demo/
    templates/
  scripts/
    README.md
```

## Contributing

This project is early and benefits most from real-world agent failure cases,
example harness installs, docs improvements, and reusable workflow patterns.
See `CONTRIBUTING.md` for contribution ideas.

Useful contributions include:

- Show how the harness works in a real project.
- Add missing templates or improve existing ones.
- Propose validation patterns for different stacks.
- Share failures where an agent made the wrong change because the repo lacked
  context.
- Compare harness behavior across Claude Code, Codex, Cursor, and other tools.

## Share

If this idea resonates, please star the repo and share it with someone building
with coding agents.

Short description:

> An agent-ready repo harness for Claude Code, Codex, Cursor, and other coding
> agents: AGENTS.md, product contracts, story packets, validation matrix, and
> decision records.
