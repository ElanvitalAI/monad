// ── Presentation P2 · BoxShadow ──

import { describe, test, expect } from 'bun:test';
import { BoxShadow } from '../../../src/ui/attributes/box-shadow.js';

describe('BoxShadow · construction', () => {
  test('default opts · offset 0,0 · color null · opacity 1 · blurRadius 0', () => {
    const s = new BoxShadow();
    expect(s.offset).toEqual({ dx: 0, dy: 0 });
    expect(s.color).toBeNull();
    expect(s.opacity).toBe(1);
    expect(s.blurRadius).toBe(0);
  });

  test('opacity clamps into [0, 1]', () => {
    expect(new BoxShadow({ opacity: -0.5 }).opacity).toBe(0);
    expect(new BoxShadow({ opacity: 2 }).opacity).toBe(1);
    expect(new BoxShadow({ opacity: 0.42 }).opacity).toBeCloseTo(0.42);
  });

  test('offset rounds fractional input', () => {
    const s = new BoxShadow({ offset: { dx: 1.6, dy: -2.3 } });
    expect(s.offset.dx).toBe(2);
    expect(s.offset.dy).toBe(-2);
  });

  test('blurRadius clamps negative to 0', () => {
    expect(new BoxShadow({ blurRadius: -5 }).blurRadius).toBe(0);
  });
});

describe('BoxShadow · derivation', () => {
  test('copyWith returns new instance with overrides', () => {
    const s = new BoxShadow({ offset: { dx: 1, dy: 1 }, color: 'shadow', opacity: 0.6 });
    const s2 = s.copyWith({ opacity: 0.3 });
    expect(s2.opacity).toBeCloseTo(0.3);
    expect(s2.color).toBe('shadow');
    expect(s2.offset).toEqual(s.offset);
    expect(s).not.toBe(s2);
  });

  test('copyWith with color null clears color', () => {
    const s = new BoxShadow({ color: 'x' });
    const s2 = s.copyWith({ color: null });
    expect(s2.color).toBeNull();
  });

  test('JSON round-trip preserves all fields', () => {
    const s = new BoxShadow({
      offset: { dx: 2, dy: -1 },
      color: 'shadow.soft',
      opacity: 0.75,
      blurRadius: 3,
    });
    const r = BoxShadow.fromJSON(s.toJSON());
    expect(r.offset).toEqual(s.offset);
    expect(r.color).toBe(s.color);
    expect(r.opacity).toBe(s.opacity);
    expect(r.blurRadius).toBe(s.blurRadius);
  });

  test('schema() structure is object with nested offset', () => {
    const s = BoxShadow.schema();
    expect(s.type).toBe('object');
    const props = s.properties as Record<string, { type?: unknown }>;
    expect(props.offset?.type).toBe('object');
  });
});
