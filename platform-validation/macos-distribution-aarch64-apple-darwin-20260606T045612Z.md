# macOS Distribution Evidence

- Target: `aarch64-apple-darwin`
- Bundles: `app`
- Signing identity: `-`
- Notarization: `skipped`
- npm install: `skipped`
- App build: `skipped`
- App: `target/aarch64-apple-darwin/release/bundle/macos/jdiff.app`
- DMG: `target/aarch64-apple-darwin/release/bundle/dmg/jdiff-aarch64-apple-darwin.dmg`
- Target-specific JLINK env: `JDIFF_JLINK_AARCH64_APPLE_DARWIN`
- JLINK: `/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin/jlink`
- Expected Mach-O arch: `arm64`
- Timestamp UTC: `20260606T045612Z`

## Completed Checks

- `npm run verify:all`
- JLINK java at `/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin/java` is Mach-O `arm64`
- `scripts/assemble-sidecar-resources.sh`
- `scripts/test-sidecar-smoke.sh`
- app bundle present at `target/aarch64-apple-darwin/release/bundle/macos/jdiff.app`
- app executable at `target/aarch64-apple-darwin/release/bundle/macos/jdiff.app/Contents/MacOS/jdiff-desktop` is Mach-O `arm64`
- bundled Java runtime at `target/aarch64-apple-darwin/release/bundle/macos/jdiff.app/Contents/Resources/resources/jre/bin/java` is Mach-O `arm64`
- `scripts/sign-macos-bundle.sh "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app" "-" "target/aarch64-apple-darwin/release/bundle/macos/jdiff-signed.app"`
- `clean_bundle_xattrs "target/aarch64-apple-darwin/release/bundle/macos/jdiff-signed.app"`
- `codesign --verify --deep --strict --verbose=2 "target/aarch64-apple-darwin/release/bundle/macos/jdiff-signed.app"`
- `codesign -d --entitlements - "target/aarch64-apple-darwin/release/bundle/macos/jdiff-signed.app"`
- `clean_bundle_xattrs "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"`
- `codesign --verify --deep --strict --verbose=2 "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"`
- `codesign -d --entitlements - "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"`
- `scripts/package-macos-dmg.sh "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app" "target/aarch64-apple-darwin/release/bundle/dmg/jdiff-aarch64-apple-darwin.dmg"`
- `clean_bundle_xattrs "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"` after DMG packaging
- post-DMG `codesign --verify --deep --strict --verbose=2 "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"`
- post-DMG `codesign -d --entitlements - "target/aarch64-apple-darwin/release/bundle/macos/jdiff.app"`
- mounted DMG contains `jdiff.app`
- mounted DMG contains `Applications` symlink
- mounted DMG `codesign --verify --deep --strict --verbose=2 jdiff.app`
