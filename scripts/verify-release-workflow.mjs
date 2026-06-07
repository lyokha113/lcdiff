#!/usr/bin/env node
import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/release.yml";
const workflow = readFileSync(workflowPath, "utf8");
const remoteRunner = readFileSync("scripts/verify-remote-release-workflow.sh", "utf8");

const failures = [];

function requireText(needle, label = needle) {
  if (!workflow.includes(needle)) {
    failures.push(`missing ${label}`);
  }
}

function requireOrdered(labels) {
  let cursor = -1;
  for (const label of labels) {
    const index = workflow.indexOf(label);
    if (index === -1) {
      failures.push(`missing ordered step: ${label}`);
      continue;
    }
    if (index <= cursor) {
      failures.push(`step is out of order: ${label}`);
    }
    cursor = index;
  }
}

function requireRegex(pattern, label) {
  if (!pattern.test(workflow)) {
    failures.push(`missing ${label}`);
  }
}

requireText("os: macos-14\n            target: aarch64-apple-darwin\n            bundles: app", "macOS arm64 app-only matrix");
requireText("os: macos-13\n            target: x86_64-apple-darwin\n            bundles: app", "macOS x64 app-only matrix");
requireText("os: ubuntu-24.04\n            target: x86_64-unknown-linux-gnu\n            bundles: appimage,deb,rpm", "Linux bundle matrix");
requireText("os: windows-2022\n            target: x86_64-pc-windows-msvc\n            bundles: nsis,msi", "Windows bundle matrix");
requireText("Install Playwright Chromium with Linux deps", "Linux Playwright dependency step");
requireText("npx playwright install --with-deps chromium", "Linux Playwright Chromium with deps install");
requireText("runner.os != 'Linux'", "non-Linux Playwright install guard");

requireOrdered([
  "npm ci",
  "Install Playwright Chromium with Linux deps",
  "npx playwright install --with-deps chromium",
  "name: Install Playwright Chromium\n        if: runner.os != 'Linux'",
  "npx playwright install chromium",
  "Verify release invariants",
  "npm run verify:all",
  "Assemble Java runtime resources",
  "Verify bundled sidecar",
  "Build unsigned bundles",
  "Sign macOS app for notarization",
  "Notarize macOS app",
  "Promote final macOS app",
  "Package macOS DMG from final app",
  "Sign Windows bundles",
  "actions/upload-artifact@v4",
]);

requireText('run: scripts/notarize-macos-app.sh "target/${{ matrix.target }}/release/bundle/macos/jdiff-signed.app"', "notarize signed staging app");
requireRegex(/SIGNED_APP_PATH="target\/\$\{\{ matrix\.target \}\}\/release\/bundle\/macos\/jdiff-signed\.app"[\s\S]*rm -rf "\$SIGNED_APP_PATH"/, "signed macOS staging cleanup");
requireText('"target/${{ matrix.target }}/release/bundle/macos/jdiff.app"', "final macOS app path for DMG");
requireText('"target/${{ matrix.target }}/release/bundle/dmg/jdiff-${{ matrix.target }}.dmg"', "per-target macOS DMG output");

requireRegex(/name: Import macOS Developer ID certificate[\s\S]*?env\.MACOS_CERTIFICATE_BASE64 != '' &&[\s\S]*?env\.MACOS_CERTIFICATE_PASSWORD != '' &&[\s\S]*?env\.MACOS_KEYCHAIN_PASSWORD != '' &&[\s\S]*?env\.MACOS_SIGN_IDENTITY != ''[\s\S]*?shell: bash/, "complete macOS certificate import secret guard");
requireRegex(/name: Sign macOS app for notarization[\s\S]*?env\.MACOS_CERTIFICATE_BASE64 != '' &&[\s\S]*?env\.MACOS_CERTIFICATE_PASSWORD != '' &&[\s\S]*?env\.MACOS_KEYCHAIN_PASSWORD != '' &&[\s\S]*?env\.MACOS_SIGN_IDENTITY != ''[\s\S]*?shell: bash/, "complete macOS signing secret guard");
requireRegex(/name: Notarize macOS app[\s\S]*?env\.MACOS_CERTIFICATE_BASE64 != '' &&[\s\S]*?env\.MACOS_CERTIFICATE_PASSWORD != '' &&[\s\S]*?env\.MACOS_KEYCHAIN_PASSWORD != '' &&[\s\S]*?env\.MACOS_SIGN_IDENTITY != '' &&[\s\S]*?env\.APPLE_ID != '' &&[\s\S]*?env\.APPLE_TEAM_ID != '' &&[\s\S]*?env\.APPLE_APP_PASSWORD != ''[\s\S]*?shell: bash/, "complete macOS notarization secret guard");

requireText("scripts/sign-windows-bundles.ps1", "Windows signing script");
requireRegex(/name: Sign Windows bundles[\s\S]*?runner\.os == 'Windows' && env\.WINDOWS_CERTIFICATE_BASE64 != '' && env\.WINDOWS_CERTIFICATE_PASSWORD != ''[\s\S]*?shell: pwsh/, "complete Windows signing secret guard");
requireText('[Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64) | Set-Content -AsByteStream -LiteralPath $certPath', "Windows certificate base64 decode");
requireText('$timestampUrl = if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }', "Windows timestamp fallback");
requireText("-BundleDir \"target/${{ matrix.target }}/release/bundle\"", "Windows bundle signing directory");
requireText("-CertificatePath $certPath", "Windows certificate path pass-through");
requireText("-CertificatePassword \"$env:WINDOWS_CERTIFICATE_PASSWORD\"", "Windows certificate password pass-through");

for (const [needle, label] of [
  ["set -euo pipefail", "remote runner strict mode"],
  ["gh workflow run \"$WORKFLOW\" --ref \"$REF\"", "remote workflow dispatch"],
  ["gh run watch \"$RUN_ID\" --exit-status", "remote workflow wait"],
  ["gh run view \"$RUN_ID\" --json databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,createdAt,updatedAt", "remote run metadata capture"],
  ["gh run view \"$RUN_ID\" --json artifacts --jq '.artifacts'", "remote artifact capture"],
  ["platform-validation", "remote evidence output directory"],
  ["jdiff-aarch64-apple-darwin", "macOS arm64 artifact requirement"],
  ["jdiff-x86_64-apple-darwin", "macOS x64 artifact requirement"],
  ["jdiff-x86_64-unknown-linux-gnu", "Linux artifact requirement"],
  ["jdiff-x86_64-pc-windows-msvc", "Windows artifact requirement"],
]) {
  if (!remoteRunner.includes(needle)) {
    failures.push(`scripts/verify-remote-release-workflow.sh: missing ${label}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release workflow invariant failed: ${failure}`);
  }
  process.exit(1);
}

console.log("release workflow invariants passed");
