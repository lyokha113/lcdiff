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
- **Decompile** — CFR / Vineflower source and ASM bytecode through an isolated
  JVM sidecar that may degrade independently when the JVM is absent.

> This README has two parts. **[For Users](#for-users)** if you just want to
> install and run LDiff. **[For Developers](#for-developers)** if you want to
> build it from source or contribute.

---

# For Users

You do not need Rust, Node, or Java installed — the released app bundles its own
JVM runtime.

## Install

Download the latest installer for your platform from the project's **Releases**
page, then:

### macOS

1. Download `LDiff-<arch>.dmg` (`aarch64` for Apple Silicon, `x86_64` for Intel).
2. Open the DMG and drag **LDiff** into `Applications`.
3. First launch: right-click **LDiff** → **Open** to clear Gatekeeper if the
   build is not notarized.

### Windows

1. Download the LDiff installer (`.msi` or `.exe`).
2. Run it and follow the prompts.

### Linux

1. Download the LDiff AppImage (or the `.deb` for Debian/Ubuntu).
2. Make it executable and run it:

   ```bash
   chmod +x LDiff-*.AppImage
   ./LDiff-*.AppImage
   ```

   On Wayland, Browse and path input are the most reliable ways to open files.
   If drag-and-drop misbehaves, launch under XWayland (`GDK_BACKEND=x11`).

## Using LDiff

1. **Open** — use **Browse**, paste a path, or drag a `.jar` / `.zip` / folder
   onto a panel.
2. **Inspect (Single mode)** — click an entry to preview decompiled source,
   bytecode, or a text/hex view. Java sources are read-only.
3. **Compare mode** — open a second archive/folder on the right; matching entries
   align and changed rows are highlighted with a CRC tree diff.
4. **Search** — fast path/text/constant-pool search, plus an opt-in deep source
   search (left / right / both) with clickable streaming results.
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
JVM decompiler sidecar  (CFR / Vineflower / ASM, jlink Java 17)
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
- **JVM decompiler sidecar** — CFR / Vineflower / ASM over framed stdio with a
  versioned LRU cache and a bundled Java 17 jlink JRE.

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

- **Rust** toolchain with the target you intend to build
  (`aarch64-apple-darwin` is the primary local target).
- **Node.js / npm** for the frontend and verifier scripts.
- **Java 17 JDK** with `jlink` for the decompiler sidecar and bundled runtime.
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

## Platform Validation

Each platform has an external validation runner that writes evidence under
`platform-validation/`. The latest local arm64 distribution report is
`platform-validation/macos-distribution-aarch64-apple-darwin-20260606T051217Z.md`.

**macOS distribution:**

```bash
scripts/verify-macos-distribution.sh --skip-install
```

**Windows platform:**

```powershell
scripts\verify-windows-platform.ps1
scripts\verify-windows-platform.ps1 -SkipInstall -SignIfSecretsPresent
```

**Linux display matrix** (the Wayland file-drop fallback forces
`GDK_BACKEND=x11` only when a Wayland session is detected; Browse and path input
remain the primary reliable open paths):

```bash
LDIFF_FORCE_XWAYLAND=1 \
  scripts/launch-linux-xwayland.sh /path/to/LDiff
scripts/verify-linux-display-matrix.sh --app /path/to/LDiff --sample /path/to/sample.jar
```

## Release Signing Secrets

These are optional and only needed for signed release builds.

**macOS:**

- `MACOS_CERTIFICATE_BASE64` — base64-encoded Developer ID Application `.p12`.
- `MACOS_CERTIFICATE_PASSWORD` — password for that `.p12`.
- `MACOS_KEYCHAIN_PASSWORD` — temporary CI keychain password.
- `MACOS_SIGN_IDENTITY` — Developer ID Application identity name.
- `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` — `notarytool` credentials.

**Windows:**

- `WINDOWS_CERTIFICATE_BASE64` — base64-encoded Authenticode `.pfx`.
- `WINDOWS_CERTIFICATE_PASSWORD` — password for that `.pfx`.
- `WINDOWS_TIMESTAMP_URL` — timestamp server URL; defaults to DigiCert when
  omitted.

## Documentation Map

Product and build references:

- `docs/ARCHITECTURE.md` — application shape and boundary rules.
- `docs/LDIFF_IMPLEMENTATION_PLAN.md` — implementation plan.
- `docs/LDIFF_COMPLETION_AUDIT.md` — completion audit with proof evidence.
- `docs/PLATFORM_VALIDATION.md` — external platform validation gates.
- `docs/OPERATIONS_MACOS.md` — macOS sign / notarize / package / verify runbook.
- `docs/GLOSSARY.md` — shared terms.

## Contributing

1. Read `CLAUDE.md` and `docs/ARCHITECTURE.md` before changing code.
2. Run the full developer checks above, including `npm run verify:all`.
3. Keep `docs/LDIFF_COMPLETION_AUDIT.md` in sync with new behavior;
   `npm run verify:docs` enforces documentation invariants.
4. For platform-affecting changes, attach a `platform-validation/` evidence
   report from the relevant runner.
