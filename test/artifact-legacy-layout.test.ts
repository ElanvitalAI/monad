// ── VW-term-infra Bundle B-5 · P6-4 — legacy-layout provider tests ──

import { describe, expect, test } from 'bun:test';

import { createLegacyLayoutProvider } from '../src/artifact/index.js';
import type { LegacyLayoutProviderFs } from '../src/artifact/index.js';

interface FakeEntry {
  body: string;
  mtimeMs: number;
  size?: number;
}

function makeFakeFs(entries: Record<string, FakeEntry>): LegacyLayoutProviderFs {
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
      return { mtimeMs: e.mtimeMs, size: e.size ?? e.body.length };
    },
    readFileSync(p) {
      const e = entries[p];
      if (!e) throw new Error(`no file: ${p}`);
      return e.body;
    },
  };
}

describe('createLegacyLayoutProvider', () => {
  test('scans *.layout.json · extracts slug from filename', () => {
    const fs = makeFakeFs({
      '/legacy/kanban.layout.json': {
        body: JSON.stringify({ version: 1, windowId: 'w1', createdAt: 100, label: 'Kanban' }),
        mtimeMs: 1_700_000_000_000,
      },
    });
    const provider = createLegacyLayoutProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.kind).toBe('layout');
    expect(out[0]!.meta.origin).toBe('kanban');
    expect(out[0]!.meta.producer).toBe('vwt-3a-legacy');
  });

  test('JSON parse · extracts label (→ description) + createdAt', () => {
    const fs = makeFakeFs({
      '/legacy/four-pane.layout.json': {
        body: JSON.stringify({
          version: 1,
          windowId: 'w2',
          createdAt: 1_600_000_000_000,
          label: 'Four-pane dashboard',
        }),
        mtimeMs: 9_999_999_999_999,
      },
    });
    const provider = createLegacyLayoutProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out[0]!.meta.description).toBe('Four-pane dashboard');
    expect(out[0]!.meta.createdAt).toBe(1_600_000_000_000);  // from spec · wins over mtimeMs
  });

  test('JSON broken → falls back to mtimeMs + slug description', () => {
    const fs = makeFakeFs({
      '/legacy/broken.layout.json': {
        body: '{ not valid json',
        mtimeMs: 1_700_000_000_000,
      },
    });
    const provider = createLegacyLayoutProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.createdAt).toBe(1_700_000_000_000);
    expect(out[0]!.meta.description).toBe('Legacy layout broken');
  });

  test('non-.layout.json files ignored', () => {
    const fs = makeFakeFs({
      '/legacy/README.md': { body: 'hi', mtimeMs: 1 },
      '/legacy/good.layout.json': { body: '{}', mtimeMs: 2 },
    });
    const provider = createLegacyLayoutProvider({ dir: '/legacy', fs });
    expect(provider.list()).toHaveLength(1);
  });

  test('missing directory → empty list (no throw)', () => {
    const fs = makeFakeFs({});
    const provider = createLegacyLayoutProvider({ dir: '/does-not-exist', fs });
    expect(provider.list()).toEqual([]);
  });

  test('multiple entries sorted by createdAt ascending', () => {
    const fs = makeFakeFs({
      '/legacy/older.layout.json': {
        body: JSON.stringify({ version: 1, windowId: 'w', createdAt: 1000 }),
        mtimeMs: 5000,
      },
      '/legacy/newer.layout.json': {
        body: JSON.stringify({ version: 1, windowId: 'w', createdAt: 2000 }),
        mtimeMs: 3000,
      },
    });
    const provider = createLegacyLayoutProvider({ dir: '/legacy', fs });
    const out = provider.list();
    expect(out[0]!.meta.origin).toBe('older');
    expect(out[1]!.meta.origin).toBe('newer');
  });
});
