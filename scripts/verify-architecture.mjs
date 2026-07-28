import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function hasTauriDependency(coreCargoToml) {
  return (
    /^\s*tauri\s*(?:=|\.\s*workspace\s*=)/m.test(coreCargoToml) ||
    /^\s*[A-Za-z0-9_-]+\s*=\s*\{[^}]*\bpackage\s*=\s*["']tauri["'][^}]*\}/ms.test(
      coreCargoToml,
    )
  );
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
