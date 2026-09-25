import { describe, expect, test } from 'bun:test';
import { TextView, BoxView, Consumed, Ignored, type EventResult, type View } from '../src/ui/view.js';
import { withBorder, withShadow } from '../src/ui/decor.js';
import { LinearLayout } from '../src/ui/layout/linear.ts';
import { ScrollView } from '../src/ui/layout/scroll.ts';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';

function mkFocusable(label: string, consumed: string[] = []): View {
  return {
    draw(p) { p.text(0, 0, label); },
    onEvent(ev) { if (consumed.includes(ev.name)) return Consumed(); return Ignored; },
    layout() {},
    requiredSize(c) { return { width: Math.min(c.width, label.length), height: 1 }; },
    takeFocus() { return true; },
  };
}

describe('LC5 decor', () => {
  test('withBorder draws bordered box around inner', () => {
    const v = withBorder(new TextView('hi'), { title: 'T' });
    const p = Printer.create({ width: 6, height: 3 });
    v.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('┌ T ─┐');
    expect(lines[1]).toBe('│hi  │');
  });

  test('withShadow leaves right+bottom 1-cell shadow', () => {
    const v = withShadow(new TextView('AB'));
    const p = Printer.create({ width: 4, height: 3 });
    v.draw(p);
    const lines = p.lines().map(stripAnsi);
    // Top-left 3×2 region contains inner content; right col y=1..2
    // and bottom row x=1..3 are shadow cells '▒'.
    expect(lines[0].startsWith('AB')).toBe(true);
    expect(lines[0][3]).toBe(' ');                  // top-right corner NOT shadow
    expect(lines[1][3]).toBe('▒');
    expect(lines[2][1]).toBe('▒');
  });

  test('BoxView renders focused right-side title glyph without clobbering title', () => {
    const v = new BoxView(new TextView('hi'), {
      border: true,
      title: 'Window',
      titleRight: '✕',
      style: '\x1b[38;2;88;91;112m',
      focusedStyle: '\x1b[38;2;137;180;250m',
      titleStyle: '\x1b[38;2;205;214;244m',
      focusedTitleRightStyle: '\x1b[38;2;243;139;168m',
    });
    const p = Printer.create({ width: 18, height: 3, focused: true });
    v.draw(p);
    const lines = p.lines();
    expect(stripAnsi(lines[0]!)).toContain(' Window ');
    expect(stripAnsi(lines[0]!)).toContain(' ✕ ');
    expect(lines[0]!).toContain('\x1b[38;2;243;139;168m');
  });
});

describe('LC5 LinearLayout', () => {
  test('vertical layout stacks children top-to-bottom with flex share', () => {
    const l = LinearLayout.vertical(
      new TextView('A'),
      new TextView('B'),
      new TextView('C'),
    );
    const p = Printer.create({ width: 3, height: 3 });
    l.layout({ width: 3, height: 3 });
    l.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('A  ');
    expect(lines[1]).toBe('B  ');
    expect(lines[2]).toBe('C  ');
  });

  test('horizontal layout places children left-to-right', () => {
    const l = LinearLayout.horizontal(
      { view: new TextView('AA'), size: 2 },
      { view: new TextView('BB'), size: 2 },
    );
    const p = Printer.create({ width: 4, height: 1 });
    l.layout({ width: 4, height: 1 });
    l.draw(p);
    expect(stripAnsi(p.lines()[0]!)).toBe('AABB');
  });

  test('fixed + flex mix: fixed consumes first, flex shares the rest', () => {
    const l = LinearLayout.vertical(
      { view: new TextView('H'), size: 1 },
      new TextView('body'),
      { view: new TextView('F'), size: 1 },
    );
    const p = Printer.create({ width: 6, height: 4 });
    l.layout({ width: 6, height: 4 });
    l.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('H     ');
    expect(lines[1]).toBe('body  ');
    expect(lines[2]).toBe('      ');
    expect(lines[3]).toBe('F     ');
  });

  test('takeFocus cascades to first focusable child', () => {
    const l = LinearLayout.vertical(
      new TextView('ignored'),
      mkFocusable('B'),
      mkFocusable('C'),
    );
    expect(l.takeFocus('front')).toBe(true);
    expect((l.focusedChild() as any)).toBeTruthy();
  });

  test('down/up moves focus between focusable children', () => {
    const a = mkFocusable('A');
    const b = mkFocusable('B');
    const l = LinearLayout.vertical(a, b);
    l.takeFocus('front');
    // initially on a. down → b.
    const r1 = l.onEvent({ name: 'down' });
    expect(r1.kind).toBe('consumed');
    expect(l.focusedChild()).toBe(b);
    // up → a.
    const r2 = l.onEvent({ name: 'up' });
    expect(r2.kind).toBe('consumed');
    expect(l.focusedChild()).toBe(a);
  });

  test('focused child that consumes prevents focus navigation', () => {
    const a = mkFocusable('A', ['down']);
    const b = mkFocusable('B');
    const l = LinearLayout.vertical(a, b);
    l.takeFocus('front');
    l.onEvent({ name: 'down' });
    // Focused child consumed, layout should NOT move focus.
    expect(l.focusedChild()).toBe(a);
  });
});

