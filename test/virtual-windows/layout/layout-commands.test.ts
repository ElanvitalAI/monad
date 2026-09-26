// ── VW Phase 3a wiring — layout-commands integration tests ──
//
// Uses a mock WindowRegistry that satisfies only the `.get()` path
// the commands module consumes. Exercises the SAVE path end-to-end
// against a tmp dir (atomic write + round-trip load) and the PLAN
// paths against a synthetic binary tree.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LayoutNode } from '../../../src/virtual-windows/layout-tree.js';
import {
  listAvailableLayouts,
  planApplyPreset,
  planLoadLayout,
  saveWindowLayout,
} from '../../../src/virtual-windows/layout/layout-commands.js';
import { loadLayoutSpec } from '../../../src/virtual-windows/layout/index.js';

type MockWindow = { getLayoutTree: () => LayoutNode };
type MockRegistry = { get: (id: number) => MockWindow | null };

function makeRegistry(id: number, tree: LayoutNode): MockRegistry {
  return {
    get: (i) => (i === id ? { getLayoutTree: () => tree } : null),
  };
}

const leaf = (paneId: string): LayoutNode => ({ kind: 'leaf', paneId });
const split = (axis: 'h' | 'v', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode =>
  ({ kind: 'split', axis, a, b, ratio });

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'elanous-layout-cmd-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('saveWindowLayout', () => {
  test('writes spec file and returns savedPath + spec', async () => {
    const tree = split('h', leaf('a'), leaf('b'), 0.4);
    const registry = makeRegistry(7, tree) as never;
    const { savedPath, spec } = await saveWindowLayout(
      { registry, dir },
      { windowId: 7 as never, label: 'work' },
    );
    expect(savedPath).toContain('work.layout.json');
    expect(spec.label).toBe('work');
    expect(spec.windowId).toBe('7');
    const back = await loadLayoutSpec('work', { dir });
    expect(back).toEqual(spec);
  });

  test('missing window throws with guidance', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    await expect(saveWindowLayout(
      { registry, dir },
      { windowId: 99 as never },
    )).rejects.toThrow(/window 99 not found/);
  });

  test('uses windowId-derived slug when no label', async () => {
    const registry = makeRegistry(3, leaf('solo')) as never;
    const { savedPath } = await saveWindowLayout(
      { registry, dir },
      { windowId: 3 as never },
    );
    expect(savedPath).toContain('3.layout.json');
  });
});

describe('listAvailableLayouts', () => {
  test('lists saved layouts + built-in presets', async () => {
    const registry = makeRegistry(1, leaf('only')) as never;
    await saveWindowLayout({ registry, dir }, { windowId: 1 as never, label: 'first' });
    const catalog = await listAvailableLayouts({ dir });
    expect(catalog.saved.length).toBe(1);
    expect(catalog.saved[0]!.slug).toBe('first');
    expect(catalog.presets).toEqual(['one-pane', 'two-pane-split', 'three-pane-split', 'four-pane-kanban']);
  });

  test('empty dir lists 0 saved', async () => {
    const catalog = await listAvailableLayouts({ dir });
    expect(catalog.saved).toEqual([]);
  });
});

describe('planLoadLayout', () => {
  test('plans restore against current pane ids', async () => {
    const tree = split('h', leaf('a'), leaf('b'));
    const registry = makeRegistry(5, tree) as never;
    await saveWindowLayout({ registry, dir }, { windowId: 5 as never, label: 'both' });

    const { spec, plan } = await planLoadLayout(
      { registry, dir },
      { slug: 'both', windowId: 5 as never },
    );
    expect(spec.label).toBe('both');
    expect(plan.missing).toEqual([]);
    expect(plan.binaryRoot).not.toBeNull();
  });

  test('plan detects missing panes', async () => {
    // Save with pane ids a + b present.
    let treeRef: LayoutNode = split('h', leaf('a'), leaf('b'));
    const registry: MockRegistry = {
      get: () => ({ getLayoutTree: () => treeRef }),
    };
    await saveWindowLayout({ registry: registry as never, dir }, { windowId: 9 as never, label: 'twin' });
    // Now the "live" window only has 'a'.
    treeRef = leaf('a');
    const { plan } = await planLoadLayout(
      { registry: registry as never, dir },
      { slug: 'twin', windowId: 9 as never },
    );
    expect(plan.missing.length).toBe(1);
    expect(plan.missing[0]!.paneId).toBe('b');
  });

  test('keepMissingAsPlaceholder retains the leaf in binaryRoot', async () => {
    let treeRef: LayoutNode = split('h', leaf('a'), leaf('b'));
    const registry: MockRegistry = {
      get: () => ({ getLayoutTree: () => treeRef }),
    };
    await saveWindowLayout({ registry: registry as never, dir }, { windowId: 9 as never, label: 'twin2' });
    treeRef = leaf('a');
    const { plan } = await planLoadLayout(
      { registry: registry as never, dir },
      { slug: 'twin2', windowId: 9 as never, keepMissingAsPlaceholder: true },
    );
    // Root is still a split in placeholder mode.
    expect(plan.binaryRoot?.kind).toBe('split');
  });
});

