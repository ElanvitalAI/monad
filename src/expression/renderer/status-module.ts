// Status module renderer — single starship-style segment.
//
// A "module" is one labelled chunk in the status bar: an icon (or
// nothing), separator, text, optional surrounding wrappers. The
// status bar router decides ordering / spacing across modules; we
// just render one. Pure: same `(spec, profile, opts)` → same string.
//
// Layout templates:
//
//    ┃ icon text             — `style: 'pill'` (rounded prefix)
//    [icon text]             — `style: 'bracket'`
//    icon · text             — `style: 'inline'` (default)
//
// Profile fallback: mono returns plain text + simple separator,
// truecolor wraps icon + text in theme accent / muted as appropriate.

import type { StatusModuleSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  paint,
} from '../color.js';
import { Style } from '../style.js';

export type StatusModuleStyle = 'inline' | 'pill' | 'bracket';

export interface RenderStatusModuleOpts {
  /** Visual frame around the segment. Default `'inline'`. */
  style?: StatusModuleStyle;
  /** Theme accent — icon + pill/bracket frame. */
  themeAccent?: AdaptiveColor | string;
  /** Theme muted — separator + dimmed text. */
  themeMuted?: AdaptiveColor | string;
  /** Override the inline separator glyph. Default `' · '`. */
  separator?: string;
  /** Mark the segment as actionable — emits a tiny `▸` cursor before
   *  the icon to signal there's a click target. */
  actionable?: boolean;
  /** PR-Δ25 (Sprint 17 · 2026-04-30) — opt-in mono emphasis. When
   *  true AND profile is `'mono'`, attribute SGRs (bold / faint /
   *  italic / underline / inverse / strikethrough) survive even
   *  though color SGRs are still stripped. Default false preserves
   *  the existing mono = zero-CSI contract for callers (legacy
   *  status-bar) that depend on it. The setup wizard's status row
   *  flips this on so spec.style.bold reads as visible weight on
   *  NO_COLOR / SSH / CI logs. */
  keepAttrsInMono?: boolean;
}

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';
const DEFAULT_SEPARATOR = ' · ';

/** Render a single status bar segment for one frame. */
export function renderStatusModule(
  spec: StatusModuleSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderStatusModuleOpts = {},
): string {
  const accent = opts.themeAccent ?? DEFAULT_ACCENT;
  const muted = opts.themeMuted ?? DEFAULT_MUTED;
  const style = opts.style ?? 'inline';
  const sep = opts.separator ?? DEFAULT_SEPARATOR;
  const actionable = opts.actionable ?? spec.actionable ?? false;

  const iconRaw = spec.icon ?? '';
  const textRaw = spec.text ?? '';

  const icon = iconRaw ? paint(accent, profile)(iconRaw) : '';
  const text = renderText(textRaw, spec, profile, opts.keepAttrsInMono ?? false);

  const cursor = actionable
    ? paint(accent, profile)('▸') + ' '
    : '';

  switch (style) {
    case 'pill':
      return `${cursor}${paint(accent, profile)('┃')} ${joinIconText(icon, text)}`;
    case 'bracket': {
      const lb = paint(muted, profile)('[');
      const rb = paint(muted, profile)(']');
      return `${cursor}${lb}${joinIconText(icon, text)}${rb}`;
    }
    case 'inline':
    default: {
      if (!icon) return `${cursor}${text}`;
      if (!text) return `${cursor}${icon}`;
      return `${cursor}${icon}${paint(muted, profile)(sep)}${text}`;
    }
  }
}

function joinIconText(icon: string, text: string): string {
  if (!icon) return text;
  if (!text) return icon;
  return `${icon} ${text}`;
}

function renderText(
  raw: string,
  spec: StatusModuleSpec,
  profile: ColorProfile,
  keepAttrsInMono: boolean,
): string {
  if (!raw) return '';
  let s = Style.empty();
  const style = spec.style;
  if (style?.fg) s = s.foreground(style.fg);
  if (style?.bg) s = s.background(style.bg);
  if (style?.bold) s = s.bold();
  if (style?.faint) s = s.faint();
  if (style?.italic) s = s.italic();
  if (style?.underline) s = s.underline();
  return keepAttrsInMono ? s.renderWithMonoEmphasis(raw, profile) : s.render(raw, profile);
}
