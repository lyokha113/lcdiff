# LCDiff Development

This file is for people changing LCDiff, building it from source, or cutting a
release. The main README is intentionally user-facing.

## Architecture

```text
src/app + src/features   (composition, workflow state, React + Monaco)
        |  typed src/ipc facade
src-tauri commands       (Tauri interface and async adapters)
        |                 \
src-tauri state            sidecar_process -> Java 17 JVM service
        |
lcdiff-core              (archive domain, staged bytes, atomic save)
```

The frontend never owns archive bytes. Rust owns archive state, staged changes,
and atomic save semantics. Decompiled Java is a view only and must never enter
merge writes. See [ARCHITECTURE.md](ARCHITECTURE.md) for the boundary rules.

## Repository Layout

```text
lcdiff/
  crates/
    lcdiff-core/   Rust archive engine
  src-tauri/
    src/lib.rs     desktop composition root
    src/state.rs   stored desktop state and lifecycle invariants
    src/commands/  stable Tauri command modules
  src/
    app/           frontend composition root
    ipc/           exact wire DTOs and the only Tauri imports
    features/      workflow-owned UI, state and controllers
    lib/           pure shared utilities
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

## Developer Checks

Run these before shipping changes:

```bash
npm run verify:architecture
npm run verify:all
env -u RUSTC_WRAPPER cargo fmt --all -- --check
env -u RUSTC_WRAPPER cargo clippy --workspace --all-targets -- -D warnings
env -u RUSTC_WRAPPER cargo test --workspace
scripts/test-sidecar-smoke.sh
npm run tauri -- build --debug --bundles app
git diff --check
```

Use Java 17 and Node on `PATH`; point `LCDIFF_JLINK` at that JDK's `jlink`
when assembling resources. The Rust commands explicitly remove
`RUSTC_WRAPPER` so a stale local wrapper cannot invalidate the gate.

`npm run verify:all` starts with the architecture guard, then runs the frontend
build, unit tests, browser render check, branding check, and release-doc
synchronization. `npm run verify:architecture` is also useful as the focused
boundary check. `npm run verify:frontend-render` boots the shell under
Playwright and fails on browser page errors.

`src-tauri/tauri.conf.json` intentionally keeps
`bundle.createUpdaterArtifacts` enabled. The default command shown in the proof
ladder,

```bash
npm run tauri -- build --debug --bundles app
```

is therefore the real updater-signing gate. It requires
`TAURI_SIGNING_PRIVATE_KEY` and, for an encrypted key,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without the private key, Tauri may finish
compiling and create `LCDiff.app`, then exit non-zero when it attempts to sign
the updater artifact. Record that command as failed rather than treating the
created app alone as a green signing gate.

For unsigned local app-bundle validation when the updater signing key is not
available, override only the local invocation:

```bash
npm run tauri -- build --debug --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

This override validates the local `.app` bundle and packaged resources only. It
does not validate updater artifact generation/signing, release signing,
Developer ID signing, or notarization, and it does not change the checked-in
release configuration.

The debug bundle gate is artifact-backed only after inspecting
`target/debug/bundle/macos/LCDiff.app` and its bundled
`Contents/Resources/resources/sidecar/lcdiff-sidecar.jar` and
`Contents/Resources/resources/jre/bin/java`.
Interactive macOS smoke may prove only the behaviors actually exercised with
that built artifact and real sample inputs. Keep Windows atomic replacement,
Linux compositor/drop behavior, Developer ID notarization, Authenticode, and
public release publication as separate external gates in
[PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md).

## Build Linux

For release artifacts, prefer Docker from any host. Future `v*` tags run the
`Linux Release` workflow, which calls the same matrix script on
`ubuntu-latest` for Ubuntu 22.04 and Ubuntu 24.04, then uploads the staged
release assets.

```bash
docker/build-linux-matrix.sh --arch amd64 --bundles appimage,deb
```

The matrix builds Ubuntu 22.04, Ubuntu 24.04, and Ubuntu 26.04 separately so
GTK, WebKit, OpenSSL, and glibc-linked dependencies cannot overwrite each
other. Artifacts land in:

```text
artifacts/linux/ubuntu22.04-amd64/
artifacts/linux/ubuntu24.04-amd64/
artifacts/linux/ubuntu26.04-amd64/
```

For single-target debugging:

```bash
docker/build-linux-docker.sh --arch amd64 --ubuntu 22.04 --bundles appimage,deb
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

Future `v*` tags run the `macOS Release` workflow on `macos-15`, which calls
the macOS distribution verifier for Apple Silicon and uploads the DMG plus
`install-macos.sh`.

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

Future release tags build and upload platform assets through:

- `macOS Release` (`.github/workflows/macos-release.yml`).
- `Linux Release` (`.github/workflows/linux-release.yml`).
- `Windows Release` (`.github/workflows/windows-release.yml`).

Current release focus:

- macOS Apple Silicon DMG.
- Linux x86_64 Ubuntu 22.04 LTS AppImage/deb.
- Linux x86_64 Ubuntu 24.04 LTS AppImage/deb.
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
