# Releasing LCDiff

End-to-end runbook for cutting a tagged GitHub release with macOS, Linux, and
Windows artifacts. Targets the current build focus: **macOS (Apple Silicon)**,
**Linux (x86_64, Ubuntu 24.04 LTS and Ubuntu 26.04 LTS)**, and **Windows 10/11
x64**.

## Artifacts per release

| Platform | File | Built where |
| --- | --- | --- |
| macOS arm64 | `LCDiff-<version>-aarch64.dmg` | locally on macOS |
| Linux x86_64 / Ubuntu 24.04 LTS | `artifacts/linux/ubuntu24.04-amd64/appimage/LCDiff_<version>_amd64.AppImage` | Docker (`ubuntu:24.04`) |
| Linux x86_64 / Ubuntu 24.04 LTS | `artifacts/linux/ubuntu24.04-amd64/deb/LCDiff_<version>_amd64.deb` | Docker (`ubuntu:24.04`) |
| Linux x86_64 / Ubuntu 26.04 LTS | `artifacts/linux/ubuntu26.04-amd64/appimage/LCDiff_<version>_amd64.AppImage` | Docker (`ubuntu:26.04`) |
| Linux x86_64 / Ubuntu 26.04 LTS | `artifacts/linux/ubuntu26.04-amd64/deb/LCDiff_<version>_amd64.deb` | Docker (`ubuntu:26.04`) |
| Windows 10/11 x64 | `LCDiff-<version>-windows-x64-setup.exe` | GitHub Actions (`windows-latest`) |
| Arch Linux | `aur/lcdiff/PKGBUILD` | AUR (`yay` / `paru`) |
| Installers | `install-macos.sh`, `install-linux.sh` | committed in `scripts/` |

The install scripts ship as release assets so users get them next to the
binaries without cloning the repo. Arch Linux uses the AUR package in
`aur/lcdiff/` instead of a GitHub release asset.

## 1. Pick the version

The version lives in three manifests, kept in sync:

- `src-tauri/tauri.conf.json` (`version`)
- `Cargo.toml` (workspace `version`)
- `package.json` (`version`)

Bump all three for a new version, commit, then tag `v<version>`.

## 2. Build the macOS bundle (on macOS)

```bash
npm install
LCDIFF_JLINK="$(command -v jlink)" scripts/assemble-sidecar-resources.sh
npm run tauri -- build --bundles app
```

Ad-hoc sign and package the DMG (unsigned distribution — no Apple Developer
ID). The macOS step order is always **sign, then notarize, then package DMG**;
with ad-hoc signing the notarize step is skipped:

```bash
scripts/sign-macos-bundle.sh \
  "$PWD/target/release/bundle/macos/LCDiff.app" \
  - \
  "$PWD/target/release/bundle/macos/LCDiff-signed.app"

scripts/package-macos-dmg.sh \
  "$PWD/target/release/bundle/macos/LCDiff-signed.app" \
  "$PWD/target/release/bundle/dmg/LCDiff-<version>-aarch64.dmg"
```

For a Gatekeeper-clean signed/notarized build instead, supply Developer ID
credentials and run `scripts/notarize-macos-app.sh` between the two commands —
see `docs/OPERATIONS_MACOS.md`.

## 3. Build the Linux bundles (Docker, from any host)

```bash
docker/build-linux-matrix.sh --arch amd64 --bundles appimage,deb
```

This builds separately inside `ubuntu:24.04` and `ubuntu:26.04`, giving the GTK,
WebKit, OpenSSL, and glibc-linked desktop stack its own dependency floor per
supported Ubuntu LTS version. The bundled jlink JRE is built inside each Linux
container, so it matches Linux x86_64 instead of the host. The matrix script
copies artifacts to:

```bash
artifacts/linux/ubuntu24.04-amd64/
artifacts/linux/ubuntu26.04-amd64/
```

For a single target while debugging:

```bash
docker/build-linux-docker.sh --arch amd64 --ubuntu 24.04 --bundles appimage,deb
docker/build-linux-docker.sh --arch amd64 --ubuntu 26.04 --bundles appimage,deb
```

(Optional) prove the GUI renders headlessly after a single-target build:
`docker/run-linux-docker.sh`.

## 3.5 Build the Windows installer (GitHub Actions)

Windows is phase-1 CI-built. Push a `v<version>` tag and the
`Windows Release` workflow builds an unsigned NSIS installer on
`windows-latest`, uploads it as a workflow artifact, and attaches it to the
matching GitHub Release:

```text
LCDiff-<version>-windows-x64-setup.exe
```

To run the same build on a Windows machine:

```powershell
scripts\build-windows.ps1
```

Signing is optional. Configure `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` repository secrets to enable Authenticode
signing in the workflow.

## 3.6 Publish the AUR package

Update `aur/lcdiff/PKGBUILD` and `aur/lcdiff/.SRCINFO` when the version changes,
then push the AUR repo separately from the GitHub release. Arch users install
it with `yay -S lcdiff` or `paru -S lcdiff`.

## 4. Publish the release

Stage every artifact under one folder, then create the tagged release:

```bash
gh release create v<version> \
  artifacts/macos/LCDiff-<version>-aarch64.dmg \
  artifacts/linux/ubuntu24.04-amd64/appimage/LCDiff_<version>_amd64.AppImage \
  artifacts/linux/ubuntu24.04-amd64/deb/LCDiff_<version>_amd64.deb \
  artifacts/linux/ubuntu26.04-amd64/appimage/LCDiff_<version>_amd64.AppImage \
  artifacts/linux/ubuntu26.04-amd64/deb/LCDiff_<version>_amd64.deb \
  scripts/install-macos.sh \
  scripts/install-linux.sh \
  --title "LCDiff v<version>" \
  --notes-file docs/release-notes/v<version>.md
```

## 5. Verify the published release

- macOS: download the DMG + `install-macos.sh`, run `bash install-macos.sh`,
  confirm `open -a LCDiff` launches.
- Linux: download the AppImage or `.deb` matching the Ubuntu LTS floor plus
  `install-linux.sh`, run `bash install-linux.sh LCDiff_<version>_amd64.AppImage`
  or `bash install-linux.sh LCDiff_<version>_amd64.deb`, confirm `lcdiff` runs.
- Windows: download `LCDiff-<version>-windows-x64-setup.exe`, install it on
  Windows 10 or 11, confirm LCDiff launches and decompile/bytecode views work.
- Arch Linux: install from AUR with `yay -S lcdiff`, confirm `lcdiff` runs.

## Notes

- Linux bundles are unsigned; there is no Linux code-signing step.
- Windows NSIS installers are unsigned until Authenticode secrets are configured
  for the GitHub Actions workflow; unsigned builds may trigger SmartScreen.
- Arch Linux uses the AUR package, not a GitHub release asset.
- Ubuntu release assets are intentionally split by LTS floor. Do not collapse
  24.04 and 26.04 artifacts into one Linux directory because linked GTK/WebKit
  dependencies can drift across distro releases.
- ARM Linux is not a release target — build from source with
  `docker/build-linux-docker.sh --arch arm64 --ubuntu 26.04` if needed.
- Run the developer checks (`npm run verify:all`,
  `npm run verify:frontend-render`) before tagging.
