// ── Presentation P2 · BoxDecoration ──

import { describe, test, expect } from 'bun:test';
import {
  BoxDecoration,
  EdgeInsets,
  BorderSpec,
  BorderRadius,
  BoxShadow,
} from '../../../src/ui/attributes/index.js';

describe('BoxDecoration · construction', () => {
  test('default · color null · border null · shape rectangle', () => {
    const d = new BoxDecoration();
    expect(d.color).toBeNull();
    expect(d.border).toBeNull();
    expect(d.borderRadius).toBeNull();
    expect(d.boxShadow).toBeNull();
    expect(d.padding).toBeNull();
    expect(d.shape).toBe('rectangle');
  });

  test('simple API · color only · rest sensible defaults', () => {
    const d = new BoxDecoration({ color: 'accent.primary' });
    expect(d.color).toBe('accent.primary');
    expect(d.shape).toBe('rectangle');
    expect(d.border).toBeNull();
  });

  test('composed · border + radius + padding + shadow', () => {
    const d = new BoxDecoration({
      color: 'surface',
      border: BorderSpec.all({ color: 'border.focused', width: 1 }),
      borderRadius: BorderRadius.circular(2),
      padding: EdgeInsets.symmetric({ horizontal: 2, vertical: 1 }),
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 }, color: 'shadow' })],
    });
    expect(d.color).toBe('surface');
    expect(d.border?.top?.color).toBe('border.focused');
    expect(d.borderRadius?.topLeft).toBe(2);
    expect(d.padding?.horizontal).toBe(4);
    expect(d.boxShadow).toHaveLength(1);
    expect(d.boxShadow?.[0]?.color).toBe('shadow');
  });

  test('shape = circle opt-in', () => {
    const d = new BoxDecoration({ shape: 'circle' });
    expect(d.shape).toBe('circle');
  });
});

describe('BoxDecoration · copyWith', () => {
  test('copyWith preserves fields not in patch', () => {
    const base = new BoxDecoration({
      color: 'a',
      borderRadius: BorderRadius.circular(1),
      shape: 'circle',
    });
    const next = base.copyWith({ color: 'b' });
    expect(next.color).toBe('b');
    expect(next.borderRadius?.topLeft).toBe(1);
    expect(next.shape).toBe('circle');
    expect(base).not.toBe(next);
  });

  test('copyWith with null overrides field', () => {
    const base = new BoxDecoration({ borderRadius: BorderRadius.circular(3) });
    const next = base.copyWith({ borderRadius: null });
    expect(next.borderRadius).toBeNull();
    expect(base.borderRadius?.topLeft).toBe(3); // unchanged
  });

  test('copyWith shape stays default when not specified', () => {
    const base = new BoxDecoration({ shape: 'circle' });
    const next = base.copyWith({ color: 'x' });
    expect(next.shape).toBe('circle'); // preserved
  });
});

describe('BoxDecoration · JSON round-trip', () => {
  test('toJSON · nested attribute JSON shape', () => {
    const d = new BoxDecoration({
      color: 'surface',
      border: BorderSpec.all({ color: 'a', width: 2, style: 'dashed' }),
      borderRadius: BorderRadius.circular(1),
      padding: EdgeInsets.all(2),
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 } })],
    });
    const j = d.toJSON();
    expect(j.color).toBe('surface');
    expect(j.border?.top?.style).toBe('dashed');
    expect(j.borderRadius?.topLeft).toBe(1);
    expect(j.padding?.top).toBe(2);
    expect(j.boxShadow).toHaveLength(1);
    expect(j.shape).toBe('rectangle');
  });

  test('fromJSON reconstructs with nested class instances', () => {
    const d = new BoxDecoration({
      color: 'surface',
      border: BorderSpec.all({ color: 'a', width: 1 }),
      borderRadius: BorderRadius.circular(2),
      padding: EdgeInsets.all(1),
      boxShadow: [new BoxShadow({ offset: { dx: 0, dy: 1 }, color: 's' })],
    });
    const r = BoxDecoration.fromJSON(d.toJSON());
    expect(r.color).toBe('surface');
    expect(r.border).toBeInstanceOf(BorderSpec);
    expect(r.borderRadius).toBeInstanceOf(BorderRadius);
    expect(r.padding).toBeInstanceOf(EdgeInsets);
    expect(r.boxShadow?.[0]).toBeInstanceOf(BoxShadow);
    expect(r.borderRadius?.topLeft).toBe(2);
  });

  test('fromJSON with null returns baseline decoration', () => {
    const r = BoxDecoration.fromJSON(null);
    expect(r.color).toBeNull();
    expect(r.shape).toBe('rectangle');
  });
});

describe('BoxDecoration · schema', () => {
  test('schema() shape includes nested attribute schemas', () => {
    const s = BoxDecoration.schema();
    expect(s.type).toBe('object');
    const props = s.properties as Record<string, unknown>;
    expect(props.shape).toBeDefined();
    expect(props.border).toBeDefined();
    expect(props.borderRadius).toBeDefined();
    expect(props.padding).toBeDefined();
    expect(props.boxShadow).toBeDefined();
  });
});
