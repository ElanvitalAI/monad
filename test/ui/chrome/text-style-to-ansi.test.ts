// ── Presentation P4a · TextStyle → ANSI composer ──

import { describe, test, expect } from 'bun:test';
import { TextStyle } from '../../../src/ui/attributes/text-style.js';
import { composeAnsi, applyAnsi } from '../../../src/ui/chrome/text-style-to-ansi.js';
import { DEFAULT_THEME_TOKENS } from '../../../src/theme/tokens.js';

const theme = DEFAULT_THEME_TOKENS;

describe('composeAnsi · empty / null', () => {
  test('null style returns empty pair', () => {
    expect(composeAnsi(null, theme)).toEqual({ open: '', close: '' });
    expect(composeAnsi(undefined, theme)).toEqual({ open: '', close: '' });
  });

  test('all-null TextStyle returns empty pair', () => {
    expect(composeAnsi(new TextStyle(), theme)).toEqual({ open: '', close: '' });
  });
});

describe('composeAnsi · single attributes', () => {
  test('bold: true emits SGR 1 + 22', () => {
    const { open, close } = composeAnsi(new TextStyle({ bold: true }), theme);
    expect(open).toContain('1');
    expect(close).toContain('22');
  });

  test('italic: true emits SGR 3 + 23', () => {
    const { open, close } = composeAnsi(new TextStyle({ italic: true }), theme);
    expect(open).toContain('3');
    expect(close).toContain('23');
  });

  test('underline: true emits SGR 4 + 24', () => {
    const { open, close } = composeAnsi(new TextStyle({ underline: true }), theme);
    expect(open).toContain('4');
    expect(close).toContain('24');
  });

  test('explicit false bold emits SGR 22 up-front (no close)', () => {
    const { open, close } = composeAnsi(new TextStyle({ bold: false }), theme);
    expect(open).toContain('22');
    // only a reset when nothing else paired
    expect(close).toContain('0');
  });
});

describe('composeAnsi · Zellij extended emphasis', () => {
  test('doubleUnderline emits SGR 21 (overrides plain underline)', () => {
    const { open, close } = composeAnsi(
      new TextStyle({ underline: true, doubleUnderline: true }),
      theme,
    );
    expect(open).toContain('21');
    expect(open).not.toMatch(/\[4m|\[4[^:]/);
    expect(close).toContain('24');
  });

  test('curlyUnderline uses 4:3 subparameter form', () => {
    const { open } = composeAnsi(new TextStyle({ curlyUnderline: true }), theme);
    expect(open).toContain('4:3');
  });

  test('overline emits SGR 53 + 55', () => {
    const { open, close } = composeAnsi(new TextStyle({ overline: true }), theme);
    expect(open).toContain('53');
    expect(close).toContain('55');
  });

  test('reverse emits SGR 7 + 27', () => {
    const { open, close } = composeAnsi(new TextStyle({ reverse: true }), theme);
    expect(open).toContain('7');
    expect(close).toContain('27');
  });

  test('strikethrough emits SGR 9 + 29', () => {
    const { open, close } = composeAnsi(new TextStyle({ strikethrough: true }), theme);
    expect(open).toContain('9');
    expect(close).toContain('29');
  });
});

describe('composeAnsi · merge round-trip', () => {
  test('parent.merge(child) composes cumulative ANSI', () => {
    const parent = new TextStyle({ bold: true, color: 'text' });
    const child = new TextStyle({ italic: true });
    const merged = parent.merge(child);
    const { open, close } = composeAnsi(merged, theme);
    expect(open).toContain('1');   // bold
    expect(open).toContain('3');   // italic
    expect(close).toContain('22'); // bold off
    expect(close).toContain('23'); // italic off
  });

  test('child override bold=false still emits 22 disable', () => {
    const parent = new TextStyle({ bold: true });
    const child = new TextStyle({ bold: false });
    const merged = parent.merge(child);
    const { open } = composeAnsi(merged, theme);
    expect(open).toContain('22');
  });
});

describe('composeAnsi · color', () => {
  test('known color token emits an RGB / palette SGR', () => {
    const { open } = composeAnsi(new TextStyle({ color: 'text' }), theme);
    // chalk.hex produces 38;2;r;g;b · just assert presence of the "38" prefix
    expect(open).toContain('38');
  });

  test('raw hex color pass-through also emits SGR', () => {
    const { open } = composeAnsi(new TextStyle({ color: '#abcdef' }), theme);
    expect(open).toContain('38');
  });

  test('unknown token → no color SGR', () => {
    const { open } = composeAnsi(new TextStyle({ color: 'nope' }), theme);
    expect(open).not.toContain('38');
  });
});

describe('applyAnsi helper', () => {
  test('applyAnsi wraps text with open/close sequences', () => {
    const style = new TextStyle({ bold: true });
    const result = applyAnsi('hello', style, theme);
    expect(result).toContain('hello');
    expect(result).toMatch(/\u001b\[/);
  });

  test('applyAnsi no-ops when pair is empty', () => {
    expect(applyAnsi('hello', null, theme)).toBe('hello');
    expect(applyAnsi('hello', new TextStyle(), theme)).toBe('hello');
  });
});
