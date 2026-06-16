# LDiff

**LDiff** is a Tauri desktop tool for inspecting, comparing, and staging merges
between JAR/ZIP archives and folders. Decompiled Java is always read-only; a
merge copies the original entry bytes, never the decompiled view.

- **Inspect** — open a `.jar`, `.zip`, or folder and browse its entry tree with
  lazy index/read, detected text languages, and binary size/CRC/SHA-256 detail.
- **Compare** — CRC tree diff between two archives or folders with aligned diff
  rows, Monaco source/bytecode diff, and text/hex preview.
- **Merge** — stage original entry bytes from one side to the other, review
  pending changes, then save atomically with an optional `.bak` backup.
- **Decompile** — Vineflower source by default, CFR as an alternate engine, and
  ASM bytecode through an isolated JVM sidecar that may degrade independently
  when the JVM is absent.

> This README has two parts. **[For Users](#for-users)** if you just want to
> install and run LDiff. **[For Developers](#for-developers)** if you want to
> build it from source or contribute.

---

# For Users

> **Prebuilt downloads are available.** Grab the installer for your platform
> from the [**Releases**](https://github.com/lyokha113/ldiff/releases/latest)
> page — no toolchain or build step required. Prefer building from source? Skip
> to [Build and run](#build-and-run).

## Download and install (prebuilt)

Each release ships an installer per platform plus a matching `install-*.sh`
helper that places the app where your system expects it (so you don't copy
files by hand).

### macOS (Apple Silicon)

1. Download `LDiff-<version>-aarch64.dmg` and `install-macos.sh` from the
   [latest release](https://github.com/lyokha113/ldiff/releases/latest).
2. Run the installer (both files in the same folder):

   ```bash
   bash install-macos.sh                 # copies LDiff.app to /Applications
   LDIFF_LINK_CLI=1 bash install-macos.sh   # also adds an `ldiff` CLI launcher
   ```

   LDiff is **unsigned** (no Apple Developer ID), so the script clears the
   Gatekeeper quarantine flag for you. Without it macOS reports the app as
   "damaged". To do it by hand instead: drag `LDiff.app` to `/Applications`,
   then `xattr -dr com.apple.quarantine /Applications/LDiff.app`.

3. Launch from Spotlight/Launchpad, or `open -a LDiff`.

### Linux (Ubuntu 22.04+ / glibc 2.35+)

Two artifacts ship: a portable **AppImage** (runs on any recent distro) and a
**`.deb`** (Debian/Ubuntu). The `install-linux.sh` helper handles either —
pass it whichever you downloaded:

```bash
bash install-linux.sh LDiff_<version>_amd64.AppImage   # -> ~/.local/bin/ldiff + app menu entry
bash install-linux.sh LDiff_<version>_amd64.deb        # -> system install via apt (sudo)
```

The AppImage path needs no root and adds an `ldiff` command plus a desktop
entry. On Wayland, if drag-and-drop misbehaves, launch with
`GDK_BACKEND=x11 ldiff`.

> The Linux release is built for **x86_64**. For ARM Linux, build from source
> (see [For Developers](#building-and-packaging-linux)).

---

> The rest of this section is for running from source instead of a download.

## Prerequisites

Install these first (one-time setup):

- **Rust** toolchain — <https://rustup.rs>
- **Node.js 18+ / npm** — <https://nodejs.org>
- **Java 17 JDK with `jlink`** (e.g. Temurin 17) — needed for the decompiler.
- **Maven** — builds the decompiler sidecar.
- **macOS only:** Xcode Command Line Tools (`xcode-select --install`).

Verify they are on your `PATH`:

```bash
rustc --version
node --version
mvn --version
jlink --version   # must report 17 or newer
```

## Get the source

```bash
git clone https://github.com/lyokha113/ldiff.git
cd ldiff
```

To update later, pull the latest and rebuild:

```bash
git pull
npm install
LDIFF_JLINK="$(command -v jlink)" scripts/assemble-sidecar-resources.sh
```

## Build and run

```bash
# 1. Install frontend dependencies
npm install

# 2. Build the JVM decompiler sidecar and its bundled runtime
LDIFF_JLINK="$(command -v jlink)" scripts/assemble-sidecar-resources.sh

# 3. Launch the desktop app
npm run tauri -- dev
```

Step 2 is required for **Decompile** and **bytecode** views to work. If you skip
it, LDiff still opens, inspects, diffs, and merges archives — only the JVM-backed
decompiler degrades. Run it once; re-run only after pulling sidecar changes.

`npm run tauri -- dev` opens LDiff in a native window with hot reload. The first
run compiles the Rust host, so it takes a few minutes; later launches are fast.

### Want a standalone app you can double-click?

Build a bundle for your platform instead of running in dev mode:

```bash
npm run tauri -- build --bundles app    # macOS .app
```

The output lands under `target/<...>/bundle/`. Full per-platform packaging,
signing, and notarization steps are in **[For Developers](#building-and-packaging-macos)**.

On Wayland (Linux), Browse and path input are the most reliable ways to open
files. If drag-and-drop misbehaves, launch under XWayland (`GDK_BACKEND=x11`).

## Using LDiff

1. **Open** — use **Browse**, paste a path, or drag a `.jar` / `.zip` / folder
   onto a panel.
2. **Inspect (Single mode)** — click an entry to preview decompiled source,
   bytecode, or a text/hex view. Java sources are read-only.
3. **Compare mode** — open a second archive/folder on the right; matching entries
   align and changed rows are highlighted with a CRC tree diff.
4. **Search** — fast path/text/constant-pool search across the open source in
   Single mode or both sides in Compare mode, plus an opt-in deep decompiled
   source search with clickable results.
5. **Merge** — use the arrow buttons or row context menu to stage original bytes
   from one side to the other. Pending changes show a badge until you save.
6. **Save** — writes atomically. Enable the backup option to keep a `.bak`.
   LDiff warns before saving over a signed JAR and before discarding staged
   changes.

---

# For Developers

Everything below is for building LDiff from source and contributing.

## Architecture

```text
React + shadcn/ui + Tailwind + Monaco   (view + intent emitter)
        |  Tauri IPC
Rust src-tauri  (commands, async adapters)
        |
Rust ldiff-core  (archive state, staged bytes, CRC diff, search, save)
        |  framed stdio
JVM decompiler sidecar  (Vineflower default / CFR / ASM, jlink Java 17)
```

The frontend never owns bytes. Rust owns archive state, staged changes, and the
atomic save path. Decompilation lives behind the sidecar boundary and may
degrade independently when the JVM sidecar is absent. See
`docs/ARCHITECTURE.md` for the boundary rules.

LDiff is built from four layers:

- **Rust `ldiff-core`** — validated open for JAR/ZIP files and folders, lazy
  index/read, CRC tree diff, normalized-path duplicate rejection, constant-pool
  search, text search, staged copy, signed-JAR detection, atomic archive save,
  folder target copy, and `.bak` backup.
- **Rust `ldiff-cli`** — headless `list`, `diff`, `read`, `search`, and `copy`
  smoke adapter over `ldiff-core`.
- **Tauri + React shell** — shadcn/ui + Tailwind v4 + Monaco UI with native
  picker, file drop, resizable tree/editor panels, context-menu merge actions,
  staged copy, signed-save confirmation, and async adapters for
  ZIP/folder/decompiler long operations.
- **JVM decompiler sidecar** — Vineflower source by default, CFR source as an
  alternate engine, and ASM bytecode over framed stdio with a versioned LRU
  cache and a bundled Java 17 jlink JRE.

## Repository Layout

```text
ldiff/
  crates/
    ldiff-core/   Rust archive engine (open, diff, search, stage, save)
    ldiff-cli/    headless smoke adapter over ldiff-core
  src-tauri/      Tauri v2 host: IPC commands, bundle config, capabilities
  src/            React + Monaco frontend (App.tsx, components, lib)
  sidecar/        JVM decompiler (Maven, CFR/Vineflower/ASM)
  scripts/        build, sign, package, and verification scripts
  platform-validation/  per-platform distribution evidence reports
  docs/           product documentation
```

## Prerequisites

Current build targets are **Linux** (Ubuntu / Arch) and **macOS**.

- **Rust** toolchain with the target you intend to build
  (`aarch64-apple-darwin` is the primary macOS target).
- **Node.js / npm** for the frontend and verifier scripts.
- **Java 17 JDK** with `jlink` for the decompiler sidecar and bundled runtime.
- **Maven** to build the sidecar jar.
- **Linux:** GTK 3 + WebKit2GTK 4.1 system libraries. `scripts/build-linux.sh`
  installs them for you (apt or pacman) — see
  [Building and Packaging (Linux)](#building-and-packaging-linux).
- **macOS only:** Xcode Command Line Tools (`codesign`, `hdiutil`, `xcrun`,
  `ditto`) for signing, packaging, and verification.

## Getting Started

Install dependencies and run the desktop app in development mode:

```bash
npm install
npm run tauri -- dev
```

The headless Rust CLI is useful for quick checks without the desktop shell:

```bash
cargo run -p ldiff-cli -- list path/to/archive.jar
cargo run -p ldiff-cli -- diff path/to/left.jar path/to/right.jar
```

## Developer Checks

Run these before sending changes. They mirror what CI enforces.

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm run verify:all
npm run verify:frontend-render
```

- `npm run verify:all` runs the frontend build plus the release, packaging, CI,
  frontend-invariant, frontend-render, and docs verifiers.
- `npm run verify:frontend-render` boots the Vite shell under Playwright and
  fails on any browser page error.

Build the JVM sidecar and assemble its bundled resources:

```bash
mvn -f sidecar/pom.xml clean package -DskipTests
LDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  scripts/assemble-sidecar-resources.sh
scripts/test-sidecar-smoke.sh
```

## Building and Packaging (Linux)

Build on the target Linux machine — Linux bundles cannot be cross-built from
macOS. One script installs the GTK/WebKit deps, assembles the sidecar, and
builds the bundles on both Ubuntu and Arch:

```bash
scripts/build-linux.sh                 # apt or pacman deps, then AppImage + deb
scripts/build-linux.sh --no-deps       # skip dep install if already present
scripts/build-linux.sh --bundles appimage
```

System dependencies it installs:

- **Ubuntu/Debian (apt):** `build-essential curl wget file libwebkit2gtk-4.1-dev
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev
  patchelf`.
- **Arch (pacman):** `base-devel curl wget file webkit2gtk-4.1 gtk3
  libappindicator-gtk3 librsvg xdotool openssl patchelf`.

Bundles land under `target/release/bundle/` (`appimage/*.AppImage`, `deb/*.deb`).
The **AppImage** is the portable artifact for both distros; the `.deb` targets
Debian/Ubuntu.

### Cross-building Linux bundles from macOS (Docker)

Linux bundles cannot be cross-built natively from macOS, but you can build them
in an Ubuntu container with every dependency baked in:

```bash
docker/build-linux-docker.sh                 # host arch (arm64 on Apple Silicon)
docker/build-linux-docker.sh --arch amd64    # x86_64 bundle (the release target)
docker/build-linux-docker.sh --arch amd64 --bundles appimage,deb
```

The wrapper runs `scripts/build-linux.sh --no-deps` inside the image, builds a
Linux jlink JRE in-container (so the bundled runtime has the right arch), and
keeps your host `node_modules/` and `target/` untouched via named volumes.
`docker/run-linux-docker.sh` launches the built AppImage headlessly under Xvfb
and screenshots it to prove the GUI renders. The full release flow is in
[`docs/RELEASING.md`](docs/RELEASING.md).

On Wayland, prefer Browse and path input to open files; if
drag-and-drop misbehaves, relaunch under XWayland with
`LDIFF_FORCE_XWAYLAND=1 scripts/launch-linux-xwayland.sh /path/to/LDiff`.

Linux builds are unsigned; there is no Linux code-signing step.

## Building and Packaging (macOS)

The primary local target is `aarch64-apple-darwin`. Build a debug app bundle:

```bash
npm run tauri -- build --debug --bundles app
```

Intel macOS builds require `LDIFF_JLINK_X86_64_APPLE_DARWIN` to point at an
x86_64 JDK/jlink.

Sign, notarize, and package the bundle **in this order** (signing first,
notarization second, DMG packaging last):

```bash
scripts/sign-macos-bundle.sh \
  "$PWD/target/debug/bundle/macos/LDiff.app" \
  - \
  "$PWD/target/debug/bundle/macos/LDiff-signed.app"

APPLE_ID=you@example.com \
APPLE_TEAM_ID=TEAMID1234 \
APPLE_APP_PASSWORD=app-specific-password \
  scripts/notarize-macos-app.sh "$PWD/target/debug/bundle/macos/LDiff-signed.app"

scripts/package-macos-dmg.sh \
  "$PWD/target/debug/bundle/macos/LDiff-signed.app" \
  "$PWD/target/debug/bundle/dmg/LDiff-signed.dmg"

scripts/verify-macos-distribution.sh --skip-install
```

Developer ID notarization requires Apple certificate and notary credentials;
without them, local validation uses ad-hoc signing and records notarization as
skipped. The full macOS operator runbook is `docs/OPERATIONS_MACOS.md`.

## Platform Validation (optional)

Validation is **not required** for the current Linux + macOS build focus —
`npm run verify:all` plus the build commands above are enough. The optional
distribution runner writes evidence reports under `platform-validation/`; the
latest local arm64 report is
`platform-validation/macos-distribution-aarch64-apple-darwin-20260606T051217Z.md`.

```bash
scripts/verify-macos-distribution.sh --skip-install
```

The Windows and Linux display-matrix gates are documented in
`docs/PLATFORM_VALIDATION.md` for when those targets come back into scope.

## Release Signing Secrets

Optional, only for signed/notarized **macOS** release builds (Linux bundles are
unsigned):

- `MACOS_CERTIFICATE_BASE64` — base64-encoded Developer ID Application `.p12`.
- `MACOS_CERTIFICATE_PASSWORD` — password for that `.p12`.
- `MACOS_KEYCHAIN_PASSWORD` — temporary CI keychain password.
- `MACOS_SIGN_IDENTITY` — Developer ID Application identity name.
- `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` — `notarytool` credentials.

## Documentation Map

Product and build references:

- `docs/ARCHITECTURE.md` — application shape and boundary rules.
- `docs/LDIFF_IMPLEMENTATION_PLAN.md` — implementation plan.
- `docs/LDIFF_COMPLETION_AUDIT.md` — completion audit with proof evidence.
- `docs/PLATFORM_VALIDATION.md` — external platform validation gates.
- `docs/OPERATIONS_MACOS.md` — macOS sign / notarize / package / verify runbook.
- `docs/RELEASING.md` — end-to-end release runbook (macOS + Linux artifacts).
- `docs/GLOSSARY.md` — shared terms.

## Contributing

1. Read `CLAUDE.md` and `docs/ARCHITECTURE.md` before changing code.
2. Run the full developer checks above, including `npm run verify:all`.
3. Keep `docs/LDIFF_COMPLETION_AUDIT.md` in sync with new behavior;
   `npm run verify:docs` enforces documentation invariants.
4. For Linux/macOS builds, confirm the bundle builds via `scripts/build-linux.sh`
   or `npm run tauri -- build`. A `platform-validation/` evidence report is
   optional and only expected when a platform gate is back in scope.
