// Nord Light — soft arctic pastel with cool blue-grey tones.
// Palette: https://www.nordtheme.com/
//
// IDX-6 Phase 2: light pastel preset with an arctic-feel. Uses Nord's
// frost + aurora families against the lightest snow-storm bases for
// a restful surface that still shows clear focus + selection states.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  snow0: '#eceff4',
  snow1: '#e5e9f0',
  snow2: '#d8dee9',
  polar0: '#c0c8d4',
  polar1: '#a7b1c2',
  polar2: '#6e7a92',
  polar3: '#4c566a',
  text: '#2e3440',
  frost0: '#8fbcbb',
  frost1: '#88c0d0',
  frost2: '#81a1c1',
  frost3: '#5e81ac',
  red: '#bf616a',
  orange: '#d08770',
  yellow: '#ebcb8b',
  green: '#a3be8c',
  purple: '#b48ead',
};

/** expression-1 adaptive backbone. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette);

export const NORD_LIGHT: ThemeTokens = {
  name: 'nord-light',
  isDark: false,
  isPastel: true,
  colors: {
    text: palette.text,
    muted: palette.polar2,
    dim: palette.polar1,
    accent: palette.frost3,
    success: palette.green,
    warning: palette.yellow,
    error: palette.red,
    info: palette.frost1,
    highlight: palette.purple,
  },
  pane: {
    titleActive: palette.frost3,
    titleInactive: palette.polar2,
    dividerActive: palette.frost3,
    dividerInactive: palette.polar1,
  },
  modal: {
    borderActive: palette.frost3,
    borderInactive: palette.polar1,
    title: palette.text,
  },
  cursor: {
    focused: palette.frost3,
    inactive: palette.polar1,
  },
  widget: {
    accent: palette.frost3,
    selected: palette.snow2,
  },
  widgetTokens: {
    button: {
      normal: pair(palette.text),
      focused: pair(palette.snow0, { bg: palette.frost3, bold: true }),
      hovered: pair(palette.text, { bg: palette.snow2 }),
      disabled: pair(palette.polar1, { faint: true }),
      pressed: pair(palette.snow0, { bg: palette.frost2, bold: true }),
      highlighted: pair(palette.purple, { bold: true }),
    },
    dialog: {
      border: pair(palette.frost3),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.polar0, { faint: true }),
    },
    selectView: {
      cursor: pair(palette.frost3, { bg: palette.snow2, bold: true }),
      selected: pair(palette.text, { bg: palette.polar0 }),
      muted: pair(palette.polar2),
      hovered: pair(palette.text, { bg: palette.snow2 }),
      // Phase D-3 cleanup — mergeStyle preserves backdrop bg.
      description: pair(palette.polar2),
    },
    modal: {
      // IDX-F8b — backdrop sets bg so caller-driven rect fill produces
      // a visible pastel surface behind modal contents.
      backdrop: pair(palette.text, { bg: palette.snow2 }),
      shadow: pair(palette.polar0, { faint: true }),
      border: pair(palette.frost3),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair('#000000', { bg: palette.frost3, bold: true }),
      titleText: pair('#000000', { bg: palette.frost3, bold: true }),
      titleBarInactive: pair(palette.text, { bg: palette.snow2 }),
      titleTextInactive: pair(palette.text, { bg: palette.snow2, bold: true }),
      borderActive: pair(palette.frost3),
      borderInactive: pair(palette.polar1),
      closeButton: pair('#000000', { bg: palette.frost3, bold: true }),
      minimizeButton: pair('#000000', { bg: palette.frost3 }),
      dragHandle: pair('#000000', { bg: palette.frost3 }),
      separator: pair(palette.polar1),
      shadow: pair(palette.polar0, { faint: true }),
      chromeVariant: 'plain',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.frost3, { bold: true }),
      inactive: pair(palette.polar2),
      hint: pair(palette.polar1, { faint: true }),
      hovered: pair(palette.text),
    },
    statusBar: {
      bg: pair(palette.text),
      pill: pair(palette.text, { bg: palette.snow2 }),
      pillActive: pair(palette.snow0, { bg: palette.frost3, bold: true }),
      pillHovered: pair(palette.text, { bg: palette.polar0 }),
    },
    semantic: {
      critical: pair(palette.red, { bold: true }),
      warning: pair(palette.yellow),
      success: pair(palette.green),
      info: pair(palette.frost1),
      muted: pair(palette.polar2),
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
