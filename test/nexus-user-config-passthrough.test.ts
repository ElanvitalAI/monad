// ── NEXUS user-config: unknown keys passthrough (critical fix 2026-05-13) ──
//
// Regression guard for the bug discovered while restoring a user's
// 5-provider LLM rotation: NEXUS's readUserConfig() preserved only
// `version` + `global` + `tabs`, dropping the 16 Path A keys (llm,
// chat, obsidian, …) on every patchUserConfig() round-trip. The fix
// spreads `parsed` first so unknown keys flow through.
//
// This file pins the passthrough behavior so a future refactor that
// "tidies up" the spread doesn't silently restore the wipe.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nexus-user-config-pt-'));
  setMonadConfigDir(root);
});
afterEach(() => {
  resetMonadConfigDir();
  rmSync(root, { recursive: true, force: true });
});

function configPath(): string {
  return join(root, 'config.json');
}

async function freshModule(): Promise<typeof import('../src/nexus/config/user-config')> {
  return await import('../src/nexus/config/user-config');
}

describe('NEXUS readUserConfig — unknown keys passthrough', () => {
  test('preserves all 16 Path A keys on read', async () => {
    const seeded = {
      version: 1,
      global: { nexus: { template: 'minimal' } },
      tabs: {},
      llm: { provider: 'local', model: 'gemma' },
      acp: { autoPersist: true },
      chat: { historyLimit: 100 },
      obsidian: { vault: '/path/to/vault' },
      skills: { dir: ['~/skills'] },
      discord: { token: 'ref:secret:dc' },
      telegram: { token: 'ref:secret:tg' },
      voice: { stt: { provider: 'openai' } },
      lsp: { tcpHost: '127.0.0.1' },
      shell: { path: '/bin/zsh' },
      onboarding: { complete: true },
      debug: { level: 'normal' },
      skillRouter: { exitOnDoneByDefault: true },
      dashboard: { foo: 'bar' },
      vw: { x: 1 },
      controlPlane: { y: 2 },
    };
    writeFileSync(configPath(), JSON.stringify(seeded));
    const { readUserConfig } = await freshModule();
    const cfg = readUserConfig();
    // All 16 Path A keys survive.
    for (const key of [
      'llm', 'acp', 'chat', 'obsidian', 'skills', 'discord', 'telegram',
      'voice', 'lsp', 'shell', 'onboarding', 'debug', 'skillRouter',
      'dashboard', 'vw', 'controlPlane',
    ]) {
      expect(cfg[key as keyof typeof cfg]).toBeDefined();
    }
    // Nested data inside Path A keys is preserved verbatim.
    const asPathA = cfg as unknown as {
      llm: { provider: string; model: string };
      obsidian: { vault: string };
    };
    expect(asPathA.llm.provider).toBe('local');
    expect(asPathA.llm.model).toBe('gemma');
    expect(asPathA.obsidian.vault).toBe('/path/to/vault');
    // NEXUS-typed keys still parse correctly.
    expect(cfg.version).toBe(1);
    expect(cfg.global.nexus?.template).toBe('minimal');
  });

  test('missing file → defaultUserConfig with NO extra keys', async () => {
    const { readUserConfig } = await freshModule();
    const cfg = readUserConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.global).toEqual({});
    expect(cfg.tabs).toEqual({});
    expect(Object.keys(cfg).sort()).toEqual(['global', 'tabs', 'version']);
  });

  test('version mismatch → defaultUserConfig (passthrough is NOT applied for bad version)', async () => {
    const seeded = {
      version: 999, // wrong
      global: {},
      tabs: {},
      llm: { provider: 'should-be-dropped' },
    };
    writeFileSync(configPath(), JSON.stringify(seeded));
    const { readUserConfig } = await freshModule();
    const cfg = readUserConfig();
    expect(cfg.version).toBe(1);
    expect((cfg as { llm?: unknown }).llm).toBeUndefined();
  });

  test('corrupt JSON → defaultUserConfig (graceful)', async () => {
    writeFileSync(configPath(), '{{{ not json');
    const { readUserConfig } = await freshModule();
    const cfg = readUserConfig();
    expect(cfg.version).toBe(1);
    expect(Object.keys(cfg).sort()).toEqual(['global', 'tabs', 'version']);
  });
});

describe('NEXUS writeUserConfig — unknown keys serialize', () => {
  test('any extra top-level key in cfg is JSON.stringified to disk', async () => {
    const { writeUserConfig } = await freshModule();
    writeUserConfig({
      version: 1,
      global: {},
      tabs: {},
      llm: { provider: 'local', rotation: [{ label: 'opus' }] },
      obsidian: { vault: '/tmp/v' },
    } as never);
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8'));
    expect(raw.llm.provider).toBe('local');
    expect(raw.llm.rotation[0].label).toBe('opus');
    expect(raw.obsidian.vault).toBe('/tmp/v');
  });
});

describe('NEXUS patchUserConfig — 16-key round trip survives mutation', () => {
  test('Path A keys preserved across one patch cycle', async () => {
    const seeded = {
      version: 1,
      global: { nexus: { firstBootGuideShown: false } },
      tabs: {},
      llm: { provider: 'local', rotation: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }] },
      acp: { autoPersist: true },
      obsidian: { vault: '/tmp/v' },
    };
    writeFileSync(configPath(), JSON.stringify(seeded));
    const { patchUserConfig } = await freshModule();
    patchUserConfig((cfg) => {
      // Mutate a NEXUS-typed switch (the typical caller path —
      // src/nexus/index.ts:2041 toggles global.nexus.pwa.shareTailnet
      // the same way).
      cfg.global.nexus = { ...cfg.global.nexus, firstBootGuideShown: true };
    });
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8'));
    // NEXUS-typed mutation took effect.
    expect(raw.global.nexus.firstBootGuideShown).toBe(true);
    // Path A keys still present (would have been wiped before the fix).
    expect(raw.llm.provider).toBe('local');
    expect(raw.llm.rotation.length).toBe(5);
    expect(raw.acp.autoPersist).toBe(true);
    expect(raw.obsidian.vault).toBe('/tmp/v');
  });

  test('10 successive patches keep Path A keys intact (regression scenario)', async () => {
    const seeded = {
      version: 1,
      global: {},
      tabs: {},
      llm: { provider: 'local' },
      skills: { dir: ['~/skills'] },
    };
    writeFileSync(configPath(), JSON.stringify(seeded));
    const { patchUserConfig } = await freshModule();
    for (let i = 0; i < 10; i++) {
      patchUserConfig((cfg) => {
        cfg.tabs[`x:${i}`] = { enabled: true };
      });
    }
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8'));
    expect(raw.llm.provider).toBe('local');
    expect(raw.skills.dir[0]).toBe('~/skills');
    expect(Object.keys(raw.tabs).length).toBe(10);
  });
});
