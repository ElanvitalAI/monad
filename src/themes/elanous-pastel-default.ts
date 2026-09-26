// Elanous Pastel Default — the house brand pastel (light).
//
// Custom blend of lavender / mint / peach over an off-white canvas.
// Drops the rigid community palettes for something that reads as
// distinctly "elanous". Semantic colors respect DD-IDX-15 so PFC
// Andon and TO status badges keep their meaning.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  base: '#fbf8f4',
  surface: '#f5f0ea',
  overlay: '#ebe3d9',
  border: '#d9cfc1',
  muted: '#9a8d7b',
  subtle: '#786b58',
  text: '#3a2f23',
  lavender: '#a093e8',
  lavenderText: '#67507f',
  lavenderSoft: '#c8bff3',
  mint: '#7ccbb0',
  mintSoft: '#b4e2d4',
  peach: '#f0a285',
  peachSoft: '#fac9b7',
  rose: '#e88aa6',
  amber: '#dca34a',
  sage: '#7fa680',
  sky: '#6ba6cc',
  plum: '#8e6ba8',
};

/** expression-1 — adaptive backbone. Mirrors `palette` in the
 *  AdaptiveColor shape so renderers under `src/expression/` can
 *  resolve profile-aware (truecolor / 256 / 16 / mono). Keys mirror
 *  `palette` exactly so tests can assert parity.
 *
 *  PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — `lavender` is the brand
 *  accent. Auto-derived nearest-RGB lands on bright magenta (13) which
 *  reads as too saturated on legacy 16-color terminals; the palette's
 *  pastel intent comes through better as plain magenta (5). The
 *  truecolor / ANSI-256 channels stay derived from the canonical hex
 *  so users on rich terminals see the design hex unchanged. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette, {
  lavender: { ansi16: '5' },
});

export const ELANOUS_PASTEL_DEFAULT: ThemeTokens = {
  name: 'elanous-pastel-default',
  isDark: false,
  isPastel: true,
  colors: {
    text: palette.text,
    muted: palette.muted,
    dim: palette.border,
    accent: palette.lavender,
    success: palette.sage,
    warning: palette.amber,
    error: palette.rose,
    info: palette.sky,
    highlight: palette.peach,
  },
  pane: {
    titleActive: palette.lavender,
    titleInactive: palette.muted,
    dividerActive: palette.lavender,
    dividerInactive: palette.border,
  },
  modal: {
    borderActive: palette.lavender,
    borderInactive: palette.border,
    title: palette.text,
  },
  cursor: {
    focused: palette.lavender,
    inactive: palette.border,
  },
  widget: {
    accent: palette.lavender,
    selected: palette.surface,
  },
  widgetTokens: {
    button: {
      normal: pair(palette.text),
      focused: pair(palette.base, { bg: palette.lavenderText, bold: true }),
      hovered: pair(palette.text, { bg: palette.surface }),
      disabled: pair(palette.muted, { faint: true }),
      pressed: pair(palette.base, { bg: palette.lavenderText, bold: true }),
      highlighted: pair(palette.peach, { bold: true }),
    },
    dialog: {
      border: pair(palette.lavender),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.border, { faint: true }),
    },
    selectView: {
      cursor: pair(palette.lavenderText, { bg: palette.surface, bold: true }),
      selected: pair(palette.text, { bg: palette.overlay }),
      muted: pair(palette.muted),
      hovered: pair(palette.text, { bg: palette.surface }),
      // Phase D-3 cleanup (2026-04-21): `description` bg was needed
      // as a workaround for the opaque-string Cell model losing
      // backdrop bg on fg-only overlay. Phase D-2 `Printer.placeText`
      // now uses `mergeStyle` (see src/ui/printer-cell-model.ts) so
      // fg-only descriptions auto-preserve the parent backdrop bg.
      // Keeping description as fg-only is both simpler and the
      // original token author's intent.
      description: pair(palette.muted),
    },
    modal: {
      // IDX-F8b — backdrop now sets `bg` (was fg-only with `faint`),
      // so callers that fill the modal rect with `' '` + ansiForPair
      // get an actual pastel background. Foreground stays readable
      // text colour over the soft surface fill.
      backdrop: pair(palette.text, { bg: palette.surface }),
      shadow: pair(palette.border, { faint: true }),
      border: pair(palette.lavender),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair('#000000', { bg: palette.lavender, bold: true }),
      titleText: pair('#000000', { bg: palette.lavender, bold: true }),
      titleBarInactive: pair(palette.text, { bg: palette.overlay }),
      titleTextInactive: pair(palette.text, { bg: palette.overlay, bold: true }),
      borderActive: pair(palette.lavender),
      borderInactive: pair(palette.border),
      closeButton: pair('#000000', { bg: palette.lavender, bold: true }),
      minimizeButton: pair('#000000', { bg: palette.lavender }),
      dragHandle: pair('#000000', { bg: palette.lavender }),
      separator: pair(palette.border),
      shadow: pair(palette.border, { faint: true }),
      chromeVariant: 'rounded',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.lavender, { bold: true }),
      inactive: pair(palette.muted),
      hint: pair(palette.border, { faint: true }),
      hovered: pair(palette.text),
    },
    statusBar: {
      bg: pair(palette.text),
      pill: pair(palette.text, { bg: palette.surface }),
      pillActive: pair(palette.base, { bg: palette.lavenderText, bold: true }),
      pillHovered: pair(palette.text, { bg: palette.overlay }),
    },
    semantic: {
      // Slightly desaturated to sit with the pastel palette while
      // still being unambiguous — red-ish, amber-ish, green-ish.
      critical: pair(palette.rose, { bold: true }),
      warning: pair(palette.amber),
      success: pair(palette.sage),
      info: pair(palette.sky),
      muted: pair(palette.muted),
    },
    icon: {
      terminal: '🖥️',
      agent: '🤖',
      skill: '🧠',
      task: '📋',
      notification: '🔔',
      goal: '🎯',
      dashboard: '📊',
      warning: '⚠️',
      error: '❌',
      success: '✅',
      running: '🟢',
      review: '🟡',
      backlog: '⚪',
      done: '✅',
      locked: '🔒',
    },
  },
};
