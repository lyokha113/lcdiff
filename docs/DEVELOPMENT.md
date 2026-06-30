# LCDiff Development

This file is for people changing LCDiff, building it from source, or cutting a
release. The main README is intentionally user-facing.

## Architecture

```text
React + shadcn/ui + Tailwind + Monaco   (view + intent emitter)
        |  Tauri IPC
Rust src-tauri  (commands, async adapters)
        |
Rust lcdiff-core  (archive state, staged bytes, CRC diff, search, save)
        |  framed stdio
JVM decompiler sidecar  (Vineflower default / CFR / ASM, jlink Java 17)
```

The frontend never owns archive bytes. Rust owns archive state, staged changes,
and atomic save semantics. Decompiled Java is a view only and must never enter
merge writes. See [ARCHITECTURE.md](ARCHITECTURE.md) for the boundary rules.

## Repository Layout

```text
lcdiff/
  crates/
    lcdiff-core/   Rust archive engine
    lcdiff-cli/    headless smoke adapter
  src-tauri/       Tauri v2 host and IPC commands
  src/             React + Monaco frontend
  sidecar/         JVM decompiler sidecar
  scripts/         build, sign, package, verification scripts
  docker/          Linux release build containers
  docs/            product and release docs
```

## Prerequisites

- Rust toolchain.
- Node.js / npm.
- Java 17 JDK with `jlink`.
- Maven.
- macOS: Xcode Command Line Tools.
- Linux: GTK 3 + WebKit2GTK 4.1 system libraries.

## Run From Source

```bash
npm install
LCDIFF_JLINK="$(command -v jlink)" scripts/assemble-sidecar-resources.sh
npm run tauri -- dev
```

The sidecar assembly step is required for decompile and bytecode views. The app
can still inspect, diff, search, and merge archives without it, but JVM-backed
views degrade.

The headless CLI is useful for quick checks:

```bash
cargo run -p lcdiff-cli -- list path/to/archive.jar
cargo run -p lcdiff-cli -- diff path/to/left.jar path/to/right.jar
```

## Developer Checks

Run these before shipping changes:

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm run verify:all
npm run verify:frontend-render
```

`npm run verify:all` runs the frontend build plus packaging, frontend,
branding, render, and docs invariants. `npm run verify:frontend-render` boots
the shell under Playwright and fails on browser page errors.

## Build Linux

For release artifacts, prefer Docker from any host:

```bash
docker/build-linux-matrix.sh --arch amd64 --bundles appimage,deb
```

The matrix builds Ubuntu 24.04 and Ubuntu 26.04 separately so GTK, WebKit,
OpenSSL, and glibc-linked dependencies cannot overwrite each other. Artifacts
land in:

```text
artifacts/linux/ubuntu24.04-amd64/
artifacts/linux/ubuntu26.04-amd64/
```

For single-target debugging:

```bash
docker/build-linux-docker.sh --arch amd64 --ubuntu 24.04 --bundles appimage,deb
docker/build-linux-docker.sh --arch amd64 --ubuntu 26.04 --bundles appimage,deb
```

To build directly on a Linux machine:

```bash
scripts/build-linux.sh
scripts/build-linux.sh --no-deps
scripts/build-linux.sh --bundles appimage
```

`docker/run-linux-docker.sh` launches the built AppImage headlessly under Xvfb
and captures evidence that the GUI renders.

## Build macOS

Debug app bundle:

```bash
npm run tauri -- build --debug --bundles app
```

Release distribution order is always sign, notarize, package DMG, then verify:

```bash
scripts/sign-macos-bundle.sh \
  "$PWD/target/release/bundle/macos/LCDiff.app" \
  - \
  "$PWD/target/release/bundle/macos/LCDiff-signed.app"

APPLE_ID=you@example.com \
APPLE_TEAM_ID=TEAMID1234 \
APPLE_APP_PASSWORD=app-specific-password \
  scripts/notarize-macos-app.sh "$PWD/target/release/bundle/macos/LCDiff-signed.app"

scripts/package-macos-dmg.sh \
  "$PWD/target/release/bundle/macos/LCDiff-signed.app" \
  "$PWD/target/release/bundle/dmg/LCDiff-signed.dmg"

scripts/verify-macos-distribution.sh --skip-install
```

Without Developer ID credentials, local validation uses ad-hoc signing and
records notarization as skipped. The operator runbook is
[OPERATIONS_MACOS.md](OPERATIONS_MACOS.md).

## Build Windows

Windows release installers are built on Windows, not cross-built from macOS or
Linux. For phase 1, GitHub Actions builds an unsigned NSIS installer on
`windows-latest` whenever a `v*` tag is pushed.

Run the same build script inside a Windows VM or machine:

```powershell
scripts\build-windows.ps1
scripts\build-windows.ps1 -Bundles nsis
scripts\build-windows.ps1 -Bundles "nsis,msi"
```

The script requires Node.js, Rust, Git Bash, Maven, and Java 17 with `jlink`.
Artifacts are copied to:

```text
artifacts/windows/
```

Unsigned installers are expected until `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` secrets are configured. When those secrets are
present, `scripts\build-windows.ps1 -SignIfSecretsPresent` signs `.exe` and
`.msi` bundles through [sign-windows-bundles.ps1](../scripts/sign-windows-bundles.ps1).

## Release

Use [RELEASING.md](RELEASING.md) for the full tagged release process.

Current release focus:

- macOS Apple Silicon DMG.
- Linux x86_64 Ubuntu 24.04 LTS AppImage/deb.
- Linux x86_64 Ubuntu 26.04 LTS AppImage/deb.
- Windows 10/11 x64 NSIS installer from GitHub Actions.
- Arch Linux AUR package via `aur/lcdiff`.

Arch users install with:

```bash
yay -S lcdiff
```

## Documentation Map

- [ARCHITECTURE.md](ARCHITECTURE.md) - application shape and boundary rules.
- [LCDIFF_COMPLETION_AUDIT.md](LCDIFF_COMPLETION_AUDIT.md) - completion audit.
- [OPERATIONS_MACOS.md](OPERATIONS_MACOS.md) - macOS sign/notarize/package.
- [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) - external platform gates.
- [RELEASING.md](RELEASING.md) - release runbook.
- [GLOSSARY.md](GLOSSARY.md) - shared terms.
