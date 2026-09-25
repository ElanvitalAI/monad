// ── VW-term-infra Phase 3a — Built-in preset tests ──
//
// Verify each preset emits a validator-clean LayoutSpec with the
// expected arity, deterministic `preset-<name>` label, and correct
// root shape. Arity violations throw before touching shape.

import { describe, expect, test } from 'bun:test';

import {
  LAYOUT_PRESET_NAMES,
  buildPreset,
  fromJson,
  presetArity,
  toJson,
} from '../../../src/virtual-windows/layout/index.js';

describe('Phase 3a · preset arity + validation', () => {
  for (const name of LAYOUT_PRESET_NAMES) {
    test(`${name} builds with expected arity`, () => {
      const arity = presetArity(name);
      const paneIds = Array.from({ length: arity }, (_, i) => `p-${i + 1}`);
      const spec = buildPreset(name, {
        windowId: 'w:test',
        paneIds,
        now: () => 42,
      });
      expect(spec.createdAt).toBe(42);
      expect(spec.label).toBe(`preset-${name}`);
      expect(spec.windowId).toBe('w:test');
      // Round-trip through the validator to confirm structural validity.
      const back = fromJson(toJson(spec));
      expect(back).toEqual(spec);
    });
  }

  test('arity mismatch throws', () => {
    expect(() =>
      buildPreset('two-pane-split', { windowId: 'w', paneIds: ['only'] }),
    ).toThrow(/expected 2 pane ids, got 1/);
  });
});

describe('Phase 3a · preset root shape', () => {
  test('one-pane emits a single leaf', () => {
    const spec = buildPreset('one-pane', { windowId: 'w', paneIds: ['solo'] });
    expect(spec.root.kind).toBe('leaf');
    if (spec.root.kind === 'leaf') {
      expect(spec.root.paneRef.paneId).toBe('solo');
    }
  });

  test('two-pane-split emits a col split with equal sizes', () => {
    const spec = buildPreset('two-pane-split', {
      windowId: 'w', paneIds: ['a', 'b'],
    });
    expect(spec.root.kind).toBe('split');
    if (spec.root.kind === 'split') {
      expect(spec.root.axis).toBe('col');
      expect(spec.root.children.length).toBe(2);
      expect(spec.root.sizes).toEqual([0.5, 0.5]);
    }
  });

  test('four-pane-kanban emits four leaves summing to 1', () => {
    const spec = buildPreset('four-pane-kanban', {
      windowId: 'w', paneIds: ['todo', 'doing', 'review', 'done'],
    });
    if (spec.root.kind === 'split') {
      expect(spec.root.children.length).toBe(4);
      const sum = spec.root.sizes.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});
