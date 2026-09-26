// ── VW-term-infra Bundle B-2 · P6-1 — artifact store tests ──
//
// Covers types · path resolver · meta encode/decode · store put/get/
// list/subscribe. Uses an in-memory fs fake so tests never touch
// `~/.elanous/artifacts/`.

import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import {
  decodeMeta,
  encodeMeta,
  ArtifactMetaParseError,
} from '../src/artifact/meta.js';
import {
  DEFAULT_EXTENSIONS,
  defaultArtifactBaseDir,
  directoryFor,
  metaPathFor,
  resolveArtifactPath,
  sanitizeOrigin,
  timestampSlug,
} from '../src/artifact/paths.js';
import {
  createArtifactStore,
  type ArtifactFs,
} from '../src/artifact/store.js';
import type { ArtifactEvent, ArtifactMeta } from '../src/artifact/types.js';

// ── Fake fs ─────────────────────────────────────────────────────

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
      if (files.has(p)) return true;
      // Directory exists if any file or dir is under it, or it's explicitly recorded.
      if (dirs.has(p)) return true;
      const prefix = p.endsWith('/') ? p : p + '/';
      for (const full of files.keys()) {
        if (full.startsWith(prefix)) return true;
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) return true;
      }
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

// ── Paths + meta ────────────────────────────────────────────────

describe('artifact · paths', () => {
  test('defaultArtifactBaseDir appends artifacts to the isolated state root', () => {
    const isolatedStateRoot = process.env.ELANOUS_STATE_DIR;
    expect(isolatedStateRoot).toBeDefined();
    expect(defaultArtifactBaseDir()).toBe(path.join(isolatedStateRoot!, 'artifacts'));
  });

  test('timestampSlug is YYYYMMDD-HHmmss · sortable', () => {
    const slug = timestampSlug(Date.UTC(2026, 3, 20, 14, 2, 30));
    expect(slug).toBe('20260420-140230');
  });

  test('sanitizeOrigin collapses unsafe chars + empty → "unknown"', () => {
    expect(sanitizeOrigin('rec-abc123')).toBe('rec-abc123');
    expect(sanitizeOrigin('with space/slash')).toBe('with-space-slash');
    expect(sanitizeOrigin('')).toBe('unknown');
    expect(sanitizeOrigin('!!!')).toBe('unknown');
  });

  test('resolveArtifactPath composes <base>/<kind>/<stamp>-<origin>.<ext>', () => {
    const p = resolveArtifactPath({
      kind: 'timeline',
      origin: 'rec-01',
      createdAt: Date.UTC(2026, 3, 20, 12, 0, 0),
      baseDir: '/tmp/artifacts',
    });
    expect(p).toContain('/tmp/artifacts/timeline/20260420-120000-rec-01.cast');
  });

  test('resolveArtifactPath extOverride respected', () => {
    const p = resolveArtifactPath({
      kind: 'capture',
      origin: 'pane-xy',
      createdAt: 0,
      extOverride: 'svg',
    });
    expect(p.endsWith('.svg')).toBe(true);
  });

  test('DEFAULT_EXTENSIONS maps all 5 kinds', () => {
    expect(DEFAULT_EXTENSIONS.timeline).toBe('cast');
    expect(DEFAULT_EXTENSIONS.layout).toBe('layout.json');
    expect(DEFAULT_EXTENSIONS.capture).toBe('png');
    expect(DEFAULT_EXTENSIONS.block).toBe('md');
    expect(DEFAULT_EXTENSIONS.attachment).toBe('bin');
  });

  test('metaPathFor appends .meta.json', () => {
    expect(metaPathFor('/x/y.cast')).toBe('/x/y.cast.meta.json');
  });

  test('directoryFor joins base + kind', () => {
    expect(directoryFor('timeline', '/base')).toBe('/base/timeline');
  });
});

