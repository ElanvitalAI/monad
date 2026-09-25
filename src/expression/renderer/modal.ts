// Notification modal renderer — rounded-border framed dialog.
//
// Renders a `ModalSpec` as a multi-line ANSI string framed by the
// requested border kind (default rounded). Variant tints (info /
// success / warning / error / destructive) tint the title bar +
// border to give the host's notification stack a quick at-a-glance
// signal.
//
// Layout (rounded, 6 lines for a one-paragraph body):
//
//    ╭─ Title ─────────────────╮
//    │                         │
//    │ Body text wraps to fit  │
//    │ the requested width.    │
//    │                         │
//    │  [ OK ]  [ Cancel ]     │
//    ╰─────────────────────────╯
//
// Pure: no side effects, no terminal dim/screen detection.
// Hosts pass `opts.width` and the rendered block fills exactly that
// many cells per line; word-aware wrapping handles long bodies.

import type { ModalSpec, ActionSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  paint,
} from '../color.js';
import { Style } from '../style.js';
import { pickBorder, type BorderShape } from '../borders.js';

export interface RenderModalOpts {
  /** Frame width in cells (default 50). Body wraps to width-4. */
  width?: number;
  /** Theme accent fallback when variant doesn't pick its own. */
  themeAccent?: AdaptiveColor | string;
  /** Theme muted — border on info / default variants. */
  themeMuted?: AdaptiveColor | string;
  /** PR-Δ25c (Sprint 18 · 2026-04-30) — opt-in: when true AND profile
   *  is `'mono'`, attribute SGRs (bold) survive on title + action
   *  labels even though color SGRs are still stripped. Default false
   *  preserves the legacy mono = zero-CSI contract that
   *  expression-mono-fallback.test.ts asserts on the modal body.
   *  Hosts that want title/action emphasis on NO_COLOR / pipe / CI
   *  logs flip this on. Pattern mirrors Δ25 (status-module + picker)
   *  and Δ25d (markdown). */
  keepAttrsInMono?: boolean;
}

const DEFAULT_WIDTH = 50;
const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';

const VARIANT_COLORS: Record<NonNullable<ModalSpec['variant']>, string> = {
  info: '#89b4fa',
  success: '#a6e3a1',
  warning: '#f9e2af',
  error: '#f38ba8',
  destructive: '#eba0ac',
};

/** Render a `ModalSpec` to a multi-line ANSI string. */
export function renderModal(
  spec: ModalSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderModalOpts = {},
): string {
  const width = Math.max(20, opts.width ?? DEFAULT_WIDTH);
  const muted = opts.themeMuted ?? DEFAULT_MUTED;
  const accentColor =
    spec.variant && VARIANT_COLORS[spec.variant]
      ? VARIANT_COLORS[spec.variant]
      : opts.themeAccent ?? DEFAULT_ACCENT;
  const borderColor = spec.variant ? accentColor : muted;
  const border = pickBorder(spec.style?.border ?? 'rounded');
  const keepAttrs = opts.keepAttrsInMono ?? false;

  const lines: string[] = [];
  lines.push(renderTopBorder(border, spec.title, width, profile, accentColor, borderColor, keepAttrs));
  lines.push(renderEmptyRow(border, width, profile, borderColor));

  const bodyLines = wrapBody(spec.body, width - 4);
  for (const line of bodyLines) {
    lines.push(renderBodyRow(border, line, width, profile, borderColor));
  }
  if (bodyLines.length > 0) {
    lines.push(renderEmptyRow(border, width, profile, borderColor));
  }

  if (spec.actions && spec.actions.length > 0) {
    const actionsLine = renderActions(spec.actions, profile, accentColor, muted, keepAttrs);
    lines.push(renderActionsRow(border, actionsLine, width, profile, borderColor));
    lines.push(renderEmptyRow(border, width, profile, borderColor));
  }

  lines.push(renderBottomBorder(border, width, profile, borderColor));
  return lines.join('\n');
}

// ── Frame helpers ───────────────────────────────────────────────────

