// Adaptive color profile — backbone of `src/expression/`.
//
// Every renderer in the expression layer consumes `AdaptiveColor` (or
// a raw hex string) and a `ColorProfile`, then resolves to whatever
// format the active terminal supports. This keeps theme palettes
// authoritative in one shape while degrading gracefully on legacy
// terminals (SSH sessions, IDE pseudo-terminals, mono fallbacks).
//
// Profile detection rides on top of chalk's `supportsColor` so we
// don't reinvent capability sniffing — chalk already honours
// FORCE_COLOR, NO_COLOR, COLORTERM, term type, isTTY, etc.

import { supportsColor } from 'chalk';
import { debug } from '../debug/log.js';

export interface AdaptiveColor {
  /** Hex (`#rrggbb` / `#rgb`) used when the terminal supports 24-bit. */
  truecolor: string;
  /** xterm-256 palette index, formatted as a string ("0".."255"). */
  ansi256: string;
  /** Basic 16-color palette index, formatted as a string ("0".."15"). */
  ansi16: string;
}

export type ColorProfile = 'mono' | 'ansi16' | 'ansi256' | 'truecolor';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Detect the richest profile this terminal supports.
 *
 *  Honours `chalk.supportsColor` (`.has16m`, `.has256`, `.hasBasic`).
 *  Returns 'mono' when chalk reports no color support — that's
 *  pipe / NO_COLOR / non-TTY territory. */
export function detectProfile(): ColorProfile {
  const sc = supportsColor;
  let profile: ColorProfile;
  if (!sc) profile = 'mono';
  else if (sc.has16m) profile = 'truecolor';
  else if (sc.has256) profile = 'ansi256';
  else if (sc.hasBasic) profile = 'ansi16';
  else profile = 'mono';
  if (debug.enabled) {
    debug.log('expression.color', 'detect-profile', {
      profile,
      has16m: !!sc && sc.has16m,
      has256: !!sc && sc.has256,
      hasBasic: !!sc && sc.hasBasic,
    });
  }
  return profile;
}

/** Resolve an `AdaptiveColor` (or raw hex) to a printable form for the
 *  given profile. The return shape is profile-specific so callers can
 *  feed it into the right chalk method:
 *
 *  - 'truecolor' → hex string ("#a093e8") for `chalk.hex(...)`.
 *  - 'ansi256'   → numeric string ("141") for `chalk.ansi256(...)`.
 *  - 'ansi16'    → numeric string ("5")   for `chalk.ansi(...)`.
 *  - 'mono'      → empty string (caller renders without color).
 *
 *  When `c` is a raw hex string, we materialize a transient
 *  AdaptiveColor on the fly so legacy theme tokens still work. */
export function resolveColor(c: AdaptiveColor | string, profile: ColorProfile): string {
  if (profile === 'mono') return '';
  const adapted = typeof c === 'string' ? adaptive(c) : c;
  switch (profile) {
    case 'truecolor':
      return adapted.truecolor;
    case 'ansi256':
      return adapted.ansi256;
    case 'ansi16':
      return adapted.ansi16;
  }
}

/** Map a flat hex-palette into an `AdaptiveColor` palette. Theme
 *  presets keep their authoritative hex literals and call this helper
 *  to materialize the AdaptiveColor sibling — keys + truecolor stay
 *  in lock-step by construction so theme tests just need to spot-check
 *  one or two indices.
 *
 *  PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — optional `overrides` lets a
 *  theme pin specific ANSI-16 / ANSI-256 indices for brand colors
 *  whose automatic nearest-RGB mapping picks a fallback that doesn't
 *  read as the intended hue (lavenders that round to bright magenta,
 *  pastel teal that rounds to bright cyan, etc.). Truecolor stays
 *  derived from the source hex so the override only kicks in on
 *  legacy terminals — the truecolor preview matches the design hex
 *  exactly, ANSI-256 is the rich-256 fallback, ANSI-16 is the legacy
 *  fallback. Each override key is a partial AdaptiveColor: theme
 *  authors pin only the channels they care about (typically just
 *  `ansi16`) and let the rest stay auto-derived. */
export function adaptivePalette<T extends Record<string, string>>(
  hexes: T,
  overrides?: { [K in keyof T]?: Partial<AdaptiveColor> },
): { [K in keyof T]: AdaptiveColor } {
  const out = {} as { [K in keyof T]: AdaptiveColor };
  for (const k in hexes) {
    const auto = adaptive(hexes[k]);
    const ov = overrides?.[k];
    out[k] = ov ? { ...auto, ...ov } : auto;
  }
  return out;
}

/** Build an `AdaptiveColor` from a hex by computing the nearest
 *  xterm-256 + ANSI-16 indices. Useful for theme presets that only
 *  specify truecolor and want the fallbacks for free. */
export function adaptive(hex: string): AdaptiveColor {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return {
    truecolor: HEX_RE.test(hex) ? hex : '#000000',
    ansi256: String(rgbToAnsi256(rgb.r, rgb.g, rgb.b)),
    ansi16: String(rgbToAnsi16(rgb.r, rgb.g, rgb.b)),
  };
}

