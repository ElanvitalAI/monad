// Markdown render themes — 6 presets that hand the markdown renderer
// a coherent palette without dragging the dashboard's full theme stack
// in. Each preset materializes through `adaptive(hex)` so `truecolor`,
// `ansi256`, and `ansi16` profiles all degrade gracefully from a single
// hex authoritative source.
//
// Renderers consume the `MarkdownTheme` shape directly. Hosts that
// already resolved a different theme system can hand-roll a
// `MarkdownTheme` without using the presets here.

import { type AdaptiveColor, adaptive } from '../color.js';

export interface MarkdownTheme {
  /** H1..H6 colors. The renderer falls back to the last entry for
   *  levels deeper than the array (we only ship 6 — markdown caps at
   *  six anyway). */
  headings: readonly AdaptiveColor[];
  /** Default paragraph foreground. */
  text: AdaptiveColor;
  /** Faint / annotative text — link URLs, language labels, quote body. */
  muted: AdaptiveColor;
  /** Primary accent — bullets, numbered markers, code-block left bar. */
  accent: AdaptiveColor;
  /** Inline + block code foreground. */
  code: AdaptiveColor;
  /** Inline code background. Block code stays bare so wrap-around lines
   *  don't smear bg color across the gutter. */
  codeBg: AdaptiveColor;
  /** Hyperlink foreground (paired with underline). */
  link: AdaptiveColor;
  /** Quote left-bar color. */
  quote: AdaptiveColor;
  /** Horizontal rule color. */
  hr: AdaptiveColor;
}

// Catppuccin Mocha — matches elanous's IDX track default-pastel theme.
const THEME_DEFAULT: MarkdownTheme = {
  headings: [
    adaptive('#cba6f7'), // h1 mauve
    adaptive('#89b4fa'), // h2 blue
    adaptive('#94e2d5'), // h3 teal
    adaptive('#a6e3a1'), // h4 green
    adaptive('#f9e2af'), // h5 yellow
    adaptive('#f5c2e7'), // h6 pink
  ],
  text: adaptive('#cdd6f4'),
  muted: adaptive('#7f849c'),
  accent: adaptive('#89b4fa'),
  code: adaptive('#fab387'),
  codeBg: adaptive('#313244'),
  link: adaptive('#74c7ec'),
  quote: adaptive('#a6adc8'),
  hr: adaptive('#585b70'),
};

// Plain dark — for terminals/themes that prefer minimal hue.
const THEME_DARK: MarkdownTheme = {
  headings: [
    adaptive('#ffffff'),
    adaptive('#e0e0e0'),
    adaptive('#c8c8c8'),
    adaptive('#b0b0b0'),
    adaptive('#9a9a9a'),
    adaptive('#808080'),
  ],
  text: adaptive('#d4d4d4'),
  muted: adaptive('#808080'),
  accent: adaptive('#569cd6'),
  code: adaptive('#ce9178'),
  codeBg: adaptive('#2d2d30'),
  link: adaptive('#3794ff'),
  quote: adaptive('#9cdcfe'),
  hr: adaptive('#3e3e42'),
};

// Light — for terminals running in light mode (sun-lit offices).
const THEME_LIGHT: MarkdownTheme = {
  headings: [
    adaptive('#1a1a1a'),
    adaptive('#2a2a2a'),
    adaptive('#3a3a3a'),
    adaptive('#4a4a4a'),
    adaptive('#5a5a5a'),
    adaptive('#6a6a6a'),
  ],
  text: adaptive('#1e1e1e'),
  muted: adaptive('#6e6e6e'),
  accent: adaptive('#005cc5'),
  code: adaptive('#d73a49'),
  codeBg: adaptive('#f0f2f4'),
  link: adaptive('#0366d6'),
  quote: adaptive('#586069'),
  hr: adaptive('#d1d5da'),
};

// Nord — calm cool palette.
const THEME_NORD: MarkdownTheme = {
  headings: [
    adaptive('#88c0d0'),
    adaptive('#8fbcbb'),
    adaptive('#81a1c1'),
    adaptive('#5e81ac'),
    adaptive('#b48ead'),
    adaptive('#d08770'),
  ],
  text: adaptive('#eceff4'),
  muted: adaptive('#4c566a'),
  accent: adaptive('#88c0d0'),
  code: adaptive('#ebcb8b'),
  codeBg: adaptive('#3b4252'),
  link: adaptive('#8fbcbb'),
  quote: adaptive('#d8dee9'),
  hr: adaptive('#434c5e'),
};

// Gruvbox — warm retro palette.
const THEME_GRUVBOX: MarkdownTheme = {
  headings: [
    adaptive('#fb4934'),
    adaptive('#fabd2f'),
    adaptive('#b8bb26'),
    adaptive('#83a598'),
    adaptive('#d3869b'),
    adaptive('#fe8019'),
  ],
  text: adaptive('#ebdbb2'),
  muted: adaptive('#928374'),
  accent: adaptive('#fabd2f'),
  code: adaptive('#fe8019'),
  codeBg: adaptive('#3c3836'),
  link: adaptive('#83a598'),
  quote: adaptive('#bdae93'),
  hr: adaptive('#504945'),
};

// Mono — bold/faint only (no chromatic intent). Useful when the host
// theme is already grayscale or accessibility prefers high-contrast.
const THEME_MONO: MarkdownTheme = {
  headings: [
    adaptive('#ffffff'),
    adaptive('#e8e8e8'),
    adaptive('#c8c8c8'),
    adaptive('#a8a8a8'),
    adaptive('#888888'),
    adaptive('#707070'),
  ],
  text: adaptive('#ffffff'),
  muted: adaptive('#808080'),
  accent: adaptive('#ffffff'),
  code: adaptive('#ffffff'),
  codeBg: adaptive('#404040'),
  link: adaptive('#ffffff'),
  quote: adaptive('#c0c0c0'),
  hr: adaptive('#606060'),
};

export const MARKDOWN_THEMES = {
  default: THEME_DEFAULT,
  dark: THEME_DARK,
  light: THEME_LIGHT,
  nord: THEME_NORD,
  gruvbox: THEME_GRUVBOX,
  mono: THEME_MONO,
} as const;

export type MarkdownThemeName = keyof typeof MARKDOWN_THEMES;

/** Pick a markdown theme by name, falling back to the default. Helpful
 *  when the spec's `theme` field is a free-form string. */
export function pickMarkdownTheme(name?: string): MarkdownTheme {
  if (!name) return THEME_DEFAULT;
  return (MARKDOWN_THEMES as Record<string, MarkdownTheme>)[name] ?? THEME_DEFAULT;
}
