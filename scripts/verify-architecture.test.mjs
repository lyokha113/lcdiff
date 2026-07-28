import assert from 'node:assert/strict';
import test from 'node:test';

import * as architecture from './verify-architecture.mjs';

const { verifyPhaseOneArchitecture } = architecture;

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

test('rejects a workspace-inherited Tauri dependency in lcdiff-core', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[dependencies]\ntauri.workspace = true\n',
    }),
    ['crates/lcdiff-core/Cargo.toml must not depend on tauri'],
  );
});

test('rejects an aliased Tauri dependency in lcdiff-core', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[dependencies]\ndesktop-shell = { package = "tauri", version = "2" }\n',
    }),
    ['crates/lcdiff-core/Cargo.toml must not depend on tauri'],
  );
});

test('rejects a Tauri package declared through a dependency table alias', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[dependencies.desktop_shell]\npackage = "tauri"\nversion = "2"\n',
    }),
    ['crates/lcdiff-core/Cargo.toml must not depend on tauri'],
  );
});

test('rejects a direct Tauri dependency table', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[dependencies.tauri]\nversion = "2"\n',
    }),
    ['crates/lcdiff-core/Cargo.toml must not depend on tauri'],
  );
});

test('allows a Tauri package marker outside dependency sections', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: '[package.metadata.desktop]\npackage = "tauri"\n',
    }),
    [],
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

const expectedCommandNames = [
  'validate_path',
  'platform_hints',
  'list_system_fonts',
  'open_archive',
  'compute_diff',
  'compute_nested_diff',
  'open_view_source',
  'list_view_sources',
  'read_entry',
  'read_view_entry',
  'compute_view_nested_entries',
  'close_view_source',
  'set_engine',
  'disassemble',
  'disassemble_view_entry',
  'stage_copy',
  'stage_write',
  'stage_view_write',
  'unstage_view_write',
  'commit_view',
  'commit_merge',
  'clear_staged',
  'unstage',
  'search',
  'search_view_source',
  'deep_search',
  'deep_search_view_source',
  'cancel_deep_search',
  'prefetch_siblings',
  'pending_open_paths',
];

const expectedEventNames = [
  'search-progress',
  'search-result',
  'os-open-paths',
  'app-action',
];

const cleanPhaseTwoSources = {
  libSource: `tauri::generate_handler![${expectedCommandNames.join(',')}]\n`,
  commandSources: Object.fromEntries(
    expectedCommandNames.map((name) => [
      `src-tauri/src/commands/${name}.rs`,
      `#[tauri::command]\nfn ${name}() {}\n`,
    ]),
  ),
  eventSource: [
    'pub(crate) const SEARCH_PROGRESS: &str = "search-progress";',
    'pub(crate) const SEARCH_RESULT: &str = "search-result";',
    'pub(crate) const OS_OPEN_PATHS: &str = "os-open-paths";',
    'pub(crate) const APP_ACTION: &str = "app-action";',
  ].join('\n'),
  protectedSources: {
    'src-tauri/src/state.rs': 'use crate::sidecar_process::SidecarClient;\n',
    'src-tauri/src/events.rs': 'use tauri::Emitter;\n',
    'src-tauri/src/menu.rs': 'use crate::events::emit_app_action;\n',
    'src-tauri/src/sidecar_process.rs': 'use std::process::Command;\n',
    'src-tauri/src/system_fonts.rs': 'use font_kit::source::SystemSource;\n',
  },
  nonCommandSources: {},
};

function verifyPhaseTwoArchitecture(sources) {
  assert.equal(
    typeof architecture.verifyPhaseTwoArchitecture,
    'function',
    'verifyPhaseTwoArchitecture must be implemented',
  );
  return architecture.verifyPhaseTwoArchitecture(sources);
}

test('accepts a Phase-2 compliant backend command and event boundary', () => {
  assert.deepEqual(verifyPhaseTwoArchitecture(cleanPhaseTwoSources), []);
});

test('rejects commands imports from stored state, events, menu, and adapters', () => {
  for (const path of Object.keys(cleanPhaseTwoSources.protectedSources)) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.protectedSources[path] = 'use crate::commands::open_archive;\n';
    assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
      `${path} must not depend on src-tauri/src/commands`,
    ]);
  }
});

test('rejects commands imported through a grouped crate use', () => {
  const rootCommandImports = [
    'use crate::{commands::open_archive, sidecar_process::SidecarClient};\n',
    'use crate::{commands as workflow_commands, sidecar_process::SidecarClient};\n',
    'use crate::{commands::{open_archive as load_archive}, sidecar_process::SidecarClient};\n',
  ];

  for (const rootCommandImport of rootCommandImports) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.protectedSources['src-tauri/src/state.rs'] = rootCommandImport;
    assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
      'src-tauri/src/state.rs must not depend on src-tauri/src/commands',
    ]);
  }
});

