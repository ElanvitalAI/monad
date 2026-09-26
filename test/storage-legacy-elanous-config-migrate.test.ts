// Phase 3 (PLAN-config-unification-elanous-root-2026-05-10):
//   migrateLegacyXdgUserConfig() — once-per-process · idempotent merge
//   of ~/.config/elanous/config.json (Path A · 19 keys) into
//   ~/.elanous/config.json (Path B · NEXUS schema).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateLegacyXdgUserConfig, __resetElanousConfigMigrateForTests,
} from '../src/storage/legacy-elanous-config-migrate';

const prevTestHome = process.env.ELANOUS_TEST_HOME;
const prevXdg = process.env.XDG_CONFIG_HOME;
let home: string;

function legacyPath(): string {
  return join(home, '.config', 'elanous', 'config.json');
}
function unifiedPath(): string {
  return join(home, '.elanous', 'config.json');
}
function writeLegacy(json: unknown): void {
  mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
  writeFileSync(legacyPath(), JSON.stringify(json));
}
function writeUnified(json: unknown): void {
  mkdirSync(join(home, '.elanous'), { recursive: true });
  writeFileSync(unifiedPath(), JSON.stringify(json));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cfg-migrate-'));
  process.env.ELANOUS_TEST_HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  __resetElanousConfigMigrateForTests();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevTestHome === undefined) delete process.env.ELANOUS_TEST_HOME;
  else process.env.ELANOUS_TEST_HOME = prevTestHome;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  __resetElanousConfigMigrateForTests();
});

describe('migrateLegacyXdgUserConfig', () => {
  test('no legacy file → no-op (does not create unified file)', () => {
    migrateLegacyXdgUserConfig();
    expect(existsSync(unifiedPath())).toBe(false);
  });

  test('XDG_CONFIG_HOME set → skip migration (legacy honor)', () => {
    process.env.XDG_CONFIG_HOME = join(home, 'custom-xdg');
    writeLegacy({ llm: { provider: 'anthropic' } });
    migrateLegacyXdgUserConfig();
    expect(existsSync(unifiedPath())).toBe(false);
    expect(existsSync(legacyPath())).toBe(true);
  });

  test('legacy 19 keys → merged into new file root', () => {
    writeLegacy({
      llm: { provider: 'anthropic' },
      skillRouter: { autoRoute: true },
      voice: { stt: { language: 'ko' } },
    });
    writeUnified({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'enabled' } } },
      tabs: {},
    });

    migrateLegacyXdgUserConfig();

    const merged = JSON.parse(readFileSync(unifiedPath(), 'utf-8'));
    expect(merged.version).toBe(1);
    expect(merged.global).toEqual({ nexus: { pwa: { shareTailnet: 'enabled' } } });
    expect(merged.tabs).toEqual({});
    expect(merged.llm).toEqual({ provider: 'anthropic' });
    expect(merged.skillRouter).toEqual({ autoRoute: true });
    expect(merged.voice).toEqual({ stt: { language: 'ko' } });

    // Legacy renamed to .bak (soft deprecation · permanent retention).
    expect(existsSync(legacyPath())).toBe(false);
    expect(existsSync(legacyPath() + '.bak')).toBe(true);
  });

  test('NEXUS schema keys in legacy file are NOT carried over', () => {
    // Defensive: legacy file shouldn't have version/global/tabs but if
    // it does (e.g. from prior accidental write), we ignore them so we
    // never overwrite the unified file's NEXUS state.
    writeLegacy({
      llm: { provider: 'anthropic' },
      version: 99,
      global: { stale: true },
      tabs: { 'old:1': {} },
    });
    writeUnified({ version: 1, global: { real: true }, tabs: {} });

    migrateLegacyXdgUserConfig();

    const merged = JSON.parse(readFileSync(unifiedPath(), 'utf-8'));
    expect(merged.version).toBe(1);
    expect(merged.global).toEqual({ real: true });
    expect(merged.tabs).toEqual({});
    expect(merged.llm).toEqual({ provider: 'anthropic' });
  });

  test('idempotent: if Path A key already at unified root, skip', () => {
    writeLegacy({ llm: { provider: 'anthropic' } });
    writeUnified({ version: 1, global: {}, tabs: {}, llm: { provider: 'gemini' } });

    migrateLegacyXdgUserConfig();

    const final = JSON.parse(readFileSync(unifiedPath(), 'utf-8'));
    // Unified file's value wins (we did not clobber).
    expect(final.llm).toEqual({ provider: 'gemini' });
    // Legacy file untouched (no .bak rename when we skipped).
    expect(existsSync(legacyPath())).toBe(true);
    expect(existsSync(legacyPath() + '.bak')).toBe(false);
  });

  test('once-per-process: second call after legacy re-creation is no-op', () => {
    writeLegacy({ llm: { provider: 'anthropic' } });
    migrateLegacyXdgUserConfig();
    expect(JSON.parse(readFileSync(unifiedPath(), 'utf-8')).llm).toEqual({ provider: 'anthropic' });

    // Recreate legacy file with different content; second call must NOT migrate.
    writeLegacy({ llm: { provider: 'gemini' } });
    migrateLegacyXdgUserConfig();
    expect(JSON.parse(readFileSync(unifiedPath(), 'utf-8')).llm).toEqual({ provider: 'anthropic' });
    // The newly recreated legacy file is left in place (not re-migrated).
    expect(existsSync(legacyPath())).toBe(true);
  });

  test('unified file absent → migrate creates it from legacy', () => {
    writeLegacy({
      llm: { provider: 'anthropic' },
      onboarding: { completed: true },
    });
    expect(existsSync(unifiedPath())).toBe(false);

    migrateLegacyXdgUserConfig();

    const created = JSON.parse(readFileSync(unifiedPath(), 'utf-8'));
    expect(created.llm).toEqual({ provider: 'anthropic' });
    expect(created.onboarding).toEqual({ completed: true });
    expect(existsSync(legacyPath() + '.bak')).toBe(true);
  });

  test('malformed legacy JSON → no-op (does not write anything)', () => {
    mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(legacyPath(), '{ this is not json');

    migrateLegacyXdgUserConfig();

    expect(existsSync(unifiedPath())).toBe(false);
    // Legacy preserved (not renamed to .bak when migration didn't run).
    expect(existsSync(legacyPath())).toBe(true);
  });

  test('legacy with only NEXUS keys → renamed to .bak (cleanup) without merge', () => {
    // A file that has NEXUS-only content has nothing for us to migrate
    // but we still clean it up (otherwise the legacy file lingers
    // forever and confuses users).
    writeLegacy({ version: 1, global: { x: 1 }, tabs: {} });
    writeUnified({ version: 1, global: {}, tabs: {} });

    migrateLegacyXdgUserConfig();

    const after = JSON.parse(readFileSync(unifiedPath(), 'utf-8'));
    expect(after.global).toEqual({}); // unified file untouched
    expect(existsSync(legacyPath())).toBe(false);
    expect(existsSync(legacyPath() + '.bak')).toBe(true);
  });
});
