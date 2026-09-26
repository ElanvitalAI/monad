// Phase 2 (PLAN-config-unification-elanous-root-2026-05-10):
//   buildUserConfig() exposes NEXUS schema fields (`version`, `global`,
//   `tabs`) at the typed UserConfig root so `elanous config get/set
//   global.<...>` resolves through the same dotted-path resolver as
//   Path A keys. saveUserConfig() round-trips them.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig, saveUserConfig } from '../src/user-config';

let root: string;
let cfgPath: string;

function writeFile(json: unknown): void {
  writeFileSync(cfgPath, JSON.stringify(json));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'p2-nexus-schema-'));
  cfgPath = join(root, 'config.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Phase 2 · NEXUS schema co-resident at UserConfig root', () => {
  test('buildUserConfig parses version/global/tabs from on-disk JSON', () => {
    writeFile({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'enabled' } } },
      tabs: { 'daemon:1': { httpPort: 4321 } },
      llm: { provider: 'anthropic' },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.version).toBe(1);
    expect(cfg.global).toEqual({ nexus: { pwa: { shareTailnet: 'enabled' } } });
    expect(cfg.tabs).toEqual({ 'daemon:1': { httpPort: 4321 } });
    // Path A key still parses
    expect(cfg.llm.provider).toBe('anthropic');
  });

  test('NEXUS keys absent → fields are undefined (not empty objects)', () => {
    writeFile({ llm: { provider: 'anthropic' } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.version).toBeUndefined();
    expect(cfg.global).toBeUndefined();
    expect(cfg.tabs).toBeUndefined();
  });

  test('malformed NEXUS values (string/array) → undefined (defensive)', () => {
    writeFile({ version: 'not-a-number', global: ['arrays', 'not', 'allowed'], tabs: 42 });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.version).toBeUndefined();
    expect(cfg.global).toBeUndefined();
    expect(cfg.tabs).toBeUndefined();
  });

  test('round-trip preserves NEXUS schema: build → save → re-read', () => {
    writeFile({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'enabled' } }, tools: 'all' },
      tabs: { 'chat:1': { backend: 'anthropic' } },
      llm: { provider: 'anthropic', model: 'gpt-5' },
    });
    const cfg = buildUserConfig(cfgPath);
    saveUserConfig(cfg, cfgPath);
    const reloaded = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect(reloaded.version).toBe(1);
    expect(reloaded.global).toEqual({ nexus: { pwa: { shareTailnet: 'enabled' } }, tools: 'all' });
    expect(reloaded.tabs).toEqual({ 'chat:1': { backend: 'anthropic' } });
    expect((reloaded.llm as Record<string, unknown>).provider).toBe('anthropic');
  });

  test('save omits empty global/tabs to keep Path-A-only files clean', () => {
    writeFile({ llm: { provider: 'anthropic' } });
    const cfg = buildUserConfig(cfgPath);
    saveUserConfig(cfg, cfgPath);
    const reloaded = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect('version' in reloaded).toBe(false);
    expect('global' in reloaded).toBe(false);
    expect('tabs' in reloaded).toBe(false);
    // Path A keys still present (sanity).
    expect((reloaded.llm as Record<string, unknown>).provider).toBe('anthropic');
  });

  test('mutating cfg.global between read and save persists to disk', () => {
    writeFile({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'disabled' } } },
      llm: { provider: 'auto' },
    });
    const cfg = buildUserConfig(cfgPath);
    // Simulate `elanous config set global.nexus.pwa.shareTailnet enabled`
    (cfg.global as Record<string, Record<string, Record<string, unknown>>>)
      .nexus.pwa.shareTailnet = 'enabled';
    saveUserConfig(cfg, cfgPath);
    const reloaded = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect(((reloaded.global as Record<string, Record<string, Record<string, unknown>>>)
      .nexus.pwa.shareTailnet)).toBe('enabled');
  });

  test('mutating cfg.tabs between read and save persists to disk', () => {
    writeFile({ version: 1, tabs: { 'chat:1': { backend: 'anthropic' } } });
    const cfg = buildUserConfig(cfgPath);
    (cfg.tabs as Record<string, Record<string, unknown>>)['chat:2'] = { backend: 'claude' };
    saveUserConfig(cfg, cfgPath);
    const reloaded = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect(reloaded.tabs).toEqual({
      'chat:1': { backend: 'anthropic' },
      'chat:2': { backend: 'claude' },
    });
  });

  test('co-existence: NEXUS reader and Path A reader see consistent state', () => {
    // The NEXUS reader (src/nexus/config/user-config.ts) reads version /
    // global / tabs from the same file. After Phase 2, buildUserConfig
    // surfaces the same values · this test confirms both lenses agree.
    writeFile({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'enabled' } } },
      tabs: {},
      llm: { provider: 'anthropic' },
    });
    const pathA = buildUserConfig(cfgPath);
    expect(pathA.global?.nexus).toEqual({ pwa: { shareTailnet: 'enabled' } });

    // Independently re-parse JSON to mimic NEXUS reader's view.
    const onDisk = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    expect(onDisk.global).toEqual(pathA.global as Record<string, unknown>);
    expect(onDisk.version).toBe(pathA.version);
  });

  test('UserConfig.raw still carries NEXUS keys as catch-all for legacy readers', () => {
    writeFile({
      version: 1,
      global: { nexus: {} },
      tabs: {},
      llm: { provider: 'anthropic' },
    });
    const cfg = buildUserConfig(cfgPath);
    // Phase 2 keeps raw populated (no behavior change for legacy
    // consumers that still read cfg.raw.global).
    expect(cfg.raw.version).toBe(1);
    expect(cfg.raw.global).toEqual({ nexus: {} });
  });
});