function renderTopBorder(
  border: BorderShape,
  title: string,
  width: number,
  profile: ColorProfile,
  accent: AdaptiveColor | string,
  borderColor: AdaptiveColor | string,
  keepAttrs: boolean,
): string {
  // Layout: tl + ─ + ' Title ' + ───…─ + tr
  const titlePadded = ` ${title} `;
  // PR-Δ25c — single helper for the 4 render() callsites in this file.
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  const styledTitle = r(Style.empty().foreground(accent).bold(), titlePadded);
  const visibleTitle = titlePadded.length;
  const innerWidth = width - 2;
  const leftFiller = 1; // a single ─ before the title
  const rightFiller = Math.max(0, innerWidth - leftFiller - visibleTitle);
  const tl = paint(borderColor, profile)(border.tl);
  const left = paint(borderColor, profile)(border.top.repeat(leftFiller));
  const right = paint(borderColor, profile)(border.top.repeat(rightFiller));
  const tr = paint(borderColor, profile)(border.tr);
  return `${tl}${left}${styledTitle}${right}${tr}`;
}

function renderBottomBorder(
  border: BorderShape,
  width: number,
  profile: ColorProfile,
  borderColor: AdaptiveColor | string,
): string {
  const inner = paint(borderColor, profile)(border.bottom.repeat(width - 2));
  const bl = paint(borderColor, profile)(border.bl);
  const br = paint(borderColor, profile)(border.br);
  return `${bl}${inner}${br}`;
}

function renderEmptyRow(
  border: BorderShape,
  width: number,
  profile: ColorProfile,
  borderColor: AdaptiveColor | string,
): string {
  const left = paint(borderColor, profile)(border.left);
  const right = paint(borderColor, profile)(border.right);
  return `${left}${' '.repeat(width - 2)}${right}`;
}

function renderBodyRow(
  border: BorderShape,
  line: string,
  width: number,
  profile: ColorProfile,
  borderColor: AdaptiveColor | string,
): string {
  const left = paint(borderColor, profile)(border.left);
  const right = paint(borderColor, profile)(border.right);
  const inner = ` ${line}`;
  const padded = inner + ' '.repeat(Math.max(0, width - 2 - inner.length));
  return `${left}${padded}${right}`;
}

function renderActionsRow(
  border: BorderShape,
  rendered: string,
  width: number,
  profile: ColorProfile,
  borderColor: AdaptiveColor | string,
): string {
  // We can't measure ANSI-rich strings in cells via .length, so the
  // action text already accounts for its own visible width. Strip
  // ANSI for sizing.
  const visible = stripAnsi(rendered).length;
  const innerWidth = width - 4;
  const padding = Math.max(0, innerWidth - visible);
  const left = paint(borderColor, profile)(border.left);
  const right = paint(borderColor, profile)(border.right);
  return `${left}  ${rendered}${' '.repeat(padding)}  ${right}`;
}

function renderActions(
  actions: ReadonlyArray<ActionSpec>,
  profile: ColorProfile,
  accent: AdaptiveColor | string,
  muted: AdaptiveColor | string,
  keepAttrs: boolean,
): string {
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  return actions
    .map((a) => {
      const label = a.hotkey ? `${a.label} [${a.hotkey}]` : a.label;
      const wrapped = `[ ${label} ]`;
      if (a.destructive) {
        return r(Style.empty().foreground('#f38ba8').bold(), wrapped);
      }
      if (a.primary) {
        return r(Style.empty().foreground(accent).bold(), wrapped);
      }
      return r(Style.empty().foreground(muted), wrapped);
    })
    .join('  ');
}

// ── Text helpers ───────────────────────────────────────────────────

/** Greedy whitespace-aware word wrap. Doesn't measure ANSI; pass plain. */
export function wrapBody(text: string, width: number): string[] {
  if (width <= 0 || !Number.isFinite(width)) return [text];
  if (!text) return [];
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.length === 0) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    let current = '';
    for (const word of words) {
      if (current.length === 0) {
        current = word;
        continue;
      }
      if (current.length + 1 + word.length > width) {
        out.push(current);
        current = word;
      } else {
        current += ' ' + word;
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[\d;]*m/g, '');
}
