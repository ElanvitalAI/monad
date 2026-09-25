import { describe, expect, test } from 'bun:test';
import { ColorScheme, createColorScheme } from '../src/theme/color-scheme.js';
import { tokenToPaletteColor } from '../src/theme/token-mapping.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../src/theme/tokens.js';
import type { ColorToken } from '../src/widgets/types.js';

// ── Token resolution ──────────────────────────────────────────────

describe('tokenToPaletteColor — 25 semantic tokens', () => {
  const tokens = DEFAULT_THEME_TOKENS;

  test('surface returns default (terminal bg)', () => {
    const r = tokenToPaletteColor('surface', tokens, 0);
    expect(r.kind).toBe('default');
  });

  test('text returns rgb from colors.text', () => {
    const r = tokenToPaletteColor('text', tokens, 0);
    expect(r.kind).toBe('rgb');
    if (r.kind === 'rgb') {
      // DEFAULT #cdd6f4
      expect(r.r).toBe(0xcd);
      expect(r.g).toBe(0xd6);
      expect(r.b).toBe(0xf4);
    }
  });

  test('success / warning / error / info map to ThemeColorTokens', () => {
    const s = tokenToPaletteColor('success', tokens, 0);
    expect(s.kind).toBe('rgb');
    const w = tokenToPaletteColor('warning', tokens, 0);
    expect(w.kind).toBe('rgb');
    const e = tokenToPaletteColor('error', tokens, 0);
    expect(e.kind).toBe('rgb');
    const i = tokenToPaletteColor('info', tokens, 0);
    expect(i.kind).toBe('rgb');
  });

  test('border.focused ≠ border (different pane dividers)', () => {
    const inactive = tokenToPaletteColor('border', tokens, 0);
    const active = tokenToPaletteColor('border.focused', tokens, 0);
    expect(inactive).not.toEqual(active);
  });

  test('diff.add.bg is a dimmed variant of success', () => {
    const add = tokenToPaletteColor('diff.add.fg', tokens, 0);
    const addBg = tokenToPaletteColor('diff.add.bg', tokens, 0);
    expect(add.kind).toBe('rgb');
    expect(addBg.kind).toBe('rgb');
    if (add.kind === 'rgb' && addBg.kind === 'rgb') {
      // bg is darker (shaded toward black on dark theme)
      expect(addBg.r + addBg.g + addBg.b).toBeLessThan(add.r + add.g + add.b);
    }
  });

  test('all 25 tokens resolve without throwing', () => {
    const all: ColorToken[] = [
      'surface', 'surface.raised', 'surface.overlay', 'surface.sunken',
      'text', 'text.muted', 'text.disabled', 'text.placeholder', 'text.accent',
      'border', 'border.focused', 'border.accent', 'border.disabled',
      'success', 'warning', 'error', 'info',
      'diff.add.fg', 'diff.add.bg', 'diff.del.fg', 'diff.del.bg',
      'highlight.fg', 'highlight.bg', 'pressed.fg', 'pressed.bg',
    ];
    for (const t of all) {
      const r = tokenToPaletteColor(t, tokens, 0);
      expect(r).toBeDefined();
      expect(['rgb', 'ansi', 'default']).toContain(r.kind);
    }
  });

  test('emphasis shifts color on dark theme (toward white)', () => {
    const darkTokens: ThemeTokens = { ...DEFAULT_THEME_TOKENS, isDark: true };
    const t0 = tokenToPaletteColor('text.accent', darkTokens, 0);
    const t3 = tokenToPaletteColor('text.accent', darkTokens, 3);
    expect(t0.kind).toBe('rgb');
    expect(t3.kind).toBe('rgb');
    if (t0.kind === 'rgb' && t3.kind === 'rgb') {
      // Emphasis 3 should be brighter overall on dark theme.
      expect(t3.r + t3.g + t3.b).toBeGreaterThan(t0.r + t0.g + t0.b);
    }
  });

  test('emphasis shifts color on light theme (toward black)', () => {
    const lightTokens: ThemeTokens = {
      ...DEFAULT_THEME_TOKENS,
      isDark: false,
      colors: { ...DEFAULT_THEME_TOKENS.colors, text: '#111111' },
    };
    const t0 = tokenToPaletteColor('text.accent', lightTokens, 0);
    const t3 = tokenToPaletteColor('text.accent', lightTokens, 3);
    if (t0.kind === 'rgb' && t3.kind === 'rgb') {
      expect(t3.r + t3.g + t3.b).toBeLessThan(t0.r + t0.g + t0.b);
    }
  });
});

