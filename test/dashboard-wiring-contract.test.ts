import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(HERE, '..', 'src', 'dashboard');
const DASHBOARD_INDEX = readFileSync(resolve(DASHBOARD_DIR, 'index.ts'), 'utf8');
const WIRING_EXPORT = /^(?:boot|register|wire|arm)\w*Dashboard\w*$/;
const DECLARATION_EXPORT = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+(\w+)/g;
const VARIABLE_EXPORT = /export\s+(?:const|let|var)\s+([^;]+);/g;
const VARIABLE_DECLARATION = /(?:^|,)\s*(\w+)\s*(?::[^=,]+)?=/g;
const NAMED_EXPORT = /export\s*{([^}]+)}\s*(?:from\s*['"]([^'"]+)['"])?/g;
const EXPORT_STAR = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;

function modulePath(path: string, specifier: string): string {
  return resolve(dirname(path), extname(specifier) ? specifier.replace(/\.js$/, '.ts') : `${specifier}.ts`);
}

function namesFromSpecifiers(specifiers: string): string[] {
  return specifiers.split(',').map((specifier) => {
    const [original, alias] = specifier.trim().split(/\s+as\s+/);
    return alias ?? original;
  }).filter((name) => WIRING_EXPORT.test(name));
}

function exportedWiringNames(path: string, visited = new Set<string>()): string[] {
  if (visited.has(path)) return [];
  visited.add(path);

  const source = readFileSync(path, 'utf8');
  const names = new Set<string>();
  for (const match of source.matchAll(DECLARATION_EXPORT)) {
    if (WIRING_EXPORT.test(match[1])) names.add(match[1]);
  }
  for (const match of source.matchAll(VARIABLE_EXPORT)) {
    for (const declaration of match[1].matchAll(VARIABLE_DECLARATION)) {
      if (WIRING_EXPORT.test(declaration[1])) names.add(declaration[1]);
    }
  }
  for (const match of source.matchAll(NAMED_EXPORT)) {
    for (const name of namesFromSpecifiers(match[1])) names.add(name);
    if (match[2]) {
      for (const name of namesFromSpecifiers(match[1])) names.add(name);
    }
  }
  for (const match of source.matchAll(EXPORT_STAR)) {
    for (const name of exportedWiringNames(modulePath(path, match[1]), visited)) names.add(name);
  }
  return [...names];
}

function missingWiringNames(names: readonly string[], indexSource: string): string[] {
  return names.filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(indexSource));
}

const dashboardWiringNames = readdirSync(DASHBOARD_DIR)
  .filter((entry) => extname(entry) === '.ts' && entry !== 'index.ts')
  .flatMap((entry) => exportedWiringNames(resolve(DASHBOARD_DIR, entry)))
  .sort();

describe('dashboard wiring contract', () => {
  test('derives at least one dashboard wiring export from source modules', () => {
    expect(dashboardWiringNames).not.toHaveLength(0);
  });

  test('calls every derived dashboard wiring export from dashboard/index.ts', () => {
    const missingNames = missingWiringNames(dashboardWiringNames, DASHBOARD_INDEX);

    expect(missingNames, `dashboard/index.ts does not call: ${missingNames.join(', ')}`).toEqual([]);
  });

  test('derives named local exports and named re-exports, then identifies each missing call', () => {
    const fixtureDir = mkdtempSync(resolve(tmpdir(), 'dashboard-wiring-contract-'));
    try {
      const localPath = resolve(fixtureDir, 'local.ts');
      const reexportPath = resolve(fixtureDir, 'reexport.ts');
      const variablesPath = resolve(fixtureDir, 'variables.ts');
      writeFileSync(localPath, 'function bootDashboardLocal() {}\nexport { bootDashboardLocal };\n');
      writeFileSync(reexportPath, "export { wireDashboardRemote } from './remote.js';\n");
      writeFileSync(variablesPath, 'export const other = 1, bootDashboardSecond = () => {};\n');
      writeFileSync(resolve(fixtureDir, 'remote.ts'), 'export function wireDashboardRemote() {}\n');

      const names = [
        ...exportedWiringNames(localPath),
        ...exportedWiringNames(reexportPath),
        ...exportedWiringNames(variablesPath),
      ].sort();
      expect(names).toEqual(['bootDashboardLocal', 'bootDashboardSecond', 'wireDashboardRemote']);
      expect(missingWiringNames(names, 'bootDashboardLocal()\nbootDashboardSecond()')).toEqual(['wireDashboardRemote']);
      expect(missingWiringNames(names, 'bootDashboardLocal()\nwireDashboardRemote()')).toEqual(['bootDashboardSecond']);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
