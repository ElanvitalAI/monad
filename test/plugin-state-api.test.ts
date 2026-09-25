// ── PX-2 P2: PluginStateApi tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsPluginStatePersistence } from '../src/plugin-state/persistence';
import { createPluginStateApi, createSessionStateMap } from '../src/plugin-state/api';

let userRoot: string;
let projectRoot: string;
let persist: FsPluginStatePersistence;

beforeEach(() => {
  userRoot = mkdtempSync(join(tmpdir(), 'psa-u-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'psa-p-'));
  persist = new FsPluginStatePersistence({
    userRoot,
    projectRoot,
    warn: () => { /* silent */ },
  });
});

afterEach(() => {
  rmSync(userRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('persist / load', () => {
  test('round-trip user scope', async () => {
    const api = createPluginStateApi('alpha', persist);
    await api.persist('k', { n: 1 });
    const got = await api.load<{ n: number }>('k');
    expect(got).toEqual({ n: 1 });
  });

  test('project scope wins over user on unscoped load', async () => {
    const api = createPluginStateApi('alpha', persist);
    await api.persist('k', { where: 'user' }, { scope: 'user' });
    await api.persist('k', { where: 'project' }, { scope: 'project' });
    const got = await api.load<{ where: string }>('k');
    expect(got?.where).toBe('project');
  });

  test('explicit scope bypasses precedence', async () => {
    const api = createPluginStateApi('alpha', persist);
    await api.persist('k', { where: 'user' }, { scope: 'user' });
    await api.persist('k', { where: 'project' }, { scope: 'project' });
    const user = await api.load<{ where: string }>('k', { scope: 'user' });
    expect(user?.where).toBe('user');
  });

  test('different plugins isolated (namespace)', async () => {
    const a = createPluginStateApi('alpha', persist);
    const b = createPluginStateApi('beta', persist);
    await a.persist('k', { v: 'a' });
    expect(await b.load('k')).toBeNull();
  });

  test('schema applied at persist via opts.schema', async () => {
    const api = createPluginStateApi('alpha', persist);
    const schema = {
      parse: (v: unknown) => {
        if (!v || typeof v !== 'object' || !('n' in v)) throw new Error('bad');
        return v;
      },
    };
    await expect(api.persist('k', { wrong: true } as any, { schema })).rejects.toThrow(/bad/);
  });

  test('missing key → null', async () => {
    const api = createPluginStateApi('alpha', persist);
    expect(await api.load('never')).toBeNull();
  });
});

describe('session state', () => {
  test('write/read/subscribe', () => {
    const api = createPluginStateApi('alpha', persist);
    const h = api.session<number>('counter');
    expect(h.read()).toBeNull();
    const seen: number[] = [];
    const unsub = h.subscribe(v => seen.push(v));
    h.write(1);
    h.write(2);
    unsub();
    h.write(3);
    expect(seen).toEqual([1, 2]);
    expect(h.read()).toBe(3);
  });

  test('multiple subscribers all receive', () => {
    const api = createPluginStateApi('alpha', persist);
    const h = api.session<string>('topic');
    const a: string[] = [];
    const b: string[] = [];
    h.subscribe(v => a.push(v));
    h.subscribe(v => b.push(v));
    h.write('hello');
    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  test('clear() drops value + subscribers', () => {
    const api = createPluginStateApi('alpha', persist);
    const h = api.session<number>('x');
    h.write(1);
    const calls: number[] = [];
    h.subscribe(v => calls.push(v));
    h.clear();
    expect(h.read()).toBeNull();
    h.write(2);
    expect(calls).toEqual([]);  // subscriber was cleared
  });

  test('session map shared across calls to session() same key', () => {
    const api = createPluginStateApi('alpha', persist);
    const h1 = api.session<number>('shared');
    const h2 = api.session<number>('shared');
    h1.write(42);
    expect(h2.read()).toBe(42);
  });

  test('different session keys isolated', () => {
    const api = createPluginStateApi('alpha', persist);
    const a = api.session<number>('a');
    const b = api.session<number>('b');
    a.write(1);
    b.write(2);
    expect(a.read()).toBe(1);
    expect(b.read()).toBe(2);
  });

  test('sessionMap shared across plugins with SAME map param → namespaced', () => {
    const shared = createSessionStateMap();
    const a = createPluginStateApi('alpha', persist, shared);
    const b = createPluginStateApi('beta', persist, shared);
    a.session<number>('k').write(1);
    // beta's 'k' is stored under 'beta:k', not shared with alpha
    expect(b.session<number>('k').read()).toBeNull();
  });
});

describe('listKeys', () => {
  test('lists only this plugin\'s keys', async () => {
    const a = createPluginStateApi('alpha', persist);
    const b = createPluginStateApi('beta', persist);
    await a.persist('k1', {});
    await a.persist('k2', {});
    await b.persist('k1', {});
    const keys = (await a.listKeys()).sort();
    expect(keys).toEqual(['k1', 'k2']);
  });

  test('scope filter', async () => {
    const api = createPluginStateApi('alpha', persist);
    await api.persist('u-only', { v: 1 }, { scope: 'user' });
    await api.persist('p-only', { v: 2 }, { scope: 'project' });
    expect(await api.listKeys('user')).toEqual(['u-only']);
    expect(await api.listKeys('project')).toEqual(['p-only']);
  });
});
