// ── PX-2 P1: FsPluginStatePersistence tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FsPluginStatePersistence,
} from '../src/plugin-state/persistence';

let userRoot: string;
let projectRoot: string;
let p: FsPluginStatePersistence;

function makePersistence(schema?: (pid: string, k: string) => any) {
  return new FsPluginStatePersistence({
    userRoot,
    projectRoot,
    schema,
    warn: () => { /* silence */ },
  });
}

beforeEach(() => {
  userRoot = mkdtempSync(join(tmpdir(), 'pss-u-'));
  const projBase = mkdtempSync(join(tmpdir(), 'pss-p-'));
  projectRoot = projBase;
  p = makePersistence();
});

afterEach(() => {
  rmSync(userRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('FsPluginStatePersistence', () => {
  test('write → read round-trip (user scope)', () => {
    p.write('hello', 'counter', { n: 7 }, 'user');
    const got = p.read<{ n: number }>('hello', 'counter', 'user');
    expect(got).toEqual({ n: 7 });
  });

  test('write scope=project lands under projectRoot/.monad/state', () => {
    p.write('sync', 'prefs', { theme: 'dark' }, 'project');
    // project writes end up at projectRoot/.monad/state/sync/prefs.json
    const path = join(projectRoot, '.monad', 'state', 'sync', 'prefs.json');
    expect(existsSync(path)).toBe(true);
  });

  test('atomic rename — no .tmp file left after write', () => {
    p.write('atomic', 'k', { v: 1 }, 'user');
    const files = readdirSync(join(userRoot, 'atomic'));
    expect(files.some(f => f.includes('.tmp.'))).toBe(false);
    expect(files).toContain('k.json');
  });

  test('read missing key → null', () => {
    expect(p.read('ghost', 'nope', 'user')).toBeNull();
  });

  test('schema validation rejects on write', () => {
    const schema = (_pid: string, _k: string) => ({
      parse: (v: unknown) => {
        if (typeof v !== 'object' || v === null || !(v as any).n) throw new Error('bad');
        return v;
      },
    });
    const q = makePersistence(schema);
    expect(() => q.write('x', 'k', { wrong: true }, 'user')).toThrow(/bad/);
  });

  test('read corruption → quarantine + null', () => {
    // Write valid first.
    p.write('bad', 'k', { v: 1 }, 'user');
    const path = join(userRoot, 'bad', 'k.json');
    // Corrupt the file.
    writeFileSync(path, '{not-json', 'utf-8');
    const got = p.read('bad', 'k', 'user');
    expect(got).toBeNull();
    const files = readdirSync(join(userRoot, 'bad'));
    expect(files.some(f => f.includes('.corrupted.'))).toBe(true);
    // Original file is gone.
    expect(existsSync(path)).toBe(false);
  });

  test('list — returns entries across plugins in one scope', () => {
    p.write('a', 'k1', {}, 'user');
    p.write('a', 'k2', {}, 'user');
    p.write('b', 'k1', {}, 'user');
    const rows = p.list(undefined, 'user');
    expect(rows.length).toBe(3);
    expect(rows.map(r => `${r.pluginId}/${r.key}`).sort()).toEqual(['a/k1', 'a/k2', 'b/k1']);
  });

  test('list filters by pluginId', () => {
    p.write('a', 'k1', {}, 'user');
    p.write('b', 'k1', {}, 'user');
    const rows = p.list('a', 'user');
    expect(rows.map(r => r.pluginId)).toEqual(['a']);
  });

  test('drop(key) removes single file', () => {
    p.write('x', 'k1', {}, 'user');
    p.write('x', 'k2', {}, 'user');
    p.drop('x', 'k1');
    expect(p.read('x', 'k1', 'user')).toBeNull();
    expect(p.read('x', 'k2', 'user')).not.toBeNull();
  });

  test('drop(plugin) removes the whole plugin dir', () => {
    p.write('x', 'k1', {}, 'user');
    p.write('x', 'k2', {}, 'user');
    p.drop('x');
    expect(p.list('x', 'user')).toEqual([]);
  });

  test('sanitizeKey — uppercase / path traversal rejected', () => {
    expect(() => p.write('x', 'UP', {}, 'user')).toThrow(/invalid/);
    expect(() => p.write('x', '../escape', {}, 'user')).toThrow(/invalid/);
    expect(() => p.write('x', '.dotfile', {}, 'user')).toThrow(/invalid/);
  });

  test('scope=project throws when projectRoot missing', () => {
    const nop = new FsPluginStatePersistence({ userRoot });  // no projectRoot
    expect(() => nop.write('x', 'k', {}, 'project')).toThrow(/projectRoot/);
    expect(() => nop.read('x', 'k', 'project')).toThrow(/projectRoot/);
  });
});
