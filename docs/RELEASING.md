# Releasing LCDiff

End-to-end runbook for cutting a tagged GitHub release with macOS, Linux, and
Windows artifacts. Future `v*` tags run GitHub Actions release workflows that
build and upload platform assets automatically. The local commands below are
the same build paths, kept for debugging and manual fallback releases.

Targets the current build focus: **macOS (Apple Silicon)**, **Linux (x86_64,
Ubuntu 22.04 LTS and Ubuntu 24.04 LTS)**, and **Windows 10/11 x64**.

## Artifacts per release

| Platform | File | Built where |
| --- | --- | --- |
| macOS arm64 | `LCDiff-<version>-aarch64.dmg` | GitHub Actions (`macos-15`) or local macOS |
| Linux x86_64 / Ubuntu 22.04 LTS | `LCDiff_<version>_ubuntu22.04_amd64.AppImage` | GitHub Actions (`ubuntu-latest` + Docker `ubuntu:22.04`) or local Docker |
| Linux x86_64 / Ubuntu 22.04 LTS | `LCDiff_<version>_ubuntu22.04_amd64.deb` | GitHub Actions (`ubuntu-latest` + Docker `ubuntu:22.04`) or local Docker |
| Linux x86_64 / Ubuntu 24.04 LTS | `LCDiff_<version>_ubuntu24.04_amd64.AppImage` | GitHub Actions (`ubuntu-latest` + Docker `ubuntu:24.04`) or local Docker |
| Linux x86_64 / Ubuntu 24.04 LTS | `LCDiff_<version>_ubuntu24.04_amd64.deb` | GitHub Actions (`ubuntu-latest` + Docker `ubuntu:24.04`) or local Docker |
| Windows 10/11 x64 | `LCDiff-<version>-windows-x64-setup.exe` | GitHub Actions (`windows-latest`) |
| Arch Linux | `aur/lcdiff/PKGBUILD` | AUR (`yay` / `paru`) |
| Installers | `install-macos.sh`, `install-linux.sh` | committed in `scripts/` |

The install scripts ship as release assets so users get them next to the
binaries without cloning the repo. Arch Linux uses the AUR package in
`aur/lcdiff/` instead of a GitHub release asset.

## In-app updater artifacts

Tagged releases publish signed updater artifacts plus static `latest.json`-style
metadata named per Tauri target, for example:

```text
latest-darwin-aarch64.json
latest-linux-x86_64.json
latest-windows-x86_64.json
```

The app endpoint in `src-tauri/tauri.conf.json` uses
`latest-{{target}}-{{arch}}.json` so the independent platform workflows do not
overwrite one shared manifest. Native update uses signed updater artifacts where
Tauri supports the current package; unsupported packages and failed updater
checks fall back to GitHub Releases.

Required GitHub secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

`src-tauri/tauri.conf.json` keeps `bundle.createUpdaterArtifacts` enabled and
stores the public updater key. The private key must never be committed.

## 1. Pick the version

The version lives in three manifests, kept in sync:

- `src-tauri/tauri.conf.json` (`version`)
- `Cargo.toml` (workspace `version`)
- `package.json` (`version`)

Bump all three for a new version, commit, then tag `v<version>`.

## 2. Build the macOS bundle

Future tags run the `macOS Release` workflow from
`.github/workflows/macos-release.yml`. It builds on `macos-15`, runs:

```bash
scripts/verify-macos-distribution.sh --target aarch64-apple-darwin
```

Then it uploads `LCDiff-<version>-aarch64.dmg` and `install-macos.sh` to the
matching GitHub Release.

For a local/manual macOS build:

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

## 3. Build the Linux bundles

Future tags run the `Linux Release` workflow from
`.github/workflows/linux-release.yml`. It builds the Docker matrix on
`ubuntu-latest`, then stages unique GitHub release asset names:

```text
LCDiff_<version>_ubuntu22.04_amd64.AppImage
LCDiff_<version>_ubuntu22.04_amd64.deb
LCDiff_<version>_ubuntu24.04_amd64.AppImage
LCDiff_<version>_ubuntu24.04_amd64.deb
install-linux.sh
```

For a local/manual Linux build:

```bash
docker/build-linux-matrix.sh --arch amd64 --bundles appimage,deb
```

By default this builds separately inside `ubuntu:22.04`, `ubuntu:24.04`, and
`ubuntu:26.04`, giving the GTK, WebKit, OpenSSL, and glibc-linked desktop stack
its own dependency floor per supported local build target. GitHub Actions
explicitly limits the release matrix to Ubuntu 22.04 and Ubuntu 24.04. The
bundled jlink JRE is built inside each Linux container, so it matches Linux
x86_64 instead of the host. The matrix script copies artifacts to:

```bash
artifacts/linux/ubuntu22.04-amd64/
artifacts/linux/ubuntu24.04-amd64/
artifacts/linux/ubuntu26.04-amd64/
```

