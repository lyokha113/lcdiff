#!/usr/bin/env node
import { readFileSync } from "node:fs";

const files = new Map([
  ["scripts/build-windows.ps1", readFileSync("scripts/build-windows.ps1", "utf8")],
  ["scripts/sign-windows-bundles.ps1", readFileSync("scripts/sign-windows-bundles.ps1", "utf8")],
  ["scripts/verify-windows-platform.ps1", readFileSync("scripts/verify-windows-platform.ps1", "utf8")],
  ["scripts/verify-linux-display-matrix.sh", readFileSync("scripts/verify-linux-display-matrix.sh", "utf8")],
  ["scripts/verify-macos-distribution.sh", readFileSync("scripts/verify-macos-distribution.sh", "utf8")],
  ["scripts/sign-macos-bundle.sh", readFileSync("scripts/sign-macos-bundle.sh", "utf8")],
  ["scripts/notarize-macos-app.sh", readFileSync("scripts/notarize-macos-app.sh", "utf8")],
  ["scripts/package-macos-dmg.sh", readFileSync("scripts/package-macos-dmg.sh", "utf8")],
]);

const failures = [];

function requireText(file, needle, label = needle) {
  const content = files.get(file);
  if (!content.includes(needle)) {
    failures.push(`${file}: missing ${label}`);
  }
}

function requireRegex(file, pattern, label) {
  const content = files.get(file);
  if (!pattern.test(content)) {
    failures.push(`${file}: missing ${label}`);
  }
}

requireText("scripts/sign-windows-bundles.ps1", "Set-StrictMode -Version Latest", "strict mode");

requireText("scripts/build-windows.ps1", "Set-StrictMode -Version Latest", "strict mode");
requireText("scripts/build-windows.ps1", '$ErrorActionPreference = "Stop"', "stop-on-error");
requireText("scripts/build-windows.ps1", 'if (-not $IsWindows)', "Windows host guard");
requireText("scripts/build-windows.ps1", 'Require-Command "bash"', "Git Bash requirement");
requireText("scripts/build-windows.ps1", 'throw "JAVA_HOME must point to a Java 17 installation."', "JAVA_HOME requirement");
requireText("scripts/build-windows.ps1", "cygpath -u", "Git Bash jlink path conversion");
requireText("scripts/build-windows.ps1", "npm run verify:all", "aggregate verifier gate");
requireText("scripts/build-windows.ps1", "bash scripts/assemble-sidecar-resources.sh", "sidecar assembly");
requireText("scripts/build-windows.ps1", "bash scripts/test-sidecar-smoke.sh", "sidecar smoke");
requireText("scripts/build-windows.ps1", "npm run tauri -- build --bundles $Bundles", "Windows release bundle build");
requireText("scripts/build-windows.ps1", "scripts/sign-windows-bundles.ps1", "optional Windows signing");
requireText("scripts/build-windows.ps1", 'Where-Object { $_.Extension -in ".exe", ".msi" }', "exe/msi artifact filter");
requireText("scripts/build-windows.ps1", "LCDiff-$version-windows-x64-$suffix", "stable release artifact name");
requireText("scripts/sign-windows-bundles.ps1", '$ErrorActionPreference = "Stop"', "stop-on-error");
requireText("scripts/sign-windows-bundles.ps1", "Get-Command signtool.exe", "signtool lookup on PATH");
requireText("scripts/sign-windows-bundles.ps1", "Windows Kits\\10\\bin", "Windows SDK signtool fallback");
requireRegex("scripts/sign-windows-bundles.ps1", /Where-Object \{ \$_.Extension -in "\.exe", "\.msi" \}/, "exe/msi artifact filter");
requireText("scripts/sign-windows-bundles.ps1", 'throw "no .exe or .msi bundles found under $BundleDir"', "empty artifact failure");
requireText("scripts/sign-windows-bundles.ps1", "/fd SHA256", "SHA256 file digest");
requireText("scripts/sign-windows-bundles.ps1", "/td SHA256", "SHA256 timestamp digest");
requireText("scripts/sign-windows-bundles.ps1", "/tr $TimestampUrl", "RFC3161 timestamp URL");
requireText("scripts/sign-windows-bundles.ps1", "/f $CertificatePath", "certificate path argument");
requireText("scripts/sign-windows-bundles.ps1", "/p $CertificatePassword", "certificate password argument");
requireText("scripts/sign-windows-bundles.ps1", "verify /pa /v", "post-sign verification");

