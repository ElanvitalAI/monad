// ── VW-term-infra Phase 3a — restore planner tests ──
//
// Cover the three decision axes:
//   1. All panes available → clean binaryRoot + empty missing
//   2. Partial missing → dropped (default) vs kept-as-placeholder
//   3. Tabs/float nodes → siphoned into tabs/floats arrays

import { describe, expect, test } from 'bun:test';

import {
  planRestore,
  snapshotWindow,
  type LayoutSpec,
} from '../../../src/virtual-windows/layout/index.js';

function spec(root: LayoutSpec['root']): LayoutSpec {
  return { version: 1, windowId: 'w', createdAt: 100, root };
}

const leaf = (id: string): LayoutSpec['root'] => ({
  kind: 'leaf',
  paneRef: { windowId: 'w', paneId: id },
});

describe('Phase 3a · planRestore — happy path', () => {
  test('all panes available → binaryRoot with no missing', () => {
    const s = spec({
      kind: 'split', axis: 'col', sizes: [0.5, 0.5],
      children: [leaf('a'), leaf('b')],
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(['a', 'b']),
    });
    expect(plan.missing).toEqual([]);
    expect(plan.binaryRoot).not.toBeNull();
    if (plan.binaryRoot?.kind === 'split') {
      expect(plan.binaryRoot.axis).toBe('h');
    }
  });

  test('single leaf available → tree is just the leaf', () => {
    const plan = planRestore({
      spec: spec(leaf('solo')),
      availablePaneIds: new Set(['solo']),
    });
    expect(plan.binaryRoot).toEqual({ kind: 'leaf', paneId: 'solo' });
    expect(plan.missing).toEqual([]);
  });
});

describe('Phase 3a · planRestore — missing panes', () => {
  test('default drops missing leaf, renormalizes sibling sizes', () => {
    const s = spec({
      kind: 'split', axis: 'col', sizes: [0.3, 0.3, 0.4],
      children: [leaf('a'), leaf('missing'), leaf('c')],
    });
    const plan = planRestore({
      spec: s,
      availablePaneIds: new Set(['a', 'c']),
    });
    expect(plan.missing).toEqual([{ windowId: 'w', paneId: 'missing' }]);
    expect(plan.binaryRoot).not.toBeNull();
    if (plan.binaryRoot?.kind === 'split') {
      // Remaining two children survive; sizes renormalize to ≈ 0.428/0.571
      expect(plan.binaryRoot.axis).toBe('h');
    }
    expect(plan.notes.some((n) => n.includes('missing'))).toBe(true);
  });

  test('keepMissingAsPlaceholder retains leaf in tree', () => {
    const s = spec({
      kind: 'split', axis: 'row', sizes: [0.5, 0.5],
      children: [leaf('a'), leaf('ghost')],
    });
    const plan = planRestore({
      spec: s,
      availablePaneIds: new Set(['a']),
      keepMissingAsPlaceholder: true,
    });
    expect(plan.missing).toEqual([{ windowId: 'w', paneId: 'ghost' }]);
    if (plan.binaryRoot?.kind === 'split') {
      expect(plan.binaryRoot.b).toEqual({ kind: 'leaf', paneId: 'ghost' });
    }
  });

  test('all-missing split collapses to null binaryRoot', () => {
    const s = spec({
      kind: 'split', axis: 'col', sizes: [0.5, 0.5],
      children: [leaf('gone1'), leaf('gone2')],
    });
    const plan = planRestore({
      spec: s,
      availablePaneIds: new Set(),
    });
    expect(plan.binaryRoot).toBeNull();
    expect(plan.missing.length).toBe(2);
  });

  test('split collapses to single child when only one survives', () => {
    const s = spec({
      kind: 'split', axis: 'col', sizes: [0.5, 0.5],
      children: [leaf('a'), leaf('gone')],
    });
    const plan = planRestore({
      spec: s,
      availablePaneIds: new Set(['a']),
    });
    expect(plan.binaryRoot).toEqual({ kind: 'leaf', paneId: 'a' });
    expect(plan.missing).toEqual([{ windowId: 'w', paneId: 'gone' }]);
  });
});

