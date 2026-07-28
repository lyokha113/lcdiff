import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

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

const sharedUiPrimitivePaths = new Set([
  'src/components/ui/badge.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/checkbox.tsx',
  'src/components/ui/context-menu.tsx',
  'src/components/ui/dialog.tsx',
  'src/components/ui/input.tsx',
  'src/components/ui/popover.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/tooltip.tsx',
]);

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

function topLevelUseItems(useTree) {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < useTree.length; index += 1) {
    if (useTree[index] === '{') {
      depth += 1;
    } else if (useTree[index] === '}') {
      depth -= 1;
    } else if (useTree[index] === ',' && depth === 0) {
      items.push(useTree.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(useTree.slice(start).trim());
  return items.filter(Boolean);
}

function groupedUseDependsOnRootCommands(usePath) {
  const group = usePath.match(
    /^\s*(?:crate|self|super(?:::\s*super)*)\s*::\s*\{([\s\S]*)\}\s*$/,
  );
  if (!group) {
    return false;
  }
  return topLevelUseItems(group[1]).some((item) =>
    /^commands\b/.test(item),
  );
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
    groupedUseDependsOnRootCommands(match[1]),
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

function stripJavaScriptComments(source) {
  const output = [...source];
  const blank = (index) => {
    if (output[index] !== '\n' && output[index] !== '\r') {
      output[index] = ' ';
    }
  };

  for (let index = 0; index < source.length; ) {
    const quote = source[index];
    if (quote === '"' || quote === "'" || quote === '`') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += Math.min(2, source.length - index);
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') {
        blank(index);
        index += 1;
      }
      continue;
    }

    if (source.startsWith('/*', index)) {
      blank(index);
      blank(index + 1);
      index += 2;
      while (index < source.length && !source.startsWith('*/', index)) {
        blank(index);
        index += 1;
      }
      if (index < source.length) {
        blank(index);
        blank(index + 1);
        index += 2;
      }
      continue;
    }

    index += 1;
  }

  return output.join('');
}

function importsTauriPackage(source) {
  const code = stripJavaScriptComments(source);
  return (
    /\bfrom\s*["']@tauri-apps\//.test(code) ||
    /\bimport\s*["']@tauri-apps\//.test(code) ||
    /\bimport\s*\(\s*["']@tauri-apps\//.test(code)
  );
}

function quotedStringValues(source) {
  const code = stripJavaScriptComments(source);
  return [...code.matchAll(/(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g)]
    .map((match) => match[2]);
}

function rawIpcCallValues(source) {
  const code = stripJavaScriptComments(source);
  return [
    ...code.matchAll(
      /\b(?:invoke|listen)\s*(?:<[^>]*>)?\s*\(\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g,
    ),
  ].map((match) => match[2]);
}

function unwrapStaticExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticStringValue(node) {
  const expression = unwrapStaticExpression(node);
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(expression.left);
    const right = staticStringValue(expression.right);
    return left === undefined || right === undefined
      ? undefined
      : left + right;
  }
  return undefined;
}

function isGlobalObjectExpression(node) {
  const expression = unwrapStaticExpression(node);
  return (
    ts.isIdentifier(expression) &&
    (expression.text === 'window' || expression.text === 'globalThis')
  );
}

function reflectedMethodName(node) {
  const expression = unwrapStaticExpression(node);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Reflect'
  ) {
    return expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Reflect' &&
    expression.argumentExpression
  ) {
    return staticStringValue(expression.argumentExpression);
  }
  return undefined;
}

function accessesTauriInternals(path, source) {
  const scriptKind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let found = false;

  const visit = (node) => {
    if (
      (ts.isIdentifier(node) && node.text === '__TAURI_INTERNALS__') ||
      (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        staticStringValue(node.argumentExpression) === '__TAURI_INTERNALS__'
      ) ||
      (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
        staticStringValue(node.left) === '__TAURI_INTERNALS__'
      ) ||
      (
        ts.isCallExpression(node) &&
        (reflectedMethodName(node.expression) === 'get' ||
          reflectedMethodName(node.expression) === 'has') &&
        node.arguments.length >= 2 &&
        isGlobalObjectExpression(node.arguments[0]) &&
        staticStringValue(node.arguments[1]) === '__TAURI_INTERNALS__'
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function isFrontendTest(path) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function isFrontendIpc(path) {
  return path.startsWith('src/ipc/');
}

export function verifyPhaseThreeArchitecture({ frontendSources }) {
  const violations = [];
  const productionSources = Object.entries(frontendSources)
    .filter(([path]) => !isFrontendTest(path));

  for (const [path, source] of productionSources) {
    if (!isFrontendIpc(path) && importsTauriPackage(source)) {
      violations.push(`${path} must not import @tauri-apps/* outside src/ipc`);
    }
    if (!isFrontendIpc(path) && accessesTauriInternals(path, source)) {
      violations.push(
        `${path} must not access __TAURI_INTERNALS__ outside src/ipc`,
      );
    }
    if (
      !isFrontendIpc(path) &&
      rawIpcCallValues(source).some(
        (value) => backendCommandNames.includes(value) || backendEventNames.includes(value),
      )
    ) {
      violations.push(
        `${path} must not contain raw backend command/event literals outside src/ipc`,
      );
    }
  }

  const commandLiterals = quotedStringValues(
    frontendSources['src/ipc/commands.ts'] ?? '',
  ).filter((value) => backendCommandNames.includes(value));
  if (!sameValueSet(commandLiterals, backendCommandNames)) {
    violations.push(
      `frontend IPC command literals must be exactly: ${backendCommandNames.join(', ')}`,
    );
  }

  const eventLiterals = quotedStringValues(
    frontendSources['src/ipc/events.ts'] ?? '',
  ).filter((value) => backendEventNames.includes(value));
  if (!sameValueSet(eventLiterals, backendEventNames)) {
    violations.push(
      `frontend IPC event literals must be exactly: ${backendEventNames.join(', ')}`,
    );
  }

  return violations;
}

function frontendSourceFile(sourcePath, source) {
  const scriptKind = sourcePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : sourcePath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : sourcePath.endsWith('.js') || sourcePath.endsWith('.mjs') || sourcePath.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function importedModuleSpecifiers(sourcePath, source) {
  const sourceFile = frontendSourceFile(sourcePath, source);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function normalizedFrontendModulePath(sourcePath, specifier) {
  if (specifier.startsWith('@/')) {
    return path.posix.normalize(`src/${specifier.slice(2)}`);
  }
  if (specifier.startsWith('.')) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(sourcePath), specifier),
    );
  }
  return undefined;
}

function namedImportsFrom(sourcePath, source, modulePath) {
  const sourceFile = frontendSourceFile(sourcePath, source);
  const names = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      normalizedFrontendModulePath(
        sourcePath,
        statement.moduleSpecifier.text,
      ) !== modulePath
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.push('*');
      continue;
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        names.push((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

function dynamicImportModulePaths(sourcePath, source) {
  const sourceFile = frontendSourceFile(sourcePath, source);
  const modulePaths = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const modulePath = normalizedFrontendModulePath(
        sourcePath,
        node.arguments[0].text,
      );
      if (modulePath) modulePaths.push(modulePath);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return modulePaths;
}

function resolvedFrontendImport(sourcePath, specifier, frontendSources) {
  const base = normalizedFrontendModulePath(sourcePath, specifier);
  if (!base) return undefined;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  return candidates.find((candidate) => candidate in frontendSources);
}

function featureName(sourcePath) {
  return sourcePath.match(/^src\/features\/([^/]+)\//)?.[1];
}

function isForbiddenLibImport(sourcePath, specifier) {
  const resolved = normalizedFrontendModulePath(sourcePath, specifier);
  return (
    specifier === 'react' ||
    specifier.startsWith('react/') ||
    specifier === 'react-dom' ||
    specifier.startsWith('react-dom/') ||
    specifier === 'monaco-editor' ||
    specifier.startsWith('monaco-editor/') ||
    specifier === '@monaco-editor/react' ||
    specifier.startsWith('@monaco-editor/react/') ||
    specifier.startsWith('@tauri-apps/') ||
    resolved?.startsWith('src/features/')
  );
}

export function verifyPhaseFourArchitecture({ frontendSources }) {
  const violations = [];
  const productionSources = Object.entries(frontendSources)
    .filter(([sourcePath]) => !isFrontendTest(sourcePath));

  for (const [sourcePath] of productionSources) {
    if (
      sourcePath.startsWith('src/components/') &&
      !sourcePath.startsWith('src/components/ui/')
    ) {
      violations.push(
        `${sourcePath} must move to a feature; only src/components/ui primitives may remain`,
      );
    } else if (
      sourcePath.startsWith('src/components/ui/') &&
      !sharedUiPrimitivePaths.has(sourcePath)
    ) {
      violations.push(
        `${sourcePath} is not an approved shared UI primitive`,
      );
    }
  }

  for (const [sourcePath, source] of productionSources) {
    const specifiers = importedModuleSpecifiers(sourcePath, source);
    const appCommandImports =
      sourcePath === 'src/app/App.tsx'
        ? namedImportsFrom(sourcePath, source, 'src/ipc/commands')
        : [];
    const appDynamicImports =
      sourcePath === 'src/app/App.tsx'
        ? dynamicImportModulePaths(sourcePath, source)
        : [];
    const resolvedSpecifiers = specifiers
      .map((specifier) => normalizedFrontendModulePath(sourcePath, specifier))
      .filter(Boolean);
    if (
      sourcePath === 'src/app/App.tsx' &&
      appDynamicImports.includes('src/ipc/commands')
    ) {
      violations.push(
        'src/app/App.tsx must not dynamically import src/ipc/commands; feature controllers own workspace and merge commands',
      );
    }
    if (
      sourcePath === 'src/app/App.tsx' &&
      (
        resolvedSpecifiers.some((resolved) => [
          'src/features/workspace/monaco-runtime',
          'src/features/workspace/editor-types',
          'src/features/workspace/tabs',
        ].includes(resolved)) ||
        appCommandImports.some((name) => [
          '*',
          'readEntry',
          'readViewEntry',
          'disassemble',
          'disassembleViewEntry',
          'prefetchSiblings',
        ].includes(name))
      )
    ) {
      violations.push(
        'src/app/App.tsx must delegate workspace lifecycle ownership to a workspace controller',
      );
    }
    if (
      sourcePath === 'src/app/App.tsx' &&
      (
        resolvedSpecifiers.includes('src/features/merge/staging') ||
        appCommandImports.some((name) => [
          '*',
          'stageCopy',
          'stageWrite',
          'stageViewWrite',
          'unstageViewWrite',
          'commitView',
          'commitMerge',
          'clearStaged',
          'unstage',
        ].includes(name))
      )
    ) {
      violations.push(
        'src/app/App.tsx must delegate generation-guarded staging to a merge controller',
      );
    }
    if (
      sourcePath.startsWith('src/lib/') &&
      specifiers.some((specifier) => isForbiddenLibImport(sourcePath, specifier))
    ) {
      violations.push(
        `${sourcePath} must remain React-free, Monaco-free, Tauri-free, and feature-free`,
      );
    }

    const owner = featureName(sourcePath);
    if (!owner) {
      continue;
    }
    for (const specifier of specifiers) {
      const importedPath = resolvedFrontendImport(
        sourcePath,
        specifier,
        frontendSources,
      );
      const importedOwner = importedPath && featureName(importedPath);
      if (
        importedPath?.endsWith('.tsx') &&
        importedOwner &&
        importedOwner !== owner
      ) {
        violations.push(
          `${sourcePath} must not import React component ${importedPath} from another feature`,
        );
      }
    }
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

function readFrontendSources(directory) {
  if (!existsSync(directory)) {
    return {};
  }
  return Object.fromEntries(
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return Object.entries(readFrontendSources(path));
      }
      return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [[path, readFileSync(path, 'utf8')]]
        : [];
    }),
  );
}

export function verifyRepository() {
  const rustSources = readRustSources('src-tauri/src');
  const frontendSources = readFrontendSources('src');
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
    ...verifyPhaseThreeArchitecture({ frontendSources }),
    ...verifyPhaseFourArchitecture({ frontendSources }),
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