requireText("scripts/verify-windows-platform.ps1", "Set-StrictMode -Version Latest", "strict mode");
requireText("scripts/verify-windows-platform.ps1", 'if (-not $IsWindows)', "Windows host guard");
requireText("scripts/verify-windows-platform.ps1", 'Require-Command "bash"', "Git Bash requirement");
requireText("scripts/verify-windows-platform.ps1", 'throw "JAVA_HOME must point to a Java 17 installation."', "JAVA_HOME requirement");
requireText("scripts/verify-windows-platform.ps1", '$env:LCDIFF_JLINK = $jlink', "JLINK env export");
requireText("scripts/verify-windows-platform.ps1", "cargo fmt --all -- --check", "cargo fmt gate");
requireText("scripts/verify-windows-platform.ps1", "cargo test --workspace", "cargo test gate");
requireText("scripts/verify-windows-platform.ps1", "cargo clippy --workspace --all-targets -- -D warnings", "cargo clippy gate");
requireText("scripts/verify-windows-platform.ps1", "npm run verify:all", "aggregate frontend/release verifier gate");
requireText("scripts/verify-windows-platform.ps1", "bash scripts/assemble-sidecar-resources.sh", "sidecar assembly");
requireText("scripts/verify-windows-platform.ps1", "bash scripts/test-sidecar-smoke.sh", "sidecar smoke");
requireText("scripts/verify-windows-platform.ps1", "npm run tauri -- build --debug --bundles $Bundles", "Windows bundle build");
requireText("scripts/verify-windows-platform.ps1", "scripts/sign-windows-bundles.ps1", "optional Windows signing");

requireText("scripts/verify-linux-display-matrix.sh", "set -euo pipefail", "strict mode");
requireText("scripts/verify-linux-display-matrix.sh", 'if [[ "$(uname -s)" != "Linux" ]]', "Linux host guard");
requireText("scripts/verify-linux-display-matrix.sh", "scripts/launch-linux-xwayland.sh \"$APP\"", "XWayland fallback launcher");
requireText("scripts/verify-linux-display-matrix.sh", "LCDIFF_FORCE_XWAYLAND=1", "XWayland env guard");
requireText("scripts/verify-linux-display-matrix.sh", "platform-validation", "default report directory");
requireText("scripts/verify-linux-display-matrix.sh", "Linux Display Matrix Evidence", "Markdown report title");
requireText("scripts/verify-linux-display-matrix.sh", "Browse open", "Browse check");
requireText("scripts/verify-linux-display-matrix.sh", "Path input open", "path input check");
requireText("scripts/verify-linux-display-matrix.sh", "OS file drop", "file drop check");
requireText("scripts/verify-linux-display-matrix.sh", "pass|fail|skipped", "structured result prompt");

