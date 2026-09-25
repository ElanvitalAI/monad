// Cursor state — frame-scoped last-writer-wins.
//
// P2.2.a: this module is the named home for the cursor-positioning
// concept. At landing it's pure helpers + a CursorState type so
// chat.ts call-sites have a function name to call instead of raw
// `\x1b[?25l` literals. NO behavior change yet — every existing emit
// stays byte-identical.
//
// P2.2.b will add coordinator integration (setCursor / getCursor +
// frame-end paint). P2.2.c removes the inline writes from chat.ts
// once the coordinator path is proven by dual-write parity checks.
//
// Helpers split by responsibility (move vs. visibility vs. combined)
// because chat.ts emits each separately today and P2.2.a forbids
// merging them — that's P2.2.c's job.

import { ansi } from '../tui.js';

export interface CursorState {
  /** 1-indexed terminal row. */
  row: number;
  /** 1-indexed terminal column. */
  col: number;
  /** When false, paintCursor emits hide instead of move+show. */
  visible: boolean;
}

/** Just the move sequence — no visibility change.
 *  Equivalent to ansi.moveTo(row, col); kept here so call sites
 *  read as cursor-domain code rather than ANSI plumbing. */
export function paintCursorMove(row: number, col: number): string {
  return ansi.moveTo(row, col);
}

/** Just the visibility toggle. Equivalent to ansi.showCursor /
 *  ansi.hideCursor. */
export function paintCursorVisibility(visible: boolean): string {
  return visible ? ansi.showCursor : ansi.hideCursor;
}

/** Combined move + show, or hide. Used by P2.2.b's coordinator
 *  paint pipeline; chat.ts at P2.2.a still emits move + visibility
 *  separately to preserve byte-identity with the pre-refactor
 *  textInput paint loop. */
export function paintCursor(state: CursorState | null): string {
  if (!state || !state.visible) return paintCursorVisibility(false);
  return paintCursorMove(state.row, state.col) + paintCursorVisibility(true);
}