describe('planApplyPreset', () => {
  test('builds preset + plans restore', () => {
    const registry = makeRegistry(7, split('h', leaf('x'), leaf('y'))) as never;
    const { spec, plan } = planApplyPreset(
      { registry },
      {
        preset: 'two-pane-split',
        windowId: 7 as never,
        paneIds: ['x', 'y'],
      },
    );
    expect(spec.label).toBe('preset-two-pane-split');
    // Both pane ids present → no missing.
    expect(plan.missing).toEqual([]);
    expect(plan.binaryRoot).not.toBeNull();
  });

  test('preset pane ids missing from window → reported', () => {
    const registry = makeRegistry(7, leaf('only')) as never;
    const { plan } = planApplyPreset(
      { registry },
      {
        preset: 'two-pane-split',
        windowId: 7 as never,
        paneIds: ['newA', 'newB'],
      },
    );
    // Neither newA nor newB are in the current window's tree.
    expect(plan.missing.length).toBe(2);
  });
});

// ── Bundle B-6 · P6-5 — LoadLayout path resolution ──────────────

describe('planLoadLayout · path resolution (Bundle B-6)', () => {
  test('opts.path → reads from absolute path · skips slug', async () => {
    // First save a layout via legacy path, then load by absolute path.
    const tree = split('h', leaf('x'), leaf('y'));
    const registry = makeRegistry(5, tree) as never;
    const { savedPath } = await saveWindowLayout(
      { registry, dir },
      { windowId: 5 as never, label: 'by-path' },
    );
    const { spec } = await planLoadLayout(
      { registry, dir },
      { path: savedPath, windowId: 5 as never },
    );
    expect(spec.label).toBe('by-path');
  });

  test('neither slug nor path → throws', async () => {
    const registry = makeRegistry(5, leaf('a')) as never;
    await expect(
      planLoadLayout({ registry, dir }, { windowId: 5 as never }),
    ).rejects.toThrow(/either slug or path is required/);
  });

  test('artifactStore + slug → resolveLayoutArtifactPath wins when origin matches', async () => {
    // Stub ArtifactStore returning a known layout path · planLoadLayout
    // should pick that path over the legacy <dir>/<slug>.layout.json.
    const tree = leaf('p-only');
    const registry = makeRegistry(11, tree) as never;

    // Save to a custom tmp artifact path so we can read it back.
    const fakeArtifactPath = join(dir, 'artifact-20260420-120000-picked.layout.json');
    await (await import('node:fs/promises')).writeFile(
      fakeArtifactPath,
      JSON.stringify({
        version: 1,
        windowId: 'w:picked',
        createdAt: 9_999_999_999_999,
        label: 'picked-by-store',
        root: { kind: 'leaf', paneRef: { windowId: 'w:picked', paneId: 'p-only' } },
      }, null, 2),
      'utf8',
    );

    // Minimal fake store — list returns the crafted artifact.
    const fakeStore = {
      list(kind?: string) {
        if (kind !== 'layout' && kind !== undefined) return [];
        return [{
          path: fakeArtifactPath,
          meta: {
            kind: 'layout' as const,
            origin: 'picked',
            createdAt: 9_999_999_999_999,
            producer: 'vwt-3a',
          },
        }];
      },
      put: () => { throw new Error('not used'); },
      get: () => { throw new Error('not used'); },
      subscribe: () => () => {},
      _resetForTest: () => {},
    };

    const { spec } = await planLoadLayout(
      { registry, dir, artifactStore: fakeStore as never },
      { slug: 'picked', windowId: 11 as never },
    );
    expect(spec.label).toBe('picked-by-store');
  });

  test('artifactStore + slug with NO origin match → falls back to legacy path', async () => {
    const tree = leaf('fallback-p');
    const registry = makeRegistry(12, tree) as never;
    await saveWindowLayout(
      { registry, dir },
      { windowId: 12 as never, label: 'fallback' },
    );
    const emptyStore = {
      list: () => [],
      put: () => { throw new Error('not used'); },
      get: () => { throw new Error('not used'); },
      subscribe: () => () => {},
      _resetForTest: () => {},
    };
    const { spec } = await planLoadLayout(
      { registry, dir, artifactStore: emptyStore as never },
      { slug: 'fallback', windowId: 12 as never },
    );
    expect(spec.label).toBe('fallback');
  });

  test('opts.path wins even when slug would resolve via artifactStore', async () => {
    const tree = leaf('anyp');
    const registry = makeRegistry(13, tree) as never;
    const legacyPath = (await saveWindowLayout(
      { registry, dir },
      { windowId: 13 as never, label: 'via-path' },
    )).savedPath;

    const distractingStore = {
      list: () => [{
        path: '/wrong/distract.layout.json',
        meta: {
          kind: 'layout' as const,
          origin: 'via-path',
          createdAt: 1,
          producer: 'vwt-3a',
        },
      }],
      put: () => { throw new Error('not used'); },
      get: () => { throw new Error('not used'); },
      subscribe: () => () => {},
      _resetForTest: () => {},
    };

    const { spec } = await planLoadLayout(
      { registry, dir, artifactStore: distractingStore as never },
      { slug: 'via-path', path: legacyPath, windowId: 13 as never },
    );
    expect(spec.label).toBe('via-path');
  });
});
