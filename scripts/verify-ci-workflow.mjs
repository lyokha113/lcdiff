#!/usr/bin/env node
import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/ci.yml";
const workflow = readFileSync(workflowPath, "utf8");
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
      failures.push(`missing ordered item: ${label}`);
      continue;
    }
    if (index <= cursor) {
      failures.push(`item is out of order: ${label}`);
    }
    cursor = index;
  }
}

requireText("matrix:\n        os: [macos-14, ubuntu-24.04, windows-2022]", "macOS/Linux/Windows CI matrix");
requireText("fail-fast: false", "non-fail-fast matrix");
requireText("actions/setup-java@v4", "Java setup");
requireText('java-version: "17"', "Java 17");
requireText("actions/setup-node@v4", "Node setup");
requireText('node-version: "22"', "Node 22");
requireText("components: rustfmt, clippy", "rustfmt and clippy toolchain components");
requireText("if: runner.os == 'Linux'", "Linux dependency guard");
requireText("libwebkit2gtk-4.1-dev", "Linux WebKitGTK dependency");
requireText("libayatana-appindicator3-dev", "Linux appindicator dependency");
requireText("patchelf", "Linux patchelf dependency");
requireText("Install Playwright Chromium with Linux deps", "Linux Playwright dependency step");
requireText("npx playwright install --with-deps chromium", "Linux Playwright Chromium with deps install");
requireText("runner.os != 'Linux'", "non-Linux Playwright install guard");
requireText('JDIFF_JLINK="$JAVA_HOME/bin/jlink" scripts/assemble-sidecar-resources.sh', "jlink sidecar resource assembly");
requireText("scripts/test-sidecar-smoke.sh", "sidecar smoke test");

requireOrdered([
  "npm ci",
  "Install Playwright Chromium with Linux deps",
  "npx playwright install --with-deps chromium",
  "name: Install Playwright Chromium\n        if: runner.os != 'Linux'",
  "npx playwright install chromium",
  "cargo fmt --all -- --check",
  "cargo test --workspace",
  "cargo clippy --workspace --all-targets -- -D warnings",
  "npm run build",
  "npm run verify:release-workflow",
  "npm run verify:packaging-scripts",
  "npm run verify:ci-workflow",
  "npm run verify:frontend-invariants",
  "npm run verify:frontend-render",
  "npm run verify:docs",
  "Assemble Java runtime resources",
  "Sidecar smoke",
  "npm run tauri -- build --debug",
]);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`CI workflow invariant failed: ${failure}`);
  }
  process.exit(1);
}

console.log("CI workflow invariants passed");
