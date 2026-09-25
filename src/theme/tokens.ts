// Semantic theme tokens for terminal rendering.
//
// Theme policy stays separate from pane/view policy: layout code asks
// for semantic colors, while config/plugins can override the tokens.
//
// IDX-6 Phase 1 (2026-04-19): hierarchical WidgetTokens with 6-state
// variants added alongside the original flat groups. The flat fields
// remain the source of truth for backward compat; widgetTokens is an
// optional richer surface that presets can provide, and callers can
// resolveWidgetTokens(theme, kind, state?) to read uniformly.
//
// expression-1 (2026-04-28): re-export `AdaptiveColor` so theme
// presets can declare per-color truecolor / 256 / 16 fallbacks. The
// flat `string` (hex) shape stays authoritative for existing
// consumers; AdaptiveColor is opt-in alongside.

import chalk from 'chalk';

export type { AdaptiveColor } from '../expression/color.js';

export interface ThemeColorTokens {
  text: string;
  muted: string;
  dim: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  highlight: string;
}

export interface ThemePaneTokens {
  titleActive: string;
  titleInactive: string;
  dividerActive: string;
  dividerInactive: string;
  /** IDX-6 Phase 5 — optional glyph for a focused-adjacent divider.
   *  Default `'┃'` (heavy vertical) visually emphasises the
   *  focused cell without reclaiming grid space. Presets that want
   *  the flatter `'│'` look set this to `'│'` or leave undefined for
   *  callers that haven't opted in yet. */
  dividerFocusedGlyph?: string;
  /** IDX-6 Phase 5 — glyph used for non-focused dividers. Default
   *  `'│'`. Usually no reason to override — present for symmetry
   *  with `dividerFocusedGlyph`. */
  dividerGlyph?: string;
}

export interface ThemeModalTokens {
  borderActive: string;
  borderInactive: string;
  title: string;
  /** IDX-6 Phase 5 — optional drop-shadow colour (hex). Modal paint
   *  paths that opt in render a single-cell band one row below + one
   *  col to the right of bounds using this colour. Omit to disable
   *  shadows for a preset (legacy behaviour). */
  shadow?: string;
}

export interface ThemeCursorTokens {
  focused: string;
  inactive: string;
}

export interface ThemeWidgetTokens {
  accent: string;
  selected: string;
}

// ---------------------------------------------------------------------
// IDX-6 Phase 1 — Hierarchical widget tokens (AppCUI-rs pattern port).
//
// Each widget kind exposes a small struct of TokenPairs. When a state
// variant is undefined, callers fall back to `normal`. Presets can
// override any field without reshaping the whole theme.
// ---------------------------------------------------------------------

