import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function dependencySection(header) {
  const match = header
    .trim()
    .match(/^(?:target\..+\.)?(?:dependencies|dev-dependencies|build-dependencies)(?:\.(.+))?$/);
  if (!match) {
    return null;
  }

  const alias = match[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  return { alias };
}

function hasTauriDependency(coreCargoToml) {
  let section = null;
  for (const line of coreCargoToml.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (header) {
      section = dependencySection(header[1]);
      if (section?.alias === 'tauri') {
        return true;
      }
      continue;
    }
    if (!section) {
      continue;
    }
    if (section.alias) {
      if (/^\s*package\s*=\s*["']tauri["']\s*(?:#.*)?$/.test(line)) {
        return true;
      }
      continue;
    }
    if (/^\s*tauri\s*(?:=|\.\s*workspace\s*=)/.test(line)) {
      return true;
    }
    if (
      /^\s*[A-Za-z0-9_-]+\s*=\s*\{[^}]*\bpackage\s*=\s*["']tauri["'][^}]*\}/.test(
        line,
      )
    ) {
      return true;
    }
  }
  return false;
}

export const phaseOneRules = [
  {
    message: 'src-tauri/src/main.rs must not define struct AppState',
    violates: ({ mainSource }) => /\bstruct\s+AppState\b/.test(mainSource),
  },
  {
    message: 'src-tauri/src/main.rs must not define #[tauri::command] handlers',
    violates: ({ mainSource }) => /#\s*\[\s*tauri::command\s*\]/.test(mainSource),
  },
  {
    message: 'src-tauri/src/main.rs must not call .emit(',
    violates: ({ mainSource }) => /\.emit\s*\(/.test(mainSource),
  },
  {
    message: 'crates/lcdiff-core/Cargo.toml must not depend on tauri',
    violates: ({ coreCargoToml }) => hasTauriDependency(coreCargoToml),
  },
];

export function verifyPhaseOneArchitecture(sources) {
  return phaseOneRules
    .filter((rule) => rule.violates(sources))
    .map((rule) => rule.message);
}

function readTrackedSource(path) {
  execFileSync('git', ['ls-files', '--error-unmatch', path], { stdio: 'ignore' });
  return readFileSync(path, 'utf8');
}

export function verifyRepository() {
  return verifyPhaseOneArchitecture({
    mainSource: readTrackedSource('src-tauri/src/main.rs'),
    coreCargoToml: readTrackedSource('crates/lcdiff-core/Cargo.toml'),
  });
}

function main() {
  const violations = verifyRepository();
  if (violations.length === 0) {
    console.log('Architecture guard passed.');
    return;
  }

  console.error('Architecture guard failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
