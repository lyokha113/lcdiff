# Releasing LDiff

End-to-end runbook for cutting a tagged GitHub release with macOS and Linux
artifacts. Targets the current build focus: **macOS (Apple Silicon)** and
**Linux (x86_64, Ubuntu 22.04 / glibc 2.35+)**.

## Artifacts per release

| Platform | File | Built where |
| --- | --- | --- |
| macOS arm64 | `LDiff-<version>-aarch64.dmg` | locally on macOS |
| Linux x86_64 | `LDiff_<version>_amd64.AppImage` | Docker (`ubuntu:22.04`) |
| Linux x86_64 | `LDiff_<version>_amd64.deb` | Docker (`ubuntu:22.04`) |
| Installers | `install-macos.sh`, `install-linux.sh` | committed in `scripts/` |

The install scripts ship as release assets so users get them next to the
binaries without cloning the repo.

## 1. Pick the version

The version lives in three manifests, kept in sync:

- `src-tauri/tauri.conf.json` (`version`)
- `Cargo.toml` (workspace `version`)
- `package.json` (`version`)

Bump all three for a new version, commit, then tag `v<version>`.

## 2. Build the macOS bundle (on macOS)

```bash
npm install
LDIFF_JLINK="$(command -v jlink)" scripts/assemble-sidecar-resources.sh
npm run tauri -- build --bundles app
```

Ad-hoc sign and package the DMG (unsigned distribution — no Apple Developer
ID). The macOS step order is always **sign, then notarize, then package DMG**;
with ad-hoc signing the notarize step is skipped:

```bash
scripts/sign-macos-bundle.sh \
  "$PWD/target/release/bundle/macos/LDiff.app" \
  - \
  "$PWD/target/release/bundle/macos/LDiff-signed.app"

scripts/package-macos-dmg.sh \
  "$PWD/target/release/bundle/macos/LDiff-signed.app" \
  "$PWD/target/release/bundle/dmg/LDiff-<version>-aarch64.dmg"
```

For a Gatekeeper-clean signed/notarized build instead, supply Developer ID
credentials and run `scripts/notarize-macos-app.sh` between the two commands —
see `docs/OPERATIONS_MACOS.md`.

## 3. Build the Linux bundles (Docker, from any host)

```bash
docker/build-linux-docker.sh --arch amd64 --bundles appimage,deb
```

This builds inside `ubuntu:22.04` so the glibc floor is 2.35 and the bundled
jlink JRE is Linux x86_64. Copy the artifacts out of the build volume:

```bash
cid=$(docker create --platform linux/amd64 -v ldiff-linux-amd64-u2204-target:/t \
  ldiff-linux-build-amd64-u2204)
docker cp "$cid":/t/release/bundle ./artifacts/linux-bundle
docker rm "$cid"
```

(Optional) prove the GUI renders headlessly: `docker/run-linux-docker.sh`.

## 4. Publish the release

Stage every artifact under one folder, then create the tagged release:

```bash
gh release create v<version> \
  artifacts/macos/LDiff-<version>-aarch64.dmg \
  artifacts/linux/LDiff_<version>_amd64.AppImage \
  artifacts/linux/LDiff_<version>_amd64.deb \
  scripts/install-macos.sh \
  scripts/install-linux.sh \
  --title "LDiff v<version>" \
  --notes-file docs/release-notes/v<version>.md
```

## 5. Verify the published release

- macOS: download the DMG + `install-macos.sh`, run `bash install-macos.sh`,
  confirm `open -a LDiff` launches.
- Linux: download the AppImage + `install-linux.sh`, run
  `bash install-linux.sh LDiff_<version>_amd64.AppImage`, confirm `ldiff` runs.

## Notes

- Linux bundles are unsigned; there is no Linux code-signing step.
- ARM Linux is not a release target — build from source with
  `docker/build-linux-docker.sh --arch arm64` if needed.
- Run the developer checks (`npm run verify:all`,
  `npm run verify:frontend-render`) before tagging.
