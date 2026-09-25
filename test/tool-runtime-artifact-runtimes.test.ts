// ── VW-term-infra Bundle B-2 · P6-1 — artifact-runtimes tests ──

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildListArtifactsTool,
  dispatchListArtifacts,
  registerArtifactRuntimes,
  __resetArtifactRuntimesForTest,
} from '../src/tool-runtime/artifact-runtimes.js';
import {
  _resetToolRuntimeRegistryForTest,
  getToolRuntime,
} from '../src/tool-runtime/registry.js';
import { getChordHint } from '../src/tool-runtime/mirror-hints.js';
import {
  createArtifactStore,
  type ArtifactFs,
} from '../src/artifact/index.js';

function makeFakeFs(): ArtifactFs & { files: Map<string, string | Buffer>; dirs: Set<string> } {
  const files = new Map<string, string | Buffer>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    mkdirSync(p) { dirs.add(p); },
    writeFileSync(p, body) { files.set(p, body); },
    readFileSync(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`no file: ${p}`);
      return typeof v === 'string' ? v : v.toString('utf8');
    },
    readFileSyncBuffer(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`no file: ${p}`);
      return typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
    },
    existsSync(p) {
      if (files.has(p) || dirs.has(p)) return true;
      const prefix = p.endsWith('/') ? p : p + '/';
      for (const full of files.keys()) if (full.startsWith(prefix)) return true;
      for (const d of dirs) if (d.startsWith(prefix)) return true;
      return false;
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const names = new Set<string>();
      for (const full of files.keys()) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        if (rest.includes('/')) continue;
        names.add(rest);
      }
      return [...names];
    },
  };
}

afterEach(() => {
  __resetArtifactRuntimesForTest();
  _resetToolRuntimeRegistryForTest();
});

describe('ListArtifacts · tool spec', () => {
  test('name · enum kinds · mirror chord "^B a"', () => {
    const spec = buildListArtifactsTool();
    expect(spec.name).toBe('ListArtifacts');
    const params = spec.parameters as {
      properties: { kind: { enum: string[] } };
    };
    expect(params.properties.kind.enum).toEqual([
      'timeline', 'layout', 'capture', 'block', 'attachment',
    ]);
    expect(getChordHint(spec)).toBe('^B a');
  });
});

describe('dispatchListArtifacts', () => {
  test('empty store → total 0 · artifacts []', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    const out = dispatchListArtifacts({}, { store });
    expect(out.total).toBe(0);
    expect(out.artifacts).toEqual([]);
    expect(out.kindFilter).toBeUndefined();
  });

  test('after 3 puts across 2 kinds → list all sorted', () => {
    let t = 1;
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs(), now: () => (t += 1000) });
    store.put('timeline', 'a', { origin: 'r1' });
    store.put('layout', 'b', { origin: 'l1' });
    store.put('timeline', 'c', { origin: 'r2' });
    const out = dispatchListArtifacts({}, { store });
    expect(out.total).toBe(3);
    const kinds = out.artifacts.map(a => a.meta.kind);
    expect(kinds).toEqual(['timeline', 'layout', 'timeline']);
  });

  test('kind filter returns only matching', () => {
    let t = 1;
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs(), now: () => (t += 1000) });
    store.put('timeline', 'a', { origin: 'r' });
    store.put('layout', 'b', { origin: 'l' });
    const out = dispatchListArtifacts({ kind: 'timeline' }, { store });
    expect(out.total).toBe(1);
    expect(out.artifacts[0]!.meta.kind).toBe('timeline');
    expect(out.kindFilter).toBe('timeline');
  });

  test('invalid kind silently ignored (no throw)', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    const out = dispatchListArtifacts({ kind: 'bogus' }, { store });
    expect(out.kindFilter).toBeUndefined();
    expect(out.total).toBe(0);
  });
});

