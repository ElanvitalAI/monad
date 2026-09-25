// Progress bar renderer — pure fn `renderProgress(spec, profile, opts) → string`.
//
// Three bar styles:
//   - solid    : single accent colour over `█` cells
//   - gradient : linear blend from `from` to `to` across filled cells
//   - dotted   : ascii-safe `═` filled / `─` empty (works on legacy
//                terminals + screen readers)
//
// The bar emits SGR escapes per cell so the gradient is visible
// regardless of how the host frames it. The renderer stays pure —
// the host is responsible for clamping width to terminal columns,
// padding the line, and persisting between frames.

import type { ProgressSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  hexToRgb,
  paint,
} from '../color.js';

export interface RenderProgressOpts {
  /** Override the default 40-cell width when the spec doesn't say. */
  defaultWidth?: number;
  /** Theme accent fallback used when the spec omits `from` / `to`. */
  themeAccent?: AdaptiveColor | string;
  /** Theme highlight fallback for gradient `to`. */
  themeHighlight?: AdaptiveColor | string;
}

const DEFAULT_FROM_HEX = '#89b4fa'; // catppuccin mocha blue
const DEFAULT_TO_HEX = '#f5c2e7';   // catppuccin mocha pink

/** Render a `ProgressSpec` to an ANSI string. */
export function renderProgress(
  spec: ProgressSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderProgressOpts = {},
): string {
  const width = Math.max(1, spec.width ?? opts.defaultWidth ?? 40);
  const value = clamp01(spec.value);
  const filled = Math.round(value * width);
  const empty = width - filled;
  const style = spec.bar ?? 'gradient';

  const fillChar = style === 'dotted' ? '═' : '█';
  const emptyChar = style === 'dotted' ? '─' : '·';

  const fromColor = spec.from ?? opts.themeAccent ?? DEFAULT_FROM_HEX;
  const toColor = spec.to ?? opts.themeHighlight ?? DEFAULT_TO_HEX;

  let body = '';
  if (style === 'gradient' && filled > 1) {
    const fromRgb = hexToRgb(asHex(fromColor)) ?? { r: 0x89, g: 0xb4, b: 0xfa };
    const toRgb = hexToRgb(asHex(toColor)) ?? { r: 0xf5, g: 0xc2, b: 0xe7 };
    for (let i = 0; i < filled; i++) {
      const t = filled === 1 ? 0 : i / (filled - 1);
      const r = Math.round(lerp(fromRgb.r, toRgb.r, t));
      const g = Math.round(lerp(fromRgb.g, toRgb.g, t));
      const b = Math.round(lerp(fromRgb.b, toRgb.b, t));
      body += paint(rgbToHex(r, g, b), profile)(fillChar);
    }
  } else {
    body += paint(fromColor, profile)(fillChar.repeat(filled));
  }
  body += paint('#585b70', profile)(emptyChar.repeat(empty));

  if (spec.label) {
    body += ' ' + spec.label;
  }
  return body;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function asHex(c: AdaptiveColor | string): string {
  if (typeof c === 'string') return c;
  return c.truecolor;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