/** Wrap text with the resolved color via chalk. Off-profile + mono
 *  return the text untouched so renderers don't have to branch. */
export function paint(c: AdaptiveColor | string, profile: ColorProfile): (text: string) => string {
  const value = resolveColor(c, profile);
  if (!value) return (t) => t;
  if (profile === 'truecolor') {
    const rgb = hexToRgb(value);
    if (!rgb) return (t) => t;
    return (text: string) => `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
  }
  if (profile === 'ansi256') {
    return (text: string) => `\x1b[38;5;${value}m${text}\x1b[39m`;
  }
  if (profile === 'ansi16') {
    return wrapAnsi16Fg(Number(value));
  }
  return (t) => t;
}

/** Same idea as `paint` but for the background channel. Emits raw SGR
 *  so output is profile-deterministic regardless of `supportsColor`. */
export function paintBg(c: AdaptiveColor | string, profile: ColorProfile): (text: string) => string {
  const value = resolveColor(c, profile);
  if (!value) return (t) => t;
  if (profile === 'truecolor') {
    const rgb = hexToRgb(value);
    if (!rgb) return (t) => t;
    return (text: string) => `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[49m`;
  }
  if (profile === 'ansi256') {
    return (text: string) => `\x1b[48;5;${value}m${text}\x1b[49m`;
  }
  if (profile === 'ansi16') {
    return wrapAnsi16Bg(Number(value));
  }
  return (t) => t;
}

/** Wrap text in raw ANSI-16 SGR for the foreground. chalk only exposes
 *  hex/ansi256, so we craft the escape ourselves: 30..37 for indices
 *  0..7, 90..97 for the bright family 8..15. */
export function wrapAnsi16Fg(n: number): (text: string) => string {
  const code = n < 8 ? 30 + n : 90 + (n - 8);
  return (text: string) => `\x1b[${code}m${text}\x1b[39m`;
}

/** ANSI-16 background SGR helper — 40..47 for 0..7, 100..107 for 8..15. */
export function wrapAnsi16Bg(n: number): (text: string) => string {
  const code = n < 8 ? 40 + n : 100 + (n - 8);
  return (text: string) => `\x1b[${code}m${text}\x1b[49m`;
}

// ── Internal helpers ────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let body = hex.trim().slice(1);
  if (body.length === 3) body = body.split('').map((ch) => ch + ch).join('');
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** xterm-256 nearest. Cube spans 16..231 with five canonical breakpoints
 *  per channel (0, 95, 135, 175, 215, 255); grayscale ramp 232..255
 *  handles equal-channel inputs more accurately. */
export function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return (
    16 +
    36 * channelToCubeIndex(r) +
    6 * channelToCubeIndex(g) +
    channelToCubeIndex(b)
  );
}

const CUBE_BREAKPOINTS = [0, 95, 135, 175, 215, 255];

function channelToCubeIndex(v: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < CUBE_BREAKPOINTS.length; i++) {
    const d = Math.abs(CUBE_BREAKPOINTS[i]! - v);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** ANSI-16 nearest using Euclidean RGB distance against the standard
 *  xterm/Linux-console palette. Good-enough for fallbacks; presets
 *  that care about specific 16-color hits can override `ansi16`
 *  manually in their AdaptiveColor entries. */
export function rgbToAnsi16(r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ANSI16_PALETTE.length; i++) {
    const p = ANSI16_PALETTE[i]!;
    const dr = p.r - r;
    const dg = p.g - g;
    const db = p.b - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// Standard xterm-style 16-color palette used by chalk.ansi(0..15).
const ANSI16_PALETTE: ReadonlyArray<{ r: number; g: number; b: number }> = [
  { r: 0x00, g: 0x00, b: 0x00 }, //  0 black
  { r: 0x80, g: 0x00, b: 0x00 }, //  1 red
  { r: 0x00, g: 0x80, b: 0x00 }, //  2 green
  { r: 0x80, g: 0x80, b: 0x00 }, //  3 yellow
  { r: 0x00, g: 0x00, b: 0x80 }, //  4 blue
  { r: 0x80, g: 0x00, b: 0x80 }, //  5 magenta
  { r: 0x00, g: 0x80, b: 0x80 }, //  6 cyan
  { r: 0xc0, g: 0xc0, b: 0xc0 }, //  7 white (dim)
  { r: 0x80, g: 0x80, b: 0x80 }, //  8 bright black (gray)
  { r: 0xff, g: 0x00, b: 0x00 }, //  9 bright red
  { r: 0x00, g: 0xff, b: 0x00 }, // 10 bright green
  { r: 0xff, g: 0xff, b: 0x00 }, // 11 bright yellow
  { r: 0x00, g: 0x00, b: 0xff }, // 12 bright blue
  { r: 0xff, g: 0x00, b: 0xff }, // 13 bright magenta
  { r: 0x00, g: 0xff, b: 0xff }, // 14 bright cyan
  { r: 0xff, g: 0xff, b: 0xff }, // 15 bright white
];
