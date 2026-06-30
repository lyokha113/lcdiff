#!/usr/bin/env node
import { readFileSync } from "node:fs";

const files = [
  "README.md",
  "docs/RELEASING.md",
  "docs/OPERATIONS_MACOS.md",
  "docs/LCDIFF_COMPLETION_AUDIT.md",
  "docs/LCDIFF_IMPLEMENTATION_PLAN.md",
  "docs/ARCHITECTURE.md",
  "docs/PLATFORM_VALIDATION.md",
  "docs/release-notes/v0.2.0.md",
  "aur/lcdiff/PKGBUILD",
  "aur/lcdiff/.SRCINFO",
  "aur/lcdiff/lcdiff.install",
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
  "scripts/sign-macos-bundle.sh",
  "scripts/notarize-macos-app.sh",
  "scripts/package-macos-dmg.sh",
  "scripts/verify-macos-distribution.sh",
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

if (!readme.includes("npm run verify:all")) {
  failures.push("README.md: missing aggregate verifier command in Developer checks");
}

if (!readme.includes("npm run verify:frontend-render")) {
  failures.push("README.md: missing frontend render verifier command in Developer checks");
}
if (!readme.includes("docs/OPERATIONS_MACOS.md")) {
  failures.push("README.md: missing macOS operations runbook link");
}
if (!readme.includes("JAR/ZIP archives and folders")) {
  failures.push("README.md: missing folder input support summary");
}
// Current build focus is Linux + macOS. The Windows / Linux display-matrix
// validation runners stay documented in docs/PLATFORM_VALIDATION.md (still
// enforced below) but are no longer required inline in the README.
if (!readme.includes("scripts/build-linux.sh")) {
  failures.push("README.md: missing Linux build script command");
}
if (!readme.includes("yay -S lcdiff")) {
  failures.push("README.md: missing Arch AUR install note");
}

const releasing = readFileSync("docs/RELEASING.md", "utf8");
if (!releasing.includes("aur/lcdiff/PKGBUILD")) {
  failures.push("docs/RELEASING.md: missing AUR package reference");
}
if (!releasing.includes("yay -S lcdiff")) {
  failures.push("docs/RELEASING.md: missing AUR install command");
}

const aurPkgbuild = readFileSync("aur/lcdiff/PKGBUILD", "utf8");
for (const marker of [
  "pkgname=lcdiff",
  "pkgver=0.2.0",
  "source=(\"git+https://github.com/lyokha113/lcdiff.git#tag=v${pkgver}\")",
  "npm ci",
  "LCDIFF_JLINK=\"$(command -v jlink)\" scripts/assemble-sidecar-resources.sh",
  "npm run tauri -- build --bundles deb",
  "bsdtar -xf \"src-tauri/target/release/bundle/deb/LCDiff_${pkgver}_amd64.deb\" -C \"$pkgdir\"",
]) {
  if (!aurPkgbuild.includes(marker)) {
    failures.push(`aur/lcdiff/PKGBUILD: missing ${marker}`);
  }
}

const aurSrcinfo = readFileSync("aur/lcdiff/.SRCINFO", "utf8");
for (const marker of [
  "pkgbase = lcdiff",
  "pkgver = 0.2.0",
  "source = git+https://github.com/lyokha113/lcdiff.git#tag=v0.2.0",
  "sha256sums = SKIP",
]) {
  if (!aurSrcinfo.includes(marker)) {
    failures.push(`aur/lcdiff/.SRCINFO: missing ${marker}`);
  }
}

const aurInstall = readFileSync("aur/lcdiff/lcdiff.install", "utf8");
if (!aurInstall.includes("gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor")) {
  failures.push("aur/lcdiff/lcdiff.install: missing icon cache refresh");
}
if (!aurInstall.includes("update-desktop-database -q")) {
  failures.push("aur/lcdiff/lcdiff.install: missing desktop database refresh");
}

const releaseNotes = readFileSync("docs/release-notes/v0.2.0.md", "utf8");
if (!releaseNotes.includes("yay -S lcdiff")) {
  failures.push("docs/release-notes/v0.2.0.md: missing AUR install command");
}
if (!releaseNotes.includes("Arch Linux")) {
  failures.push("docs/release-notes/v0.2.0.md: missing Arch Linux note");
}

const audit = readFileSync("docs/LCDIFF_COMPLETION_AUDIT.md", "utf8");
if (!audit.includes("Open JAR/ZIP/folder")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing folder-open audit row");
}
if (!audit.includes("folder target temp-file replacement")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing folder target merge evidence");
}
if (!audit.includes("Playwright render verifier boots the Vite shell")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing Playwright render verifier evidence");
}
if (!audit.includes("exercise path-input validation error and clear-on-success")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing path-input render verifier evidence");
}
if (!audit.includes("pending target plus pending row badge")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing staged-copy render verifier evidence");
}
if (!audit.includes("unstage through the row context menu")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing context-menu unstage render verifier evidence");
}
if (!audit.includes("verify tree-filter row visibility")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing tree-filter render verifier evidence");
}
if (!audit.includes("click a scoped T2 search result")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing search-result render verifier evidence");
}
if (!audit.includes("verify on-demand metadata-only class status")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing metadata-only render verifier evidence");
}
if (!audit.includes("verify dirty mode-switch blocking")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing dirty mode-switch render verifier evidence");
}
if (!audit.includes("clear staged changes and switch into Single mode without Monaco lifecycle errors")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing clear-staged Single-mode render verifier evidence");
}
if (!audit.includes("verify signed-save session suppression")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing signed-save suppression render verifier evidence");
}
if (!audit.includes("prove backup checkbox IPC propagation")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing backup checkbox render verifier evidence");
}
if (!audit.includes("render the Bytecode tab through `disassemble`")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing bytecode render verifier evidence");
}
if (!audit.includes("render binary fallback SHA/CRC details plus hex preview")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing binary fallback render verifier evidence");
}
if (!audit.includes("signed-JAR warning Dialog before a confirmed Save anyway commits")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing signed-save render verifier evidence");
}
if (!audit.includes("Windows platform validation runner")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing Windows platform runner evidence");
}
if (!audit.includes("Linux display-matrix validation runner")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing Linux display runner evidence");
}
if (!audit.includes("macOS distribution validation runner")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing macOS distribution runner evidence");
}
if (!audit.includes("Arch AUR package source")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing Arch AUR package evidence");
}
if (!audit.includes("platform-validation/macos-distribution-*.md")) {
  failures.push("docs/LCDIFF_COMPLETION_AUDIT.md: missing macOS distribution report evidence");
}

const platformValidation = readFileSync("docs/PLATFORM_VALIDATION.md", "utf8");
const macosOps = readFileSync("docs/OPERATIONS_MACOS.md", "utf8");
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
if (!platformValidation.includes("docs/OPERATIONS_MACOS.md")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing macOS operations runbook link");
}
if (!platformValidation.includes("Arch Linux AUR package for `lcdiff`")) {
  failures.push("docs/PLATFORM_VALIDATION.md: missing Arch AUR package note");
}

for (const marker of [
  "scripts/verify-macos-distribution.sh",
  "LCDIFF_JLINK_X86_64_APPLE_DARWIN",
  "platform-validation/macos-distribution-*.md",
  "MACOS_SIGN_IDENTITY",
  "APPLE_ID",
  "codesign --verify --deep --strict",
  "hdiutil verify",
  "LCDiff-aarch64-apple-darwin.dmg",
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
