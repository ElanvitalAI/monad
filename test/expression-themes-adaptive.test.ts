import { describe, expect, test } from 'bun:test';
import {
  ADAPTIVE_PALETTES_BY_THEME,
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  LATTE_ADAPTIVE_PALETTE,
  MOCHA_ADAPTIVE_PALETTE,
  MOCHA_PASTEL_ACCENT,
  MOCHA_PASTEL_ADAPTIVE_PALETTE,
  ELANOUS_ADAPTIVE_PALETTE,
  ELANOUS_PASTEL_DEFAULT,
  NORD_ADAPTIVE_PALETTE,
  NORD_LIGHT,
  ROSE_PINE_ADAPTIVE_PALETTE,
  ROSE_PINE_DAWN,
  getThemeAdaptivePalette,
  THEME_REGISTRY,
} from '../src/themes/index.js';
import {
  adaptive,
  paint,
  type ColorProfile,
} from '../src/expression/color.js';

describe('expression-1 · 7 theme adaptive backbone', () => {
  test('every theme in THEME_REGISTRY has a registered adaptive palette', () => {
    for (const t of THEME_REGISTRY) {
      const p = getThemeAdaptivePalette(t.name);
      expect(p).not.toBeNull();
      expect(Object.keys(p!).length).toBeGreaterThan(0);
    }
  });

  test('mocha adaptive palette truecolor entries match canonical hexes', () => {
    expect(MOCHA_ADAPTIVE_PALETTE.blue.truecolor).toBe('#89b4fa');
    expect(MOCHA_ADAPTIVE_PALETTE.green.truecolor).toBe('#a6e3a1');
    expect(MOCHA_ADAPTIVE_PALETTE.red.truecolor).toBe('#f38ba8');
    // ANSI 256 lookup falls in the cube range 16..231 or grayscale 232..255
    const idx = Number(MOCHA_ADAPTIVE_PALETTE.blue.ansi256);
    expect(idx).toBeGreaterThanOrEqual(16);
    expect(idx).toBeLessThanOrEqual(255);
  });

  test('all six theme palettes are distinct from each other', () => {
    const palettes = [
      MOCHA_ADAPTIVE_PALETTE,
      LATTE_ADAPTIVE_PALETTE,
      ROSE_PINE_ADAPTIVE_PALETTE,
      NORD_ADAPTIVE_PALETTE,
      ELANOUS_ADAPTIVE_PALETTE,
      MOCHA_PASTEL_ADAPTIVE_PALETTE,
    ];
    // No two palettes should share the exact same key set + values
    for (let i = 0; i < palettes.length; i++) {
      for (let j = i + 1; j < palettes.length; j++) {
        const a = JSON.stringify(palettes[i]);
        const b = JSON.stringify(palettes[j]);
        expect(a).not.toBe(b);
      }
    }
  });

  test('flat ThemeTokens.colors hex values agree with adaptive truecolor for accent', () => {
    // Each theme exposes accent in both shapes — they should be the
    // same hex literal (the adaptive palette is derived from the same
    // source-of-truth palette object).
    const cases: Array<[string, string]> = [
      [CATPPUCCIN_MOCHA.colors.accent, MOCHA_ADAPTIVE_PALETTE.blue.truecolor],
      [CATPPUCCIN_LATTE.colors.accent, LATTE_ADAPTIVE_PALETTE.blue.truecolor],
      [ROSE_PINE_DAWN.colors.accent, ROSE_PINE_ADAPTIVE_PALETTE.rose.truecolor],
      [NORD_LIGHT.colors.accent, NORD_ADAPTIVE_PALETTE.frost3.truecolor],
      [ELANOUS_PASTEL_DEFAULT.colors.accent, ELANOUS_ADAPTIVE_PALETTE.lavender.truecolor],
      [MOCHA_PASTEL_ACCENT.colors.accent, MOCHA_PASTEL_ADAPTIVE_PALETTE.lavender.truecolor],
    ];
    for (const [flat, adaptiveTrue] of cases) {
      expect(flat).toBe(adaptiveTrue);
    }
  });

  test('every adaptive entry renders in all 4 profiles without throwing', () => {
    const profiles: ColorProfile[] = ['truecolor', 'ansi256', 'ansi16', 'mono'];
    for (const palette of ADAPTIVE_PALETTES_BY_THEME.values()) {
      for (const c of Object.values(palette)) {
        for (const p of profiles) {
          const out = paint(c, p)('x');
          // Mono returns the bare text; otherwise an SGR-wrapped string.
          if (p === 'mono') expect(out).toBe('x');
          else expect(out).toContain('x');
        }
      }
    }
  });

  test('adaptive() round-trip from any palette hex preserves truecolor', () => {
    for (const palette of ADAPTIVE_PALETTES_BY_THEME.values()) {
      for (const c of Object.values(palette)) {
        const round = adaptive(c.truecolor);
        expect(round.truecolor).toBe(c.truecolor);
      }
    }
  });

  // PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — brand color manual ANSI-16
  // overrides applied where auto-nearest collapses two distinct hues
  // into the same legacy index. Truecolor stays derived from the
  // canonical hex; only the ANSI-16 fallback is pinned.
  describe('brand ANSI-16 overrides (Δ19 · F7)', () => {
    test('elanous-pastel: lavender → magenta (5) instead of bright magenta', () => {
      expect(ELANOUS_ADAPTIVE_PALETTE.lavender.ansi16).toBe('5');
      // Truecolor + ANSI-256 unchanged from auto-derived.
      expect(ELANOUS_ADAPTIVE_PALETTE.lavender.truecolor).toBe('#a093e8');
    });

    test('catppuccin-mocha: lavender → magenta (5) so lavender/mauve stay distinct', () => {
      expect(MOCHA_ADAPTIVE_PALETTE.lavender.ansi16).toBe('5');
      expect(MOCHA_ADAPTIVE_PALETTE.lavender.truecolor).toBe('#b4befe');
      // Mauve stays auto-derived; lavender override should keep them
      // visually distinct on legacy 16-color terminals.
      expect(MOCHA_ADAPTIVE_PALETTE.mauve.ansi16).not.toBe(MOCHA_ADAPTIVE_PALETTE.lavender.ansi16);
    });

    test('rose-pine-dawn: love → red (1) so rose/love read as distinct warmth', () => {
      expect(ROSE_PINE_ADAPTIVE_PALETTE.love.ansi16).toBe('1');
      expect(ROSE_PINE_ADAPTIVE_PALETTE.love.truecolor).toBe('#b4637a');
      // rose stays auto-derived; ANSI-16 indices should differ.
      expect(ROSE_PINE_ADAPTIVE_PALETTE.rose.ansi16).not.toBe(ROSE_PINE_ADAPTIVE_PALETTE.love.ansi16);
    });

    test('overrides do not affect themes without brand pins', () => {
      // Themes that didn't opt in keep purely auto-derived ANSI-16
      // values — sanity check that the overrides hook is opt-in.
      for (const c of Object.values(LATTE_ADAPTIVE_PALETTE)) {
        // Auto-derived values are always in [0, 15].
        const idx = Number(c.ansi16);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(15);
      }
    });
  });
});
