# Platform Validation

This file is the handoff checklist for gates that cannot be proven from a
single macOS local workspace.

## Windows Atomic Replace

Run on `windows-2022` or a Windows 11 machine with Rust, Node, Java 17, Git
Bash, and the Windows SDK available:

```powershell
scripts\verify-windows-platform.ps1
```

Pass evidence:

- `scripts\verify-windows-platform.ps1` passes on Windows.
- `cargo test --workspace` passes on Windows, proving the merge commit path uses
  `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` for target
  overwrite semantics.
- CLI smoke proves copy with `--backup` rewrites the target and preserves the
  overwritten `.bak`.
- Built NSIS/MSI artifacts exist under `target/<target>/debug/bundle/` or
  `target/<target>/release/bundle/`.

## Windows Signing

Configure repository secrets:

- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`
- Optional `WINDOWS_TIMESTAMP_URL`

Then run the release workflow on `windows-2022`.

For a local signed Windows validation run after bundles are built:

```powershell
scripts\verify-windows-platform.ps1 -SkipInstall -SignIfSecretsPresent
```

Pass evidence:

- `scripts/sign-windows-bundles.ps1` signs every `.exe` and `.msi` under the
  bundle directory.
- `signtool verify /pa /v` passes for every signed artifact.
- Uploaded artifacts include signed installer bundles.

## Linux Display Matrix

Run the same Tauri bundle on:

| Desktop | Session | Required checks |
| --- | --- | --- |
| GNOME / Mutter | Wayland | Browse open, path input open, OS file drop, optional XWayland fallback |
| GNOME / Mutter | X11 | Browse open, path input open, OS file drop |
| KDE / KWin | Wayland | Browse open, path input open, OS file drop, optional XWayland fallback |
| KDE / KWin | X11 | Browse open, path input open, OS file drop |
| Sway / wlroots | Wayland | Browse open, path input open, OS file drop, optional XWayland fallback |

On each environment, record evidence with:

```bash
scripts/verify-linux-display-matrix.sh --app /path/to/jdiff --sample /path/to/sample.jar
```

The script writes a timestamped Markdown report under `platform-validation/`.

For Wayland fallback runs:

```bash
JDIFF_FORCE_XWAYLAND=1 scripts/launch-linux-xwayland.sh /path/to/jdiff
```

Pass evidence:

- A `platform-validation/linux-display-*.md` report exists for each required
  desktop/session row.
- Browse and path input open a valid `.jar` or `.zip` on every environment.
- If OS file drop fails on native Wayland, record the compositor/session and
  verify that Browse/path input still work.
- If `JDIFF_FORCE_XWAYLAND=1` is supported by the environment, record whether
  OS file drop recovers under XWayland.

## macOS Developer ID Notarization

For the macOS-first operator path, including local dev, arm64 distribution,
Intel JDK selection, signing modes, DMG packaging, and troubleshooting, use
`docs/OPERATIONS_MACOS.md`.

Configure repository secrets:

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_KEYCHAIN_PASSWORD`
- `MACOS_SIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_PASSWORD`

Then run the release workflow on macOS targets.

For local macOS distribution validation:

```bash
scripts/verify-macos-distribution.sh --target aarch64-apple-darwin
scripts/verify-macos-distribution.sh --target x86_64-apple-darwin
```

When cross-building on macOS, provide a target-specific JDK/jlink path if the
default `JDIFF_JLINK` does not match the requested target:

```bash
JDIFF_JLINK_X86_64_APPLE_DARWIN=/path/to/x64-jdk/bin/jlink \
  scripts/verify-macos-distribution.sh --target x86_64-apple-darwin
```

The runner signs inside-out, strips extended attributes before strict signature
verification, notarizes when Developer ID and Apple notary credentials are
present, promotes the final `jdiff.app`, packages the DMG, verifies the
post-DMG app, mounts the DMG, verifies the mounted `jdiff.app`, and writes
`platform-validation/macos-distribution-*.md`.

Pass evidence:

- `scripts/verify-macos-distribution.sh` passes for each macOS target.
- A `platform-validation/macos-distribution-*.md` report exists for each macOS
  target.
- The selected JDK `java`, app executable, and bundled `jre/bin/java` are Mach-O
  binaries matching the requested target architecture (`arm64` for
  `aarch64-apple-darwin`, `x86_64` for `x86_64-apple-darwin`).
- `scripts/sign-macos-bundle.sh` produces `jdiff-signed.app`.
- `codesign --verify --deep --strict` passes.
- `codesign -d --entitlements - jdiff-signed.app` includes:
  `com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory`, and
  `com.apple.security.cs.disable-library-validation`.
- The final app still passes `codesign --verify --deep --strict` after DMG
  packaging.
- The mounted DMG contains `jdiff.app`, an `Applications` symlink, and the
  mounted app passes `codesign --verify --deep --strict`.
- `scripts/notarize-macos-app.sh jdiff-signed.app` completes, staples the
  ticket, and `spctl --assess --type execute --verbose=4` passes.
- `scripts/package-macos-dmg.sh` creates the uploaded `.dmg` from
  `jdiff.app` after the release workflow promotes `jdiff-signed.app` over that
  final upload path when signing is enabled; unsigned macOS releases keep the
  unsigned `.app`.
- Mounted `.dmg` contains the `.app` bundle and an `Applications` symlink at the
  volume root.

## Remote Release Workflow

Run `.github/workflows/release.yml` with `workflow_dispatch`.

Use the GitHub CLI runner to dispatch and record evidence:

```bash
scripts/verify-remote-release-workflow.sh --dispatch --ref main
```

The runner writes `platform-validation/remote-release-*.md` with run metadata
and uploaded artifact names.

Pass evidence:

- `scripts/verify-remote-release-workflow.sh --dispatch --ref <ref>` passes.
- macOS arm64 and x64 app/dmg artifacts upload.
- Signed macOS workflows upload one final `jdiff.app` bundle path, not both a
  signed and unsigned app bundle.
- Linux AppImage/deb/rpm artifacts upload.
- Windows NSIS/MSI artifacts upload.
- Optional signing/notarization steps run only when their secrets are present;
  unsigned builds still upload when secrets are absent.
- macOS signing steps require the full certificate secret set before importing
  or signing; notarization additionally requires the Apple notary credentials.
