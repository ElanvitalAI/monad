// PLAN-codex-app-server-hermes-parity §5 Phase H3·3 test —
// migrateCodexConfig orchestrator. fs interactions go through a tmp
// path so the real ~/.codex never gets touched.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateCodexConfig } from './migrate.js';
import { MARKER_START, MARKER_END } from './managed-block.js';

let workdir: string;
let configPath: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'elanous-codex-migrate-test-'));
  configPath = join(workdir, 'config.toml');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const STABLE_CLOCK = () => new Date('2026-05-16T05:30:00Z').getTime();

describe('migrateCodexConfig · first write', () => {
  test('creates file when missing, no backup', async () => {
    const res = await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    expect(res.action).toBe('wrote');
    expect(res.backupPath).toBeUndefined();
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain(MARKER_START);
    expect(written).toContain('[mcp_servers.elanous-tools]');
    expect(written).toContain(MARKER_END);
  });

  test('appends to existing user content + writes backup', async () => {
    const userContent = `model = "gpt-5.4"\n`;
    writeFileSync(configPath, userContent);
    const res = await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    expect(res.action).toBe('wrote');
    expect(res.backupPath).toBeDefined();
    expect(existsSync(res.backupPath!)).toBe(true);
    // backup retains the original
    expect(readFileSync(res.backupPath!, 'utf8')).toBe(userContent);
    // new file keeps user content + appends managed section
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain('model = "gpt-5.4"');
    expect(written).toContain(MARKER_START);
  });

  test('skipBackup suppresses .bak creation', async () => {
    writeFileSync(configPath, `model = "x"\n`);
    const res = await migrateCodexConfig({
      configPath,
      now: STABLE_CLOCK,
      skipBackup: true,
    });
    expect(res.backupPath).toBeUndefined();
    expect(readdirSync(workdir).filter((f) => f.includes('.bak-'))).toEqual([]);
  });
});

describe('migrateCodexConfig · subsequent runs', () => {
  test('idempotent re-run with same body = no-op (no rewrite, no backup)', async () => {
    await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    const r2 = await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    expect(r2.action).toBe('no-op');
    expect(r2.backupPath).toBeUndefined();
    // no-op never produced a 2nd backup
    expect(readdirSync(workdir).filter((f) => f.includes('.bak-'))).toHaveLength(0);
  });

  test('re-run with different entry replaces in place', async () => {
    await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    const r2 = await migrateCodexConfig({
      configPath,
      now: STABLE_CLOCK,
      entry: { command: '/custom/elanous' },
    });
    expect(r2.action).toBe('replaced');
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain('command = "/custom/elanous"');
  });
});

describe('migrateCodexConfig · remove', () => {
  test('--remove strips the managed section + writes backup', async () => {
    await migrateCodexConfig({ configPath, now: STABLE_CLOCK });
    const r = await migrateCodexConfig({
      configPath,
      now: STABLE_CLOCK,
      remove: true,
    });
    expect(r.action).toBe('removed');
    expect(r.backupPath).toBeDefined();
    const written = readFileSync(configPath, 'utf8');
    expect(written).not.toContain(MARKER_START);
    expect(written).not.toContain('[mcp_servers.elanous-tools]');
  });

  test('--remove on file without markers → no-op', async () => {
    writeFileSync(configPath, `model = "x"\n`);
    const r = await migrateCodexConfig({
      configPath,
      now: STABLE_CLOCK,
      remove: true,
    });
    expect(r.action).toBe('no-op');
  });
});

describe('migrateCodexConfig · auto-creates parent', () => {
  test('creates missing ~/.codex dir', async () => {
    const nestedPath = join(workdir, 'missing-dir', 'config.toml');
    const r = await migrateCodexConfig({
      configPath: nestedPath,
      now: STABLE_CLOCK,
    });
    expect(r.action).toBe('wrote');
    expect(existsSync(nestedPath)).toBe(true);
  });
});
