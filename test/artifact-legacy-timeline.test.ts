// ── VW-term-infra Bundle B-4 · P6-3 — legacy timeline provider tests ──
//
// Hermetic · uses fake LegacyProviderFs · no real `~/.monad/timelines/`.

import { describe, expect, test } from 'bun:test';

import { createLegacyTimelineProvider } from '../src/artifact/index.js';
import type { LegacyProviderFs } from '../src/artifact/index.js';

interface FakeEntry {
  mtimeMs: number;
  size: number;
}

function makeFakeFs(entries: Record<string, FakeEntry>): LegacyProviderFs {
  return {
    existsSync(p) {
      return Object.keys(entries).some(full => full === p || full.startsWith(p + '/'));
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const names = new Set<string>();
      for (const full of Object.keys(entries)) {
        if (!full.startsWith(prefix)) continue;
        const rest = full.slice(prefix.length);
        if (rest.includes('/')) continue;
        names.add(rest);
      }
      return [...names];
    },
    statSync(p) {
      const e = entries[p];
      if (!e) throw new Error(`no file: ${p}`);
      return { mtimeMs: e.mtimeMs, size: e.size };
    },
  };
}

describe('createLegacyTimelineProvider · rec-*.cast', () => {
  test('scans rec-<id>.cast · synthesizes meta · origin extracted', () => {
    const fs = makeFakeFs({
      '/legacy/rec-abc123.cast': { mtimeMs: 1_700_000_000_000, size: 1024 },
    });
    const provider = createLegacyTimelineProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/legacy/rec-abc123.cast');
    expect(out[0]!.meta.kind).toBe('timeline');
    expect(out[0]!.meta.origin).toBe('abc123');
    expect(out[0]!.meta.producer).toBe('bundle-8t-legacy');
    expect(out[0]!.meta.createdAt).toBe(1_700_000_000_000);
    expect(out[0]!.meta.sizeBytes).toBe(1024);
    expect(out[0]!.meta.tags).toContain('legacy');
  });
});

describe('createLegacyTimelineProvider · widget-timeline-*.cast', () => {
  test('scans widget-timeline-<iso>.cast · producer=widget-team-8w-legacy', () => {
    const fs = makeFakeFs({
      '/legacy/widget-timeline-2026-04-20T12-00-00.cast': { mtimeMs: 1, size: 256 },
    });
    const provider = createLegacyTimelineProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.origin).toBe('2026-04-20T12-00-00');
    expect(out[0]!.meta.producer).toBe('widget-team-8w-legacy');
    expect(out[0]!.meta.tags).toContain('8w-slash');
  });
});

describe('createLegacyTimelineProvider · robustness', () => {
  test('missing directory → empty list (no throw)', () => {
    const fs = makeFakeFs({});
    const provider = createLegacyTimelineProvider({ dir: '/does-not-exist', fs });
    expect(provider.list()).toEqual([]);
  });

  test('non-matching .cast file skipped silently', () => {
    const fs = makeFakeFs({
      '/legacy/other.cast': { mtimeMs: 1, size: 0 },
      '/legacy/rec-good.cast': { mtimeMs: 2, size: 10 },
    });
    const provider = createLegacyTimelineProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.origin).toBe('good');
  });

  test('non-.cast files ignored', () => {
    const fs = makeFakeFs({
      '/legacy/README.md': { mtimeMs: 1, size: 0 },
      '/legacy/rec-keeper.cast': { mtimeMs: 2, size: 0 },
    });
    const provider = createLegacyTimelineProvider({ dir: '/legacy', fs });
    expect(provider.list()).toHaveLength(1);
  });

  test('multiple entries sorted by createdAt ascending', () => {
    const fs = makeFakeFs({
      '/legacy/rec-newer.cast': { mtimeMs: 2000, size: 0 },
      '/legacy/rec-older.cast': { mtimeMs: 1000, size: 0 },
    });
    const provider = createLegacyTimelineProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out[0]!.meta.origin).toBe('older');
    expect(out[1]!.meta.origin).toBe('newer');
  });

  test('custom patterns override defaults', () => {
    const fs = makeFakeFs({
      '/legacy/xyz-alpha.cast': { mtimeMs: 1, size: 0 },
    });
    const provider = createLegacyTimelineProvider({
      dir: '/legacy',
      fs,
      origins: { recPattern: /^xyz-(.+)\.cast$/ },
    });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.origin).toBe('alpha');
  });
});