test('allows nested modules named commands in a grouped crate use', () => {
  const nestedCommandImports = [
    'use crate::{sidecar_process::commands::Command};\n',
    'use crate::{sidecar_process::{commands::Command, SidecarClient}};\n',
    'use crate::{sidecar_process::{commands::{Command, Other}}, state::AppState};\n',
  ];

  for (const nestedCommandImport of nestedCommandImports) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.protectedSources['src-tauri/src/state.rs'] = nestedCommandImport;
    assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
  }
});

test('rejects fully-qualified and aliased command dependencies', () => {
  const dependencies = [
    'fn call() { crate::commands::open_archive(); }\n',
    'use crate::commands as workflow_commands;\nfn call() { workflow_commands::open_archive(); }\n',
  ];

  for (const dependency of dependencies) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.protectedSources['src-tauri/src/state.rs'] = dependency;
    assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
      'src-tauri/src/state.rs must not depend on src-tauri/src/commands',
    ]);
  }
});

test('ignores command dependency text inside comments and strings', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.protectedSources['src-tauri/src/state.rs'] = `
    use third_party::commands::Command;
    // crate::commands::open_archive();
    /* use crate::commands as workflow_commands; */
    const NORMAL: &str = "use crate::commands::open_archive;";
    const RAW: &str = r#"crate::commands::open_archive()"#;
  `;

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
});

test('rejects Tauri command definitions outside commands modules', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.protectedSources['src-tauri/src/system_fonts.rs'] =
    '#[tauri::command]\npub async fn list_system_fonts() {}\n';

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    'Tauri commands must be defined only in src-tauri/src/commands/*.rs',
  ]);
});

test('rejects Tauri command definitions in any non-command backend module', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.nonCommandSources['src-tauri/src/ipc_contracts.rs'] =
    '#[tauri::command]\nfn rogue_test_command() {}\n';

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    'Tauri commands must be defined only in src-tauri/src/commands/*.rs',
  ]);
});

test('ignores Tauri command annotation text in comments and strings', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.nonCommandSources['src-tauri/src/ipc_contracts.rs'] = `
    // #[tauri::command]
    /* #[tauri::command] fn commented_out() {} */
    const NORMAL: &str = "#[tauri::command] fn string_only() {}";
    const RAW: &str = r#"#[tauri::command] fn raw_string_only() {}"#;
  `;

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
});

test('rejects a changed or reordered backend handler allowlist', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.libSource = sources.libSource.replace(
    'validate_path,platform_hints',
    'platform_hints,validate_path',
  );

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    `backend handlers must be exactly: ${expectedCommandNames.join(', ')}`,
  ]);
});

test('rejects a changed backend command definition allowlist', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  delete sources.commandSources['src-tauri/src/commands/validate_path.rs'];
  sources.commandSources['src-tauri/src/commands/renamed.rs'] =
    '#[tauri::command]\nfn validate_source_path() {}\n';

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    `backend command definitions must be exactly: ${expectedCommandNames.join(', ')}`,
  ]);
});

test('rejects a changed backend event allowlist', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.eventSource = sources.eventSource.replace(
    '"search-result"',
    '"search-complete"',
  );

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    `backend events must be exactly: ${expectedEventNames.join(', ')}`,
  ]);
});

const cleanPhaseThreeSources = {
  frontendSources: {
    'src/ipc/commands.ts': [
      'import { invoke } from "@tauri-apps/api/core";',
      ...expectedCommandNames.map((name) => `const ${name.toUpperCase()} = "${name}";`),
    ].join('\n'),
    'src/ipc/events.ts': [
      'import { listen } from "@tauri-apps/api/event";',
      ...expectedEventNames.map((name, index) => `const EVENT_${index} = "${name}";`),
    ].join('\n'),
    'src/ipc/platform.ts': 'import { open } from "@tauri-apps/plugin-dialog";\n',
    'src/App.tsx': 'import { openArchive } from "@/ipc/commands";\n',
    'src/App.test.tsx': 'vi.mock("@tauri-apps/api/core", () => ({}));\nconst command = "open_archive";\n',
  },
};

function verifyPhaseThreeArchitecture(sources) {
  assert.equal(
    typeof architecture.verifyPhaseThreeArchitecture,
    'function',
    'verifyPhaseThreeArchitecture must be implemented',
  );
  return architecture.verifyPhaseThreeArchitecture(sources);
}

