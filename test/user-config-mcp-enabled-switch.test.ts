// PR1 (2026-05-13) — `mcp.enabled: false` user-config master switch
// parser test. Pair to the CLI flag `--no-mcp` (asserted in runNexus
// integration; here we cover the schema layer alone).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getUserConfig } from '../src/user-config.js';

function writeCfg(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'config.json');
  writeFileSync(p, body, 'utf-8');
  return p;
}

describe('user-config — mcp.enabled master switch (PR1)', () => {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-enabled-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('mcp.enabled omitted → not surfaced (enabled === undefined, default on)', () => {
    const p = writeCfg(dir, JSON.stringify({
      mcp: { servers: [{ id: 'a', command: ['x'] }] },
    }));
    const cfg = getUserConfig(p);
    expect(cfg.mcp?.servers).toHaveLength(1);
    expect(cfg.mcp?.enabled).toBeUndefined();
  });

  test('mcp.enabled: false → carries through to runtime', () => {
    const p = writeCfg(dir, JSON.stringify({
      mcp: { enabled: false, servers: [{ id: 'a', command: ['x'] }] },
    }));
    const cfg = getUserConfig(p);
    expect(cfg.mcp?.enabled).toBe(false);
    expect(cfg.mcp?.servers).toHaveLength(1); // list preserved, gate is separate
  });

  test('mcp.enabled: true (or anything not strictly false) → undefined (default-on)', () => {
    const p = writeCfg(dir, JSON.stringify({
      mcp: { enabled: true, servers: [{ id: 'a', command: ['x'] }] },
    }));
    const cfg = getUserConfig(p);
    expect(cfg.mcp?.enabled).toBeUndefined();
  });

  test('servers absent + enabled: false → keep config so caller can read the switch', () => {
    const p = writeCfg(dir, JSON.stringify({
      mcp: { enabled: false },
    }));
    const cfg = getUserConfig(p);
    expect(cfg.mcp?.enabled).toBe(false);
    expect(cfg.mcp?.servers).toEqual([]);
  });

  test('empty servers + no enabled flag → mcp config dropped (legacy behavior)', () => {
    const p = writeCfg(dir, JSON.stringify({ mcp: { servers: [] } }));
    const cfg = getUserConfig(p);
    expect(cfg.mcp).toBeUndefined();
  });
});