export interface TokenPair {
  fg: string;
  bg?: string;
  bold?: boolean;
  faint?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export type WidgetState =
  | 'normal'
  | 'focused'
  | 'hovered'
  | 'disabled'
  | 'pressed'
  | 'highlighted';

export interface ButtonStateTokens {
  normal: TokenPair;
  focused?: TokenPair;
  hovered?: TokenPair;
  disabled?: TokenPair;
  pressed?: TokenPair;
  highlighted?: TokenPair;
}

export interface DialogWidgetTokens {
  border: TokenPair;
  title: TokenPair;
  body: TokenPair;
  shadow?: TokenPair;
}

export interface SelectViewWidgetTokens {
  cursor: TokenPair;
  selected: TokenPair;
  muted: TokenPair;
  hovered?: TokenPair;
  // IDX-6 round-2 — additional paint-path slots. All optional so
  // existing presets stay valid; the resolver below falls back to
  // sensible defaults derived from cursor/muted when the slot is
  // absent, matching the legacy C.* palette.
  /** Heading rendered above the option list (bold caption). */
  title?: TokenPair;
  /** `/` prefix + typed query text in search mode. */
  query?: TokenPair;
  /** Small blinking caret inside query / input mode (▎). */
  caret?: TokenPair;
  /** Right-side preview pane body text + separator glyph. */
  preview?: TokenPair;
  /** One-line footer hint ("↑↓ · Enter · Esc" etc.). */
  footer?: TokenPair;
  /** Empty-list placeholder and the feedback "done/…typing" banners. */
  placeholder?: TokenPair;
  /** Disabled row label. */
  disabled?: TokenPair;
  /** Reason string that follows a disabled row. */
  disabledReason?: TokenPair;
  /** Horizontal separator in upward-mode layouts (─). */
  separator?: TokenPair;
  /** Per-row description suffix (smaller secondary text). */
  description?: TokenPair;
}

export interface ModalWidgetTokens {
  backdrop?: TokenPair;
  shadow?: TokenPair;
  border: TokenPair;
  title: TokenPair;
}

/** U1 Bundle B — future window chrome family. Kept optional in
 *  `WidgetTokens` so presets can adopt it incrementally before the
 *  chrome renderer becomes a production consumer. */
export interface ModalChromeWidgetTokens {
  titleBar: TokenPair;
  titleText: TokenPair;
  borderActive: TokenPair;
  borderInactive: TokenPair;
  titleBarInactive?: TokenPair;
  titleTextInactive?: TokenPair;
  closeButton?: TokenPair;
  minimizeButton?: TokenPair;
  dragHandle?: TokenPair;
  separator?: TokenPair;
  shadow?: TokenPair;
  chromeVariant?: 'plain' | 'rounded' | 'double' | 'heavy';
  chromeTarget?: 'frame' | 'title-bar' | 'frame-and-title';
  motionPolicy?: ChromeMotionPolicy;
}

export type ChromeMotionMode = 'static' | 'motion';
export type ChromeMotionRecipe =
  | 'none'
  | 'focus-swap'
  | 'pulse'
  | 'audit-pulse'
  | 'sweep'
  | 'ants';

export interface ChromeMotionPolicy {
  mode: ChromeMotionMode;
  recipe: ChromeMotionRecipe;
  target: 'frame' | 'title-bar' | 'frame-and-title';
}

export interface PaneTitleWidgetTokens {
  active: TokenPair;
  inactive: TokenPair;
  hint?: TokenPair;
  hovered?: TokenPair;
}

export interface StatusBarWidgetTokens {
  bg: TokenPair;
  pill: TokenPair;
  pillActive: TokenPair;
  pillHovered?: TokenPair;
}

/** Theme-invariant semantic colors. Per DD-IDX-15 these stay red-ish,
 *  green-ish, etc. across theme switches so PFC Andon / TO status
 *  badges keep meaning regardless of the active preset. Presets may
 *  tune the exact hue (e.g. slightly desaturate for pastel) but
 *  must preserve the meaning: critical=red, warning=amber, success=green. */
export interface SemanticTokens {
  critical: TokenPair;
  warning: TokenPair;
  success: TokenPair;
  info: TokenPair;
  muted: TokenPair;
}

/** Glyph / icon map. Themes can override glyphs (ASCII-safe fallback
 *  provides `[T]`-style brackets). Consumers look up by logical name. */
export interface IconTokens {
  terminal: string;
  agent: string;
  skill: string;
  task: string;
  notification: string;
  goal: string;
  dashboard: string;
  warning: string;
  error: string;
  success: string;
  running: string;
  review: string;
  backlog: string;
  done: string;
  locked: string;
}

export interface WidgetTokens {
  button: ButtonStateTokens;
  dialog: DialogWidgetTokens;
  selectView: SelectViewWidgetTokens;
  modal: ModalWidgetTokens;
  modalChrome?: ModalChromeWidgetTokens;
  paneTitle: PaneTitleWidgetTokens;
  statusBar: StatusBarWidgetTokens;
  semantic: SemanticTokens;
  icon: IconTokens;
}

export interface ThemeTokens {
  name: string;
  colors: ThemeColorTokens;
  pane: ThemePaneTokens;
  modal: ThemeModalTokens;
  cursor: ThemeCursorTokens;
  widget: ThemeWidgetTokens;
  /** Optional hierarchical widget tokens (IDX-6 Phase 1). Presets
   *  that want fine-grained per-state theming fill this; otherwise
   *  resolveWidgetTokens derives a minimal shape from the flat groups. */
  widgetTokens?: WidgetTokens;
  /** Dark theme (fg light on dark bg). Used by IDX-6 Phase 5 to
   *  pick appropriate border / shadow glyphs. */
  isDark?: boolean;
  /** Pastel palette — softer saturation, uniformly light or uniformly
   *  dim accents. Distinct from `isDark`: a dark-bg pastel (mocha +
   *  pastel accents) is possible. */
  isPastel?: boolean;
  /** F8 (S2) — per-tier BoxDecoration defaults. When present, modal
   *  call sites of a matching tier that DON'T pass an explicit
   *  `decoration` get this shape auto-applied by the modal-adapter.
   *  Themes opt in by populating this field; absent = pre-S2 behaviour
   *  (no auto-chrome). See `src/ui/chrome-defaults.ts` for the
   *  resolver and `BUILT_IN_CHROME_DEFAULTS` for reusable baselines. */
  chromeDefaults?: import('../ui/chrome-defaults.js').ChromeDefaults;
}

export type ThemeTokenInput = Partial<{
  name: unknown;
  colors: Partial<Record<keyof ThemeColorTokens, unknown>>;
  pane: Partial<Record<keyof ThemePaneTokens, unknown>>;
  modal: Partial<Record<keyof ThemeModalTokens, unknown>>;
  cursor: Partial<Record<keyof ThemeCursorTokens, unknown>>;
  widget: Partial<Record<keyof ThemeWidgetTokens, unknown>>;
}>;

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  name: 'catppuccin-mocha',
  colors: {
    text: '#cdd6f4',
    muted: '#7f849c',
    dim: '#585b70',
    accent: '#89b4fa',
    success: '#a6e3a1',
    warning: '#f9e2af',
    error: '#f38ba8',
    info: '#94e2d5',
    highlight: '#f5c2e7',
  },
  pane: {
    titleActive: '#89b4fa',
    titleInactive: '#7f849c',
    dividerActive: '#89b4fa',
    dividerInactive: '#585b70',
  },
  modal: {
    borderActive: '#89b4fa',
    borderInactive: '#585b70',
    title: '#cdd6f4',
  },
  cursor: {
    focused: '#89b4fa',
    inactive: '#585b70',
  },
  widget: {
    accent: '#89b4fa',
    selected: '#313244',
  },
};

