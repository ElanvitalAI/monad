// H6 P4 · three-pane-split preset smoke.
//
// Verifies the preset lives in the LayoutSpec library so the
// agent-room path can map `three-split` → `three-pane-split` and
// reuse `applyLayoutPlan` infra without bespoke layout code.

import { describe, test, expect } from 'bun:test';
import {
  buildPreset,
  presetArity,
  LAYOUT_PRESET_NAMES,
} from '../src/virtual-windows/layout/presets.js';

describe('three-pane-split preset', () => {
  test('enrolled in LAYOUT_PRESET_NAMES · between two-pane-split and four-pane-kanban', () => {
    const idx = LAYOUT_PRESET_NAMES.indexOf('three-pane-split');
    expect(idx).toBeGreaterThan(-1);
    // Ordering is not load-bearing but we keep it sorted by arity so
    // the catalog reads naturally in docs/help.
    expect(idx).toBeGreaterThan(LAYOUT_PRESET_NAMES.indexOf('two-pane-split'));
    expect(idx).toBeLessThan(LAYOUT_PRESET_NAMES.indexOf('four-pane-kanban'));
  });

  test('presetArity("three-pane-split") === 3', () => {
    expect(presetArity('three-pane-split')).toBe(3);
  });

  test('buildPreset · col axis · three equal children', () => {
    const spec = buildPreset('three-pane-split', {
      windowId: 'w1',
      paneIds: ['p0', 'p1', 'p2'],
      now: () => 42,
    });
    expect(spec.createdAt).toBe(42);
    expect(spec.label).toBe('preset-three-pane-split');
    const root = spec.root as { kind: 'split'; axis: string; children: unknown[]; sizes: number[] };
    expect(root.kind).toBe('split');
    expect(root.axis).toBe('col');
    expect(root.children).toHaveLength(3);
    expect(root.sizes).toHaveLength(3);
  });

  test('buildPreset · sizes are 1/3 each · approximately sum to 1', () => {
    const spec = buildPreset('three-pane-split', {
      windowId: 'w1',
      paneIds: ['a', 'b', 'c'],
    });
    const root = spec.root as { sizes: number[] };
    expect(root.sizes[0]).toBeCloseTo(1 / 3, 6);
    expect(root.sizes[1]).toBeCloseTo(1 / 3, 6);
    expect(root.sizes[2]).toBeCloseTo(1 / 3, 6);
    const sum = root.sizes.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  test('buildPreset · arity mismatch throws with preset name', () => {
    expect(() =>
      buildPreset('three-pane-split', {
        windowId: 'w1',
        paneIds: ['only-one'],
      }),
    ).toThrow(/three-pane-split/);
  });
});