describe('artifact · meta encode/decode', () => {
  test('round-trip preserves all fields', () => {
    const meta: ArtifactMeta = {
      kind: 'timeline',
      origin: 'rec-01',
      createdAt: 1_700_000_000_000,
      sizeBytes: 42,
      description: 'test',
      tags: ['demo', 'bundle-8t'],
      producer: 'bundle-8t',
      extra: { frameCount: 5 },
    };
    const encoded = encodeMeta(meta);
    const decoded = decodeMeta(encoded);
    expect(decoded).toEqual(meta);
  });

  test('decode rejects missing kind', () => {
    expect(() => decodeMeta('{"origin":"x","createdAt":0}')).toThrow(ArtifactMetaParseError);
  });

  test('decode rejects unknown kind', () => {
    expect(() => decodeMeta('{"kind":"bogus","origin":"x","createdAt":0}')).toThrow(/unknown kind/);
  });

  test('decode rejects malformed JSON', () => {
    expect(() => decodeMeta('{not json')).toThrow(ArtifactMetaParseError);
  });
});

// ── Store ───────────────────────────────────────────────────────

describe('ArtifactStore · put/get/list', () => {
  test('put writes body + meta sidecar · returns handle with enriched meta', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1_700_000_000_000 });
    const handle = store.put('timeline', 'body', { origin: 'rec-01' });
    expect(handle.path.endsWith('.cast')).toBe(true);
    expect(handle.metaPath.endsWith('.meta.json')).toBe(true);
    expect(handle.meta.kind).toBe('timeline');
    expect(handle.meta.origin).toBe('rec-01');
    expect(handle.meta.createdAt).toBe(1_700_000_000_000);
    expect(handle.meta.sizeBytes).toBe(4);
    expect(fs.files.has(handle.path)).toBe(true);
    expect(fs.files.has(handle.metaPath)).toBe(true);
  });

  test('put Buffer body · sizeBytes from byteLength', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const handle = store.put('capture', Buffer.from([1, 2, 3]), { origin: 'pane' });
    expect(handle.meta.sizeBytes).toBe(3);
  });

  test('get returns body + meta for text kind', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const h = store.put('timeline', 'hello', { origin: 'rec' });
    const got = store.get(h.path);
    expect(got.body).toBe('hello');
    expect(got.meta.origin).toBe('rec');
  });

  test('get returns Buffer for binary kind', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const h = store.put('capture', Buffer.from([7, 7]), { origin: 'p' });
    const got = store.get(h.path);
    expect(Buffer.isBuffer(got.body)).toBe(true);
    expect((got.body as Buffer).length).toBe(2);
  });

  test('get unknown path throws', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs });
    expect(() => store.get('/b/ghost.cast')).toThrow(/artifact not found/);
  });

  test('list(kind) returns sorted listings · empty when dir empty', () => {
    const fs = makeFakeFs();
    let t = 1;
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => (t += 1000) });
    expect(store.list('timeline')).toEqual([]);
    store.put('timeline', 'a', { origin: 'rec-1' });
    store.put('timeline', 'b', { origin: 'rec-2' });
    const listed = store.list('timeline');
    expect(listed).toHaveLength(2);
    expect(listed[0]!.meta.origin).toBe('rec-1');  // earlier createdAt
    expect(listed[1]!.meta.origin).toBe('rec-2');
  });

  test('list() without kind aggregates all kinds sorted by createdAt', () => {
    const fs = makeFakeFs();
    let t = 1;
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => (t += 1000) });
    store.put('timeline', 'a', { origin: 'r' });
    store.put('layout', 'b', { origin: 'l' });
    store.put('capture', Buffer.from([1]), { origin: 'c' });
    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all.map(a => a.meta.kind)).toEqual(['timeline', 'layout', 'capture']);
  });

  test('list skips meta with malformed JSON · no throw', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    store.put('timeline', 'a', { origin: 'good' });
    // Corrupt a meta file by writing malformed JSON to a second entry.
    fs.writeFileSync('/b/timeline/20260420-000000-bad.cast', 'body');
    fs.writeFileSync('/b/timeline/20260420-000000-bad.cast.meta.json', '{bad json');
    const listed = store.list('timeline');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.meta.origin).toBe('good');
  });
});

describe('ArtifactStore · subscribe', () => {
  test('put fires put event with handle', () => {
    const fs = makeFakeFs();
    const store = createArtifactStore({ baseDir: '/b', fs, now: () => 1 });
    const events: ArtifactEvent[] = [];
    const off = store.subscribe((e) => events.push(e));
    store.put('timeline', 'x', { origin: 'rec' });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('put');
    off();
    store.put('timeline', 'y', { origin: 'rec2' });
    expect(events).toHaveLength(1); // no further after unsubscribe
  });
});
