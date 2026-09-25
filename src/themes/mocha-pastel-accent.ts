// Mocha Pastel Accent — dark background, pastel accents.
//
// Mocha's surfaces paired with the monad-pastel accent family so
// dark-mode users can still enjoy a softened palette. Uses lighter
// lavender/mint/peach highlights against the mocha base.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  base: '#1e1e2e',
  mantle: '#181825',
  surface0: '#2a2a3e',
  surface1: '#3a3a52',
  surface2: '#4a4a68',
  overlay1: '#8a8ba8',
  text: '#e8e4d8',
  subtext: '#c8c4b8',
  lavender: '#c8bff3',
  mint: '#b4e2d4',
  peach: '#fac9b7',
  rose: '#f5a8c0',
  amber: '#f5d98a',
  sage: '#c0e0a8',
  sky: '#a8d0ec',
  plum: '#d0a8ec',
};

/** expression-1 adaptive backbone. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette);

export const MOCHA_PASTEL_ACCENT: ThemeTokens = {
  name: 'mocha-pastel-accent',
  isDark: true,
  isPastel: true,
  colors: {
    text: palette.text,
    muted: palette.overlay1,
    dim: palette.surface2,
    accent: palette.lavender,
    success: palette.sage,
    warning: palette.amber,
    error: palette.rose,
    info: palette.sky,
    highlight: palette.peach,
  },
  pane: {
    titleActive: palette.lavender,
    titleInactive: palette.overlay1,
    dividerActive: palette.lavender,
    dividerInactive: palette.surface2,
  },
  modal: {
    borderActive: palette.lavender,
    borderInactive: palette.surface2,
    title: palette.text,
  },
  cursor: {
    focused: palette.lavender,
    inactive: palette.surface2,
  },
  widget: {
    accent: palette.lavender,
    selected: palette.surface0,
  },
  widgetTokens: {
    button: {
      normal: pair(palette.text),
      focused: pair(palette.base, { bg: palette.lavender, bold: true }),
      hovered: pair(palette.text, { bg: palette.surface0 }),
      disabled: pair(palette.surface2, { faint: true }),
      pressed: pair(palette.base, { bg: palette.plum, bold: true }),
      highlighted: pair(palette.peach, { bold: true }),
    },
    dialog: {
      border: pair(palette.lavender),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.mantle, { faint: true }),
    },
    selectView: {
      cursor: pair(palette.lavender, { bg: palette.surface0, bold: true }),
      selected: pair(palette.text, { bg: palette.surface1 }),
      muted: pair(palette.overlay1),
      hovered: pair(palette.text, { bg: palette.surface0 }),
      // Phase D-3 cleanup — mergeStyle preserves backdrop bg.
      description: pair(palette.overlay1),
    },
    modal: {
      // IDX-F8b — backdrop sets bg so caller-driven rect fill produces
      // a visible pastel surface behind modal contents.
      backdrop: pair(palette.text, { bg: palette.mantle }),
      shadow: pair(palette.mantle, { faint: true }),
      border: pair(palette.lavender),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair(palette.base, { bg: palette.lavender, bold: true }),
      titleText: pair(palette.base, { bg: palette.lavender, bold: true }),
      titleBarInactive: pair(palette.text, { bg: palette.surface0 }),
      titleTextInactive: pair(palette.text, { bg: palette.surface0, bold: true }),
      borderActive: pair(palette.lavender),
      borderInactive: pair(palette.surface2),
      closeButton: pair(palette.base, { bg: palette.lavender, bold: true }),
      minimizeButton: pair(palette.base, { bg: palette.lavender }),
      dragHandle: pair(palette.base, { bg: palette.lavender }),
      separator: pair(palette.surface2),
      shadow: pair(palette.mantle, { faint: true }),
      chromeVariant: 'rounded',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.lavender, { bold: true }),
      inactive: pair(palette.overlay1),
      hint: pair(palette.surface2, { faint: true }),
      hovered: pair(palette.text),
    },
    statusBar: {
      bg: pair(palette.text),
      pill: pair(palette.text, { bg: palette.surface0 }),
      pillActive: pair(palette.base, { bg: palette.lavender, bold: true }),
      pillHovered: pair(palette.text, { bg: palette.surface1 }),
    },
    semantic: {
      critical: pair(palette.rose, { bold: true }),
      warning: pair(palette.amber),
      success: pair(palette.sage),
      info: pair(palette.sky),
      muted: pair(palette.overlay1),
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