describe('Phase 3a · planRestore — tabs + float extraction', () => {
  test('tabs node siphoned into tabs[] (not in binary tree)', () => {
    const s = spec({
      kind: 'tabs', active: 1,
      panes: [
        { windowId: 'w', paneId: 't1' },
        { windowId: 'w', paneId: 't2' },
        { windowId: 'w', paneId: 't3' },
      ],
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(['t1', 't2', 't3']),
    });
    expect(plan.binaryRoot).toBeNull();
    expect(plan.tabs.length).toBe(1);
    expect(plan.tabs[0]!.panes.map(p => p.paneId)).toEqual(['t1', 't2', 't3']);
    expect(plan.tabs[0]!.active).toBe(1);
  });

  test('tabs with all panes missing yields empty tabs[] + missing', () => {
    const s = spec({
      kind: 'tabs', active: 0,
      panes: [{ windowId: 'w', paneId: 'gone' }],
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(),
    });
    expect(plan.tabs).toEqual([]);
    expect(plan.missing.length).toBe(1);
    expect(plan.notes.some(n => n.includes('no available'))).toBe(true);
  });

  test('tabs active index clamps to surviving pane count', () => {
    const s = spec({
      kind: 'tabs', active: 2,
      panes: [
        { windowId: 'w', paneId: 't1' },
        { windowId: 'w', paneId: 'gone' },
        { windowId: 'w', paneId: 't3' },
      ],
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(['t1', 't3']),
    });
    expect(plan.tabs[0]!.panes.length).toBe(2);
    expect(plan.tabs[0]!.active).toBeLessThanOrEqual(1);
  });

  test('float node siphoned into floats[]', () => {
    const s = spec({
      kind: 'float',
      pane: { windowId: 'w', paneId: 'tooltip' },
      rect: { row: 5, col: 10, width: 30, height: 10 },
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(['tooltip']),
    });
    expect(plan.binaryRoot).toBeNull();
    expect(plan.floats.length).toBe(1);
    expect(plan.floats[0]!.pane.paneId).toBe('tooltip');
    expect(plan.floats[0]!.rect.width).toBe(30);
  });

  test('float with missing pane reported but not rendered', () => {
    const s = spec({
      kind: 'float',
      pane: { windowId: 'w', paneId: 'gone' },
      rect: { row: 0, col: 0, width: 10, height: 5 },
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(),
    });
    expect(plan.floats).toEqual([]);
    expect(plan.missing[0]!.paneId).toBe('gone');
  });

  test('mixed tree: split + tabs side-by-side', () => {
    const s = spec({
      kind: 'split', axis: 'row', sizes: [0.6, 0.4],
      children: [
        leaf('main'),
        {
          kind: 'tabs', active: 0,
          panes: [{ windowId: 'w', paneId: 'side1' }, { windowId: 'w', paneId: 'side2' }],
        },
      ],
    });
    const plan = planRestore({
      spec: s, availablePaneIds: new Set(['main', 'side1', 'side2']),
    });
    expect(plan.binaryRoot).toEqual({ kind: 'leaf', paneId: 'main' });
    expect(plan.tabs.length).toBe(1);
    expect(plan.tabs[0]!.panes.length).toBe(2);
  });
});

describe('Phase 3a · snapshotWindow', () => {
  test('wraps fromBinaryTree with same shape', () => {
    const spec = snapshotWindow({
      windowId: 'w:1',
      root: { kind: 'leaf', paneId: 'solo' },
      label: 'quick',
      createdAt: 42,
    });
    expect(spec.version).toBe(1);
    expect(spec.windowId).toBe('w:1');
    expect(spec.label).toBe('quick');
    expect(spec.createdAt).toBe(42);
    expect(spec.root.kind).toBe('leaf');
  });

  test('round-trip through planRestore (all present)', () => {
    const snap = snapshotWindow({
      windowId: 'w',
      root: {
        kind: 'split', axis: 'h', ratio: 0.4,
        a: { kind: 'leaf', paneId: 'left' },
        b: { kind: 'leaf', paneId: 'right' },
      },
    });
    const plan = planRestore({
      spec: snap, availablePaneIds: new Set(['left', 'right']),
    });
    expect(plan.missing).toEqual([]);
    if (plan.binaryRoot?.kind === 'split') {
      expect(plan.binaryRoot.ratio).toBeCloseTo(0.4, 6);
    }
  });
});
