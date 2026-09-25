// ── Presentation P2 · TextStyle ──

import { describe, test, expect } from 'bun:test';
import { TextStyle } from '../../../src/ui/attributes/text-style.js';

describe('TextStyle · construction', () => {
  test('default · every field null (inherit)', () => {
    const t = new TextStyle();
    expect(t.color).toBeNull();
    expect(t.bold).toBeNull();
    expect(t.italic).toBeNull();
    expect(t.underline).toBeNull();
    expect(t.dim).toBeNull();
    expect(t.reverse).toBeNull();
    expect(t.strikethrough).toBeNull();
    expect(t.doubleUnderline).toBeNull();
    expect(t.curlyUnderline).toBeNull();
    expect(t.overline).toBeNull();
  });

  test('explicit false is distinct from null', () => {
    const t = new TextStyle({ bold: false });
    expect(t.bold).toBe(false);
    expect(new TextStyle().bold).toBeNull();
  });

  test('Zellij extended emphasis fields accepted', () => {
    const t = new TextStyle({
      doubleUnderline: true,
      curlyUnderline: true,
      overline: true,
    });
    expect(t.doubleUnderline).toBe(true);
    expect(t.curlyUnderline).toBe(true);
    expect(t.overline).toBe(true);
  });
});

describe('TextStyle · copyWith', () => {
  test('copyWith preserves unspecified fields', () => {
    const a = new TextStyle({ color: 'fg', bold: true });
    const b = a.copyWith({ italic: true });
    expect(b.color).toBe('fg');
    expect(b.bold).toBe(true);
    expect(b.italic).toBe(true);
    expect(a).not.toBe(b);
  });

  test('copyWith with null clears a field', () => {
    const a = new TextStyle({ bold: true });
    const b = a.copyWith({ bold: null });
    expect(b.bold).toBeNull();
  });
});

describe('TextStyle · merge (parent ← child override)', () => {
  test('child non-null overrides parent', () => {
    const parent = new TextStyle({ color: 'fg', bold: true, italic: false });
    const child = new TextStyle({ bold: false });
    const merged = parent.merge(child);
    expect(merged.color).toBe('fg');    // inherit
    expect(merged.bold).toBe(false);    // overridden
    expect(merged.italic).toBe(false);  // inherit (parent was false explicit)
  });

  test('child null inherits parent', () => {
    const parent = new TextStyle({ bold: true, underline: true });
    const child = new TextStyle({ underline: false });
    const merged = parent.merge(child);
    expect(merged.bold).toBe(true);       // child null → parent
    expect(merged.underline).toBe(false); // child explicit false → wins
  });

  test('merge(null) returns this', () => {
    const t = new TextStyle({ bold: true });
    expect(t.merge(null)).toBe(t);
    expect(t.merge(undefined)).toBe(t);
  });

  test('merge is non-mutating (pure)', () => {
    const p = new TextStyle({ bold: true });
    const c = new TextStyle({ italic: true });
    const m = p.merge(c);
    expect(p.italic).toBeNull();  // parent unchanged
    expect(c.bold).toBeNull();    // child unchanged
    expect(m.bold).toBe(true);
    expect(m.italic).toBe(true);
  });
});

describe('TextStyle · JSON + schema', () => {
  test('JSON round-trip preserves tri-state', () => {
    const t = new TextStyle({ bold: true, italic: false, underline: null, color: 'accent' });
    const r = TextStyle.fromJSON(t.toJSON());
    expect(r.bold).toBe(true);
    expect(r.italic).toBe(false);
    expect(r.underline).toBeNull();
    expect(r.color).toBe('accent');
  });

  test('schema() contains all Zellij emphasis fields', () => {
    const s = TextStyle.schema();
    const props = s.properties as Record<string, unknown>;
    expect(props.doubleUnderline).toBeDefined();
    expect(props.curlyUnderline).toBeDefined();
    expect(props.overline).toBeDefined();
  });
});