describe('registerArtifactRuntimes', () => {
  test('registers artifact_list runtime · idempotent', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    registerArtifactRuntimes({ store });
    expect(getToolRuntime('artifact_list')).toBeDefined();
    expect(() => registerArtifactRuntimes({ store })).not.toThrow();
  });

  test('runtime.run wires through store', async () => {
    let t = 1;
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs(), now: () => (t += 1000) });
    store.put('timeline', 'x', { origin: 'rec-01' });
    registerArtifactRuntimes({ store });
    const rt = getToolRuntime('artifact_list')!;
    const result = await rt.run({} as never, { surface: 'dashboard' } as never);
    const payload = JSON.parse((result as { output: string }).output);
    expect(payload.total).toBe(1);
    expect(payload.artifacts[0].meta.origin).toBe('rec-01');
  });
});

// ── Bundle B-6 · GetArtifact ────────────────────────────────────

import {
  buildGetArtifactTool,
  dispatchGetArtifact,
} from '../src/tool-runtime/artifact-runtimes.js';

describe('buildGetArtifactTool · spec', () => {
  test('name · required path · description mentions security', () => {
    const spec = buildGetArtifactTool();
    expect(spec.name).toBe('GetArtifact');
    const p = spec.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(p.required).toEqual(['path']);
    expect(p.properties.path).toBeDefined();
    expect(spec.description).toMatch(/ListArtifacts/);
  });
});

describe('dispatchGetArtifact', () => {
  test('missing path → found:false · note', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    const out = dispatchGetArtifact({}, { store });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/path is required/);
  });

  test('path not in ListArtifacts results → rejected', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    const out = dispatchGetArtifact({ path: '/etc/passwd' }, { store });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/outside artifact roots/);
  });

  test('known text path → returns body + meta · bytes counted', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const handle = store.put('timeline', 'hello', { origin: 'rec-01' });
    const out = dispatchGetArtifact({ path: handle.path }, { store });
    expect(out.found).toBe(true);
    expect(out.body).toBe('hello');
    expect(out.bodyBase64).toBeUndefined();
    expect(out.bytes).toBe(5);
    expect(out.meta!.kind).toBe('timeline');
    expect(out.meta!.origin).toBe('rec-01');
  });

  test('known binary path → returns bodyBase64 + bytes · no body string', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const handle = store.put('capture', Buffer.from([1, 2, 3, 4]), { origin: 'pane-x' });
    const out = dispatchGetArtifact({ path: handle.path }, { store });
    expect(out.found).toBe(true);
    expect(out.body).toBeUndefined();
    expect(out.bodyBase64).toBeDefined();
    expect(out.bytes).toBe(4);
    expect(Buffer.from(out.bodyBase64!, 'base64').toString('hex')).toBe('01020304');
  });

  test('path validation uses live store list (dedup with legacyProviders honored)', () => {
    const fs = makeFakeFs();
    // Manually seed a "legacy" entry through a fake provider so the
    // listing includes a path outside baseDir; GetArtifact should
    // still validate via that listing.
    const store = createArtifactStore({
      baseDir: '/b',
      fs,
      legacyProviders: [{
        kind: 'timeline',
        list: () => [{
          path: '/legacy/rec-old.cast',
          meta: {
            kind: 'timeline', origin: 'old', createdAt: 1, producer: 'legacy',
          },
        }],
      }],
    });
    // Attempt to fetch the legacy-reported path — store.get() will
    // fail (fake fs missing) but validation passes.
    const out = dispatchGetArtifact({ path: '/legacy/rec-old.cast' }, { store });
    // Expected: validation allowed (no "outside artifact roots" note),
    // but read fails → found:false with a different message.
    expect(out.note).not.toMatch(/outside artifact roots/);
    expect(out.found).toBe(false);
  });

  test('registered runtime dispatches via registry', async () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs(), now: () => 1 });
    const handle = store.put('timeline', 'xyz', { origin: 'r' });
    registerArtifactRuntimes({ store });
    const rt = getToolRuntime('artifact_get')!;
    const result = await rt.run({ path: handle.path } as never, { surface: 'dashboard' } as never);
    const payload = JSON.parse((result as { output: string }).output);
    expect(payload.found).toBe(true);
    expect(payload.body).toBe('xyz');
  });

  test('empty path string → treated as missing', () => {
    const store = createArtifactStore({ baseDir: '/b', fs: makeFakeFs() });
    const out = dispatchGetArtifact({ path: '' }, { store });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/path is required/);
  });
});