describe('LC5 ScrollView', () => {
  test('renders visible slice of tall content', () => {
    const long = new TextView(Array.from({ length: 10 }, (_, i) => `row${i}`).join('\n'));
    const sv = new ScrollView(long, { scrollbar: false });
    const p = Printer.create({ width: 8, height: 3 });
    sv.layout({ width: 8, height: 3 });
    sv.draw(p);
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('row0    ');
    expect(lines[1]).toBe('row1    ');
    expect(lines[2]).toBe('row2    ');
  });

  test('scroll down shifts the visible slice', () => {
    const long = new TextView(Array.from({ length: 10 }, (_, i) => `row${i}`).join('\n'));
    const sv = new ScrollView(long, { scrollbar: false });
    sv.layout({ width: 8, height: 3 });
    // First draw populates lastContentH etc.
    const p = Printer.create({ width: 8, height: 3 });
    sv.draw(p);
    // Down key scrolls by 1.
    sv.onEvent({ name: 'down' });
    const p2 = Printer.create({ width: 8, height: 3 });
    sv.draw(p2);
    expect(stripAnsi(p2.lines()[0]!)).toBe('row1    ');
  });

  test('end key jumps to bottom; home jumps to top', () => {
    const long = new TextView(Array.from({ length: 20 }, (_, i) => `r${i}`).join('\n'));
    const sv = new ScrollView(long, { scrollbar: false });
    const p = Printer.create({ width: 5, height: 3 });
    sv.draw(p);
    sv.onEvent({ name: 'end' });
    const pEnd = Printer.create({ width: 5, height: 3 });
    sv.draw(pEnd);
    const lines = pEnd.lines().map(stripAnsi);
    expect(lines[2]).toContain('r19');

    sv.onEvent({ name: 'home' });
    const pHome = Printer.create({ width: 5, height: 3 });
    sv.draw(pHome);
    expect(stripAnsi(pHome.lines()[0]!)).toContain('r0');
  });

  test('scrollbar track + thumb on right edge', () => {
    const long = new TextView(Array.from({ length: 20 }, () => 'x').join('\n'));
    const sv = new ScrollView(long, { scrollbar: true });
    const p = Printer.create({ width: 4, height: 4 });
    sv.draw(p);
    const lines = p.lines().map(stripAnsi);
    // Right column is the scrollbar (│ or █ ).
    for (const line of lines) {
      expect(line[3] === '│' || line[3] === '█').toBe(true);
    }
    // At least one thumb cell '█' somewhere in track.
    const col = lines.map(l => l[3]).join('');
    expect(col).toContain('█');
  });
});
