import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPhaseOneArchitecture } from './verify-architecture.mjs';

const cleanMain = 'fn main() {}\n';
const cleanCoreCargoToml = '[dependencies]\nserde = "1"\n';

test('accepts a Phase-1 compliant source pair', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: cleanCoreCargoToml,
    }),
    [],
  );
});

test('rejects AppState ownership in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: 'struct AppState {}\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    ['src-tauri/src/main.rs must not define struct AppState'],
  );
});

test('rejects Tauri commands in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: '#[tauri::command]\nfn open_archive() {}\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    ['src-tauri/src/main.rs must not define #[tauri::command] handlers'],
  );
});

test('rejects event emission in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: 'window.emit("search-progress", payload)?;\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    ['src-tauri/src/main.rs must not call .emit('],
  );
});

test('rejects a Tauri dependency in lcdiff-core', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[dependencies]\ntauri = "2"\n',
    }),
    ['crates/lcdiff-core/Cargo.toml must not depend on tauri'],
  );
});

test('reports every independent Phase-1 violation together', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: 'struct AppState {}\n#[tauri::command]\nfn run() { window.emit("event", ()); }\n',
      coreCargoToml: '[dependencies]\ntauri = "2"\n',
    }),
    [
      'src-tauri/src/main.rs must not define struct AppState',
      'src-tauri/src/main.rs must not define #[tauri::command] handlers',
      'src-tauri/src/main.rs must not call .emit(',
      'crates/lcdiff-core/Cargo.toml must not depend on tauri',
    ],
  );
});
