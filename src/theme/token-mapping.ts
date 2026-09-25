// Token mapping — maps the Phase 1 semantic ColorToken × ColorEmphasis
// surface onto the existing ThemeTokens preset fields.
//
// The 25 semantic tokens are a superset of what legacy ThemeTokens
// provides directly. Some map 1:1 (text → colors.text), others derive
// from multiple fields (surface.raised = background + 5% lighten), and
// a few fall back to neutral-grey approximations when the preset
// doesn't carry the concept (e.g. pressed.bg uses widget.selected).
//
// Emphasis 0-3 is applied uniformly as a "dim multiplier" — 0 returns
// the canonical value, 3 returns a darker/lighter variant. Concrete
// presets can override via ColorScheme.mapping to carry emphasis tiers
// natively (Zellij's StyleDeclaration { base, emphasis_0..3 } pattern).

import type { ColorToken, ColorEmphasis, PaletteColor } from '../widgets/types.js';
import type { ThemeTokens } from './tokens.js';

/** A custom mapping override. Either a fixed PaletteColor or a
 *  function that derives one from the wrapped ThemeTokens. */
export type TokenMapping = Partial<
  Record<ColorToken, PaletteColor | ((tokens: ThemeTokens, emphasis: ColorEmphasis) => PaletteColor)>
>;

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse `#RRGGBB` → rgb triplet; returns null if not a valid hex. */
function parseHex(s: string): { r: number; g: number; b: number } | null {
  if (typeof s !== 'string' || s.length !== 7 || s[0] !== '#') return null;
  const r = parseInt(s.slice(1, 3), 16);
  const g = parseInt(s.slice(3, 5), 16);
  const b = parseInt(s.slice(5, 7), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b };
}

/** Produce a PaletteColor from any string in ThemeTokens. Hex → rgb,
 *  anything else (chalk ansi code, empty) → default. */
function hexToPalette(hex: string): PaletteColor {
  const parsed = parseHex(hex);
  if (!parsed) return { kind: 'default' };
  return { kind: 'rgb', r: parsed.r, g: parsed.g, b: parsed.b };
}

/** Linear interpolation toward black or white by `t` ∈ [0, 1]. */
function shade(color: PaletteColor, t: number, toward: 'dark' | 'light'): PaletteColor {
  if (color.kind !== 'rgb' || t === 0) return color;
  const tgt = toward === 'dark' ? 0 : 255;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return {
    kind: 'rgb',
    r: clamp(color.r + (tgt - color.r) * t),
    g: clamp(color.g + (tgt - color.g) * t),
    b: clamp(color.b + (tgt - color.b) * t),
  };
}

/** Applies emphasis 0-3 to a base color. 0 = canonical. 1 = slightly
 *  dimmer (darker on light theme, brighter on dark theme). 2-3 =
 *  progressively more. */
function applyEmphasis(
  color: PaletteColor,
  emphasis: ColorEmphasis,
  brightness: 'dark' | 'light',
): PaletteColor {
  if (emphasis === 0) return color;
  // On dark theme, emphasis = brighter (toward white). On light,
  // emphasis = darker (toward black).
  const direction: 'dark' | 'light' = brightness === 'dark' ? 'light' : 'dark';
  const t = emphasis * 0.12; // 0.12, 0.24, 0.36
  return shade(color, t, direction);
}

function isDarkTheme(tokens: ThemeTokens): boolean {
  if (tokens.isDark === true) return true;
  if (tokens.isDark === false) return false;
  // heuristic — dark themes have light text
  const text = parseHex(tokens.colors.text);
  if (!text) return true;
  return (text.r + text.g + text.b) / 3 > 128;
}

// ── Mapping ─────────────────────────────────────────────────────────

/**
 * Canonical resolver — maps a ColorToken + ThemeTokens preset to a
 * PaletteColor. Used by ColorScheme.resolve() when no custom mapping
 * is provided.
 *
 * The switch covers all 25 tokens. Every case returns a concrete
 * PaletteColor so ColorScheme.resolve is never undefined.
 */
export function tokenToPaletteColor(
  token: ColorToken,
  tokens: ThemeTokens,
  emphasis: ColorEmphasis,
): PaletteColor {
  const dark = isDarkTheme(tokens);
  const textPal = hexToPalette(tokens.colors.text);

  let base: PaletteColor;
  switch (token) {
    // ── Surface ──
    case 'surface':
      // Default terminal background. On dark themes that's usually
      // the empty string or shell's bg; represent via 'default'.
      base = { kind: 'default' };
      break;
    case 'surface.raised':
      // One step away from background — use widget.selected as the
      // raised variant (elevated panel).
      base = hexToPalette(tokens.widget.selected);
      if (base.kind === 'default') base = shade(textPal, 0.85, dark ? 'dark' : 'light');
      break;
    case 'surface.overlay':
      // Modal backdrop territory — use pane.dividerInactive as a
      // muted surface that still contrasts with the canvas.
      base = hexToPalette(tokens.pane.dividerInactive);
      break;
    case 'surface.sunken':
      // Recessed area — darker on dark theme, lighter on light.
      base = shade(textPal, 0.92, dark ? 'dark' : 'light');
      break;

    // ── Text ──
    case 'text':          base = hexToPalette(tokens.colors.text); break;
    case 'text.muted':    base = hexToPalette(tokens.colors.muted); break;
    case 'text.disabled': base = hexToPalette(tokens.colors.dim); break;
    case 'text.placeholder':
      base = hexToPalette(tokens.colors.muted);
      base = shade(base, 0.25, dark ? 'dark' : 'light');
      break;
    case 'text.accent':   base = hexToPalette(tokens.colors.accent); break;

    // ── Border ──
    case 'border':         base = hexToPalette(tokens.pane.dividerInactive); break;
    case 'border.focused': base = hexToPalette(tokens.pane.dividerActive); break;
    case 'border.accent':  base = hexToPalette(tokens.widget.accent); break;
    case 'border.disabled':
      base = hexToPalette(tokens.colors.dim);
      break;

    // ── Semantic status ──
    case 'success': base = hexToPalette(tokens.colors.success); break;
    case 'warning': base = hexToPalette(tokens.colors.warning); break;
    case 'error':   base = hexToPalette(tokens.colors.error); break;
    case 'info':    base = hexToPalette(tokens.colors.info); break;

    // ── Diff ──
    case 'diff.add.fg': base = hexToPalette(tokens.colors.success); break;
    case 'diff.add.bg':
      base = shade(hexToPalette(tokens.colors.success), 0.8, dark ? 'dark' : 'light');
      break;
    case 'diff.del.fg': base = hexToPalette(tokens.colors.error); break;
    case 'diff.del.bg':
      base = shade(hexToPalette(tokens.colors.error), 0.8, dark ? 'dark' : 'light');
      break;

    // ── Interactive ──
    case 'highlight.fg': base = hexToPalette(tokens.colors.highlight); break;
    case 'highlight.bg':
      base = shade(hexToPalette(tokens.colors.highlight), 0.75, dark ? 'dark' : 'light');
      break;
    case 'pressed.fg':
      // Canonical "pressed" look: inverted on the accent.
      base = hexToPalette(tokens.colors.text);
      break;
    case 'pressed.bg': base = hexToPalette(tokens.widget.accent); break;

    default: {
      const _exhaustive: never = token;
      void _exhaustive;
      base = { kind: 'default' };
    }
  }

  return applyEmphasis(base, emphasis, dark ? 'dark' : 'light');
}
