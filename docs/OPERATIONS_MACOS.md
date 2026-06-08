# macOS Operations Runbook

This runbook is the macOS-first build, verification, signing, notarization, and
packaging path for `LDiff`.

## Current Scope

- macOS `aarch64-apple-darwin` is the primary local build target.
- The latest local arm64 distribution evidence is
  `platform-validation/macos-distribution-aarch64-apple-darwin-20260606T051217Z.md`.
- macOS `x86_64-apple-darwin` requires an Intel JDK/jlink path through
  `LDIFF_JLINK_X86_64_APPLE_DARWIN`.
- Developer ID notarization requires Apple certificate and notary credentials.
  Without those credentials, local validation uses ad-hoc signing and records
  notarization as skipped.

## Prerequisites

Install or expose:

- Rust toolchain with the required macOS target.
- Node.js/npm.
- Java 17 JDK with `jlink`.
- Xcode Command Line Tools: `codesign`, `hdiutil`, `xcrun`, and `ditto`.

For Apple Developer ID release signing, provide:

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_KEYCHAIN_PASSWORD`
- `MACOS_SIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_PASSWORD`

## Fast Local Development

```bash
npm ci
npm run verify:all
LDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  scripts/assemble-sidecar-resources.sh
scripts/test-sidecar-smoke.sh
npm run tauri -- dev
```

## Build A Debug App Bundle

```bash
LDIFF_JLINK="$(mise where java@temurin-17.0.18+8)/bin/jlink" \
  scripts/assemble-sidecar-resources.sh
npm run tauri -- build --debug --bundles app
```

Expected debug bundle:

```text
target/debug/bundle/macos/LDiff.app
```

## Full macOS Distribution Validation

Run the full macOS arm64 path:

```bash
scripts/verify-macos-distribution.sh \
  --target aarch64-apple-darwin \
  --skip-install
```

If an app bundle already exists and only signing/DMG/report validation is being
rechecked:

```bash
scripts/verify-macos-distribution.sh \
  --target aarch64-apple-darwin \
  --skip-install \
  --skip-build
```

Run the Intel target only with an Intel JDK/jlink:

```bash
LDIFF_JLINK_X86_64_APPLE_DARWIN=/path/to/x64-jdk/bin/jlink \
  scripts/verify-macos-distribution.sh \
    --target x86_64-apple-darwin \
    --skip-install
```

The runner writes:

```text
platform-validation/macos-distribution-*.md
```

Expected release outputs:

```text
target/aarch64-apple-darwin/release/bundle/macos/LDiff.app
target/aarch64-apple-darwin/release/bundle/dmg/LDiff-aarch64-apple-darwin.dmg
target/x86_64-apple-darwin/release/bundle/macos/LDiff.app
target/x86_64-apple-darwin/release/bundle/dmg/LDiff-x86_64-apple-darwin.dmg
```

When the repo is under a File Provider managed path such as `Documents`, macOS
may attach Finder metadata to `.app` bundles inside the workspace. The
distribution runner signs, verifies, and packages a temporary validation app
under `/tmp`, then writes the DMG and report back to the workspace.

## Signing Modes

Ad-hoc local signing is the default:

```bash
scripts/verify-macos-distribution.sh \
  --target aarch64-apple-darwin \
  --sign-identity - \
  --skip-install
```

Developer ID signing:

```bash
MACOS_SIGN_IDENTITY="Developer ID Application: Example Corp (TEAMID1234)" \
  scripts/verify-macos-distribution.sh \
    --target aarch64-apple-darwin \
    --skip-install
```

Notarization runs automatically only when `APPLE_ID`, `APPLE_TEAM_ID`,
`APPLE_APP_PASSWORD`, and a non-ad-hoc `MACOS_SIGN_IDENTITY` are present.

Manual script order, when debugging the distribution path:

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
```

## Verification Checklist

- `npm run verify:all` passes.
- `scripts/test-sidecar-smoke.sh` passes after JRE assembly.
- Selected JDK `java`, app executable, and bundled `jre/bin/java` are Mach-O
  binaries matching the requested target architecture.
- `codesign --verify --deep --strict` passes for the signed app, final app, and
  mounted DMG app.
- Entitlements include:
  - `com.apple.security.cs.allow-jit`
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.cs.disable-library-validation`
- `hdiutil verify` passes for the DMG.
- Mounted DMG contains `LDiff.app` and an `Applications` symlink.
- Developer ID releases also pass notarization, stapling, and Gatekeeper
  assessment through `scripts/notarize-macos-app.sh`.

## Troubleshooting

- `expected LDIFF_JLINK java to be a Mach-O x86_64 binary`: the Intel build is
  using an arm64 JDK. Set `LDIFF_JLINK_X86_64_APPLE_DARWIN` to an Intel JDK's
  `bin/jlink`.
- Notarization is skipped: confirm `APPLE_ID`, `APPLE_TEAM_ID`,
  `APPLE_APP_PASSWORD`, and a non-`-` `MACOS_SIGN_IDENTITY`.
- Strict codesign fails after copying: avoid Finder/manual copies. Use
  `scripts/verify-macos-distribution.sh` or `scripts/package-macos-dmg.sh`,
  which strip extended attributes before verification.
- Strict codesign fails only for a workspace `.app` under `Documents`: trust the
  distribution runner's temporary validation app and mounted-DMG checks. The
  workspace path can receive File Provider metadata after copy.
- LaunchServices errors in a sandboxed automation session are not sufficient
  release evidence. Use mounted-DMG contents plus `codesign --verify --deep
  --strict` and the generated `platform-validation/macos-distribution-*.md`
  report.

## macOS-First Definition Of Done

- Arm64 distribution report exists and passes.
- Intel distribution report exists only if Intel delivery is required.
- Developer ID notarized report exists only if public distribution outside local
  testing is required.