// ---------------------------------------------------------------------
// IDX-6 Phase 1 — default hierarchical widget tokens derived from the
// existing flat Mocha palette. Preset files in src/themes/ supply
// richer state variants; this fallback keeps widgets coherent when a
// theme ships only the flat fields.
// ---------------------------------------------------------------------

export const DEFAULT_WIDGET_TOKENS: WidgetTokens = {
  button: {
    normal: { fg: '#cdd6f4' },
    focused: { fg: '#1e1e2e', bg: '#89b4fa', bold: true },
    hovered: { fg: '#cdd6f4', bg: '#313244' },
    disabled: { fg: '#585b70', faint: true },
    pressed: { fg: '#1e1e2e', bg: '#b4befe', bold: true },
    highlighted: { fg: '#f5c2e7', bold: true },
  },
  dialog: {
    border: { fg: '#89b4fa' },
    title: { fg: '#cdd6f4', bold: true },
    body: { fg: '#cdd6f4' },
    shadow: { fg: '#1e1e2e', faint: true },
  },
  selectView: {
    cursor: { fg: '#89b4fa', bg: '#313244', bold: true },
    selected: { fg: '#cdd6f4', bg: '#45475a' },
    muted: { fg: '#7f849c' },
    hovered: { fg: '#cdd6f4', bg: '#313244' },
    // TECH-DEBT-printer-cell-bg-loss: description bg matches
    // modal.backdrop bg (#1e1e2e) so popup description text blends
    // with the surrounding backdrop fill rather than exposing the
    // terminal default bg through cell SGR overwrite.
    description: { fg: '#7f849c', bg: '#1e1e2e' },
  },
  modal: {
    // IDX-F8b — backdrop sets bg so the modal-adapter's fill pass
    // produces a visible surface behind modal contents. Default
    // mocha-ish palette: light text over dark mantle.
    backdrop: { fg: '#cdd6f4', bg: '#1e1e2e' },
    shadow: { fg: '#1e1e2e', faint: true },
    border: { fg: '#89b4fa' },
    title: { fg: '#cdd6f4', bold: true },
  },
  modalChrome: {
    titleBar: { fg: '#cdd6f4', bg: '#313244', bold: true },
    titleText: { fg: '#cdd6f4', bg: '#313244', bold: true },
    titleBarInactive: { fg: '#7f849c', bg: '#1e1e2e' },
    titleTextInactive: { fg: '#bac2de', bg: '#1e1e2e' },
    borderActive: { fg: '#89b4fa' },
    borderInactive: { fg: '#585b70' },
    closeButton: { fg: '#f38ba8', bg: '#313244', bold: true },
    minimizeButton: { fg: '#f9e2af', bg: '#313244' },
    dragHandle: { fg: '#89b4fa', bg: '#313244' },
    separator: { fg: '#585b70' },
    shadow: { fg: '#1e1e2e', faint: true },
    chromeVariant: 'plain',
    chromeTarget: 'frame-and-title',
    motionPolicy: {
      mode: 'static',
      recipe: 'focus-swap',
      target: 'frame-and-title',
    },
  },
  paneTitle: {
    active: { fg: '#89b4fa', bold: true },
    inactive: { fg: '#7f849c' },
    hint: { fg: '#585b70', faint: true },
    hovered: { fg: '#cdd6f4' },
  },
  statusBar: {
    bg: { fg: '#cdd6f4' },
    pill: { fg: '#cdd6f4', bg: '#313244' },
    pillActive: { fg: '#1e1e2e', bg: '#89b4fa', bold: true },
    pillHovered: { fg: '#cdd6f4', bg: '#45475a' },
  },
  semantic: {
    critical: { fg: '#f38ba8', bold: true },
    warning: { fg: '#f9e2af' },
    success: { fg: '#a6e3a1' },
    info: { fg: '#94e2d5' },
    muted: { fg: '#7f849c' },
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
};

/** ASCII-safe fallback glyphs. Presets with `asciiSafe: true` will
 *  expose these via `widgetTokens.icon`, and consumers can opt in
 *  with env `MONAD_ASCII_ICONS=1`. */
export const ASCII_SAFE_ICONS: IconTokens = {
  terminal: '[T]',
  agent: '[A]',
  skill: '[S]',
  task: '[K]',
  notification: '[!]',
  goal: '[*]',
  dashboard: '[#]',
  warning: '[W]',
  error: '[E]',
  success: '[v]',
  running: '[>]',
  review: '[~]',
  backlog: '[ ]',
  done: '[v]',
  locked: '[L]',
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function mergeThemeTokens(
  base: ThemeTokens = DEFAULT_THEME_TOKENS,
  input?: ThemeTokenInput | null,
): ThemeTokens {
  if (!input || typeof input !== 'object') return cloneTheme(base);
  return {
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : base.name,
    colors: mergeGroup(base.colors, input.colors),
    pane: mergeGroup(base.pane, input.pane),
    modal: mergeGroup(base.modal, input.modal),
    cursor: mergeGroup(base.cursor, input.cursor),
    widget: mergeGroup(base.widget, input.widget),
  };
}

/** Accept either a direct token object or { tokens: {...} }. The
 *  wrapper form leaves room for future active theme ids and plugin
 *  contribution references without changing dashboard.theme again. */
export function resolveThemeTokens(raw: unknown): ThemeTokens {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneTheme(DEFAULT_THEME_TOKENS);
  }
  const obj = raw as Record<string, unknown>;
  const tokenSource = obj.tokens && typeof obj.tokens === 'object' && !Array.isArray(obj.tokens)
    ? obj.tokens as ThemeTokenInput
    : obj as ThemeTokenInput;
  return mergeThemeTokens(DEFAULT_THEME_TOKENS, tokenSource);
}

export function themeColor(theme: ThemeTokens, token: keyof ThemeColorTokens): string {
  return theme.colors[token] ?? DEFAULT_THEME_TOKENS.colors[token];
}

export function colorize(hex: string, opts: { bold?: boolean; underline?: boolean } = {}): (text: string) => string {
  let c = chalk.hex(hex);
  if (opts.bold) c = c.bold;
  if (opts.underline) c = c.underline;
  return (text: string) => c(text);
}

function mergeGroup<T extends object>(
  base: T,
  input: Partial<Record<keyof T, unknown>> | undefined,
): T {
  const out: Record<string, string> = { ...(base as Record<string, string>) };
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (isThemeColor(value) && key in base) out[key] = value.trim();
    }
  }
  return out as T;
}

