// ── SetWorkingDir ToolRuntime (WD8) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setWorkingDirRuntime } from '../src/tool-runtime/set-working-dir-runtime';
import {
  __resetSessionWorkingDir,
  getSessionCwd,
  initSessionWorkingDir,
} from '../src/session/working-dir';

describe('SetWorkingDir runtime', () => {
  let home: string;
  let insideHome: string;
  let outsideHome: string;
  const savedHome = process.env.HOME;
  const savedOverride = process.env.ELANOUS_SWD_ALLOW_OUTSIDE_HOME;

  beforeEach(() => {
    // Build a fake HOME so the allowlist check is deterministic.
    home = mkdtempSync(join(tmpdir(), 'swd-home-'));
    process.env.HOME = home;
    insideHome = mkdtempSync(join(home, 'proj-'));
    outsideHome = mkdtempSync(join(tmpdir(), 'swd-out-'));
    __resetSessionWorkingDir();
    initSessionWorkingDir(home);
    delete process.env.ELANOUS_SWD_ALLOW_OUTSIDE_HOME;
  });

  afterEach(() => {
    __resetSessionWorkingDir();
    try { rmSync(outsideHome, { recursive: true, force: true }); } catch {}
    try { rmSync(home, { recursive: true, force: true }); } catch {}
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedOverride === undefined) delete process.env.ELANOUS_SWD_ALLOW_OUTSIDE_HOME;
    else process.env.ELANOUS_SWD_ALLOW_OUTSIDE_HOME = savedOverride;
  });

  test('absolute path inside HOME → switches SWD', async () => {
    const res = await setWorkingDirRuntime.run({ path: insideHome }, { surface: 'dashboard' });
    expect(res.cwd).toBe(resolve(insideHome));
    expect(res.origin).toBe('tool');
    expect(res.output).toContain('working dir →');
    expect(getSessionCwd()).toBe(resolve(insideHome));
  });

  test('~ expansion resolves to HOME', async () => {
    const res = await setWorkingDirRuntime.run({ path: '~' }, { surface: 'dashboard' });
    expect(res.cwd).toBe(resolve(home));
  });

  test('relative path resolves against current SWD', async () => {
    initSessionWorkingDir(home);
    // Create a sibling under HOME and reference it relatively.
    const sib = mkdtempSync(join(home, 'sib-'));
    const rel = sib.slice(home.length + 1); // drop leading slash
    const res = await setWorkingDirRuntime.run({ path: rel }, { surface: 'dashboard' });
    expect(res.cwd).toBe(resolve(sib));
  });

  test('path outside HOME is rejected by default', async () => {
    await expect(
      setWorkingDirRuntime.run({ path: outsideHome }, { surface: 'dashboard' }),
    ).rejects.toThrow(/outside HOME/);
  });

  test('ELANOUS_SWD_ALLOW_OUTSIDE_HOME=1 permits outside-HOME targets', async () => {
    process.env.ELANOUS_SWD_ALLOW_OUTSIDE_HOME = '1';
    const res = await setWorkingDirRuntime.run({ path: outsideHome }, { surface: 'dashboard' });
    expect(res.cwd).toBe(resolve(outsideHome));
  });

  test('non-existent path is rejected', async () => {
    await expect(
      setWorkingDirRuntime.run({ path: join(home, 'nope-dir') }, { surface: 'dashboard' }),
    ).rejects.toThrow(/does not exist/);
  });

  test('file path (not directory) is rejected', async () => {
    const f = join(home, 'a.txt');
    writeFileSync(f, 'hi');
    await expect(
      setWorkingDirRuntime.run({ path: f }, { surface: 'dashboard' }),
    ).rejects.toThrow(/not a directory/);
  });

  test('empty path is rejected', async () => {
    await expect(
      setWorkingDirRuntime.run({ path: '' }, { surface: 'dashboard' }),
    ).rejects.toThrow(/`path` is required/);
  });
});
