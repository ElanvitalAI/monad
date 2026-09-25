import { describe, expect, test } from 'bun:test';
import { BoxView, Consumed, Ignored, TextView, type EventResult, type View } from '../src/ui/view.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';

describe('LC4 View foundation', () => {
  test('Ignored is a shared frozen singleton', () => {
    expect(Ignored.kind).toBe('ignored');
    expect(Object.isFrozen(Ignored)).toBe(true);
  });

  test('Consumed wraps a callback', () => {
    let fired = false;
    const r = Consumed(() => { fired = true; });
    expect(r.kind).toBe('consumed');
    if (r.kind === 'consumed') r.callback?.();
    expect(fired).toBe(true);
  });

  test('TextView paints single-line text', () => {
    const v = new TextView('hello');
    const p = Printer.create({ width: 10, height: 1 });
    v.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toBe('hello     ');
  });

  test('TextView paints multi-line split on \\n', () => {
    const v = new TextView('a\nbb\nccc');
    const p = Printer.create({ width: 5, height: 3 });
    v.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toBe('a    ');
    expect(stripAnsi(p.lines()[1]!)).toBe('bb   ');
    expect(stripAnsi(p.lines()[2]!)).toBe('ccc  ');
  });

  test('TextView requiredSize fits widest line and line count', () => {
    const v = new TextView('a\nhello\nhi');
    expect(v.requiredSize({ width: 100, height: 100 })).toEqual({ width: 5, height: 3 });
    expect(v.requiredSize({ width: 3, height: 100 })).toEqual({ width: 3, height: 3 });
    expect(v.requiredSize({ width: 100, height: 2 })).toEqual({ width: 5, height: 2 });
  });

  test('TextView does not take focus', () => {
    expect(new TextView('x').takeFocus()).toBe(false);
  });

  test('BoxView draws border + title', () => {
    const inner = new TextView('hi');
    const box = new BoxView(inner, { border: true, title: 'T' });
    const p = Printer.create({ width: 6, height: 3 });
    box.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('┌ T ─┐');
    expect(lines[1]).toBe('│hi  │');
    expect(lines[2]).toBe('└────┘');
  });

  test('BoxView reserves 1-cell padding when bordered', () => {
    const inner = new TextView('abcdef');
    const box = new BoxView(inner, { border: true });
    const p = Printer.create({ width: 6, height: 3 });
    box.draw(p);
    // Inner region is 4 wide × 1 tall. 'abcd' fits, 'ef' clipped.
    expect(stripAnsi(p.lines()[1]!)).toBe('│abcd│');
  });

  test('BoxView without border uses full region', () => {
    const box = new BoxView(new TextView('abcd'), { border: false });
    const p = Printer.create({ width: 4, height: 1 });
    box.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toBe('abcd');
  });

  test('BoxView fill option paints background', () => {
    const box = new BoxView(new TextView(''), { border: false, fill: '.' });
    const p = Printer.create({ width: 3, height: 2 });
    box.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toBe('...');
    expect(stripAnsi(p.lines()[1]!)).toBe('...');
  });

  test('BoxView delegates onEvent + takeFocus to inner', () => {
    const ev = { name: 'enter' };
    const captured: string[] = [];
    const inner: View = {
      draw() {},
      onEvent() { captured.push('enter'); return Consumed(); },
      layout() {},
      requiredSize() { return { width: 0, height: 0 }; },
      takeFocus() { captured.push('focus'); return true; },
    };
    const box = new BoxView(inner);
    const r = box.onEvent(ev);
    expect(r.kind).toBe('consumed');
    expect(captured).toEqual(['enter']);
    expect(box.takeFocus()).toBe(true);
    expect(captured).toEqual(['enter', 'focus']);
  });

  test('BoxView requiredSize accounts for border padding', () => {
    const inner = new TextView('abc');
    const box = new BoxView(inner, { border: true });
    // Inner needs 3×1; border adds 2 each axis → 5×3.
    expect(box.requiredSize({ width: 100, height: 100 })).toEqual({ width: 5, height: 3 });
    // Bordered box should not exceed constraint.
    expect(box.requiredSize({ width: 4, height: 2 })).toEqual({ width: 4, height: 2 });
  });

  test('BoxView title truncates with ellipsis when too long', () => {
    const box = new BoxView(new TextView(''), { border: true, title: 'LongTitle' });
    const p = Printer.create({ width: 8, height: 3 });
    box.draw(p);
    const top = stripAnsi(p.lines()[0]!);
    expect(top.startsWith('┌')).toBe(true);
    expect(top.endsWith('┐')).toBe(true);
    expect(top).toContain('…');
  });
});
