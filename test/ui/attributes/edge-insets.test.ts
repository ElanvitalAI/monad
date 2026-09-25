// ── Presentation P2 · EdgeInsets ──

import { describe, test, expect } from 'bun:test';
import { EdgeInsets } from '../../../src/ui/attributes/edge-insets.js';

describe('EdgeInsets · factories', () => {
  test('all(n) sets every side to n', () => {
    const p = EdgeInsets.all(3);
    expect(p.top).toBe(3);
    expect(p.right).toBe(3);
    expect(p.bottom).toBe(3);
    expect(p.left).toBe(3);
  });

  test('symmetric applies horizontal + vertical · omitted → 0', () => {
    const p = EdgeInsets.symmetric({ horizontal: 2, vertical: 1 });
    expect(p.left).toBe(2);
    expect(p.right).toBe(2);
    expect(p.top).toBe(1);
    expect(p.bottom).toBe(1);
  });

  test('only({...}) preserves specified sides · others → 0', () => {
    const p = EdgeInsets.only({ top: 4, left: 1 });
    expect(p.top).toBe(4);
    expect(p.left).toBe(1);
    expect(p.right).toBe(0);
    expect(p.bottom).toBe(0);
  });

  test('zero singleton · all sides 0', () => {
    expect(EdgeInsets.zero.top).toBe(0);
    expect(EdgeInsets.zero.horizontal).toBe(0);
    expect(EdgeInsets.zero.vertical).toBe(0);
  });

  test('negative or fractional inputs are normalized', () => {
    const p = EdgeInsets.only({ top: -5, right: 2.7, bottom: 0, left: NaN });
    expect(p.top).toBe(0);
    expect(p.right).toBe(3);
    expect(p.bottom).toBe(0);
    expect(p.left).toBe(0);
  });
});

describe('EdgeInsets · copyWith immutability', () => {
  test('copyWith returns a new instance', () => {
    const a = EdgeInsets.all(2);
    const b = a.copyWith({ top: 5 });
    expect(b).not.toBe(a);
    expect(b.top).toBe(5);
    expect(a.top).toBe(2);
  });

  test('copyWith preserves omitted sides', () => {
    const a = EdgeInsets.only({ top: 1, right: 2, bottom: 3, left: 4 });
    const b = a.copyWith({ left: 9 });
    expect(b.top).toBe(1);
    expect(b.right).toBe(2);
    expect(b.bottom).toBe(3);
    expect(b.left).toBe(9);
  });
});

describe('EdgeInsets · JSON + schema', () => {
  test('toJSON returns plain object with all 4 sides', () => {
    const p = EdgeInsets.only({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(p.toJSON()).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  test('fromJSON round-trip', () => {
    const p = EdgeInsets.symmetric({ horizontal: 2, vertical: 4 });
    const restored = EdgeInsets.fromJSON(p.toJSON());
    expect(restored.toJSON()).toEqual(p.toJSON());
  });

  test('fromJSON with null returns zero', () => {
    const r = EdgeInsets.fromJSON(null);
    expect(r.toJSON()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test('schema() returns JSONSchema-shaped object', () => {
    const s = EdgeInsets.schema();
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect((s.properties as Record<string, unknown>).top).toBeDefined();
  });
});
