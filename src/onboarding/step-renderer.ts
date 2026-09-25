// Step header + footer renderer using the expression framework's
// adaptive color + Style + borders primitives. Replaces the bespoke
// box-drawing strings hard-coded in `src/onboarding.ts`.
//
// Pure functions: `(stepIndex, total, title, profile, theme?) → string`.
// Hosts (`realIO` / `widgetIO`) print these as-is.
//
// The renderer doesn't pick a profile itself — callers pass one
// (typically from `detectProfile()` on `realIO`, or `'truecolor'`
// inside the dashboard widget where SGR always works).

import {
  detectProfile,
  type ColorProfile,
  Style,
  pickBorder,
  type BorderKind,
} from '../expression/index.js';
import type { ThemeTokens } from '../theme/tokens.js';

export interface StepHeaderOpts {
  /** Color profile — defaults to runtime detection. */
  profile?: ColorProfile;
  /** Theme tokens — when present, the accent + muted colors are
   *  pulled from `theme.colors.{accent,muted}`. */
  theme?: ThemeTokens;
  /** Border family — default `'rounded'`. */
  border?: BorderKind;
  /** Width of the header rule, in cells. Default 56. */
  width?: number;
}

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';

/** Render a single-line step header — `╭─ Step 3 / 5 — Obsidian vault ──╮`. */
export function renderStepHeader(
  stepIndex: number,
  total: number,
  title: string,
  opts: StepHeaderOpts = {},
): string {
  const profile = opts.profile ?? detectProfile();
  const accent = opts.theme?.colors.accent ?? DEFAULT_ACCENT;
  const muted = opts.theme?.colors.muted ?? DEFAULT_MUTED;
  const border = pickBorder(opts.border ?? 'rounded');
  const width = Math.max(20, opts.width ?? 56);

  const counter = `Step ${stepIndex} / ${total}`;
  const headLabel = ` ${counter} — ${title} `;
  const remaining = Math.max(2, width - headLabel.length - 2);
  const rule = border.top.repeat(Math.max(2, remaining));

  const accentPaint = Style.empty().foreground(accent).bold();
  const mutedPaint = Style.empty().foreground(muted);

  return (
    mutedPaint.render(border.tl + border.top + border.top, profile) +
    accentPaint.render(headLabel, profile) +
    mutedPaint.render(rule + border.tr, profile)
  );
}

/** Render a single-line step footer — `╰────────────────────────────╯`. */
export function renderStepFooter(opts: StepHeaderOpts = {}): string {
  const profile = opts.profile ?? detectProfile();
  const muted = opts.theme?.colors.muted ?? DEFAULT_MUTED;
  const border = pickBorder(opts.border ?? 'rounded');
  const width = Math.max(20, opts.width ?? 56);
  const rule = border.bottom.repeat(width - 2);
  return Style.empty().foreground(muted).render(border.bl + rule + border.br, profile);
}

/** Render an inline body line — adds a left bar prefix matching the
 *  border family, so multi-line step bodies visually connect to the
 *  header / footer. */
export function renderStepBodyLine(
  text: string,
  opts: StepHeaderOpts = {},
): string {
  const profile = opts.profile ?? detectProfile();
  const muted = opts.theme?.colors.muted ?? DEFAULT_MUTED;
  const border = pickBorder(opts.border ?? 'rounded');
  const prefix = Style.empty().foreground(muted).render(`${border.left}  `, profile);
  return prefix + text;
}

/** Compose a full step block — header + body lines + footer — in one
 *  string (newline-separated). Useful for hosts that buffer the whole
 *  block before emitting (clack `note()`, dashboard widget paint). */
export function renderStepBlock(
  stepIndex: number,
  total: number,
  title: string,
  body: ReadonlyArray<string>,
  opts: StepHeaderOpts = {},
): string {
  const lines: string[] = [];
  lines.push(renderStepHeader(stepIndex, total, title, opts));
  for (const line of body) lines.push(renderStepBodyLine(line, opts));
  lines.push(renderStepFooter(opts));
  return lines.join('\n');
}
