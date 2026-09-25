import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const capabilitiesDir = join(root, 'src/mission-capabilities');
const stateDir = mkdtempSync(join(tmpdir(), 'monad-probe-readonly-'));
const providers: Array<{ path: string; provider: { id: string; probe(): Promise<{ ok: boolean; repairHint?: unknown }> } }> = [];
const previousStateDir = process.env.MONAD_STATE_DIR;
const previousConatusDataDir = process.env.CONATUS_DATA_DIR;
process.env.MONAD_STATE_DIR = stateDir;
process.env.CONATUS_DATA_DIR = join(stateDir, 'conatus');
const { capabilityProviders } = await import('../../src/mission-capabilities/registry.js');

function discoverProviderPaths(dir = capabilitiesDir): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? discoverProviderPaths(path)
      : entry !== 'registry.ts' && entry.endsWith('.ts') ? [path] : [];
  }).sort();
}

function duplicateIds(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

function snapshot(path: string): string {
  if (!existsSync(path)) return 'missing';
  const db = new Database(path, { readonly: true });
  try {
    return JSON.stringify(db.query("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name").all());
  } finally {
    db.close();
  }
}

function resultFor(id: string, results: readonly { ok: boolean; repairHint?: unknown }[]): { ok: boolean; repairHint?: unknown } {
  const index = providers.findIndex(entry => entry.provider.id === id);
  if (index < 0) throw new Error(`Discovered provider ${id} is missing.`);
  return results[index]!;
}

function expectRepairableAbsence(id: string, results: readonly { ok: boolean; repairHint?: unknown }[]): void {
  const result = resultFor(id, results);
  expect(result.ok).toBe(false);
  expect(result.repairHint).toBeDefined();
}

beforeAll(async () => {
  for (const path of discoverProviderPaths()) {
    const module = await import(relative(import.meta.dir, path).replaceAll(sep, '/'));
    if (module.default?.probe) providers.push({ path, provider: module.default });
  }
});

afterAll(() => {
  if (previousStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = previousStateDir;
  if (previousConatusDataDir === undefined) delete process.env.CONATUS_DATA_DIR;
  else process.env.CONATUS_DATA_DIR = previousConatusDataDir;
  rmSync(stateDir, { recursive: true, force: true });
});

describe('mission capability probes are read-only observers', () => {
  test('discovers every provider module and matches registry registration exactly', () => {
    const discoveredIds = providers.map(({ provider }) => provider.id).sort();
    const registeredIds = capabilityProviders.map(provider => provider.id).sort();
    const unregistered = discoveredIds.filter(id => !registeredIds.includes(id));
    const undiscovered = registeredIds.filter(id => !discoveredIds.includes(id));

    expect(duplicateIds(discoveredIds)).toEqual([]);
    expect(duplicateIds(registeredIds)).toEqual([]);
    expect(
      { unregistered, undiscovered, discoveredIds, registeredIds },
      `Unregistered providers: ${unregistered.join(', ') || '(none)'}; registered modules not discovered: ${undiscovered.join(', ') || '(none)'}`,
    ).toEqual({ unregistered: [], undiscovered: [], discoveredIds: registeredIds, registeredIds });
  });

  test('production probes do not create missing stores and report repairable absence', async () => {
    const { SIGNALS_DB_PATH } = await import('../../src/domains/breaking-signals.js');
    const { knowledgeDbPath } = await import('../../src/domains/knowledge.js');
    const { SCREENER_DB_PATH } = await import('../../src/domains/sector-store.js');
    const storePaths = [SIGNALS_DB_PATH, knowledgeDbPath(), SCREENER_DB_PATH];
    const before = storePaths.map(snapshot);

    const results = await Promise.all(providers.map(({ provider }) => provider.probe()));

    expect(storePaths.map(snapshot)).toEqual(before);
    for (const result of results) if (!result.ok) expect(result.repairHint).toBeDefined();
    for (const id of ['news.resolution.scaled', 'analysis.valuechain', 'market.sector.moves']) expectRepairableAbsence(id, results);
  });

  test('production probes do not change an empty existing store schema', async () => {
    const { SIGNALS_DB_PATH } = await import('../../src/domains/breaking-signals.js');
    const { knowledgeDbPath } = await import('../../src/domains/knowledge.js');
    const { SCREENER_DB_PATH } = await import('../../src/domains/sector-store.js');
    const storePaths = [SIGNALS_DB_PATH, knowledgeDbPath(), SCREENER_DB_PATH];
    for (const path of storePaths) {
      mkdirSync(dirname(path), { recursive: true });
      const db = new Database(path);
      db.close();
    }
    const before = storePaths.map(snapshot);

    const results = await Promise.all(providers.map(({ provider }) => provider.probe()));

    expect(storePaths.map(snapshot)).toEqual(before);
    for (const id of ['news.resolution.scaled', 'analysis.valuechain', 'market.sector.moves']) expectRepairableAbsence(id, results);
  });
});
