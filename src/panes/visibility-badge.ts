// ── VW-term Bundle B-7-γ · visibility pill glyph mapping ──
//
// Pure function: PaneVisibility → rendered badge string (or null when
// the pane is in the default `visible` state). Consumed by
// VirtualWindow.paintPane when a visibilityResolver is attached to
// the window spec.
//
// Glyph choice rationale:
//   - `·X·` form: a single letter surrounded by middle-dots keeps
//     the badge visually separable from the adjacent pane-id label
//     (`[bec704]`). Three cells total — fits next to the label
//     without dominating it.
//   - Single letter mnemonic: H for hidden, D for dormant, ᴸ
//     (superscript L) for llm-only so the three-letter shape stays
//     identical in width while the character signals the state.
//   - C.warning tint: the pane is NOT in its default state so the
//     user's eye should catch it; warning yellow is the existing
//     palette's "needs attention" tone (chatLines warning,
//     `attention` notifications).
//
// PLAN: 내부 문서 `PLAN-vw-term-bundle-b7-gamma-visibility-pill`

import { C } from '../tui.js';
import type { PaneVisibility } from './visual-state.js';

/** Raw glyphs without SGR, exported so tests can assert the visible
 *  payload without matching ANSI escape bytes. */
export const BADGE_GLYPHS: Readonly<Record<PaneVisibility, string | null>> = {
  visible: null,
  hidden: '·H·',
  dormant: '·D·',
  'llm-only': '·ᴸ·',
};

/** Return the fully-styled badge string for a given visibility, or
 *  null when the visibility is the default (no badge painted). */
export function composeVisibilityBadge(visibility: PaneVisibility): string | null {
  const raw = BADGE_GLYPHS[visibility];
  if (raw === null) return null;
  return C.warning(raw);
}

/** Raw-width helper. Each badge is exactly 3 visible cells (two
 *  middle-dots + one letter · all BMP single-width). Returns 0 for
 *  the default `visible` state. Tests + paintPane use this to
 *  compute the total label width for the row-clear step so the
 *  badge never sits on top of pre-existing PTY output. */
export function badgeVisibleWidth(visibility: PaneVisibility): number {
  return BADGE_GLYPHS[visibility] === null ? 0 : 3;
}
