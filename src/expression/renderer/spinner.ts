// Spinner renderer — pure fn `renderSpinner(spec, profile, opts) → string`.
//
// Pure means: given the same `(spec, profile, frame)` the output is
// identical. The host owns the timer / event loop and advances the
// `frame` counter between renders. Testing is just calling the fn
// with frames 0..N and snapshotting.
//
// Five styles:
//   - dots   : Unicode braille (10 frames) — high-density, smooth
//   - line   : ASCII line (4 frames) — works everywhere
//   - arc    : Unicode arc (6 frames) — good on emoji-rich terminals
//   - pulse  : Block fill (8 frames) — eye-catching, large
//   - bounce : Dot bouncing (8 frames) — playful

import type { SpinnerSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  paint,
} from '../color.js';

export interface RenderSpinnerOpts {
  /** Theme accent fallback. */
  themeAccent?: AdaptiveColor | string;
  /** Override the spec.frame when the host wants to thread its own counter. */
  frame?: number;
}

const FRAMES: Record<NonNullable<SpinnerSpec['style']>, ReadonlyArray<string>> = {
  dots: [
    '⠋',
    '⠙',
    '⠹',
    '⠸',
    '⠼',
    '⠴',
    '⠦',
    '⠧',
    '⠇',
    '⠏',
  ],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  pulse: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
};

const DEFAULT_ACCENT = '#89b4fa';

/** Render a `SpinnerSpec` to an ANSI string for one frame. */
export function renderSpinner(
  spec: SpinnerSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderSpinnerOpts = {},
): string {
  const style = spec.style ?? 'dots';
  const frames = FRAMES[style] ?? FRAMES.dots;
  const idx = Math.abs(opts.frame ?? spec.frame ?? 0) % frames.length;
  const glyph = frames[idx]!;
  const colored = paint(opts.themeAccent ?? DEFAULT_ACCENT, profile)(glyph);
  return spec.label ? `${colored} ${spec.label}` : colored;
}

/** Number of frames for a given style. Useful for hosts that loop. */
export function frameCount(style: SpinnerSpec['style']): number {
  return FRAMES[style ?? 'dots'].length;
}
