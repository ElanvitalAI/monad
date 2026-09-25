// Catppuccin Mocha — the original monad-agent default (dark).
// Palette: https://github.com/catppuccin/catppuccin
//
// IDX-6 Phase 2: this file formalizes the mocha preset as a
// selectable ThemeTokens with full hierarchical widgetTokens so the
// runtime theme switcher (Phase 3) can swap in pastel siblings
// without bespoke code paths.

import type { ThemeTokens } from '../theme/tokens.js';
import { pair } from '../theme/tokens.js';
import { adaptivePalette } from '../expression/color.js';

const palette = {
  base: '#1e1e2e',
  mantle: '#181825',
  surface0: '#313244',
  surface1: '#45475a',
  surface2: '#585b70',
  overlay0: '#6c7086',
  overlay1: '#7f849c',
  text: '#cdd6f4',
  subtext1: '#bac2de',
  blue: '#89b4fa',
  lavender: '#b4befe',
  sapphire: '#74c7ec',
  teal: '#94e2d5',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  red: '#f38ba8',
  pink: '#f5c2e7',
  mauve: '#cba6f7',
};

/** expression-1 adaptive backbone. Mirrors `palette` in
 *  AdaptiveColor shape (truecolor + nearest 256 + nearest 16).
 *
 *  PR-Δ19 (Sprint 15 · 2026-04-29 · F7) — `lavender` and `mauve` are
 *  the catppuccin signature pastels. Auto-nearest rounds them to
 *  bright magenta (13), which collapses both into one indistinct hue
 *  on legacy terminals; pin lavender to plain magenta (5) so the two
 *  remain visually distinct (lavender = soft, mauve = bright) under
 *  the ANSI-16 fallback. Truecolor / 256 unchanged. */
export const ADAPTIVE_PALETTE = adaptivePalette(palette, {
  lavender: { ansi16: '5' },
});

export const CATPPUCCIN_MOCHA: ThemeTokens = {
  name: 'catppuccin-mocha',
  isDark: true,
  isPastel: false,
  colors: {
    text: palette.text,
    muted: palette.overlay1,
    dim: palette.surface2,
    accent: palette.blue,
    success: palette.green,
    warning: palette.yellow,
    error: palette.red,
    info: palette.teal,
    highlight: palette.pink,
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
      disabled: pair(palette.surface2, { faint: true }),
      pressed: pair(palette.base, { bg: palette.lavender, bold: true }),
      highlighted: pair(palette.pink, { bold: true }),
    },
    dialog: {
      border: pair(palette.blue),
      title: pair(palette.text, { bold: true }),
      body: pair(palette.text),
      shadow: pair(palette.mantle, { faint: true }),
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
      // IDX-F8b — backdrop now sets bg for actual rect-fill backdrop.
      backdrop: pair(palette.text, { bg: palette.mantle }),
      shadow: pair(palette.mantle, { faint: true }),
      border: pair(palette.blue),
      title: pair(palette.text, { bold: true }),
    },
    modalChrome: {
      titleBar: pair(palette.text, { bg: palette.surface0, bold: true }),
      titleText: pair(palette.text, { bg: palette.surface0, bold: true }),
      titleBarInactive: pair(palette.subtext1, { bg: palette.mantle }),
      titleTextInactive: pair(palette.subtext1, { bg: palette.mantle, bold: true }),
      borderActive: pair(palette.blue),
      borderInactive: pair(palette.surface2),
      closeButton: pair(palette.red, { bg: palette.surface0, bold: true }),
      minimizeButton: pair(palette.yellow, { bg: palette.surface0 }),
      dragHandle: pair(palette.lavender, { bg: palette.surface0 }),
      separator: pair(palette.surface2),
      shadow: pair(palette.mantle, { faint: true }),
      chromeVariant: 'plain',
      chromeTarget: 'frame-and-title',
    },
    paneTitle: {
      active: pair(palette.blue, { bold: true }),
      inactive: pair(palette.overlay1),
      hint: pair(palette.surface2, { faint: true }),
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