requireText("scripts/verify-macos-distribution.sh", "set -euo pipefail", "strict mode");
requireText("scripts/verify-macos-distribution.sh", 'if [[ "$(uname -s)" != "Darwin" ]]', "Darwin host guard");
requireText("scripts/verify-macos-distribution.sh", "npm run verify:all", "aggregate verifier gate");
requireText("scripts/verify-macos-distribution.sh", "scripts/assemble-sidecar-resources.sh", "sidecar assembly");
requireText("scripts/verify-macos-distribution.sh", "scripts/test-sidecar-smoke.sh", "sidecar smoke");
requireText("scripts/verify-macos-distribution.sh", 'npm run tauri -- build --target "$TARGET" --bundles "$BUNDLES"', "macOS app build");
requireText("scripts/verify-macos-distribution.sh", "expected_macho_arch", "target architecture mapping");
requireText("scripts/verify-macos-distribution.sh", "file -b \"$path\"", "architecture guard ignores path names");
requireText("scripts/verify-macos-distribution.sh", "TARGET_JLINK_ENV=\"LCDIFF_JLINK_$(printf '%s' \"$TARGET\" | tr '[:lower:]-' '[:upper:]_')\"", "target-specific JLINK env");
requireText("scripts/verify-macos-distribution.sh", "assert_macho_arch \"LCDIFF_JLINK java\" \"$JLINK_JAVA\" \"$EXPECTED_ARCH\"", "JLINK architecture guard");
requireText("scripts/verify-macos-distribution.sh", "assert_macho_arch \"app executable\" \"$APP_EXECUTABLE\" \"$EXPECTED_ARCH\"", "app executable architecture guard");
requireText("scripts/verify-macos-distribution.sh", "assert_macho_arch \"bundled Java runtime\" \"$BUNDLED_JAVA\" \"$EXPECTED_ARCH\"", "bundled JRE architecture guard");
requireText("scripts/verify-macos-distribution.sh", "scripts/sign-macos-bundle.sh", "inside-out signing");
requireText("scripts/verify-macos-distribution.sh", "clean_bundle_xattrs \"$SIGNED_APP_PATH\"", "signed app xattr cleanup");
requireText("scripts/verify-macos-distribution.sh", "xattr -d com.apple.FinderInfo \"$path\"", "root FinderInfo cleanup");
requireText("scripts/verify-macos-distribution.sh", "find \"$path\" -exec xattr -d com.apple.FinderInfo", "recursive FinderInfo cleanup");
requireText("scripts/verify-macos-distribution.sh", "grep -E 'com\\.apple\\.(FinderInfo|fileprovider\\.fpfs#P)'", "strict xattr cleanup assertion");
requireText("scripts/verify-macos-distribution.sh", "codesign --verify --deep --strict --verbose=2 \"$SIGNED_APP_PATH\"", "signed app verification");
requireText("scripts/verify-macos-distribution.sh", "codesign -d --entitlements - \"$SIGNED_APP_PATH\"", "entitlements dump");
requireText("scripts/verify-macos-distribution.sh", "scripts/notarize-macos-app.sh \"$SIGNED_APP_PATH\"", "optional notarization");
requireText("scripts/verify-macos-distribution.sh", "clean_bundle_xattrs \"$FINAL_APP_PATH\"", "final app xattr cleanup");
requireText("scripts/verify-macos-distribution.sh", "codesign --verify --deep --strict --verbose=2 \"$FINAL_APP_PATH\"", "final app codesign verification");
requireText("scripts/verify-macos-distribution.sh", "codesign -d --entitlements - \"$FINAL_APP_PATH\"", "final app entitlement dump");
requireText("scripts/verify-macos-distribution.sh", "FINAL_APP_PATH=\"$VALIDATION_DIR/LCDiff.app\"", "temporary final validation app");
requireText("scripts/verify-macos-distribution.sh", "scripts/package-macos-dmg.sh \"$FINAL_APP_PATH\" \"$DMG_PATH\"", "DMG packaging");
requireText("scripts/verify-macos-distribution.sh", "post-DMG \\`codesign --verify --deep --strict --verbose=2 \"$FINAL_APP_PATH\"\\`", "post-DMG final app verification report");
requireText("scripts/verify-macos-distribution.sh", "hdiutil attach \"$DMG_PATH\" -mountpoint \"$MOUNT_DIR\" -nobrowse -readonly", "mounted DMG verification");
requireText("scripts/verify-macos-distribution.sh", "test -d \"$MOUNT_DIR/LCDiff.app\"", "mounted app guard");
requireText("scripts/verify-macos-distribution.sh", "test -L \"$MOUNT_DIR/Applications\"", "mounted Applications symlink guard");
requireText("scripts/verify-macos-distribution.sh", "codesign --verify --deep --strict --verbose=2 \"$MOUNT_DIR/LCDiff.app\"", "mounted app codesign verification");
requireText("scripts/verify-macos-distribution.sh", "post-mount \\`codesign --verify --deep --strict --verbose=2 \"$FINAL_APP_PATH\"\\`", "post-mount final app verification report");
requireText("scripts/verify-macos-distribution.sh", "platform-validation", "default report directory");
requireText("scripts/verify-macos-distribution.sh", "macOS Distribution Evidence", "Markdown report title");
requireText("scripts/verify-macos-distribution.sh", "macos-distribution-$TARGET-$timestamp.md", "target-specific report name");
requireText("scripts/verify-macos-distribution.sh", "macOS distribution report written", "report completion message");

