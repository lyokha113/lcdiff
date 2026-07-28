import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const backendCommandNames = [
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

const backendEventNames = [
  'search-progress',
  'search-result',
  'os-open-paths',
  'app-action',
];

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

function registeredHandlerNames(source) {
  const match = source.match(/tauri::generate_handler!\s*\[([\s\S]*?)]/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function stripRustCommentsAndLiterals(source) {
  const output = [...source];
  const blank = (index) => {
    if (output[index] !== '\n' && output[index] !== '\r') {
      output[index] = ' ';
    }
  };

  for (let index = 0; index < source.length; ) {
    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') {
        blank(index);
        index += 1;
      }
      continue;
    }

    if (source.startsWith('/*', index)) {
      let depth = 1;
      blank(index);
      blank(index + 1);
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith('/*', index)) {
          depth += 1;
          blank(index);
          blank(index + 1);
          index += 2;
        } else if (source.startsWith('*/', index)) {
          depth -= 1;
          blank(index);
          blank(index + 1);
          index += 2;
        } else {
          blank(index);
          index += 1;
        }
      }
      continue;
    }

    const rawPrefix = source.slice(index).match(/^(?:b|c)?r(#+)?"/);
    if (rawPrefix) {
      const hashes = rawPrefix[1] ?? '';
      const terminator = `"${hashes}`;
      const start = index;
      index += rawPrefix[0].length;
      const end = source.indexOf(terminator, index);
      index = end === -1 ? source.length : end + terminator.length;
      for (let cursor = start; cursor < index; cursor += 1) {
        blank(cursor);
      }
      continue;
    }

    const quotedPrefix = source.slice(index).match(/^(?:b|c)?"/);
    if (quotedPrefix) {
      const start = index;
      index += quotedPrefix[0].length;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += Math.min(2, source.length - index);
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      for (let cursor = start; cursor < index; cursor += 1) {
        blank(cursor);
      }
      continue;
    }

    index += 1;
  }

  return output.join('');
}

function tauriCommandNames(source) {
  const code = stripRustCommentsAndLiterals(source);
  return [
    ...code.matchAll(
      /#\s*\[\s*tauri::command\s*]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    ),
  ].map((match) => match[1]);
}

function declaredEventNames(source) {
  return [
    ...source.matchAll(
      /\bconst\s+[A-Z][A-Z0-9_]*\s*:\s*&str\s*=\s*["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

function dependsOnCommands(source) {
  const code = stripRustCommentsAndLiterals(source);
  if (
    /\b(?:crate|self|super(?:::\s*super)*)\s*::\s*commands\b/.test(
      code,
    )
  ) {
    return true;
  }
  return [...code.matchAll(/\buse\s+([\s\S]*?);/g)].some((match) =>
    /^\s*(?:crate|self|super(?:::\s*super)*)\s*::\s*\{[\s\S]*?\bcommands\b/.test(
      match[1],
    ),
  );
}

function sameOrderedValues(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameValueSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

export function verifyPhaseTwoArchitecture({
  libSource,
  commandSources,
  eventSource,
  protectedSources,
  nonCommandSources = {},
}) {
  const violations = [];

  for (const [path, source] of Object.entries(protectedSources)) {
    if (dependsOnCommands(source)) {
      violations.push(`${path} must not depend on src-tauri/src/commands`);
    }
  }

  const outsideCommandSources = [
    libSource,
    ...Object.values(protectedSources),
    ...Object.values(nonCommandSources),
  ];
  if (outsideCommandSources.some((source) => tauriCommandNames(source).length > 0)) {
    violations.push(
      'Tauri commands must be defined only in src-tauri/src/commands/*.rs',
    );
  }

  const handlers = registeredHandlerNames(libSource);
  if (!sameOrderedValues(handlers, backendCommandNames)) {
    violations.push(
      `backend handlers must be exactly: ${backendCommandNames.join(', ')}`,
    );
  }

  const commands = Object.values(commandSources).flatMap(tauriCommandNames);
  if (!sameValueSet(commands, backendCommandNames)) {
    violations.push(
      `backend command definitions must be exactly: ${backendCommandNames.join(', ')}`,
    );
  }

  const events = declaredEventNames(eventSource);
  if (!sameValueSet(events, backendEventNames)) {
    violations.push(
      `backend events must be exactly: ${backendEventNames.join(', ')}`,
    );
  }

  return violations;
}

function readTrackedSource(path) {
  execFileSync('git', ['ls-files', '--error-unmatch', path], { stdio: 'ignore' });
  return readFileSync(path, 'utf8');
}

function readRustSources(directory) {
  if (!existsSync(directory)) {
    return {};
  }
  return Object.fromEntries(
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return Object.entries(readRustSources(path));
      }
      return entry.isFile() && entry.name.endsWith('.rs')
        ? [[path, readFileSync(path, 'utf8')]]
        : [];
    }),
  );
}

export function verifyRepository() {
  const rustSources = readRustSources('src-tauri/src');
  const mainSource = rustSources['src-tauri/src/main.rs'];
  const coreCargoToml = readTrackedSource('crates/lcdiff-core/Cargo.toml');
  const libSource = rustSources['src-tauri/src/lib.rs'];
  const protectedPaths = [
    'src-tauri/src/state.rs',
    'src-tauri/src/events.rs',
    'src-tauri/src/menu.rs',
    'src-tauri/src/sidecar_process.rs',
    'src-tauri/src/system_fonts.rs',
  ];
  const commandDirectory = 'src-tauri/src/commands';
  const commandSources = Object.fromEntries(
    Object.entries(rustSources).filter(([path]) =>
      path.startsWith(`${commandDirectory}/`),
    ),
  );
  const nonCommandSources = Object.fromEntries(
    Object.entries(rustSources).filter(
      ([path]) => !path.startsWith(`${commandDirectory}/`),
    ),
  );

  return [
    ...verifyPhaseOneArchitecture({ mainSource, coreCargoToml }),
    ...verifyPhaseTwoArchitecture({
      libSource,
      commandSources,
      eventSource: rustSources['src-tauri/src/events.rs'],
      protectedSources: Object.fromEntries(
        protectedPaths.map((path) => [path, rustSources[path]]),
      ),
      nonCommandSources,
    }),
  ];
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
