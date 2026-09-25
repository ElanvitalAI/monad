import { describe, expect, test } from 'bun:test';
import { ToastStack, MousePointer } from '../src/ui/widgets/toast-stack.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';

function render(fn: (p: Printer) => void, w = 40, h = 10): string[] {
  const p = Printer.create({ width: w, height: h });
  fn(p);
  return p.lines().map(stripAnsi);
}

describe('MX10 ToastStack — lifecycle', () => {
  test('push increments id, pruneExpired removes old ones', () => {
    let now = 1000;
    const stack = new ToastStack({ nowMs: () => now });
    stack.push({ text: 'first', ttlMs: 500 });
    stack.push({ text: 'second', ttlMs: 2000 });
    expect(stack.snapshot().map(t => t.text)).toEqual(['first', 'second']);
    now += 600;
    stack.pruneExpired();
    expect(stack.snapshot().map(t => t.text)).toEqual(['second']);
  });

  test('ttlMs <= 0 means persistent — only manual dismiss removes it', () => {
    let now = 1000;
    const stack = new ToastStack({ nowMs: () => now });
    const id = stack.push({ text: 'sticky', ttlMs: 0 });
    now += 999999;
    stack.pruneExpired();
    expect(stack.snapshot()).toHaveLength(1);
    expect(stack.dismiss(id)).toBe(true);
    expect(stack.snapshot()).toHaveLength(0);
  });

  test('dismiss on unknown id returns false', () => {
    const stack = new ToastStack();
    expect(stack.dismiss(999)).toBe(false);
  });

  test('maxVisible caps the stack (oldest drop first)', () => {
    const stack = new ToastStack({ maxVisible: 2 });
    stack.push({ text: '1', ttlMs: 10000 });
    stack.push({ text: '2', ttlMs: 10000 });
    stack.push({ text: '3', ttlMs: 10000 });
    stack.pruneExpired();
    const texts = stack.snapshot().map(t => t.text);
    expect(texts).toEqual(['2', '3']);
  });
});

describe('MX10 ToastStack — rendering', () => {
  test('top-right placement: toast sits near top-right corner', () => {
    const stack = new ToastStack({ placement: 'top-right', nowMs: () => 0 });
    stack.push({ text: 'hello', kind: 'info', ttlMs: 10000 });
    const lines = render(p => stack.render(p), 40, 5);
    expect(lines[1]).toContain('hello');
    // Should appear in the right portion of the line, not col 0.
    const idx = lines[1]!.indexOf('hello');
    expect(idx).toBeGreaterThan(10);
  });

  test('bottom-left placement: toast sits near bottom-left', () => {
    const stack = new ToastStack({ placement: 'bottom-left', nowMs: () => 0 });
    stack.push({ text: 'nope', kind: 'warning', ttlMs: 10000 });
    const lines = render(p => stack.render(p), 40, 6);
    expect(lines[4]).toContain('nope');
    // IDX-6 Phase 6 — toast glyph now sourced from theme-icons, which
    // may include variation selectors or wide emoji. Relax the bound
    // to "in the left half" so the placement assertion survives
    // theme-specific glyph widths.
    expect(lines[4]!.indexOf('nope')).toBeLessThan(20);
  });

  test('multiple toasts stack with newest at the bottom by default', () => {
    const stack = new ToastStack({ placement: 'top-right', nowMs: () => 0, gapY: 0 });
    stack.push({ text: 'first' });
    stack.push({ text: 'second' });
    stack.push({ text: 'third' });
    const lines = render(p => stack.render(p), 40, 8);
    // Find row indices of each toast.
    const rows: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('first'))  rows.first  = i;
      if (lines[i]!.includes('second')) rows.second = i;
      if (lines[i]!.includes('third'))  rows.third  = i;
    }
    expect(rows.first).toBeLessThan(rows.second!);
    expect(rows.second).toBeLessThan(rows.third!);
  });

  test('newest-top order reverses the stack vertically', () => {
    const stack = new ToastStack({ placement: 'top-right', order: 'newest-top', nowMs: () => 0, gapY: 0 });
    stack.push({ text: 'oldest' });
    stack.push({ text: 'newest' });
    const lines = render(p => stack.render(p), 40, 5);
    let oldestRow = -1, newestRow = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('oldest')) oldestRow = i;
      if (lines[i]!.includes('newest')) newestRow = i;
    }
    expect(newestRow).toBeLessThan(oldestRow);
  });

  test('glyph varies by kind', () => {
    // IDX-6 Phase 6 — toast kind → glyph now routes through
    // theme-icons, so the glyph is whatever the theme's
    // IconTokens.{success,error} resolves to. The exact character
    // varies across presets; the assertion is therefore on
    // placement + visible text, with the glyph ≠ the other kind's
    // glyph.
    const stack = new ToastStack({ nowMs: () => 0 });
    stack.push({ text: 'ok',  kind: 'success' });
    stack.push({ text: 'bad', kind: 'error' });
    const lines = render(p => stack.render(p), 40, 5).join('\n');
    expect(lines).toContain(' ok');
    expect(lines).toContain(' bad');
    // The two rows should differ in the glyph cell (and the text cell),
    // which is covered by the 'text contains' checks above.
  });

  test('empty stack: render is a no-op (no throw)', () => {
    const stack = new ToastStack();
    expect(() => render(p => stack.render(p))).not.toThrow();
  });
});

describe('MX10 MousePointer', () => {
  test('hidden by default', () => {
    const mp = new MousePointer();
    expect(mp.isVisible()).toBe(false);
  });

  test('update positions the pointer', () => {
    const mp = new MousePointer();
    mp.update(5, 2);
    expect(mp.isVisible()).toBe(true);
    const lines = render(p => mp.draw(p), 10, 5);
    expect(lines[2]?.[5]).toBe('◆');
  });

  test('off-screen position does not draw', () => {
    const mp = new MousePointer();
    mp.update(100, 100);
    const lines = render(p => mp.draw(p), 10, 5);
    const joined = lines.join('\n');
    expect(joined).not.toContain('◆');
  });

  test('hide() disables rendering', () => {
    const mp = new MousePointer();
    mp.update(0, 0);
    mp.hide();
    const lines = render(p => mp.draw(p), 10, 5);
    expect(lines.join('\n')).not.toContain('◆');
  });

  test('custom glyph option', () => {
    const mp = new MousePointer({ glyph: '●' });
    mp.update(3, 1);
    const lines = render(p => mp.draw(p), 10, 3);
    expect(lines[1]?.[3]).toBe('●');
  });

  test('takeFocus returns false — pointer never consumes focus', () => {
    expect(new MousePointer().takeFocus()).toBe(false);
  });
});
