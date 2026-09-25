// ── B-13-α — Layout tool addr-first migration tests ──
//
// Verifies that SaveLayout / LoadLayout / ApplyLayoutPreset accept
// both legacy `windowId: integer` and new `target: {kind:'window',
// windowId}` argument styles · legacy wins when both are supplied ·
// explicit error when both are missing.
//
// These are dispatcher-level tests — the underlying layout commands
// are covered by test/virtual-windows/layout/layout-commands.test.ts.
// Here we only verify argument resolution.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSaveLayoutTool,
  buildLoadLayoutTool,
  buildApplyLayoutPresetTool,
  dispatchSaveLayout,
  dispatchLoadLayout,
  dispatchApplyLayoutPreset,
} from '../src/virtual-windows/layout/layout-tools.js';
import type { LayoutNode } from '../src/virtual-windows/layout-tree.js';

type MockWindow = { getLayoutTree: () => LayoutNode };
type MockRegistry = { get: (id: number) => MockWindow | null };

function makeRegistry(id: number, tree: LayoutNode): MockRegistry {
  return {
    get: (i) => (i === id ? { getLayoutTree: () => tree } : null),
  };
}

const leaf = (paneId: string): LayoutNode => ({ kind: 'leaf', paneId });

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'monad-b13-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('B-13-α · Layout tools addr-first', () => {
  test('SaveLayout spec exposes target + legacy windowId · no schema-level required', () => {
    const spec = buildSaveLayoutTool();
    const props = (spec.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.target).toBeDefined();
    expect(props.windowId).toBeDefined();
    expect((spec.parameters as Record<string, unknown>).required).toBeUndefined();
  });

  test('SaveLayout · legacy windowId: integer path works', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    const r = await dispatchSaveLayout({ registry, dir }, { windowId: 7, label: 'legacy' });
    expect(r.ok).toBe(true);
    expect(r.windowId).toBe(7);
  });

  test('SaveLayout · target: {kind:"window", windowId} path works', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    const r = await dispatchSaveLayout(
      { registry, dir },
      { target: { kind: 'window', windowId: 7 }, label: 'structured' },
    );
    expect(r.ok).toBe(true);
    expect(r.windowId).toBe(7);
  });

  test('SaveLayout · both supplied → legacy windowId wins (explicit intent)', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    const r = await dispatchSaveLayout(
      { registry, dir },
      {
        target: { kind: 'window', windowId: 999 }, // ghost
        windowId: 7,
        label: 'both',
      },
    );
    expect(r.windowId).toBe(7);
  });

  test('SaveLayout · neither supplied → explicit error', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    await expect(
      dispatchSaveLayout({ registry, dir }, { label: 'no-addr' }),
    ).rejects.toThrow(/provide 'target'.*or 'windowId'/);
  });

  test('LoadLayout spec exposes target + legacy windowId', () => {
    const spec = buildLoadLayoutTool();
    const props = (spec.parameters as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.target).toBeDefined();
    expect(props.windowId).toBeDefined();
  });

  test('LoadLayout · list mode (no slug/path) does NOT require addr', async () => {
    const registry = makeRegistry(1, leaf('x')) as never;
    // No slug / path / target / windowId → returns catalog · no throw.
    const r = await dispatchLoadLayout({ registry, dir }, {});
    expect(r.saved).toBeDefined();
    expect(Array.isArray(r.saved)).toBe(true);
  });

  test('LoadLayout · plan mode · target path + legacy parity · need either for slug', async () => {
    const registry = makeRegistry(7, leaf('a')) as never;
    // Save first so load-by-slug has a target.
    await dispatchSaveLayout({ registry, dir }, { windowId: 7, label: 'parity' });
    const viaLegacy = await dispatchLoadLayout({ registry, dir }, { slug: 'parity', windowId: 7 });
    const viaTarget = await dispatchLoadLayout(
      { registry, dir },
      { slug: 'parity', target: { kind: 'window', windowId: 7 } },
    );
    expect(viaLegacy.ok).toBe(true);
    expect(viaTarget.ok).toBe(true);
  });

  test('ApplyLayoutPreset · legacy windowId path works', () => {
    const registry = makeRegistry(9, leaf('m')) as never;
    const r = dispatchApplyLayoutPreset(
      { registry },
      { preset: 'one-pane', windowId: 9, paneIds: ['p1'] },
    );
    expect(r.ok).toBe(true);
  });

  test('ApplyLayoutPreset · target path works', () => {
    const registry = makeRegistry(9, leaf('m')) as never;
    const r = dispatchApplyLayoutPreset(
      { registry },
      { preset: 'one-pane', target: { kind: 'window', windowId: 9 }, paneIds: ['p1'] },
    );
    expect(r.ok).toBe(true);
  });

  test('ApplyLayoutPreset · neither addr → explicit error', () => {
    const registry = makeRegistry(9, leaf('m')) as never;
    expect(() =>
      dispatchApplyLayoutPreset(
        { registry },
        { preset: 'one-pane', paneIds: ['p1'] },
      ),
    ).toThrow(/provide 'target'.*or 'windowId'/);
  });
});
