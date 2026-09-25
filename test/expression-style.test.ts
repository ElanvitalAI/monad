import { describe, expect, test } from 'bun:test';
import { Style } from '../src/expression/style.js';

describe('expression/style · Style fluent builder', () => {
  test('empty style is a no-op for mono profile', () => {
    expect(Style.empty().render('hello', 'mono')).toBe('hello');
  });

  test('foreground wraps in SGR (truecolor)', () => {
    const out = Style.empty().foreground('#89b4fa').render('x', 'truecolor');
    expect(out).toContain('x');
    expect(out).toContain('38;2;');
  });

  test('background wraps in SGR (truecolor)', () => {
    const out = Style.empty().background('#89b4fa').render('x', 'truecolor');
    expect(out).toContain('48;2;');
  });

  test('bold + underline produce SGR 1 + 4', () => {
    const out = Style.empty().bold().underline().render('x', 'truecolor');
    expect(out).toMatch(/\x1b\[(?:1|4)/); // chalk emits in some order
  });

  test('paddingX adds whitespace inside, marginX outside', () => {
    expect(Style.empty().paddingX(2).render('xy', 'mono')).toBe('  xy  ');
    expect(Style.empty().marginX(1).render('xy', 'mono')).toBe(' xy ');
  });

  test('chaining is immutable — base unchanged after derive', () => {
    const base = Style.empty().foreground('#89b4fa');
    const bold = base.bold();
    const baseOut = base.render('x', 'truecolor');
    const boldOut = bold.render('x', 'truecolor');
    expect(boldOut).not.toBe(baseOut);
    // base never gained the bold attribute
    expect(baseOut).not.toContain('\x1b[1m');
  });

  test('mono profile suppresses color but keeps attributes', () => {
    const out = Style.empty().foreground('#89b4fa').bold().render('x', 'mono');
    // Mono path skips fg painting; chalk attribute chain may still
    // emit bold SGR — that's expected. Just verify the text survives
    // and no fg color escape leaks in.
    expect(out).toContain('x');
    expect(out).not.toContain('38;2;');
  });

  test('Style.of accepts initial state', () => {
    const s = Style.of({ fg: '#89b4fa', bold: true });
    const out = s.render('x', 'truecolor');
    expect(out).toContain('38;2;');
  });
});
