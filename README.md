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
- Workspace UI: a hierarchical, foldable file tree with per-node status; a
  multi-tab diff workspace (up to 10 tabs, LRU eviction, per-tab view-mode and
  preview state, left/middle-click close) alongside the Files panel; a Config
  drawer for decompiler engine, whitespace, backup, and search-scope options;
  and a startup splash screen while the sidecar warms.
- Nested archives: archive entries (jar/zip/war/ear inside an archive) expand
  lazily in the tree through `compute_nested_diff`, extract to cached temp files
  on demand using the `parent!/inner` path separator, and merge by flattening
  staged replacements back into their parent archives.

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

Linux build:

The only Linux target validated in CI is **Ubuntu 24.04**
(`.github/workflows/release.yml`), which produces AppImage, `.deb`, and `.rpm`
artifacts. AppImage is portable to other distributions (including Arch); `.deb`
suits Ubuntu/Debian and `.rpm` suits Fedora/openSUSE.

Install the WebKitGTK toolchain for your distro:

Ubuntu / Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Arch Linux:

```bash
sudo pacman -Syu --needed \
  webkit2gtk-4.1 \
  base-devel \
  librsvg \
  libappindicator-gtk3 \
  patchelf \
  openssl
```

Then assemble the sidecar JRE and bundle (any distro):

```bash
JDIFF_JLINK="$(command -v jlink)" \
  rtk scripts/assemble-sidecar-resources.sh
rtk npm run tauri -- build \
  --target x86_64-unknown-linux-gnu \
  --bundles appimage,deb,rpm
```

Requires a Java 17+ `jlink` on `PATH` (or set `JDIFF_JLINK` to one) so the
sidecar JRE is assembled before bundling. Artifacts land under
`target/x86_64-unknown-linux-gnu/release/bundle/`. On Arch (and other non-Debian,
non-RPM distros) prefer `--bundles appimage`; native `.deb`/`.rpm` tooling is not
present by default.

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

## Architecture

```text
React + shadcn/ui + Tailwind + Monaco   (view + intent emitter)
        |  Tauri IPC
Rust src-tauri  (commands, async adapters)
        |
Rust jdiff-core  (archive state, staged bytes, CRC diff, search, save)
        |  framed stdio
JVM decompiler sidecar  (CFR / Vineflower / ASM, jlink Java 17)
```

The frontend never owns bytes. Rust owns archive state, staged changes, and the
atomic save path. Decompilation lives behind the sidecar boundary and may
degrade independently when the JVM sidecar is absent. See `docs/ARCHITECTURE.md`
for boundary rules.

## Repository Layout

```text
jdiff/
  crates/
    jdiff-core/   Rust archive engine (open, diff, search, stage, save)
    jdiff-cli/    headless smoke adapter over jdiff-core
  src-tauri/      Tauri v2 host: IPC commands, bundle config, capabilities
  src/            React + Monaco frontend (App.tsx, components, lib)
  sidecar/        JVM decompiler (Maven, CFR/Vineflower/ASM)
  scripts/        build, sign, package, and verification scripts
  platform-validation/  per-platform distribution evidence reports
  docs/           harness + product documentation
```

## Documentation Map

Product and build references:

- `docs/product/jdiff-product-contract.md` — accepted MVP product contract.
- `docs/JDIFF_IMPLEMENTATION_PLAN.md` — implementation plan.
- `docs/JDIFF_COMPLETION_AUDIT.md` — completion audit with proof evidence.
- `docs/PLATFORM_VALIDATION.md` — external platform validation gates.
- `docs/OPERATIONS_MACOS.md` — macOS sign / notarize / package / verify runbook.
- `docs/TEST_MATRIX.md` — behavior-to-proof validation map.
- `docs/TRACE_SPEC.md` — trace and evidence specification.

Agent harness references:

- `docs/HARNESS.md` — human + agent collaboration model.
- `docs/FEATURE_INTAKE.md` — tiny / normal / high-risk work classification.
- `docs/ARCHITECTURE.md` — architecture discovery and boundary rules.
- `docs/CONTEXT_RULES.md` — what an agent must read before changing code.
- `docs/HARNESS_COMPONENTS.md`, `docs/HARNESS_MATURITY.md` — harness internals.
- `docs/GLOSSARY.md` — shared terms.

## Agent Harness

This repo is operated as an agent-ready workspace. Agents start from `AGENTS.md`,
then read the harness docs above. The Rust Harness CLI is the main operational
tool:

```bash
scripts/bin/harness-cli query matrix     # macOS/Linux
.\scripts\bin\harness-cli.exe query matrix  # Windows
```

`docs/HARNESS.md` explains the collaboration model; `docs/FEATURE_INTAKE.md`
classifies incoming work before any code changes.

## Contributing

1. Read `AGENTS.md` and the harness docs before changing code.
2. Run the full developer checks above, including `rtk npm run verify:all`.
3. Keep `docs/JDIFF_COMPLETION_AUDIT.md` and `docs/TEST_MATRIX.md` in sync with
   new behavior; `npm run verify:docs` enforces documentation invariants.
4. For platform-affecting changes, attach a `platform-validation/` evidence
   report from the relevant runner.
