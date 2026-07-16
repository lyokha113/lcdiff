#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const packageVersion = JSON.parse(read("package.json")).version;
const checks = [
  ["Cargo.toml", `version = "${packageVersion}"`],
  ["src-tauri/tauri.conf.json", `"version": "${packageVersion}"`],
  ["sidecar/pom.xml", `<version>${packageVersion}</version>`],
  ["aur/lcdiff/PKGBUILD", `pkgver=${packageVersion}`],
  ["aur/lcdiff/.SRCINFO", `pkgver = ${packageVersion}`],
  ["aur/lcdiff/.SRCINFO", `#tag=v${packageVersion}`],
];

const failures = [];
for (const [path, expected] of checks) {
  if (!read(path).includes(expected)) failures.push(`${path}: missing ${expected}`);
}

const releaseNotes = `docs/release-notes/v${packageVersion}.md`;
if (!existsSync(releaseNotes)) failures.push(`${releaseNotes}: missing current release notes`);

for (const path of [
  "README.md",
  "docs/DEVELOPMENT.md",
  "docs/RELEASING.md",
  "docs/ARCHITECTURE.md",
  "docs/PLATFORM_VALIDATION.md",
]) {
  const fences = read(path).match(/```/g)?.length ?? 0;
  if (fences % 2 !== 0) failures.push(`${path}: unbalanced fenced code blocks`);
}

if (failures.length) {
  failures.forEach((failure) => console.error(`docs check failed: ${failure}`));
  process.exit(1);
}

console.log(`release docs synchronized for v${packageVersion}`);
