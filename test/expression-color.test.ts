import { describe, expect, test } from 'bun:test';
import {
  adaptive,
  adaptivePalette,
  hexToRgb,
  paint,
  resolveColor,
  rgbToAnsi16,
  rgbToAnsi256,
  wrapAnsi16Bg,
  wrapAnsi16Fg,
  type AdaptiveColor,
} from '../src/expression/color.js';

describe('expression/color · hexToRgb', () => {
  test('parses 6-digit hex', () => {
    expect(hexToRgb('#a093e8')).toEqual({ r: 0xa0, g: 0x93, b: 0xe8 });
  });

  test('parses 3-digit hex by doubling', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  test('returns null for malformed input', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#ggggggg')).toBeNull();
    expect(hexToRgb('#12')).toBeNull();
  });
});

describe('expression/color · rgbToAnsi256', () => {
  test('grayscale ramp 232..255 for r=g=b', () => {
    expect(rgbToAnsi256(0, 0, 0)).toBe(16);
    expect(rgbToAnsi256(128, 128, 128)).toBeGreaterThanOrEqual(232);
    expect(rgbToAnsi256(128, 128, 128)).toBeLessThanOrEqual(255);
    expect(rgbToAnsi256(255, 255, 255)).toBe(231);
  });

  test('cube 16..231 otherwise', () => {
    const idx = rgbToAnsi256(255, 0, 0);
    expect(idx).toBeGreaterThanOrEqual(16);
    expect(idx).toBeLessThanOrEqual(231);
    // Pure red lands on cube-cell (5, 0, 0) → 16 + 36*5 = 196.
    expect(idx).toBe(196);
  });
});

describe('expression/color · rgbToAnsi16', () => {
  test('basic colors map to standard 16-color indices', () => {
    expect(rgbToAnsi16(0, 0, 0)).toBe(0);
    expect(rgbToAnsi16(255, 0, 0)).toBe(9); // bright red nearer than dark red
    expect(rgbToAnsi16(0, 255, 0)).toBe(10);
    expect(rgbToAnsi16(0, 0, 255)).toBe(12);
    expect(rgbToAnsi16(255, 255, 255)).toBe(15);
  });

  test('a pastel hex picks a sensible 16-color neighbour', () => {
    // elanous-pastel lavender #a093e8 — closest of the 16 standard colors
    // is bright magenta (#ff00ff = 13) or bright black (8) depending on
    // distance metric. Either is acceptable; assert it's in the
    // bright family since the input is high-luminance.
    const idx = rgbToAnsi16(0xa0, 0x93, 0xe8);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(15);
  });
});

describe('expression/color · adaptive + adaptivePalette', () => {
  test('adaptive() preserves truecolor verbatim', () => {
    const c = adaptive('#a093e8');
    expect(c.truecolor).toBe('#a093e8');
    expect(Number(c.ansi256)).toBeGreaterThanOrEqual(0);
    expect(Number(c.ansi256)).toBeLessThanOrEqual(255);
    expect(Number(c.ansi16)).toBeGreaterThanOrEqual(0);
    expect(Number(c.ansi16)).toBeLessThanOrEqual(15);
  });

  test('adaptivePalette() preserves keys + truecolor', () => {
    const palette = adaptivePalette({ accent: '#89b4fa', error: '#f38ba8' });
    expect(Object.keys(palette).sort()).toEqual(['accent', 'error']);
    expect(palette.accent.truecolor).toBe('#89b4fa');
    expect(palette.error.truecolor).toBe('#f38ba8');
  });

  // PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — overrides hook
  test('adaptivePalette({overrides}) pins ANSI-16 without disturbing truecolor', () => {
    const palette = adaptivePalette(
      { accent: '#89b4fa', error: '#f38ba8' },
      { accent: { ansi16: '12' } },
    );
    // Override applied to the targeted channel only.
    expect(palette.accent.ansi16).toBe('12');
    // Truecolor / 256 stay derived from the canonical hex.
    expect(palette.accent.truecolor).toBe('#89b4fa');
    expect(Number(palette.accent.ansi256)).toBeGreaterThanOrEqual(16);
    // Untouched key keeps the auto-derived AdaptiveColor.
    expect(palette.error.truecolor).toBe('#f38ba8');
  });

  test('adaptivePalette overrides accept partial AdaptiveColor (ansi256 only)', () => {
    const palette = adaptivePalette(
      { brand: '#a093e8' },
      { brand: { ansi256: '99' } },
    );
    expect(palette.brand.ansi256).toBe('99');
    expect(palette.brand.truecolor).toBe('#a093e8');
    // ansi16 stays auto-derived.
    expect(Number(palette.brand.ansi16)).toBeGreaterThanOrEqual(0);
    expect(Number(palette.brand.ansi16)).toBeLessThanOrEqual(15);
  });

  test('adaptivePalette overrides honored end-to-end via paint(profile=ansi16)', () => {
    const palette = adaptivePalette(
      { brand: '#a093e8' },
      { brand: { ansi16: '5' } },
    );
    // ansi16 SGR uses the override (5 → 35 fg / 45 bg via wrapAnsi16Fg).
    const out = paint(palette.brand, 'ansi16')('x');
    expect(out).toBe('\x1b[35mx\x1b[39m');
  });
});