function cloneTheme(theme: ThemeTokens): ThemeTokens {
  const out: ThemeTokens = {
    name: theme.name,
    colors: { ...theme.colors },
    pane: { ...theme.pane },
    modal: { ...theme.modal },
    cursor: { ...theme.cursor },
    widget: { ...theme.widget },
  };
  if (theme.widgetTokens) out.widgetTokens = cloneWidgetTokens(theme.widgetTokens);
  if (theme.isDark !== undefined) out.isDark = theme.isDark;
  if (theme.isPastel !== undefined) out.isPastel = theme.isPastel;
  if (theme.chromeDefaults) out.chromeDefaults = { ...theme.chromeDefaults };
  return out;
}

function cloneWidgetTokens(w: WidgetTokens): WidgetTokens {
  return {
    button: { ...w.button },
    dialog: { ...w.dialog },
    selectView: { ...w.selectView },
    modal: { ...w.modal },
    paneTitle: { ...w.paneTitle },
    statusBar: { ...w.statusBar },
    semantic: { ...w.semantic },
    icon: { ...w.icon },
  };
}

// ---------------------------------------------------------------------
// IDX-6 Phase 1 — widget-token resolution helpers.
// ---------------------------------------------------------------------

/** Read a widget's tokens from the theme, falling back to the
 *  DEFAULT_WIDGET_TOKENS when the theme ships only flat fields. The
 *  generic typing lets callers narrow to the concrete widget shape
 *  without casts:
 *
 *    const b = resolveWidgetTokens(theme, 'button');  // ButtonStateTokens
 *    const d = resolveWidgetTokens(theme, 'dialog');  // DialogWidgetTokens
 */
