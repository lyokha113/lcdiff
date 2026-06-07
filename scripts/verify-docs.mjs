#!/usr/bin/env node
import { readFileSync } from "node:fs";

const files = [
  "README.md",
  "docs/OPERATIONS_MACOS.md",
  "docs/JDIFF_COMPLETION_AUDIT.md",
  "docs/JDIFF_IMPLEMENTATION_PLAN.md",
  "docs/ARCHITECTURE.md",
  "docs/PLATFORM_VALIDATION.md",
  "docs/TEST_MATRIX.md",
];

const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const fences = text.match(/```/g) ?? [];
  if (fences.length % 2 !== 0) {
    failures.push(`${file}: unbalanced fenced code block markers`);
  }
}

const readme = readFileSync("README.md", "utf8");
const macOrder = [
  "rtk scripts/sign-macos-bundle.sh",
  "rtk scripts/notarize-macos-app.sh",
  "rtk scripts/package-macos-dmg.sh",
  "rtk scripts/verify-macos-distribution.sh",
];
let cursor = -1;
for (const marker of macOrder) {
  const index = readme.indexOf(marker);
  if (index === -1) {
    failures.push(`README.md: missing ${marker}`);
    continue;
  }
  if (index <= cursor) {
    failures.push(`README.md: macOS command order must be sign, notarize, package DMG`);
  }
  cursor = index;
}

if (!readme.includes("rtk npm run verify:all")) {
  failures.push("README.md: missing aggregate verifier command in Developer checks");
}

if (!readme.includes("rtk npm run verify:frontend-render")) {
  failures.push("README.md: missing frontend render verifier command in Developer checks");
}
if (!readme.includes("docs/OPERATIONS_MACOS.md")) {
  failures.push("README.md: missing macOS operations runbook link");
}
if (!readme.includes("JAR/ZIP archives and folders")) {
  failures.push("README.md: missing folder input support summary");
}
if (!readme.includes("scripts\\verify-windows-platform.ps1")) {
  failures.push("README.md: missing Windows platform validation runner command");
}
if (!readme.includes("scripts/verify-linux-display-matrix.sh")) {
  failures.push("README.md: missing Linux display validation runner command");
}
if (!readme.includes("scripts/verify-remote-release-workflow.sh")) {
  failures.push("README.md: missing remote release workflow runner command");
}

const audit = readFileSync("docs/JDIFF_COMPLETION_AUDIT.md", "utf8");
if (!audit.includes("Open JAR/ZIP/folder")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing folder-open audit row");
}
if (!audit.includes("folder target temp-file replacement")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing folder target merge evidence");
}
if (!audit.includes("Playwright render verifier boots the Vite shell")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing Playwright render verifier evidence");
}
if (!audit.includes("exercise path-input validation error and clear-on-success")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing path-input render verifier evidence");
}
if (!audit.includes("pending target plus pending row badge")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing staged-copy render verifier evidence");
}
if (!audit.includes("unstage through the row context menu")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing context-menu unstage render verifier evidence");
}
if (!audit.includes("verify tree-filter row visibility")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing tree-filter render verifier evidence");
}
if (!audit.includes("click a scoped T2 search result")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing search-result render verifier evidence");
}
if (!audit.includes("verify on-demand metadata-only class status")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing metadata-only render verifier evidence");
}
if (!audit.includes("verify dirty mode-switch blocking")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing dirty mode-switch render verifier evidence");
}
if (!audit.includes("clear staged changes and switch into Single mode without Monaco lifecycle errors")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing clear-staged Single-mode render verifier evidence");
}
if (!audit.includes("verify signed-save session suppression")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing signed-save suppression render verifier evidence");
}
if (!audit.includes("prove backup checkbox IPC propagation")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing backup checkbox render verifier evidence");
}
if (!audit.includes("render the Bytecode tab through `disassemble`")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing bytecode render verifier evidence");
}
if (!audit.includes("render binary fallback SHA/CRC details plus hex preview")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing binary fallback render verifier evidence");
}
if (!audit.includes("signed-JAR warning Dialog before a confirmed Save anyway commits")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing signed-save render verifier evidence");
}
if (!audit.includes("Windows platform validation runner")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing Windows platform runner evidence");
}
if (!audit.includes("Linux display-matrix validation runner")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing Linux display runner evidence");
}
if (!audit.includes("macOS distribution validation runner")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing macOS distribution runner evidence");
}
if (!audit.includes("platform-validation/macos-distribution-*.md")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing macOS distribution report evidence");
}
if (!audit.includes("remote release workflow validation runner")) {
  failures.push("docs/JDIFF_COMPLETION_AUDIT.md: missing remote release workflow runner evidence");
}

const matrix = readFileSync("docs/TEST_MATRIX.md", "utf8");
if (!matrix.includes("Validated open for JAR/ZIP/folder")) {
  failures.push("docs/TEST_MATRIX.md: missing folder source contract");
}
if (!matrix.includes("archive-to-folder staged commit")) {
  failures.push("docs/TEST_MATRIX.md: missing folder commit evidence");
}
if (!matrix.includes("Playwright frontend render verifier covers visible shell controls, console-clean startup, mocked path-input validation error and clear-on-success, compare open/select/copy rendering of the pending target plus pending row badge and context-menu unstage clearing, tree-filter row visibility, scoped T2 search result click navigation, on-demand metadata-only class status, dirty mode-switch guard, clear-staged unlock into Single mode, signed-save session suppression, backup checkbox IPC propagation, Bytecode tab rendering through the disassemble IPC path, binary fallback details with SHA/CRC plus hex preview, and signed-JAR warning Dialog before confirmed Save anyway commits with a signed-invalidated message")) {
  failures.push("docs/TEST_MATRIX.md: missing frontend render verifier evidence");
}
if (!matrix.includes("scripts\\verify-windows-platform.ps1")) {
  failures.push("docs/TEST_MATRIX.md: missing Windows platform runner evidence");
}
if (!matrix.includes("scripts/verify-linux-display-matrix.sh")) {
  failures.push("docs/TEST_MATRIX.md: missing Linux display runner evidence");
}
if (!matrix.includes("scripts/verify-macos-distribution.sh")) {
  failures.push("docs/TEST_MATRIX.md: missing macOS distribution runner evidence");
}
if (!matrix.includes("platform-validation/macos-distribution-*.md")) {
  failures.push("docs/TEST_MATRIX.md: missing macOS distribution report evidence");
}
if (!matrix.includes("scripts/verify-remote-release-workflow.sh")) {
  failures.push("docs/TEST_MATRIX.md: missing remote release workflow runner evidence");
}

const platformValidation = readFileSync("docs/PLATFORM_VALIDATION.md", "utf8");
const macosOps = readFileSync("docs/OPERATIONS_MACOS.md", "utf8");
const productContract = readFileSync("docs/product/jdiff-product-contract.md", "utf8");
if (!productContract.includes("`.jar` files, `.zip` files, and folders")) {
  failures.push("docs/product/jdiff-product-contract.md: missing folder input contract");
}
if (!productContract.includes("<folder>.bak")) {
  failures.push("docs/product/jdiff-product-contract.md: missing folder backup contract");
}
if (!platformValidation.includes("scripts\\verify-windows-platform.ps1")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing Windows platform runner command");
}
if (!platformValidation.includes("scripts/verify-linux-display-matrix.sh")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing Linux display runner command");
}
if (!platformValidation.includes("scripts/verify-macos-distribution.sh")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing macOS distribution runner command");
}
if (!platformValidation.includes("platform-validation/macos-distribution-*.md")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing macOS distribution report requirement");
}
if (!platformValidation.includes("scripts/verify-remote-release-workflow.sh")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing remote release workflow runner command");
}
if (!platformValidation.includes("docs/OPERATIONS_MACOS.md")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing macOS operations runbook link");
}

for (const marker of [
  "scripts/verify-macos-distribution.sh",
  "JDIFF_JLINK_X86_64_APPLE_DARWIN",
  "platform-validation/macos-distribution-*.md",
  "MACOS_SIGN_IDENTITY",
  "APPLE_ID",
  "codesign --verify --deep --strict",
  "hdiutil verify",
  "jdiff-aarch64-apple-darwin.dmg",
]) {
  if (!macosOps.includes(marker)) {
    failures.push(`docs/OPERATIONS_MACOS.md: missing ${marker}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`docs invariant failed: ${failure}`);
  }
  process.exit(1);
}

console.log("documentation invariants passed");
