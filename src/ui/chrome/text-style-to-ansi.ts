// ── Presentation P4a · TextStyle → ANSI composer ──
//
// Converts a `TextStyle` (P2 attribute class) into a pair of ANSI SGR
// sequences the caller wraps around rendered text:
//
//   const { open, close } = composeAnsi(textStyle, theme);
//   output = `${open}${payload}${close}`;
//
// Tri-state rule: a field with value `null` contributes nothing (the
// style is "not specified" — inherit from whatever's around it).
// Explicit `false` emits the negating SGR (e.g. `22` for "no bold")
// so a child override can really turn off a parent's bold. This
// mirrors Flutter `TextStyle` merge semantics verified in P2.
//
// Zellij 4-tier + extended emphasis support:
//   - bold · italic · underline · dim (4-tier classic)
//   - reverse · strikethrough · doubleUnderline · curlyUnderline · overline
//
// The dashed/curly underline SGRs are in the extended (21 / 4:3)
// family — not universally supported but emitted whenever the
// TextStyle asks, so capable terminals get the richer rendering.

import type { TextStyle } from '../attributes/text-style.js';
import { resolveColorToken } from './resolve-color.js';
import type { ThemeTokens } from '../../theme/tokens.js';

export interface AnsiPair {
  /** Opening SGR escape · emit before the payload. Empty string when
   *  no attributes / colour were requested. */
  readonly open: string;
  /** Closing SGR escape · emit after the payload. Always balanced
   *  against `open` · empty string when `open` is empty. */
  readonly close: string;
}

const EMPTY: AnsiPair = Object.freeze({ open: '', close: '' });

const SGR_RESET = '\u001b[0m';

function sgr(...codes: readonly (string | number)[]): string {
  return `\u001b[${codes.join(';')}m`;
}

/** Convert a hex string (`#rgb` / `#rrggbb` / `#rrggbbaa`) to the
 *  `38;2;r;g;b` SGR subparameter payload. Returns `null` when the
 *  string can't be parsed so callers fall through to "no colour"
 *  rather than emitting a malformed sequence. */
function hexToTrueColourForeground(hex: string): string | null {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  let r: number, g: number, b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0]! + cleaned[0]!, 16);
    g = parseInt(cleaned[1]! + cleaned[1]!, 16);
    b = parseInt(cleaned[2]! + cleaned[2]!, 16);
  } else if (cleaned.length >= 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return null;
  }
  if ([r, g, b].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return `38;2;${r};${g};${b}`;
}

/** Compose open/close ANSI sequences for a `TextStyle`. Pass the
 *  active theme so `color` tokens resolve via `resolveColorToken`.
 *  When nothing is specified, returns `{open: '', close: ''}` —
 *  callers can skip the concatenation entirely. */
export function composeAnsi(style: TextStyle | null | undefined, theme: ThemeTokens): AnsiPair {
  if (!style) return EMPTY;

  const openCodes: (string | number)[] = [];
  const closeCodes: (string | number)[] = [];

  // Color — emit raw TrueColour SGR (38;2;r;g;b) so the sequence is
  // deterministic regardless of `chalk.level` (bun test pipes stdout,
  // which flips chalk to level 0 by default). Terminals without
  // TrueColour support usually downsample 38;2 to their best guess —
  // matches the behaviour we want for TUI consumers.
  const hex = resolveColorToken(style.color, theme);
  if (hex) {
    const colourCode = hexToTrueColourForeground(hex);
    if (colourCode) {
      openCodes.push(colourCode);
      closeCodes.unshift(39);   // default foreground
    }
  }

  // Bold — SGR 1 · off = 22 (shared with faint/dim)
  if (style.bold === true) {
    openCodes.push(1);
    closeCodes.unshift(22);
  } else if (style.bold === false) {
    // explicit off · emit 22 up-front to neutralise an ambient bold
    openCodes.push(22);
  }

  // Dim — SGR 2 · off = 22
  if (style.dim === true) {
    openCodes.push(2);
    closeCodes.unshift(22);
  }

  // Italic — SGR 3 · off = 23
  if (style.italic === true) {
    openCodes.push(3);
    closeCodes.unshift(23);
  } else if (style.italic === false) {
    openCodes.push(23);
  }

  // Underline family — 4 (single) · 21 (double) · 4:3 (curly) · 4:4 (dashed) · 55 removes overline
  // Underline off = 24 covers single/double/curly/dashed.
  if (style.doubleUnderline === true) {
    openCodes.push(21);
    closeCodes.unshift(24);
  } else if (style.curlyUnderline === true) {
    // 4:3 is the CSI subparameter form most widely supported
    // (kitty / wezterm / VTE ≥ 0.52). Fallback behaviour on older
    // terminals is "plain underline" · still sensible.
    openCodes.push('4:3');
    closeCodes.unshift(24);
  } else if (style.underline === true) {
    openCodes.push(4);
    closeCodes.unshift(24);
  } else if (style.underline === false) {
    openCodes.push(24);
  }

  // Overline — SGR 53 · off = 55 · Zellij emphasis_3 ish
  if (style.overline === true) {
    openCodes.push(53);
    closeCodes.unshift(55);
  }

  // Reverse — SGR 7 · off = 27
  if (style.reverse === true) {
    openCodes.push(7);
    closeCodes.unshift(27);
  }

  // Strikethrough — SGR 9 · off = 29
  if (style.strikethrough === true) {
    openCodes.push(9);
    closeCodes.unshift(29);
  }

  if (openCodes.length === 0) return EMPTY;

  return {
    open: sgr(...openCodes),
    close: closeCodes.length === 0 ? SGR_RESET : sgr(...closeCodes),
  };
}

/** Wrap `text` in the TextStyle's ANSI sequence · convenience. No-ops
 *  when the style produces an empty pair. */
export function applyAnsi(text: string, style: TextStyle | null | undefined, theme: ThemeTokens): string {
  const { open, close } = composeAnsi(style, theme);
  if (!open) return text;
  return `${open}${text}${close}`;
}
