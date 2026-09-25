// ── Presentation P4a · ColorToken → hex resolver ──
//
// Maps the semantic `ColorToken` union (widget-types.ts) onto hex
// colours pulled from `ThemeTokens`. Callers feed a token name (or
// raw hex pass-through) and receive a hex string they can hand to
// chalk/ANSI composers.
//
// Contract:
//   - null input → null output
//   - String starting with `#` → returned verbatim (raw override)
//   - Recognised ColorToken → hex via `themeColor(theme, ...)`
//   - Anything else → null (silent · LLM-resilient behaviour)
//
// Scope:
//   - No touching of the theme file · read-only consume only.
//   - No ANSI here — colour → hex only. ANSI composition lives in
//     `text-style-to-ansi.ts` which also consumes these hex strings.

import type { ColorToken } from '../../widgets/types.js';
import { themeColor, type ThemeColorTokens, type ThemeTokens } from '../../theme/tokens.js';

/** Fallback-safe mapping. A ColorToken that doesn't line up with
 *  `ThemeColorTokens` (e.g. `surface.raised` — no such flat field)
 *  falls back to the closest available base token. Keeping the
 *  fallback close to the declared palette avoids wild colour jumps
 *  when a preset doesn't ship the token explicitly. */
const TOKEN_TO_THEME: Record<string, keyof ThemeColorTokens> = {
  // Surfaces · map to text/muted/dim triad (terminal has no real bg layer system)
  surface: 'text',
  'surface.raised': 'text',
  'surface.overlay': 'highlight',
  'surface.sunken': 'muted',

  // Text tokens
  text: 'text',
  'text.muted': 'muted',
  'text.disabled': 'dim',
  'text.placeholder': 'dim',
  'text.accent': 'accent',

  // Borders — terminal themes expose them via modal/pane groups but
  // for the semantic resolver we flatten into the colour token family.
  border: 'muted',
  'border.focused': 'accent',
  'border.accent': 'accent',
  'border.disabled': 'dim',

  // Semantic status — preserved across theme switches (DD-IDX-15).
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',

  // Diff decoration — green/red families
  'diff.add.fg': 'success',
  'diff.add.bg': 'success',
  'diff.del.fg': 'error',
  'diff.del.bg': 'error',

  // Interactive states
  'highlight.fg': 'highlight',
  'highlight.bg': 'highlight',
  'pressed.fg': 'accent',
  'pressed.bg': 'accent',
};

/** Resolve a semantic `ColorToken` (or raw hex override) into a hex
 *  string. Returns `null` when nothing to paint — callers can then
 *  skip colour application entirely rather than falling back to a
 *  terminal default (which may already be the user's bg / fg).
 *
 *  Raw hex pass-through accepts strings that start with `#` · 3-, 4-,
 *  6-, 8-digit forms are all honoured (chalk handles the rest). Non-
 *  hex strings that don't match a known token return null. */
export function resolveColorToken(
  token: ColorToken | string | null | undefined,
  theme: ThemeTokens,
): string | null {
  if (token == null) return null;
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) return trimmed;
  const themeKey = TOKEN_TO_THEME[trimmed];
  if (!themeKey) return null;
  return themeColor(theme, themeKey);
}

/** Convenience for callers that always want a value — falls back to
 *  `theme.colors.text` when the token would otherwise resolve to null.
 *  Use when you need a guaranteed-printable colour (e.g. a default
 *  border stroke). */
export function resolveColorOrText(
  token: ColorToken | string | null | undefined,
  theme: ThemeTokens,
): string {
  const hex = resolveColorToken(token, theme);
  return hex ?? theme.colors.text;
}
