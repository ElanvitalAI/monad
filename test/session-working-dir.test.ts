// ── Session Working Directory (WD1) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  initSessionWorkingDir,
  getSessionCwd,
  getSessionProjectRoot,
  getSessionWorkingDir,
  setSessionCwd,
  subscribeSessionCwd,
  pickSwdTargetFromBrowser,
  __resetSessionWorkingDir,
} from '../src/session/working-dir.js';

describe('session-working-dir', () => {
  let tmp: string;

  beforeEach(() => {
    __resetSessionWorkingDir();
    tmp = mkdtempSync(join(tmpdir(), 'swd-'));
  });

  afterEach(() => {
    __resetSessionWorkingDir();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('lazy init seeds from process.cwd() on first read', () => {
    const cwd = getSessionCwd();
    expect(cwd).toBe(resolve(process.cwd()));
    expect(getSessionWorkingDir().origin).toBe('boot');
  });

  test('initSessionWorkingDir pins an explicit boot cwd', () => {
    initSessionWorkingDir(tmp);
    expect(getSessionCwd()).toBe(resolve(tmp));
    expect(getSessionWorkingDir().origin).toBe('boot');
  });

  test('setSessionCwd flips state + timestamp', () => {
    initSessionWorkingDir(process.cwd());
    const before = Date.now();
    const next = setSessionCwd(tmp, 'user');
    expect(next.cwd).toBe(resolve(tmp));
    expect(next.origin).toBe('user');
    expect(next.setAt).toBeGreaterThanOrEqual(before);
    expect(getSessionCwd()).toBe(resolve(tmp));
  });

  test('setSessionCwd rejects non-existent paths', () => {
    expect(() => setSessionCwd(join(tmp, 'nope'), 'user')).toThrow(/does not exist/);
  });

  test('setSessionCwd rejects files', () => {
    const f = join(tmp, 'a.txt');
    writeFileSync(f, 'hi');
    expect(() => setSessionCwd(f, 'user')).toThrow(/not a directory/);
  });

  test('subscribers fire after a real switch', () => {
    initSessionWorkingDir(process.cwd());
    const seen: string[] = [];
    subscribeSessionCwd(s => { seen.push(s.cwd); });
    setSessionCwd(tmp, 'slash');
    expect(seen).toEqual([resolve(tmp)]);
  });

  test('identity set does not fire subscribers', () => {
    initSessionWorkingDir(tmp);
    let fired = 0;
    subscribeSessionCwd(() => { fired += 1; });
    setSessionCwd(tmp, 'user');
    expect(fired).toBe(0);
  });

  test('unsubscribe stops future notifications', () => {
    initSessionWorkingDir(process.cwd());
    let fired = 0;
    const off = subscribeSessionCwd(() => { fired += 1; });
    setSessionCwd(tmp, 'user');
    off();
    const tmp2 = mkdtempSync(join(tmpdir(), 'swd-b-'));
    try {
      setSessionCwd(tmp2, 'user');
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
    expect(fired).toBe(1);
  });

  test('subscriber errors do not break the switch', () => {
    initSessionWorkingDir(process.cwd());
    subscribeSessionCwd(() => { throw new Error('boom'); });
    expect(() => setSessionCwd(tmp, 'user')).not.toThrow();
    expect(getSessionCwd()).toBe(resolve(tmp));
  });

  test('origin is preserved across reads', () => {
    initSessionWorkingDir(process.cwd());
    setSessionCwd(tmp, 'tool');
    expect(getSessionWorkingDir().origin).toBe('tool');
  });

  test('resolves the closest supported project marker above the session cwd', () => {
    const project = join(tmp, 'project');
    const nested = join(project, 'nested');
    const session = join(nested, 'deeper');
    mkdirSync(session, { recursive: true });
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(join(nested, 'pyproject.toml'), '[project]');
    setSessionCwd(session, 'tool');

    expect(getSessionProjectRoot()).toEqual({ path: resolve(nested), source: 'marker' });
  });

  test.each(['.elanous', '.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'])(
    'recognizes %s as a project marker',
    marker => {
      const project = join(tmp, marker.replace(/[^a-z]/gi, '') || 'dot-marker');
      const session = join(project, 'sub');
      mkdirSync(session, { recursive: true });
      if (marker.startsWith('.')) mkdirSync(join(project, marker));
      else writeFileSync(join(project, marker), 'marker');
      setSessionCwd(session, 'tool');

      expect(getSessionProjectRoot()).toEqual({ path: resolve(project), source: 'marker' });
    },
  );

  test('falls back to the session cwd with an explicit fallback source when unmarked', () => {
    const session = join(tmp, 'unmarked', 'sub');
    mkdirSync(session, { recursive: true });
    setSessionCwd(session, 'tool');

    expect(getSessionProjectRoot()).toEqual({ path: resolve(session), source: 'cwd-fallback' });
  });
});

describe('pickSwdTargetFromBrowser', () => {
  const mk = (overrides: Partial<Parameters<typeof pickSwdTargetFromBrowser>[0]> = {}) => ({
    cwd: '/tmp/cur',
    entries: [
      { name: '..', absPath: '/tmp', isDir: true },
      { name: 'sub', absPath: '/tmp/cur/sub', isDir: true },
      { name: 'file.ts', absPath: '/tmp/cur/file.ts', isDir: false },
    ],
    cursor: 0,
    ...overrides,
  });

  test('cursor on `..` → current dir', () => {
    expect(pickSwdTargetFromBrowser(mk({ cursor: 0 }))).toBe('/tmp/cur');
  });

  test('cursor on subfolder → that folder', () => {
    expect(pickSwdTargetFromBrowser(mk({ cursor: 1 }))).toBe('/tmp/cur/sub');
  });

  test('cursor on file → current dir', () => {
    expect(pickSwdTargetFromBrowser(mk({ cursor: 2 }))).toBe('/tmp/cur');
  });

  test('cursor out of range → current dir', () => {
    expect(pickSwdTargetFromBrowser(mk({ cursor: 99 }))).toBe('/tmp/cur');
  });

  test('empty entries → current dir', () => {
    expect(pickSwdTargetFromBrowser({ cwd: '/x', entries: [], cursor: 0 })).toBe('/x');
  });
});
