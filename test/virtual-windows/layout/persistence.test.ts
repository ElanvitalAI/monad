// ── VW-term-infra Phase 3a — LayoutSpec persistence tests ──
//
// Sandbox save / load / list into a tmp dir so ~/.monad/layouts stays
// untouched during CI. Cover the positive path + the skip-on-malformed
// contract the UI relies on (broken preset doesn't brick the picker).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, promises as fsp, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildPreset,
  deleteLayoutSpec,
  layoutsDir,
  listLayoutSpecs,
  loadLayoutSpec,
  saveLayoutSpec,
  slugify,
  specSlug,
  type LayoutSpec,
} from '../../../src/virtual-windows/layout/index.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monad-layout-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeSpec(label: string): LayoutSpec {
  return {
    version: 1,
    windowId: 'w:test',
    createdAt: 1_700_000_000_000,
    label,
    root: { kind: 'leaf', paneRef: { windowId: 'w:test', paneId: 'p:a' } },
  };
}

describe('Phase 3a · slugify + specSlug', () => {
  test('spaces / separators collapse to single dash', () => {
    expect(slugify('My Layout / Preset')).toBe('my-layout-preset');
  });

  test('path traversal attempts are neutralized', () => {
    // Slashes collapse to dashes; leading dots strip. Dashes are safe
    // inside filenames (cannot escape the layouts dir).
    const passwd = slugify('../../etc/passwd');
    expect(passwd).not.toContain('/');
    expect(passwd).not.toMatch(/^[.-]/);
    expect(passwd).toContain('etc');
    expect(slugify('/absolute/path')).toBe('absolute-path');
  });

  test('empty string → "unnamed"', () => {
    expect(slugify('')).toBe('unnamed');
    expect(slugify('...')).toBe('unnamed');
  });

  test('specSlug prefers label over windowId', () => {
    const a = makeSpec('alpha');
    expect(specSlug(a)).toBe('alpha');
    const b: LayoutSpec = { ...a, label: undefined };
    expect(specSlug(b)).toBe('w-test');
  });
});

describe('Phase 3a · saveLayoutSpec + loadLayoutSpec round-trip', () => {
  test('write → read preserves every field', async () => {
    const spec = makeSpec('scratch');
    const path = await saveLayoutSpec(spec, { dir });
    expect(path).toBe(resolve(dir, 'scratch.layout.json'));
    const back = await loadLayoutSpec('scratch', { dir });
    expect(back).toEqual(spec);
  });

  test('explicit slug option overrides the label-derived slug', async () => {
    const spec = makeSpec('alpha');
    const path = await saveLayoutSpec(spec, { dir, slug: 'my-custom' });
    expect(path).toBe(resolve(dir, 'my-custom.layout.json'));
  });

  test('save is atomic — no `.tmp.<pid>` file left behind', async () => {
    await saveLayoutSpec(makeSpec('atom'), { dir });
    const entries = await fsp.readdir(dir);
    const tmpLeft = entries.filter((e) => e.includes('.tmp.'));
    expect(tmpLeft).toHaveLength(0);
  });

  test('save then overwrite replaces prior body', async () => {
    const first = makeSpec('same');
    await saveLayoutSpec(first, { dir });
    const second: LayoutSpec = { ...first, createdAt: 9999 };
    await saveLayoutSpec(second, { dir });
    const back = await loadLayoutSpec('same', { dir });
    expect(back.createdAt).toBe(9999);
  });
});