export function resolveWidgetTokens<K extends keyof WidgetTokens>(
  theme: ThemeTokens,
  kind: K,
): WidgetTokens[K] {
  const source = theme.widgetTokens ?? DEFAULT_WIDGET_TOKENS;
  return source[kind];
}

/** Convenience: pick a state from a widget whose shape is the
 *  six-state ButtonStateTokens (buttons today, other widgets as
 *  they migrate). Falls through to `normal` when a variant is
 *  absent. */
export function resolveButtonState(
  theme: ThemeTokens,
  state: WidgetState = 'normal',
): TokenPair {
  const tokens = resolveWidgetTokens(theme, 'button');
  return tokens[state] ?? tokens.normal;
}

/** Pick a semantic color. Theme-invariant per DD-IDX-15 — the red
 *  stays red-ish across presets. */
export function resolveSemantic(
  theme: ThemeTokens,
  kind: keyof SemanticTokens,
): TokenPair {
  const tokens = resolveWidgetTokens(theme, 'semantic');
  return tokens[kind];
}

/** Look up an icon glyph. Honors MONAD_ASCII_ICONS=1 by falling
 *  back to ASCII_SAFE_ICONS even when the theme ships emoji. */
export function resolveIcon(
  theme: ThemeTokens,
  name: keyof IconTokens,
): string {
  if (process.env.MONAD_ASCII_ICONS === '1') return ASCII_SAFE_ICONS[name];
  const tokens = resolveWidgetTokens(theme, 'icon');
  return tokens[name];
}

/** Render a TokenPair as a chalk-wrapped painter. Supports fg, bg,
 *  and the common attributes. Missing fg falls back to the theme's
 *  `text` color so callers always get a safe painter. */
export function paintPair(
  pair: TokenPair | undefined,
  fallback: string = DEFAULT_THEME_TOKENS.colors.text,
): (text: string) => string {
  if (!pair) return (t: string) => chalk.hex(fallback)(t);
  let c = chalk.hex(pair.fg || fallback);
  if (pair.bg && HEX_RE.test(pair.bg)) c = c.bgHex(pair.bg);
  if (pair.bold) c = c.bold;
  if (pair.faint) c = c.dim;
  if (pair.underline) c = c.underline;
  if (pair.inverse) c = c.inverse;
  return (text: string) => c(text);
}

/** Build a TokenPair from a hex + optional attrs. Exists so preset
 *  files stay compact:
 *
 *    button: { normal: pair('#89b4fa', { bold: true }) }
 */
export function pair(
  fg: string,
  attrs: Omit<TokenPair, 'fg'> = {},
): TokenPair {
  return { fg, ...attrs };
}

/** Produce the raw ANSI escape-sequence prefix for a TokenPair so
 *  APIs that take a `style: string` (e.g. BoxView.style) can honor
 *  the theme without swapping to a painter. Truecolor only — most
 *  terminals support it and the fallback path is "no escape,
 *  terminal default". Callers concatenate the prefix, their text,
 *  and RESET_SGR (`\x1b[0m`).
 *
 *  Example:
 *    const prefix = ansiForPair(pair('#89b4fa', { bold: true }));
 *    writeTerminal(prefix + 'hello' + '\x1b[0m');
 */
export function ansiForPair(p: TokenPair | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  const fg = hexToRgbTriple(p.fg);
  if (fg) parts.push(`38;2;${fg.r};${fg.g};${fg.b}`);
  if (p.bg) {
    const bg = hexToRgbTriple(p.bg);
    if (bg) parts.push(`48;2;${bg.r};${bg.g};${bg.b}`);
  }
  if (p.bold) parts.push('1');
  if (p.faint) parts.push('2');
  if (p.underline) parts.push('4');
  if (p.inverse) parts.push('7');
  return parts.length > 0 ? `\x1b[${parts.join(';')}m` : '';
}

function hexToRgbTriple(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let body = m[1]!;
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}
