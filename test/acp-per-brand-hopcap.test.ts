// Follow-up #7 — per-brand HOP_CAP config tests.
//
// Two layers:
//   1. user-config parsing (`parseHopCap` · exposed indirectly via
//      `buildUserConfig` + `resolveAcpHopCapFromConfig`)
//   2. DRM resolver integration (`setAcpHopCapResolver` +
//      `resolveAcpHopCap` + `clientSessionCreate` behaviour)

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
  DEFAULT_HOP_CAP,
  DualRoleManager,
  ReentrancyError,
  resolveAcpHopCap,
  setAcpHopCapResolver,
} from '../src/acp/dual-role-manager.js';
import { buildUserConfig, resolveAcpHopCapFromConfig } from '../src/user-config.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeFakeAgent() {
  return {
    newSession: mock(async () => `fake-${Math.random().toString(36).slice(2, 8)}`),
    prompt: mock(async () => ({ stopReason: 'end_turn' })),
    cancel: mock(async () => {}),
  };
}

function withTempConfig(body: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hopcap-cfg-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe('user-config · acp.hopCap parsing', () => {
  test('missing acp block → empty hopCap · every brand resolves undefined', () => {
    const path = withTempConfig({});
    try {
      const cfg = buildUserConfig(path);
      expect(cfg.acp.hopCap).toEqual({});
      expect(resolveAcpHopCapFromConfig('claude', cfg)).toBeUndefined();
      expect(resolveAcpHopCapFromConfig('codex', cfg)).toBeUndefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('brand-specific values parsed · others undefined', () => {
    const path = withTempConfig({ acp: { hopCap: { claude: 5, codex: 2 } } });
    try {
      const cfg = buildUserConfig(path);
      expect(cfg.acp.hopCap).toEqual({ claude: 5, codex: 2 });
      expect(resolveAcpHopCapFromConfig('claude', cfg)).toBe(5);
      expect(resolveAcpHopCapFromConfig('codex', cfg)).toBe(2);
      expect(resolveAcpHopCapFromConfig('gemini', cfg)).toBeUndefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('default fallback applies when brand is absent', () => {
    const path = withTempConfig({ acp: { hopCap: { default: 7, claude: 9 } } });
    try {
      const cfg = buildUserConfig(path);
      expect(resolveAcpHopCapFromConfig('claude', cfg)).toBe(9);
      expect(resolveAcpHopCapFromConfig('codex', cfg)).toBe(7);
      expect(resolveAcpHopCapFromConfig('gemini', cfg)).toBe(7);
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('malformed entries (non-number, zero, negative) ignored', () => {
    const path = withTempConfig({
      acp: {
        hopCap: {
          claude: 'lots',
          codex: 0,
          gemini: -3,
          default: null,
        },
      },
    });
    try {
      const cfg = buildUserConfig(path);
      expect(cfg.acp.hopCap).toEqual({});
      expect(resolveAcpHopCapFromConfig('claude', cfg)).toBeUndefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('float values floored', () => {
    const path = withTempConfig({ acp: { hopCap: { claude: 5.9 } } });
    try {
      const cfg = buildUserConfig(path);
      expect(cfg.acp.hopCap.claude).toBe(5);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe('DRM · resolveAcpHopCap', () => {
  afterEach(() => {
    setAcpHopCapResolver(null);
  });

  test('no resolver + no explicit → DEFAULT_HOP_CAP', () => {
    expect(resolveAcpHopCap('claude')).toBe(DEFAULT_HOP_CAP);
  });

  test('resolver returns undefined → fallback to DEFAULT_HOP_CAP', () => {
    setAcpHopCapResolver(() => undefined);
    expect(resolveAcpHopCap('codex')).toBe(DEFAULT_HOP_CAP);
  });

  test('resolver returns brand-specific number → that wins over default', () => {
    setAcpHopCapResolver((brand) => brand === 'claude' ? 10 : undefined);
    expect(resolveAcpHopCap('claude')).toBe(10);
    expect(resolveAcpHopCap('codex')).toBe(DEFAULT_HOP_CAP);
  });

  test('explicit hopCap wins over resolver + default', () => {
    setAcpHopCapResolver(() => 10);
    expect(resolveAcpHopCap('claude', 2)).toBe(2);
  });

  test('resolver throwing falls through to DEFAULT_HOP_CAP', () => {
    setAcpHopCapResolver(() => { throw new Error('bad config'); });
    expect(resolveAcpHopCap('claude')).toBe(DEFAULT_HOP_CAP);
  });

  test('resolver returning ≤ 0 ignored · does not disable guard', () => {
    setAcpHopCapResolver(() => 0);
    expect(resolveAcpHopCap('claude')).toBe(DEFAULT_HOP_CAP);
    setAcpHopCapResolver(() => -5);
    expect(resolveAcpHopCap('claude')).toBe(DEFAULT_HOP_CAP);
  });
});

describe('DRM · clientSessionCreate uses per-brand resolver', () => {
  let mgr: DualRoleManager;
  beforeEach(() => {
    mgr = new DualRoleManager();
    mgr.__setAgentFactoryForTest(async () => makeFakeAgent() as any);
  });
  afterEach(() => {
    setAcpHopCapResolver(null);
  });

  test('brand-specific lower cap → ReentrancyError at brand-specific depth', async () => {
    // claude cap=2 → depth 2 rejected; codex cap=DEFAULT (3) → depth 2 ok.
    setAcpHopCapResolver((brand) => brand === 'claude' ? 2 : undefined);
    const root = await mgr.clientSessionCreate({ backendId: 'claude' });
    const d1 = await mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: root.id });
    expect(d1.chainDepth).toBe(1);
    await expect(
      mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: d1.id }),
    ).rejects.toBeInstanceOf(ReentrancyError);
  });

  test('brand-specific higher cap → deeper nesting permitted', async () => {
    setAcpHopCapResolver(() => 5);
    const root = await mgr.clientSessionCreate({ backendId: 'claude' });
    const d1 = await mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: root.id });
    const d2 = await mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: d1.id });
    const d3 = await mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: d2.id });
    // depth 3 allowed because cap=5 · would have hit DEFAULT_HOP_CAP=3 otherwise.
    expect(d3.chainDepth).toBe(3);
  });

  test('explicit opts.hopCap overrides per-brand resolver', async () => {
    setAcpHopCapResolver(() => 10);
    const root = await mgr.clientSessionCreate({ backendId: 'claude' });
    await expect(
      mgr.clientSessionCreate({ backendId: 'claude', parentSessionId: root.id, hopCap: 1 }),
    ).rejects.toBeInstanceOf(ReentrancyError);
  });
});