describe('Phase 3a · listLayoutSpecs', () => {
  test('empty / missing directory yields empty result (no throw)', async () => {
    const missing = join(dir, 'nope');
    const { loaded, skipped } = await listLayoutSpecs({ dir: missing });
    expect(loaded).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('sorts loaded by createdAt desc', async () => {
    await saveLayoutSpec({ ...makeSpec('older'), createdAt: 100 }, { dir });
    await saveLayoutSpec({ ...makeSpec('newer'), createdAt: 200 }, { dir });
    const { loaded } = await listLayoutSpecs({ dir });
    expect(loaded.map(l => l.slug)).toEqual(['newer', 'older']);
  });

  test('malformed file is skipped with a reason', async () => {
    await saveLayoutSpec(makeSpec('good'), { dir });
    await fsp.writeFile(join(dir, 'broken.layout.json'), '{not valid', 'utf8');
    const { loaded, skipped } = await listLayoutSpecs({ dir });
    expect(loaded.map(l => l.slug)).toEqual(['good']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.slug).toBe('broken');
    expect(skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  test('non-layout files ignored entirely', async () => {
    await saveLayoutSpec(makeSpec('keep'), { dir });
    await fsp.writeFile(join(dir, 'readme.txt'), 'hi', 'utf8');
    const { loaded, skipped } = await listLayoutSpecs({ dir });
    expect(loaded.map(l => l.slug)).toEqual(['keep']);
    expect(skipped).toEqual([]);
  });
});

describe('Phase 3a · deleteLayoutSpec', () => {
  test('returns true for existing slug, false for missing', async () => {
    await saveLayoutSpec(makeSpec('dy'), { dir });
    expect(await deleteLayoutSpec('dy', { dir })).toBe(true);
    expect(await deleteLayoutSpec('dy', { dir })).toBe(false);
  });
});

describe('Phase 3a · preset save-load integration', () => {
  test('built-in presets can save → load without validation error', async () => {
    const preset = buildPreset('four-pane-kanban', {
      windowId: 'w:main',
      paneIds: ['p1', 'p2', 'p3', 'p4'],
      now: () => 1000,
    });
    await saveLayoutSpec(preset, { dir });
    const back = await loadLayoutSpec(specSlug(preset), { dir });
    expect(back).toEqual(preset);
  });
});

describe('Phase 3a · layoutsDir default vs override', () => {
  test('layoutsDir({dir}) honors override', () => {
    expect(layoutsDir({ dir: '/custom/layouts' })).toBe('/custom/layouts');
  });

  test('default path contains ~/.monad/layouts', () => {
    const def = layoutsDir();
    expect(def).toContain('.monad');
    expect(def).toContain('layouts');
  });
});

// ── Bundle B-5 (P6-4) · ArtifactStore path ──────────────────────

describe('Bundle B-5 · saveLayoutSpec artifactStore migration', () => {
  function makeFakeStore(): {
    put: (...args: unknown[]) => { path: string; metaPath: string; meta: Record<string, unknown> };
    puts: Array<{ kind: string; body: unknown; meta: Record<string, unknown> }>;
  } {
    const puts: Array<{ kind: string; body: unknown; meta: Record<string, unknown> }> = [];
    return {
      puts,
      put(kind, body, meta) {
        const m = meta as Record<string, unknown>;
        puts.push({ kind: String(kind), body, meta: m });
        const path = `/fake/artifacts/${kind}/20260420-000000-${String(m.origin ?? 'x')}.layout.json`;
        return { path, metaPath: `${path}.meta.json`, meta: { ...m, kind } };
      },
    };
  }

  test('artifactStore provided → store.put called with origin=slug · producer=vwt-3a', async () => {
    const store = makeFakeStore();
    const spec: LayoutSpec = {
      version: 1,
      windowId: 'w:t1',
      createdAt: 1_700_000_000_000,
      label: 'kanban',
      root: { kind: 'leaf', paneRef: { windowId: 'w:t1', paneId: 'p:a' } },
    };
    const savedPath = await saveLayoutSpec(spec, {
      artifactStore: store as unknown as import('../../../src/artifact/index.js').ArtifactStore,
    });
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]!.kind).toBe('layout');
    expect(store.puts[0]!.meta.origin).toBe('kanban');
    expect(store.puts[0]!.meta.producer).toBe('vwt-3a');
    expect(store.puts[0]!.meta.description).toBe('kanban');
    expect(savedPath.startsWith('/fake/artifacts/layout/')).toBe(true);
  });

  test('artifactStore absent → legacy fs.promises path (no regression)', async () => {
    const spec: LayoutSpec = {
      version: 1,
      windowId: 'w:t2',
      createdAt: 1_700_000_000_000,
      root: { kind: 'leaf', paneRef: { windowId: 'w:t2', paneId: 'p:a' } },
    };
    const savedPath = await saveLayoutSpec(spec, { dir });
    expect(savedPath.endsWith('.layout.json')).toBe(true);
    expect(savedPath).toContain(dir);
    const body = await fsp.readFile(savedPath, 'utf8');
    expect(body).toContain('"windowId": "w:t2"');  // pretty JSON
  });

  test('artifactStore + dir both → artifactStore wins · legacy fs untouched', async () => {
    const store = makeFakeStore();
    const spec: LayoutSpec = {
      version: 1,
      windowId: 'w:t3',
      createdAt: 1_700_000_000_000,
      label: 'split-4',
      root: { kind: 'leaf', paneRef: { windowId: 'w:t3', paneId: 'p:a' } },
    };
    const savedPath = await saveLayoutSpec(spec, {
      dir,
      artifactStore: store as unknown as import('../../../src/artifact/index.js').ArtifactStore,
    });
    expect(store.puts).toHaveLength(1);
    expect(savedPath.startsWith('/fake/artifacts/layout/')).toBe(true);
    // Legacy dir must remain empty (no side-effect write).
    const entries = await fsp.readdir(dir);
    expect(entries).toHaveLength(0);
  });
});
