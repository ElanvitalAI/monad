// ── Presentation P2 · Border / BorderRadius ──

import { describe, test, expect } from 'bun:test';
import { BorderRadius, BorderSpec } from '../../../src/ui/attributes/border.js';

describe('BorderRadius · factories', () => {
  test('circular(n) sets every corner to n', () => {
    const r = BorderRadius.circular(2);
    expect(r.topLeft).toBe(2);
    expect(r.topRight).toBe(2);
    expect(r.bottomLeft).toBe(2);
    expect(r.bottomRight).toBe(2);
  });

  test('only({...}) per-corner · omitted → 0', () => {
    const r = BorderRadius.only({ topLeft: 3, bottomRight: 1 });
    expect(r.topLeft).toBe(3);
    expect(r.topRight).toBe(0);
    expect(r.bottomLeft).toBe(0);
    expect(r.bottomRight).toBe(1);
  });

  test('zero singleton · all corners 0', () => {
    expect(BorderRadius.zero.topLeft).toBe(0);
  });

  test('copyWith partial update', () => {
    const r = BorderRadius.circular(2);
    const r2 = r.copyWith({ topLeft: 4 });
    expect(r2.topLeft).toBe(4);
    expect(r2.topRight).toBe(2);
    expect(r).not.toBe(r2);
  });

  test('JSON round-trip', () => {
    const r = BorderRadius.only({ topLeft: 1, topRight: 2, bottomLeft: 3, bottomRight: 4 });
    expect(BorderRadius.fromJSON(r.toJSON()).toJSON()).toEqual(r.toJSON());
  });

  test('schema() structure', () => {
    const s = BorderRadius.schema();
    expect(s.type).toBe('object');
    expect((s.properties as Record<string, unknown>).topLeft).toBeDefined();
  });
});

describe('BorderSpec · factories', () => {
  test('all(side) applies to every side', () => {
    const b = BorderSpec.all({ color: 'border.focused', width: 2 });
    expect(b.top?.color).toBe('border.focused');
    expect(b.right?.width).toBe(2);
    expect(b.bottom?.style).toBe('solid'); // default style
    expect(b.left?.style).toBe('solid');
  });

  test('symmetric({horizontal, vertical})', () => {
    const b = BorderSpec.symmetric({
      horizontal: { color: 'accent', width: 1 },
      vertical: { color: 'border', width: 2 },
    });
    expect(b.left?.color).toBe('accent');
    expect(b.right?.color).toBe('accent');
    expect(b.top?.color).toBe('border');
    expect(b.bottom?.color).toBe('border');
    expect(b.top?.width).toBe(2);
  });

  test('only({...}) non-specified sides → null', () => {
    const b = BorderSpec.only({ top: { color: 'x', width: 1 } });
    expect(b.top?.color).toBe('x');
    expect(b.right).toBeNull();
    expect(b.bottom).toBeNull();
    expect(b.left).toBeNull();
  });

  test('copyWith replaces specified sides, keeps omitted', () => {
    const b = BorderSpec.all({ color: 'a', width: 1 });
    const b2 = b.copyWith({ top: { width: 3 } });
    expect(b2.top?.color).toBe('a');   // preserved from parent
    expect(b2.top?.width).toBe(3);     // overridden
    expect(b2.left?.color).toBe('a');  // untouched
  });

  test('copyWith with explicit null clears a side', () => {
    const b = BorderSpec.all({ color: 'a', width: 1 });
    const b2 = b.copyWith({ bottom: null });
    expect(b2.bottom).toBeNull();
    expect(b2.top).not.toBeNull();
  });

  test('JSON round-trip', () => {
    const b = BorderSpec.all({ color: 'border', width: 2, style: 'dashed' });
    const r = BorderSpec.fromJSON(b.toJSON());
    expect(r.top?.color).toBe('border');
    expect(r.top?.style).toBe('dashed');
  });
});
