# macOS Distribution Evidence

- Target: `aarch64-apple-darwin`
- Bundles: `app`
- Signing identity: `-`
- Notarization: `skipped`
- npm install: `executed`
- App build: `executed`
- App: `target/aarch64-apple-darwin/release/bundle/macos/LCDiff.app`
- Validation app: `/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app`
- DMG: `target/aarch64-apple-darwin/release/bundle/dmg/LCDiff-aarch64-apple-darwin.dmg`
- Target-specific JLINK env: `LCDIFF_JLINK_AARCH64_APPLE_DARWIN`
- JLINK: `/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin/jlink`
- Expected Mach-O arch: `arm64`
- Timestamp UTC: `20260630T114835Z`

## Completed Checks

- `npm run verify:all`
- JLINK java at `/Users/lyo/.local/share/mise/installs/java/temurin-17.0.18+8/bin/java` is Mach-O `arm64`
- `scripts/assemble-sidecar-resources.sh`
- `scripts/test-sidecar-smoke.sh`
- app bundle present at `target/aarch64-apple-darwin/release/bundle/macos/LCDiff.app`
- app executable at `target/aarch64-apple-darwin/release/bundle/macos/LCDiff.app/Contents/MacOS/lcdiff-desktop` is Mach-O `arm64`
- bundled Java runtime at `target/aarch64-apple-darwin/release/bundle/macos/LCDiff.app/Contents/Resources/resources/jre/bin/java` is Mach-O `arm64`
- `scripts/sign-macos-bundle.sh "target/aarch64-apple-darwin/release/bundle/macos/LCDiff.app" "-" "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff-signed.app"`
- `clean_bundle_xattrs "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff-signed.app"`
- `codesign --verify --deep --strict --verbose=2 "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff-signed.app"`
- `codesign -d --entitlements - "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff-signed.app"`
- `ditto --norsrc "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff-signed.app" "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- `clean_bundle_xattrs "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- `codesign --verify --deep --strict --verbose=2 "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- `codesign -d --entitlements - "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- `scripts/package-macos-dmg.sh "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app" "target/aarch64-apple-darwin/release/bundle/dmg/LCDiff-aarch64-apple-darwin.dmg"`
- `clean_bundle_xattrs "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"` after DMG packaging
- post-DMG `codesign --verify --deep --strict --verbose=2 "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- post-DMG `codesign -d --entitlements - "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- mounted DMG contains `LCDiff.app`
- mounted DMG contains `Applications` symlink
- mounted DMG `codesign --verify --deep --strict --verbose=2 LCDiff.app`
- post-mount `clean_bundle_xattrs "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- post-mount `codesign --verify --deep --strict --verbose=2 "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
- post-mount `codesign -d --entitlements - "/var/folders/dx/z1cq3j1x20l003fdlmm1f1s00000gn/T//lcdiff-macos-validation-aarch64-apple-darwin-20260630T114835Z/LCDiff.app"`
