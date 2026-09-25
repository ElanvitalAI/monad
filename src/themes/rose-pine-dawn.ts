// Rosé Pine Dawn — soft pastel light with rose/gold/iris undertones.
// Palette: https://rosepinetheme.com/palette/ingredients/
//
// IDX-6 Phase 2: warm pastel preset for users who dislike the cooler
// blue-forward Latte palette. Iris replaces the standard purple to
// keep the entire surface within the rose family.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  base: '#faf4ed',
  surface: '#fffaf3',
  overlay: '#f2e9e1',
  muted: '#9893a5',
  subtle: '#797593',
  text: '#575279',
  love: '#b4637a',
  gold: '#ea9d34',
  rose: '#d7827e',
  pine: '#286983',
  foam: '#56949f',
  iris: '#907aa9',
  highlightLow: '#f4ede8',
  highlightMed: '#dfdad9',
  highlightHigh: '#cecacd',
};

/** expression-1 adaptive backbone.
 *
 *  PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — `rose` (#d7827e) and `love`
 *  (#b4637a) are the warm-family accents that auto-nearest sometimes
 *  collapses into the same bright-magenta cell on the 16-color
 *  palette. Pin `love` to plain red (1) so the rose / love pair
 *  reads as two distinct warmth registers under the legacy fallback. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette, {
  love: { ansi16: '1' },
});

export const ROSE_PINE_DAWN: ThemeTokens = {
  name: 'rose-pine-dawn',
  isDark: false,
  isPastel: true,
  colors: {
    text: palette.text,
    muted: palette.muted,
    dim: palette.highlightHigh,
    accent: palette.rose,
    success: palette.foam,
    warning: palette.gold,
    error: palette.love,
    info: palette.pine,
    highlight: palette.iris,
  },
  pane: {
    titleActive: palette.rose,
    titleInactive: palette.muted,
    dividerActive: palette.rose,
    dividerInactive: palette.highlightHigh,
  },
  modal: {
    borderActive: palette.rose,
    borderInactive: palette.highlightHigh,
    title: palette.text,
  },
  cursor: {
    focused: palette.rose,
    inactive: palette.highlightHigh,
  },
  widget: {
    accent: palette.rose,
    selected: palette.highlightLow,
  },
  widgetTokens: {
    button: {
      normal: pair(palette.text),
      focused: pair(palette.base, { bg: palette.rose, bold: true }),
      hovered: pair(palette.text, { bg: palette.highlightLow }),
      disabled: pair(palette.muted, { faint: true }),
      pressed: pair(palette.base, { bg: palette.iris, bold: true }),
      highlighted: pair(palette.iris, { bold: true }),
    },
    dialog: {
      border: pair(palette.rose),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.highlightHigh, { faint: true }),
    },
    selectView: {
      cursor: pair(palette.rose, { bg: palette.highlightLow, bold: true }),
      selected: pair(palette.text, { bg: palette.highlightMed }),
      muted: pair(palette.muted),
      hovered: pair(palette.text, { bg: palette.highlightLow }),
      // Phase D-3 cleanup — mergeStyle preserves backdrop bg.
      description: pair(palette.muted),
    },
    modal: {
      // IDX-F8b — backdrop sets bg so callers can fill the modal rect.
      backdrop: pair(palette.text, { bg: palette.highlightLow }),
      shadow: pair(palette.highlightHigh, { faint: true }),
      border: pair(palette.rose),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair('#000000', { bg: palette.rose, bold: true }),
      titleText: pair('#000000', { bg: palette.rose, bold: true }),
      titleBarInactive: pair(palette.text, { bg: palette.highlightLow }),
      titleTextInactive: pair(palette.text, { bg: palette.highlightLow, bold: true }),
      borderActive: pair(palette.rose),
      borderInactive: pair(palette.highlightHigh),
      closeButton: pair('#000000', { bg: palette.rose, bold: true }),
      minimizeButton: pair('#000000', { bg: palette.rose }),
      dragHandle: pair('#000000', { bg: palette.rose }),
      separator: pair(palette.highlightHigh),
      shadow: pair(palette.highlightHigh, { faint: true }),
      chromeVariant: 'rounded',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.rose, { bold: true }),
      inactive: pair(palette.muted),
      hint: pair(palette.highlightHigh, { faint: true }),
      hovered: pair(palette.text),
    },
    statusBar: {
      bg: pair(palette.text),
      pill: pair(palette.text, { bg: palette.highlightLow }),
      pillActive: pair(palette.base, { bg: palette.rose, bold: true }),
      pillHovered: pair(palette.text, { bg: palette.highlightMed }),
    },
    semantic: {
      critical: pair(palette.love, { bold: true }),
      warning: pair(palette.gold),
      success: pair(palette.foam),
      info: pair(palette.pine),
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
