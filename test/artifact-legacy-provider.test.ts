// ── VW-term-infra Bundle B-4 · P6-3 — LegacyArtifactProvider tests ──
//
// Covers the `mergeLegacyListings` helper + `legacyProviders` store
// integration (dedup · kind filter · merge sort). Provider-specific
// behaviour tested in separate files (legacy-timeline.test.ts).

import { describe, expect, test } from 'bun:test';

import {
  createArtifactStore,
  mergeLegacyListings,
  type ArtifactFs,
  type LegacyArtifactProvider,
} from '../src/artifact/index.js';
import type { ArtifactKind, ArtifactListing } from '../src/artifact/index.js';

function makeListing(path: string, kind: ArtifactKind, createdAt: number, origin = 'x'): ArtifactListing {
  return {
    path,
    meta: { kind, origin, createdAt, tags: ['legacy'] },
  };
}

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
      if (v === undefined) throw new Error('no file');
      return typeof v === 'string' ? v : v.toString('utf8');
    },
    readFileSyncBuffer(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error('no file');
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

function makeProvider(kind: ArtifactKind, listings: readonly ArtifactListing[]): LegacyArtifactProvider {
  return { kind, list: () => listings };
}

// ── mergeLegacyListings ─────────────────────────────────────────

describe('mergeLegacyListings', () => {
  test('no providers → main returned unchanged', () => {
    const main = [makeListing('/a', 'timeline', 1)];
    const out = mergeLegacyListings(main, []);
    expect(out).toEqual(main);
  });

  test('main empty · provider contributes · sorted by createdAt', () => {
    const p = makeProvider('timeline', [
      makeListing('/b', 'timeline', 2),
      makeListing('/a', 'timeline', 1),
    ]);
    const out = mergeLegacyListings([], [p]);
    expect(out).toHaveLength(2);
    expect(out[0]!.path).toBe('/a');  // createdAt asc
    expect(out[1]!.path).toBe('/b');
  });

  test('dedup by path · main wins', () => {
    const main = [makeListing('/shared', 'timeline', 100, 'main-origin')];
    const p = makeProvider('timeline', [
      makeListing('/shared', 'timeline', 50, 'legacy-origin'),
    ]);
    const out = mergeLegacyListings(main, [p]);
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.origin).toBe('main-origin');
  });

  test('kind filter · only matching providers contribute', () => {
    const pTimeline = makeProvider('timeline', [makeListing('/t', 'timeline', 1)]);
    const pLayout = makeProvider('layout', [makeListing('/l', 'layout', 2)]);
    const out = mergeLegacyListings([], [pTimeline, pLayout], 'timeline');
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/t');
  });

  test('no kind filter · all providers contribute', () => {
    const pTimeline = makeProvider('timeline', [makeListing('/t', 'timeline', 1)]);
    const pLayout = makeProvider('layout', [makeListing('/l', 'layout', 2)]);
    const out = mergeLegacyListings([], [pTimeline, pLayout]);
    expect(out).toHaveLength(2);
  });
});

// ── Store + legacyProviders integration ─────────────────────────

describe('ArtifactStore · legacyProviders deps', () => {
  test('list(kind) merges main + matching providers', () => {
    const fs = makeFakeFs();
    const legacy = makeProvider('timeline', [
      makeListing('/legacy/rec-old.cast', 'timeline', 100),
    ]);
    let t = 1;
    const store = createArtifactStore({
      baseDir: '/b',
      fs,
      now: () => (t += 1000),
      legacyProviders: [legacy],
    });
    // Main-store entry comes in AFTER legacy by createdAt
    store.put('timeline', 'body', { origin: 'new' });
    const out = store.list('timeline');
    expect(out).toHaveLength(2);
    expect(out[0]!.path).toContain('/legacy/');  // legacy createdAt=100, put t~1000
    // Second should be main-store entry
    expect(out[1]!.meta.origin).toBe('new');
  });

  test('list() without kind · merges every provider', () => {
    const fs = makeFakeFs();
    const pTimeline = makeProvider('timeline', [makeListing('/t', 'timeline', 100)]);
    const pLayout = makeProvider('layout', [makeListing('/l', 'layout', 50)]);
    const store = createArtifactStore({
      baseDir: '/b',
      fs,
      legacyProviders: [pTimeline, pLayout],
    });
    const out = store.list();
    expect(out).toHaveLength(2);
    expect(out[0]!.meta.kind).toBe('layout');  // createdAt 50 < 100
    expect(out[1]!.meta.kind).toBe('timeline');
  });

  test('provider kind mismatch with filter · excluded', () => {
    const fs = makeFakeFs();
    const pLayout = makeProvider('layout', [makeListing('/l', 'layout', 50)]);
    const store = createArtifactStore({
      baseDir: '/b',
      fs,
      legacyProviders: [pLayout],
    });
    const out = store.list('timeline');
    expect(out).toHaveLength(0);
  });
});
