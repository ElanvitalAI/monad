// Wizard progress indicator — small dot string for the step header.
//
// Phase 3 (PR γ) of setup-tui-overhaul. The wizard's `Step N / total`
// header is augmented with a glanceable "●●●○○" dot row so users see
// at-a-glance how many steps remain. Pure function — caller composes
// it into the renderer's output.
//
// We deliberately use `●` (BLACK CIRCLE U+25CF) + `○` (WHITE CIRCLE
// U+25CB) for visibility across most fonts. Hosts that detect mono
// terminals can swap to `[==>--]` style via `progressDotsFallback`.

import { Style, type ColorProfile } from '../expression/index.js';

const DOT_FILLED = '●';
const DOT_EMPTY = '○';

export interface ProgressDotsOpts {
  /** Color profile — controls whether ANSI SGR runs. Pass `'mono'`
   *  to suppress color (no escape codes emitted). */
  profile?: ColorProfile;
  /** Hex accent for filled dots. Default `#89b4fa`. */
  accent?: string;
  /** Hex muted for empty dots. Default `#7f849c`. */
  muted?: string;
}

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';

/** Build a dot string like `●●●○○` for `current=3, total=5`. Filled
 *  dots get the accent color; empty dots get muted. Both are rendered
 *  via `Style` so the caller's profile choice (truecolor / 256 / 16 /
 *  mono) drives output. */
export function progressDots(
  current: number,
  total: number,
  opts: ProgressDotsOpts = {},
): string {
  const filled = clamp(current, 0, total);
  const empty = total - filled;
  const profile = opts.profile ?? 'truecolor';
  const accentStyle = Style.empty().foreground(opts.accent ?? DEFAULT_ACCENT);
  const mutedStyle = Style.empty().foreground(opts.muted ?? DEFAULT_MUTED);
  return (
    accentStyle.render(DOT_FILLED.repeat(filled), profile)
    + mutedStyle.render(DOT_EMPTY.repeat(empty), profile)
  );
}

/** Plain ASCII fallback for hosts that strip Unicode (e.g., `LANG=C`).
 *  Returns `[##---]` style. */
export function progressDotsFallback(current: number, total: number): string {
  const filled = clamp(current, 0, total);
  return '[' + '#'.repeat(filled) + '-'.repeat(total - filled) + ']';
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