// ── ColorScheme class ─────────────────────────────────────────────

describe('ColorScheme', () => {
  test('constructs with schemeName + brightness', () => {
    const cs = new ColorScheme({ tokens: DEFAULT_THEME_TOKENS });
    expect(cs.schemeName).toBe('catppuccin-mocha');
    expect(cs.brightness).toBe('dark'); // Mocha default text is light
  });

  test('resolve delegates to tokenToPaletteColor', () => {
    const cs = createColorScheme({ tokens: DEFAULT_THEME_TOKENS });
    const r = cs.resolve('text');
    expect(r.kind).toBe('rgb');
  });

  test('custom mapping wins over default', () => {
    const override = { kind: 'rgb' as const, r: 255, g: 0, b: 128 };
    const cs = createColorScheme({
      tokens: DEFAULT_THEME_TOKENS,
      mapping: { 'text': override },
    });
    const r = cs.resolve('text');
    expect(r).toEqual(override);
  });

  test('function-valued mapping receives tokens + emphasis', () => {
    let capturedEmphasis = -1;
    const cs = createColorScheme({
      tokens: DEFAULT_THEME_TOKENS,
      mapping: {
        'text': (_t, emphasis) => {
          capturedEmphasis = emphasis;
          return { kind: 'rgb', r: 1, g: 2, b: 3 };
        },
      },
    });
    cs.resolve('text', 2);
    expect(capturedEmphasis).toBe(2);
  });

  test('unmapped tokens fall back to default resolver', () => {
    const cs = createColorScheme({
      tokens: DEFAULT_THEME_TOKENS,
      mapping: { 'text': { kind: 'default' } }, // only text overridden
    });
    // 'error' is NOT in mapping → falls through to token-mapping.ts
    const r = cs.resolve('error');
    expect(r.kind).toBe('rgb');
  });

  test('brightness honors explicit isDark', () => {
    const dark: ThemeTokens = { ...DEFAULT_THEME_TOKENS, isDark: true };
    expect(new ColorScheme({ tokens: dark }).brightness).toBe('dark');
    const light: ThemeTokens = { ...DEFAULT_THEME_TOKENS, isDark: false };
    expect(new ColorScheme({ tokens: light }).brightness).toBe('light');
  });

  test('getExtension returns null before registration', () => {
    const cs = new ColorScheme({ tokens: DEFAULT_THEME_TOKENS });
    abstract class MyExt {}
    expect(cs.getExtension(MyExt as never)).toBeNull();
  });

  test('registerExtension + getExtension round trip', () => {
    const cs = new ColorScheme({ tokens: DEFAULT_THEME_TOKENS });
    abstract class MyExt {
      abstract copyWith(): MyExt;
      abstract lerp(other: MyExt | null, t: number): MyExt;
    }
    class ConcreteExt extends MyExt {
      value = 42;
      copyWith(): ConcreteExt { return new ConcreteExt(); }
      lerp(): ConcreteExt { return new ConcreteExt(); }
    }
    const instance = new ConcreteExt();
    cs.registerExtension(MyExt as never, instance as never);
    const out = cs.getExtension(MyExt as never);
    expect(out).toBe(instance as never);
  });
});