test('accepts a Phase-3 compliant frontend IPC boundary', () => {
  assert.deepEqual(verifyPhaseThreeArchitecture(cleanPhaseThreeSources), []);
});

test('rejects static and dynamic Tauri imports outside src/ipc', () => {
  const invalidImports = [
    'import { invoke } from "@tauri-apps/api/core";\n',
    'import "@tauri-apps/plugin-dialog";\n',
    'const eventApi = await import("@tauri-apps/api/event");\n',
  ];

  for (const invalidImport of invalidImports) {
    const sources = structuredClone(cleanPhaseThreeSources);
    sources.frontendSources['src/App.tsx'] = invalidImport;
    assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
      'src/App.tsx must not import @tauri-apps/* outside src/ipc',
    ]);
  }
});

test('allows Tauri package mocks in test files', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/App.test.tsx'] = [
    'vi.mock("@tauri-apps/api/core", () => ({}));',
    'vi.mock("@tauri-apps/plugin-dialog", () => ({}));',
  ].join('\n');

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), []);
});

test('rejects direct Tauri internals access outside src/ipc production files', () => {
  const internalAccesses = [
    `
      const { invoke: rawInvoke, listen: rawListen } = window.__TAURI_INTERNALS__;
      rawInvoke("open_archive");
      rawListen("search-result", handler);
    `,
    'const internals = globalThis["__TAURI_INTERNALS__"];\n',
  ];

  for (const internalAccess of internalAccesses) {
    const sources = structuredClone(cleanPhaseThreeSources);
    sources.frontendSources['src/App.tsx'] = internalAccess;
    assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
      'src/App.tsx must not access __TAURI_INTERNALS__ outside src/ipc',
    ]);
  }
});

test('rejects statically computed and reflected Tauri internals access', () => {
  const internalAccesses = [
    'const internals = globalThis["__TAURI_" + "INTERNALS__"];\n',
    'const internals = window[(("__TAURI_") + "INTERNALS__")];\n',
    'const internals = Reflect.get(globalThis, "__TAURI_INTERNALS__");\n',
    'const present = Reflect.has(window, "__TAURI_" + "INTERNALS__");\n',
  ];

  for (const internalAccess of internalAccesses) {
    const sources = structuredClone(cleanPhaseThreeSources);
    sources.frontendSources['src/App.tsx'] = internalAccess;
    assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
      'src/App.tsx must not access __TAURI_INTERNALS__ outside src/ipc',
    ]);
  }
});

test('allows standalone internals strings and reflection on unrelated objects', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/App.tsx'] = `
    const key = "__TAURI_" + "INTERNALS__";
    const value = Reflect.get(config, "__TAURI_INTERNALS__");
    const present = Reflect.has(settings, "__TAURI_" + "INTERNALS__");
  `;

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), []);
});

test('rejects raw backend command and event literals outside src/ipc production files', () => {
  const rawCalls = ['invoke("open_archive")', 'listen("search-result", handler)'];

  for (const rawCall of rawCalls) {
    const sources = structuredClone(cleanPhaseThreeSources);
    sources.frontendSources['src/App.tsx'] = `${rawCall};\n`;
    assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
      'src/App.tsx must not contain raw backend command/event literals outside src/ipc',
    ]);
  }
});

test('allows product copy that happens to equal a backend command name', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/components/SearchBar.tsx'] = `
    const tab = "search";
    const action = "clear_staged";
  `;

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), []);
});

test('rejects a missing or renamed frontend IPC command literal', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/ipc/commands.ts'] =
    sources.frontendSources['src/ipc/commands.ts'].replace(
      '"validate_path"',
      '"validate_source_path"',
    );

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
    `frontend IPC command literals must be exactly: ${expectedCommandNames.join(', ')}`,
  ]);
});

test('rejects a missing or renamed frontend IPC event literal', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/ipc/events.ts'] =
    sources.frontendSources['src/ipc/events.ts'].replace(
      '"search-result"',
      '"search-complete"',
    );

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
    `frontend IPC event literals must be exactly: ${expectedEventNames.join(', ')}`,
  ]);
});

test('ignores import and command text in comments and unrelated string literals', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/App.tsx'] = `
    // import { invoke } from "@tauri-apps/api/core";
    /* import "@tauri-apps/plugin-dialog"; */
    const note = "open_archive_notes";
    const internalsNote = "window.__TAURI_INTERNALS__";
    // const internals = window.__TAURI_INTERNALS__;
    /* globalThis["__TAURI_INTERNALS__"] */
  `;

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), []);
});
