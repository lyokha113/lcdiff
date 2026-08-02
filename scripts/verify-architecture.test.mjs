import assert from 'node:assert/strict';
import test from 'node:test';

import * as architecture from './verify-architecture.mjs';

const { verifyPhaseOneArchitecture } = architecture;

const cleanMain = `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
  lcdiff_desktop::run();
}
`;
const cleanCoreCargoToml = '[dependencies]\nserde = "1"\n';
const desktopEntrypointMessage =
  'src-tauri/src/main.rs must be the Windows GUI attribute plus the thin lcdiff_desktop::run() entrypoint';

test('accepts a Phase-1 compliant source pair', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: cleanMain,
      coreCargoToml: cleanCoreCargoToml,
    }),
    [],
  );
});

test('allows comments and formatting around the exact desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: `
        #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
        // The binary delegates all composition to the library crate.
        fn main ( ) {
          lcdiff_desktop :: run ( ) ;
        }
      `,
      coreCargoToml: cleanCoreCargoToml,
    }),
    [],
  );
});

test('rejects any extra crate attribute on the desktop entrypoint', () => {
  const errors = verifyPhaseOneArchitecture({
    mainSource:
      '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n' +
      '#![allow(dead_code)]\n' +
      'fn main() { lcdiff_desktop::run(); }\n',
    coreCargoToml: cleanCoreCargoToml,
  });
  assert.deepEqual(errors, [desktopEntrypointMessage]);
});

test('rejects every non-composition desktop entrypoint shape', () => {
  const invalidEntrypoints = [
    'fn main() {}\n',
    'use lcdiff_desktop::run;\nfn main() { run(); }\n',
    'fn helper() {}\nfn main() { lcdiff_desktop::run(); }\n',
    'fn main() { println!("starting"); lcdiff_desktop::run(); }\n',
    'fn main() { other_desktop::run(); }\n',
  ];

  for (const mainSource of invalidEntrypoints) {
    assert.deepEqual(
      verifyPhaseOneArchitecture({
        mainSource,
        coreCargoToml: cleanCoreCargoToml,
      }),
      [
        desktopEntrypointMessage,
      ],
    );
  }
});

test('rejects AppState ownership in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: 'struct AppState {}\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    [
      desktopEntrypointMessage,
      'src-tauri/src/main.rs must not define struct AppState',
    ],
  );
});

test('rejects Tauri commands in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: '#[tauri::command]\nfn open_archive() {}\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    [
      desktopEntrypointMessage,
      'src-tauri/src/main.rs must not define #[tauri::command] handlers',
    ],
  );
});

test('rejects event emission in the desktop entrypoint', () => {
  assert.deepEqual(
    verifyPhaseOneArchitecture({
      mainSource: 'window.emit("search-progress", payload)?;\n',
      coreCargoToml: cleanCoreCargoToml,
    }),
    [
      desktopEntrypointMessage,
      'src-tauri/src/main.rs must not call .emit(',
    ],
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
      desktopEntrypointMessage,
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
  'open_compare_sources',
  'compute_diff',
  'compute_nested_diff',
  'open_view_source',
  'list_view_sources',
  'read_entry',
  'read_text_file',
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
  'create_temp_target',
  'preview_merge_all_conflicts',
  'stage_temp_merge_all',
  'apply_temp_merge',
  'save_temp_target_as',
  'discard_temp_target',
];

const expectedFrontendCommandNames = [...expectedCommandNames];

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
    'src-tauri/src/archive_access.rs': 'use crate::state::SideSnapshot;\n',
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

test('rejects command submodule dependencies on sibling command submodules', () => {
  const siblingDependencies = [
    'use crate::commands::archive::resolve_view_entry;\n',
    'use crate::commands::{archive::resolve_view_entry, preview as preview_workflow};\n',
    'use crate::{commands::{archive as archive_workflow}, state::AppState};\n',
    'use super::archive::resolve_view_entry;\n',
    'use super::{archive as archive_workflow, search::search_archive};\n',
    'fn call() { crate::commands::archive::resolve_view_entry(); }\n',
    'use crate::commands as workflows;\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use super as workflows;\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use crate::{commands as workflows};\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use crate::commands::{self as workflows};\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use super::{self as workflows};\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use super::super::commands::archive::resolve_view_entry;\n',
    'use super::super::{commands::{archive as archive_workflow}};\n',
    'use super::super::commands as workflows;\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use super::super::{commands as workflows};\nfn call() { workflows::archive::resolve_view_entry(); }\n',
    'use super::super::commands::{self as workflows};\nfn call() { workflows::archive::resolve_view_entry(); }\n',
  ];

  for (const dependency of siblingDependencies) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.commandSources['src-tauri/src/commands/preview.rs'] = [
      '#[tauri::command]\nfn read_entry() {}\n',
      dependency,
    ].join('');
    delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];
    assert.deepEqual(
      verifyPhaseTwoArchitecture(sources),
      [
        'src-tauri/src/commands/preview.rs must not depend on sibling command submodules',
      ],
      dependency,
    );
  }
});

test('rejects temporary merge command dependencies on sibling command modules', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  for (const commandName of [
    'create_temp_target',
    'preview_merge_all_conflicts',
    'stage_temp_merge_all',
    'apply_temp_merge',
    'save_temp_target_as',
    'discard_temp_target',
  ]) {
    delete sources.commandSources[`src-tauri/src/commands/${commandName}.rs`];
  }
  sources.commandSources['src-tauri/src/commands/temp_merge.rs'] = `
    use super::merge::commit_merge;
    ${[
      'create_temp_target',
      'preview_merge_all_conflicts',
      'stage_temp_merge_all',
      'apply_temp_merge',
      'save_temp_target_as',
      'discard_temp_target',
    ]
      .map((name) => `#[tauri::command]\nfn ${name}() {}`)
      .join('\n')}
  `;

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), [
    'src-tauri/src/commands/temp_merge.rs must not depend on sibling command submodules',
  ]);
});

test('rejects command submodule dependencies through commands root reexports', () => {
  const siblingReexportDependencies = [
    'use crate::commands::open_archive;\n',
    'use crate::commands::{open_archive as load_archive};\n',
    'use crate::{commands::open_archive};\n',
    'use crate::{commands::{open_archive as load_archive}};\n',
    'use super::open_archive;\n',
    'use super::{open_archive as load_archive};\n',
    'fn call() { crate::commands::open_archive(); }\n',
    'use crate::commands as workflows;\nfn call() { workflows::open_archive(); }\n',
    'use crate::{commands as workflows};\nfn call() { workflows::open_archive(); }\n',
    'use super as workflows;\nfn call() { workflows::open_archive(); }\n',
    'use crate::commands::*;\n',
    'use super::*;\n',
  ];

  for (const dependency of siblingReexportDependencies) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.commandSources['src-tauri/src/commands/preview.rs'] = [
      '#[tauri::command]\nfn read_entry() {}\n',
      dependency,
    ].join('');
    delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];
    assert.deepEqual(
      verifyPhaseTwoArchitecture(sources),
      [
        'src-tauri/src/commands/preview.rs must not depend on sibling command submodules',
      ],
      dependency,
    );
  }
});

test('rejects command submodule dependencies through transitive commands root aliases', () => {
  const transitiveRootAliases = [
    `
      use crate::commands as workflows;
      use workflows as forwarding;
      fn call() { forwarding::open_archive(); }
    `,
    `
      use crate::{commands as workflows};
      use workflows::{self as forwarding};
      fn call() { forwarding::open_archive(); }
    `,
    `
      use super as workflows;
      use workflows as forwarding;
      fn call() { forwarding::open_archive(); }
    `,
    `
      use super::super::commands as workflows;
      use workflows as forwarding;
      fn call() { forwarding::open_archive(); }
    `,
    `
      use crate::commands as workflows;
      use workflows as forwarding;
      use forwarding as final_root;
      fn call() { final_root::open_archive(); }
    `,
    `
      use crate::commands as workflows;
      use {workflows as forwarding};
      use forwarding::{open_archive as load_archive};
    `,
    `
      use crate::commands as workflows;
      use self::workflows as forwarding;
      fn call() { forwarding::open_archive(); }
    `,
    `
      use crate::commands as workflows;
      use self::{workflows as forwarding};
      fn call() { forwarding::open_archive(); }
    `,
    `
      use crate::commands as workflows;
      mod nested {
        use super::workflows::{self as forwarding};
        fn call() { forwarding::open_archive(); }
      }
    `,
    `
      pub(crate) use crate::commands as workflows;
      pub(super) use workflows as forwarding;
      fn call() { forwarding::open_archive(); }
    `,
    `
      use crate::commands as workflows;
      use workflows as forwarding;
      use forwarding::*;
    `,
  ];

  for (const dependency of transitiveRootAliases) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.commandSources['src-tauri/src/commands/preview.rs'] = [
      '#[tauri::command]\nfn read_entry() {}\n',
      dependency,
    ].join('');
    delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];
    assert.deepEqual(
      verifyPhaseTwoArchitecture(sources),
      [
        'src-tauri/src/commands/preview.rs must not depend on sibling command submodules',
      ],
      dependency,
    );
  }
});

test('allows neutral transitive aliases and ignores command alias text', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.commandSources['src-tauri/src/commands/preview.rs'] = `
    use crate::commands as workflows;
    use crate::archive_access as access;
    use access as forwarding;
    // use workflows as forwarding;
    /* use forwarding as final_root; */
    const NOTE: &str = "forwarding::open_archive";
    fn call() { forwarding::resolve_view_entry(); }
    #[tauri::command]
    fn read_entry() {}
  `;
  delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
});

test('allows command submodules to use neutral backend services', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.commandSources['src-tauri/src/commands/preview.rs'] = `
    use crate::{
      archive_access::{resolve_side_entry, resolve_view_entry},
      sidecar_process::SidecarClient,
      state::SharedState,
    };
    #[tauri::command]
    fn read_entry() {}
  `;
  delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
});

test('ignores sibling command dependency text inside comments and strings', () => {
  const sources = structuredClone(cleanPhaseTwoSources);
  sources.commandSources['src-tauri/src/commands/preview.rs'] = `
    // use crate::commands::archive::resolve_view_entry;
    /* use super::{archive as archive_workflow}; */
    const NOTE: &str = "crate::commands::archive::resolve_view_entry";
    #[tauri::command]
    fn read_entry() {}
  `;
  delete sources.commandSources['src-tauri/src/commands/read_entry.rs'];

  assert.deepEqual(verifyPhaseTwoArchitecture(sources), []);
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

test('rejects direct, qualified, aliased, and glob command dependencies from archive access', () => {
  const reverseDependencies = [
    'use crate::commands::open_archive;\n',
    'fn call() { crate::commands::open_archive(); }\n',
    'use crate::commands as workflows;\nfn call() { workflows::open_archive(); }\n',
    'use crate::{commands as workflows};\nfn call() { workflows::open_archive(); }\n',
    'use super::commands::open_archive;\n',
    'use super::commands as workflows;\nfn call() { workflows::open_archive(); }\n',
    'use crate::commands::*;\n',
    'use crate::commands as workflows;\nuse workflows as forwarding;\nfn call() { forwarding::open_archive(); }\n',
  ];

  for (const dependency of reverseDependencies) {
    const sources = structuredClone(cleanPhaseTwoSources);
    sources.protectedSources['src-tauri/src/archive_access.rs'] = dependency;
    assert.deepEqual(
      verifyPhaseTwoArchitecture(sources),
      [
        'src-tauri/src/archive_access.rs must not depend on src-tauri/src/commands',
      ],
      dependency,
    );
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
      ...expectedFrontendCommandNames.map(
        (name) => `const ${name.toUpperCase()} = "${name}";`,
      ),
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

test('rejects non-literal dynamic imports outside src/ipc production files', () => {
  const invalidImports = [
    'const api = await import(moduleName);\n',
    'const api = await import(`@tauri-apps/${packageName}`);\n',
    'const api = await import(resolveModule());\n',
  ];

  for (const invalidImport of invalidImports) {
    const sources = structuredClone(cleanPhaseThreeSources);
    sources.frontendSources['src/features/search/search.ts'] = invalidImport;
    assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
      'src/features/search/search.ts must not use a non-literal dynamic import outside src/ipc',
    ]);
  }
});

test('allows literal dynamic imports, IPC-owned dynamic imports, and test fixtures', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/features/search/search.ts'] =
    'const helpers = await import("./search-helpers");\n';
  sources.frontendSources['src/ipc/platform.ts'] =
    'const api = await import(tauriPackageName);\n';
  sources.frontendSources['src/features/search/search.test.ts'] =
    'const fixture = await import(moduleName);\n';

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
    `frontend IPC command literals must be exactly: ${expectedFrontendCommandNames.join(', ')}`,
  ]);
});

test('rejects a missing or renamed temporary merge IPC command literal', () => {
  const sources = structuredClone(cleanPhaseThreeSources);
  sources.frontendSources['src/ipc/commands.ts'] =
    sources.frontendSources['src/ipc/commands.ts'].replace(
      '"create_temp_target"',
      '"create_temporary_target"',
    );

  assert.deepEqual(verifyPhaseThreeArchitecture(sources), [
    `frontend IPC command literals must be exactly: ${expectedFrontendCommandNames.join(', ')}`,
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

const cleanPhaseFourSources = {
  frontendSources: {
    'src/lib/format.ts': 'export const format = (value) => String(value);\n',
    'src/components/ui/button.tsx': 'import type { ButtonHTMLAttributes } from "react";\n',
    'src/features/search/SearchBar.tsx': 'import { Button } from "@/components/ui/button";\n',
    'src/features/workspace/DiffView.tsx': 'import type { ComparePair } from "@/lib/types";\n',
    'src/app/App.tsx': 'import { SearchBar } from "@/features/search/SearchBar";\n',
  },
};

function verifyPhaseFourArchitecture(sources) {
  assert.equal(
    typeof architecture.verifyPhaseFourArchitecture,
    'function',
    'verifyPhaseFourArchitecture must be implemented',
  );
  return architecture.verifyPhaseFourArchitecture(sources);
}

test('accepts a Phase-4 compliant frontend ownership boundary', () => {
  assert.deepEqual(verifyPhaseFourArchitecture(cleanPhaseFourSources), []);
});

test('rejects React, Monaco, Tauri, and feature imports from src/lib', () => {
  const invalidImports = [
    'import { useMemo } from "react";\n',
    'import { createRoot } from "react-dom/client";\n',
    'import Editor from "@monaco-editor/react";\n',
    'import type { EditorProps } from "@monaco-editor/react/dist/index";\n',
    'import type { editor } from "monaco-editor";\n',
    'import { invoke } from "@tauri-apps/api/core";\n',
    'import { SearchBar } from "@/features/search/SearchBar";\n',
    'import { SearchBar } from "@/lib/../features/search/SearchBar";\n',
  ];

  for (const invalidImport of invalidImports) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/lib/format.ts'] = invalidImport;
    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/lib/format.ts must remain React-free, Monaco-free, Tauri-free, and feature-free',
    ]);
  }
});

test('rejects feature-to-feature React component imports', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/search/SearchBar.tsx'] =
    'import { DiffView } from "@/features/workspace/DiffView";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/SearchBar.tsx must not import React component src/features/workspace/DiffView.tsx from another feature',
  ]);
});

test('normalizes aliased traversal before checking feature ownership', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/search/SearchBar.tsx'] =
    'import { DiffView } from "@/features/search/../workspace/DiffView";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/SearchBar.tsx must not import React component src/features/workspace/DiffView.tsx from another feature',
  ]);
});

test('allows cross-feature imports of non-component contracts', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/search/search.ts'] =
    'import type { UiPreferences } from "@/features/preferences/preferences";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('rejects feature imports from the app composition root', () => {
  const reverseImports = [
    'import { compose } from "@/app/App";\n',
    'import { compose } from "@/features/search/../../../src/app/App";\n',
    'import { compose } from "../../app/App";\n',
  ];

  for (const reverseImport of reverseImports) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/features/search/search.ts'] = reverseImport;
    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/features/search/search.ts must not depend on src/app',
    ]);
  }
});

test('rejects feature imports that reach src/app through a barrel', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/bridge/index.ts'] =
    'export { default as App } from "@/app/App";\n';
  sources.frontendSources['src/features/search/search.ts'] =
    'import { App } from "@/bridge";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/search.ts must not depend on src/app',
  ]);
});

test('rejects cross-feature React components re-exported through barrels', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/workspace/index.ts'] =
    'export { DiffView } from "./DiffView";\n';
  sources.frontendSources['src/features/search/SearchBar.tsx'] =
    'import { DiffView } from "@/features/workspace";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/SearchBar.tsx must not import React components through src/features/workspace/index.ts from another feature',
  ]);
});

test('rejects cross-feature React components imported then re-exported through barrels', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/workspace/index.ts'] = `
    import { DiffView } from "./DiffView";
    export { DiffView };
  `;
  sources.frontendSources['src/features/search/SearchBar.tsx'] =
    'import { DiffView } from "@/features/workspace";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/SearchBar.tsx must not import React components through src/features/workspace/index.ts from another feature',
  ]);
});

test('rejects cross-feature React components re-exported through a neutral bridge', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/bridge/index.ts'] = `
    import { DiffView } from "@/features/workspace/DiffView";
    export { DiffView };
  `;
  sources.frontendSources['src/features/search/SearchBar.tsx'] =
    'import { DiffView } from "@/bridge";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/features/search/SearchBar.tsx must not import React components through src/bridge/index.ts from another feature',
  ]);
});

test('rejects cross-feature React components re-exported through static aliases', () => {
  const aliasBarrels = [
    `
      import { DiffView } from "@/features/workspace/DiffView";
      const Exported = DiffView;
      export { Exported };
    `,
    `
      import { DiffView } from "@/features/workspace/DiffView";
      const First = DiffView;
      const Exported = First;
      export { Exported };
    `,
    `
      import { DiffView } from "@/features/workspace/DiffView";
      export const Exported = DiffView;
    `,
  ];

  for (const barrel of aliasBarrels) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/bridge/index.ts'] = barrel;
    sources.frontendSources['src/features/search/SearchBar.tsx'] =
      'import { Exported } from "@/bridge";\n';

    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/features/search/SearchBar.tsx must not import React components through src/bridge/index.ts from another feature',
    ]);
  }
});

test('allows pure contracts and dynamic expressions assigned to exported aliases', () => {
  const allowedBarrels = [
    `
      import { format } from "@/lib/format";
      const Exported = format;
      export { Exported };
    `,
    `
      import { DiffView } from "@/features/workspace/DiffView";
      const Exported = chooseComponent(DiffView);
      export { Exported };
    `,
  ];

  for (const barrel of allowedBarrels) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/bridge/index.ts'] = barrel;
    sources.frontendSources['src/features/search/search.ts'] =
      'import { Exported } from "@/bridge";\n';

    assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
  }
});

test('allows cross-feature pure contracts re-exported through barrels', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/preferences/index.ts'] =
    'export type { UiPreferences } from "./preferences";\n';
  sources.frontendSources['src/features/search/search.ts'] =
    'import type { UiPreferences } from "@/features/preferences";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('allows cross-feature pure contracts imported then re-exported through barrels', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/features/preferences/index.ts'] = `
    import type { UiPreferences } from "./preferences";
    export type { UiPreferences };
  `;
  sources.frontendSources['src/features/search/search.ts'] =
    'import type { UiPreferences } from "@/features/preferences";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('allows cross-feature pure contracts re-exported through a neutral bridge', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/bridge/index.ts'] = `
    import type { UiPreferences } from "@/features/preferences/preferences";
    export type { UiPreferences };
  `;
  sources.frontendSources['src/features/search/search.ts'] =
    'import type { UiPreferences } from "@/bridge";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('rejects non-primitive files under src/components', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/components/LegacyPanel.tsx'] =
    'export function LegacyPanel() { return null; }\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/components/LegacyPanel.tsx must move to a feature; only src/components/ui primitives may remain',
  ]);
});

test('rejects non-allowlisted files under src/components/ui', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/components/ui/FeaturePanel.tsx'] =
    'export function FeaturePanel() { return null; }\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), [
    'src/components/ui/FeaturePanel.tsx is not an approved shared UI primitive',
  ]);
});

test('allows colocated tests for approved UI primitives', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/components/ui/button.test.tsx'] =
    'import { Button } from "./button";\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('ignores Phase-4 import text in comments and unrelated strings', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/lib/format.ts'] = `
    // import Editor from "@monaco-editor/react/dist/index";
    /* import { SearchBar } from "@/features/search/SearchBar"; */
    const note = "@/features/search/SearchBar";
  `;
  sources.frontendSources['src/app/App.tsx'] = `
    // import { stageViewWrite } from "@/ipc/commands";
    /* import { readEntry } from "@/ipc/commands"; */
    const note = "@/features/workspace/monaco-runtime";
  `;

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('rejects workspace lifecycle infrastructure imports from the app root', () => {
  const forbiddenImports = [
    'import "@/features/workspace/monaco-runtime";\n',
    'import type { MonacoApi } from "@/features/workspace/editor-types";\n',
    'import { evictLru } from "@/features/workspace/tabs";\n',
    'import { evictLru } from "@/features/workspace/../workspace/tabs";\n',
    'import { evictLru } from "../features/workspace/tabs";\n',
    'import { readEntry } from "@/ipc/commands";\n',
    'import { readEntry } from "@/ipc/../ipc/commands";\n',
    'import { readEntry } from "../ipc/commands";\n',
  ];

  for (const forbiddenImport of forbiddenImports) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/app/App.tsx'] = forbiddenImport;
    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/app/App.tsx must delegate workspace lifecycle ownership to a workspace controller',
    ]);
  }
});

test('rejects merge staging infrastructure imports from the app root', () => {
  const forbiddenImports = [
    'import { beginStagingOperation } from "@/features/merge/staging";\n',
    'import { beginStagingOperation } from "@/features/merge/../merge/staging";\n',
    'import { beginStagingOperation } from "../features/merge/staging";\n',
    'import { stageViewWrite } from "@/ipc/commands";\n',
    'import { stageViewWrite } from "@/ipc/../ipc/commands";\n',
    'import { stageViewWrite } from "../ipc/commands";\n',
  ];

  for (const forbiddenImport of forbiddenImports) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/app/App.tsx'] = forbiddenImport;
    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/app/App.tsx must delegate generation-guarded staging to a merge controller',
    ]);
  }
});

test('rejects dynamic IPC command facade imports from the app root', () => {
  const forbiddenImports = [
    'const commands = await import("../ipc/commands");\ncommands.stageWrite;\n',
    'const commands = await import("@/ipc/commands");\ncommands.stageViewWrite;\n',
    'const commands = await import("@/ipc/../ipc/commands");\ncommands.readEntry;\n',
  ];

  for (const forbiddenImport of forbiddenImports) {
    const sources = structuredClone(cleanPhaseFourSources);
    sources.frontendSources['src/app/App.tsx'] = forbiddenImport;
    assert.deepEqual(verifyPhaseFourArchitecture(sources), [
      'src/app/App.tsx must not dynamically import src/ipc/commands; feature controllers own workspace and merge commands',
    ]);
  }
});

test('allows unrelated dynamic imports from the app root', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/app/App.tsx'] =
    'const helpers = await import("../features/search/search");\nhelpers.searchResultKey;\n';

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});

test('ignores dynamic IPC import text in App comments and strings', () => {
  const sources = structuredClone(cleanPhaseFourSources);
  sources.frontendSources['src/app/App.tsx'] = `
    // const commands = await import("../ipc/commands");
    /* import("@/ipc/commands"); */
    const note = 'import("@/ipc/../ipc/commands")';
  `;

  assert.deepEqual(verifyPhaseFourArchitecture(sources), []);
});
