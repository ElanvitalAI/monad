// Catppuccin Latte — official pastel light theme.
// Palette: https://github.com/catppuccin/catppuccin
//
// IDX-6 Phase 2: the canonical pastel-light preset. Good for bright
// terminals and users who prefer light surfaces with soft, de-
// saturated accents. Semantic colors (critical/warning/success)
// stay true to their meanings per DD-IDX-15 even though the overall
// palette runs cooler and lighter.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  base: '#eff1f5',
  mantle: '#e6e9ef',
  crust: '#dce0e8',
  surface0: '#ccd0da',
  surface1: '#bcc0cc',
  surface2: '#acb0be',
  overlay0: '#9ca0b0',
  overlay1: '#8c8fa1',
  overlay2: '#7c7f93',
  subtext0: '#6c6f85',
  subtext1: '#5c5f77',
  text: '#4c4f69',
  blue: '#1e66f5',
  lavender: '#7287fd',
  sky: '#04a5e5',
  teal: '#179299',
  green: '#40a02b',
  yellow: '#df8e1d',
  peach: '#fe640b',
  red: '#d20f39',
  pink: '#ea76cb',
  mauve: '#8839ef',
};

/** expression-1 adaptive backbone. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette);

export const CATPPUCCIN_LATTE: ThemeTokens = {
  name: 'catppuccin-latte',
  isDark: false,
  isPastel: true,
  colors: {
    text: palette.text,
    muted: palette.overlay1,
    dim: palette.overlay0,
    accent: palette.blue,
    success: palette.green,
    warning: palette.yellow,
    error: palette.red,
    info: palette.teal,
    highlight: palette.mauve,
  },
  pane: {
    titleActive: palette.blue,
    titleInactive: palette.overlay1,
    dividerActive: palette.blue,
    dividerInactive: palette.surface2,
  },
  modal: {
    borderActive: palette.blue,
    borderInactive: palette.surface2,
    title: palette.text,
  },
  cursor: {
    focused: palette.blue,
    inactive: palette.surface2,
  },
  widget: {
    accent: palette.blue,
    selected: palette.surface0,
  },
  widgetTokens: {
    button: {
      normal: pair(palette.text),
      focused: pair(palette.base, { bg: palette.blue, bold: true }),
      hovered: pair(palette.text, { bg: palette.surface0 }),
      disabled: pair(palette.overlay0, { faint: true }),
      pressed: pair(palette.base, { bg: palette.lavender, bold: true }),
      highlighted: pair(palette.mauve, { bold: true }),
    },
    dialog: {
      border: pair(palette.blue),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.surface2, { faint: true }),
    },
    selectView: {
      cursor: pair(palette.blue, { bg: palette.surface0, bold: true }),
      selected: pair(palette.text, { bg: palette.surface1 }),
      muted: pair(palette.overlay1),
      hovered: pair(palette.text, { bg: palette.surface0 }),
      // Phase D-3 cleanup — mergeStyle preserves backdrop bg.
      description: pair(palette.overlay1),
    },
    modal: {
      // IDX-F8b — backdrop sets bg so caller-driven rect fill produces
      // a visible pastel surface behind modal contents.
      backdrop: pair(palette.text, { bg: palette.surface0 }),
      shadow: pair(palette.surface2, { faint: true }),
      border: pair(palette.blue),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair(palette.base, { bg: palette.text, bold: true }),
      titleText: pair(palette.base, { bg: palette.text, bold: true }),
      titleBarInactive: pair(palette.text, { bg: palette.surface0 }),
      titleTextInactive: pair(palette.text, { bg: palette.surface0, bold: true }),
      borderActive: pair(palette.blue),
      borderInactive: pair(palette.surface2),
      closeButton: pair(palette.base, { bg: palette.text, bold: true }),
      minimizeButton: pair(palette.base, { bg: palette.text }),
      dragHandle: pair(palette.base, { bg: palette.text }),
      separator: pair(palette.surface2),
      shadow: pair(palette.surface2, { faint: true }),
      chromeVariant: 'rounded',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.blue, { bold: true }),
      inactive: pair(palette.overlay1),
      hint: pair(palette.overlay0, { faint: true }),
      hovered: pair(palette.text),
    },
    statusBar: {
      bg: pair(palette.text),
      pill: pair(palette.text, { bg: palette.surface0 }),
      pillActive: pair(palette.base, { bg: palette.blue, bold: true }),
      pillHovered: pair(palette.text, { bg: palette.surface1 }),
    },
    semantic: {
      critical: pair(palette.red, { bold: true }),
      warning: pair(palette.yellow),
      success: pair(palette.green),
      info: pair(palette.teal),
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