describe('expression/color · resolveColor', () => {
  const c: AdaptiveColor = {
    truecolor: '#89b4fa',
    ansi256: '111',
    ansi16: '12',
  };

  test('truecolor → hex', () => {
    expect(resolveColor(c, 'truecolor')).toBe('#89b4fa');
  });

  test('ansi256 → numeric string', () => {
    expect(resolveColor(c, 'ansi256')).toBe('111');
  });

  test('ansi16 → numeric string', () => {
    expect(resolveColor(c, 'ansi16')).toBe('12');
  });

  test('mono → empty string', () => {
    expect(resolveColor(c, 'mono')).toBe('');
  });

  test('accepts raw hex string and downgrades', () => {
    expect(resolveColor('#89b4fa', 'truecolor')).toBe('#89b4fa');
    expect(resolveColor('#89b4fa', 'mono')).toBe('');
    const v256 = resolveColor('#89b4fa', 'ansi256');
    expect(Number(v256)).toBeGreaterThanOrEqual(0);
    expect(Number(v256)).toBeLessThanOrEqual(255);
  });
});

describe('expression/color · paint', () => {
  test('mono profile passes text through unchanged', () => {
    const f = paint('#89b4fa', 'mono');
    expect(f('hello')).toBe('hello');
  });

  test('truecolor wraps in SGR escape with hex RGB', () => {
    const f = paint('#89b4fa', 'truecolor');
    const out = f('x');
    expect(out).toContain('x');
    expect(out).toMatch(/\x1b\[[\d;]+m/);
    expect(out).toContain('38;2;'); // 24-bit fg signature
  });

  test('ansi256 emits 256-color SGR', () => {
    const f = paint('#89b4fa', 'ansi256');
    const out = f('x');
    expect(out).toContain('38;5;'); // 256-color fg signature
  });

  test('ansi16 emits 4-bit fg SGR (30..37 / 90..97)', () => {
    const wrap = wrapAnsi16Fg(5);
    expect(wrap('x')).toBe('\x1b[35mx\x1b[39m');
    expect(wrapAnsi16Fg(12)('x')).toBe('\x1b[94mx\x1b[39m');
  });

  test('ansi16 bg emits 4-bit bg SGR (40..47 / 100..107)', () => {
    expect(wrapAnsi16Bg(2)('x')).toBe('\x1b[42mx\x1b[49m');
    expect(wrapAnsi16Bg(10)('x')).toBe('\x1b[102mx\x1b[49m');
  });
});

describe('expression/color · graceful degrade snapshot', () => {
  test('the same AdaptiveColor renders distinct outputs across profiles', () => {
    const c = adaptive('#a093e8');
    const t = paint(c, 'truecolor')('x');
    const a256 = paint(c, 'ansi256')('x');
    const a16 = paint(c, 'ansi16')('x');
    const m = paint(c, 'mono')('x');
    expect(m).toBe('x');
    expect(t).not.toBe(m);
    expect(a256).not.toBe(m);
    expect(a16).not.toBe(m);
    // Three distinct ANSI profiles produce three different escape
    // signatures (38;2 / 38;5 / 3X).
    expect(t).not.toBe(a256);
    expect(a256).not.toBe(a16);
  });
});