requireText("scripts/sign-macos-bundle.sh", 'if [[ "$(uname -s)" != "Darwin" ]]', "Darwin guard");
requireText("scripts/sign-macos-bundle.sh", "src-tauri/Entitlements.plist", "default entitlements");
requireText("scripts/sign-macos-bundle.sh", "ditto --norsrc \"$INPUT_APP\" \"$APP\"", "staged app copy");
requireText("scripts/sign-macos-bundle.sh", "clean_bundle_xattrs \"$APP\"", "quarantine/xattr cleanup");
requireText("scripts/sign-macos-bundle.sh", "clean_bundle_xattrs \"$OUTPUT_APP\"", "signed output xattr cleanup");
requireText("scripts/sign-macos-bundle.sh", "find \"$APP\" -type f -print0", "inside-out Mach-O traversal");
requireText("scripts/sign-macos-bundle.sh", "codesign --verify --deep --strict --verbose=2 \"$APP\"", "strict codesign verification");
requireText("scripts/sign-macos-bundle.sh", "ditto --norsrc \"$APP\" \"$OUTPUT_APP\"", "deterministic signed output copy");

requireText("scripts/notarize-macos-app.sh", 'if [[ "$(uname -s)" != "Darwin" ]]', "Darwin guard");
requireText("scripts/notarize-macos-app.sh", "APPLE_ID=\"${APPLE_ID:?APPLE_ID is required for xcrun notarytool}\"", "Apple ID requirement");
requireText("scripts/notarize-macos-app.sh", "APPLE_TEAM_ID=\"${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for xcrun notarytool}\"", "Apple team requirement");
requireText("scripts/notarize-macos-app.sh", "APPLE_APP_PASSWORD=\"${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD is required for xcrun notarytool}\"", "Apple app password requirement");
requireText("scripts/notarize-macos-app.sh", "xcrun notarytool submit", "notarytool submit");
requireText("scripts/notarize-macos-app.sh", "--wait", "notary wait");
requireText("scripts/notarize-macos-app.sh", "xcrun stapler staple \"$APP\"", "stapler");
requireText("scripts/notarize-macos-app.sh", "spctl --assess --type execute --verbose=4 \"$APP\"", "Gatekeeper assessment");

requireText("scripts/package-macos-dmg.sh", 'if [[ "$(uname -s)" != "Darwin" ]]', "Darwin guard");
requireText("scripts/package-macos-dmg.sh", "*.app)", ".app input guard");
requireText("scripts/package-macos-dmg.sh", "clean_app_xattrs \"$APP\"", "source app xattr cleanup");
requireText("scripts/package-macos-dmg.sh", "xattr -d com.apple.FinderInfo \"$app\"", "root FinderInfo cleanup");
requireText("scripts/package-macos-dmg.sh", "find \"$app\" -exec xattr -d com.apple.FinderInfo", "FinderInfo cleanup");
requireText("scripts/package-macos-dmg.sh", "find \"$app\" -exec xattr -d 'com.apple.fileprovider.fpfs#P'", "File Provider xattr cleanup");
requireText("scripts/package-macos-dmg.sh", "ditto --norsrc \"$APP\" \"$STAGING_DIR/$(basename \"$APP\")\"", "staged app copy");
requireText("scripts/package-macos-dmg.sh", "clean_app_xattrs \"$STAGING_DIR/$(basename \"$APP\")\"", "staged app xattr cleanup");
requireText("scripts/package-macos-dmg.sh", "ln -s /Applications \"$STAGING_DIR/Applications\"", "Applications symlink");
requireText("scripts/package-macos-dmg.sh", "hdiutil create", "DMG creation");
requireText("scripts/package-macos-dmg.sh", "-format UDZO", "compressed DMG format");
requireText("scripts/package-macos-dmg.sh", "hdiutil verify \"$DMG\"", "DMG verification");

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`packaging script invariant failed: ${failure}`);
  }
  process.exit(1);
}

console.log("packaging script invariants passed");
