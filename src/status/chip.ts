// ── status-chip (SRF-3) ──
//
// One source of truth for "status chip" rendering across:
//   • /shell list              (shell-runner handles)
//   • /term list -> shell-runner section
//   • /term list top           (terminal-session states)
//
// Previously each call site hand-rolled its own color + glyph,
// drifting into three flavors:
//   shell-runner:  ▶ run   / ⏸ bg   / ✓ done  / ✗ killed
//   term(shell):   run     / bg     / done    / killed
//   term(session): fg      / bg     / exited
//
// Users hopping between `/shell` and `/term` had to re-learn chips.
// renderHandleStatusChip() maps every known status onto a single
// glyph + color palette, chosen to read at a glance:
//
//   running / foreground       ▶ run
//   backgrounded / background  ⏸ bg
//   completed / exited         ✓ done
//   killed                     ✗ killed
//
// Width is fixed (7 cols incl. glyph + space) so columns line up
// across sections. Width is the *visible* width — callers don't need
// to pad. The returned string already carries ANSI color.

import { C } from '../tui.js';

export type HandleStatus =
  | 'running' | 'backgrounded' | 'completed' | 'killed'    // shell-runner
  | 'foreground' | 'background' | 'exited';                // terminal-session

export interface ChipOpts {
  /** When true, return an ascii-only variant (no glyph) for log
   *  outputs that don't want unicode. Default false. */
  ascii?: boolean;
}

/** Render a fixed-width, colorized status chip. Width = 7 visible
 *  columns so chip + ' ' + id aligns across rows. */
export function renderHandleStatusChip(status: HandleStatus, opts: ChipOpts = {}): string {
  const { glyph, word, color } = chipSpec(status, opts.ascii ?? false);
  const body = `${glyph} ${word}`;
  // Pad to 7 visible cols. 'run' = 3 + glyph(1) + space(1) = 5 → +2.
  // 'done'= 4 + glyph(1) + space(1) = 6 → +1.
  // 'killed'= 6 + glyph(1) + space(1) = 8 → -1 (let it overflow).
  // Fixed-width target keeps the common cases aligned without
  // truncating 'killed', which would lose information.
  const target = 7;
  const vis = body.length;    // glyph codepoints are 1-col here
  const pad = vis < target ? ' '.repeat(target - vis) : '';
  return color(body + pad);
}

interface ChipSpec {
  glyph: string;
  word: string;
  color: (s: string) => string;
}

function chipSpec(status: HandleStatus, ascii: boolean): ChipSpec {
  switch (status) {
    case 'running':
    case 'foreground':
      return { glyph: ascii ? '>' : '▶', word: 'run', color: C.success };
    case 'backgrounded':
    case 'background':
      return { glyph: ascii ? '~' : '⏸', word: 'bg', color: C.warning };
    case 'completed':
    case 'exited':
      return { glyph: ascii ? 'v' : '✓', word: 'done', color: C.muted };
    case 'killed':
      return { glyph: ascii ? 'x' : '✗', word: 'killed', color: C.error };
  }
}