For a single target while debugging:

```bash
docker/build-linux-docker.sh --arch amd64 --ubuntu 22.04 --bundles appimage,deb
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
then validate the package on Arch Linux:

```bash
sudo pacman -Syu --needed base-devel git namcap
cd aur/lcdiff
makepkg --verifysource
makepkg --syncdeps --cleanbuild
namcap PKGBUILD
namcap lcdiff-*.pkg.tar.zst
makepkg --printsrcinfo > .SRCINFO
```

The `Linux Release` workflow publishes AUR metadata after the Ubuntu release
matrix succeeds. Its isolated `publish-aur` job checks that `PKGBUILD` and
`.SRCINFO` match the release tag, builds and audits the package in a clean Arch
Linux container, then pushes `PKGBUILD`, `.SRCINFO`, and `LICENSE` to the AUR
`master` branch. Configure the repository secret
`AUR_SSH_PRIVATE_KEY` with a dedicated private key whose public key is registered
on the AUR account. A tag-triggered run publishes metadata from that tag; a
manual dispatch publishes metadata from the selected workflow ref, allowing an
AUR-only correction without moving an existing release tag. Arch users install
it with `yay -S lcdiff` or `paru -S lcdiff`.

## 4. Publish the release

Normal path: push the committed `v<version>` tag. The `macOS Release`,
`Linux Release`, and `Windows Release` workflows attach their assets to the
matching GitHub Release using `docs/release-notes/v<version>.md`.

Manual fallback: stage every artifact under one folder with unique basenames,
then create the tagged release:

```bash
gh release create v<version> \
  artifacts/macos/LCDiff-<version>-aarch64.dmg \
  artifacts/macos/LCDiff-<version>-aarch64.app.tar.gz \
  artifacts/macos/LCDiff-<version>-aarch64.app.tar.gz.sig \
  artifacts/release-linux/LCDiff_<version>_ubuntu22.04_amd64.AppImage \
  artifacts/release-linux/LCDiff_<version>_ubuntu22.04_amd64.AppImage.sig \
  artifacts/release-linux/LCDiff_<version>_ubuntu22.04_amd64.deb \
  artifacts/release-linux/LCDiff_<version>_ubuntu24.04_amd64.AppImage \
  artifacts/release-linux/LCDiff_<version>_ubuntu24.04_amd64.AppImage.sig \
  artifacts/release-linux/LCDiff_<version>_ubuntu24.04_amd64.deb \
  artifacts/windows/LCDiff-<version>-windows-x64-setup.exe \
  artifacts/windows/LCDiff-<version>-windows-x64-setup.exe.sig \
  artifacts/macos/latest-darwin-aarch64.json \
  artifacts/release-linux/latest-linux-x86_64.json \
  artifacts/windows/latest-windows-x86_64.json \
  scripts/install-macos.sh \
  artifacts/release-linux/install-linux.sh \
  --title "LCDiff v<version>" \
  --notes-file docs/release-notes/v<version>.md
```

## 5. Verify the published release

- macOS: download the DMG + `install-macos.sh`, run `bash install-macos.sh`,
  confirm `open -a LCDiff` launches.
- Linux: download the AppImage or `.deb` matching the Ubuntu LTS floor plus
  `install-linux.sh`, run
  `bash install-linux.sh LCDiff_<version>_ubuntu22.04_amd64.AppImage` or
  `bash install-linux.sh LCDiff_<version>_ubuntu22.04_amd64.deb`, confirm
  `lcdiff` runs.
- Windows: download `LCDiff-<version>-windows-x64-setup.exe`, install it on
  Windows 10 or 11, confirm LCDiff launches and decompile/bytecode views work.
- Arch Linux: install from AUR with `yay -S lcdiff`, confirm `lcdiff` runs.
- In-app updater: install the previous LCDiff version, publish a release with
  the matching `latest-<target>-<arch>.json`, then use Preferences > Misc >
  Updates > Check for updates. Confirm native update installs where supported
  and fallback opens GitHub Releases where native update is unavailable.

## Notes

- Linux bundles are unsigned; there is no Linux code-signing step.
- Windows NSIS installers are unsigned until Authenticode secrets are configured
  for the GitHub Actions workflow; unsigned builds may trigger SmartScreen.
- Arch Linux uses the AUR package, not a GitHub release asset.
- Ubuntu release assets are intentionally split by LTS floor. Do not collapse
  22.04 and 24.04 artifacts into one Linux directory because linked GTK/WebKit
  dependencies can drift across distro releases.
- ARM Linux is not a release target — build from source with
  `docker/build-linux-docker.sh --arch arm64 --ubuntu 26.04` if needed.
- Run the developer checks (`npm run verify:all`,
  `npm run verify:frontend-render`) before tagging.
