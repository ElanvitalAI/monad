// ── Pane title with active indicator (Catppuccin) ──
// Extracted from dashboard.ts so each pane module can render its own title.
//
// P4b (2026-04-20) — optional `titleStyle: TextStyle` consumer path. When
// provided, the TextStyle's ANSI attributes wrap the rendered label (on
// top of the existing theme.pane.titleActive/Inactive color). `null` or
// omitted → legacy path unchanged. Backward-compat: every existing
// caller continues to work without passing `titleStyle`.

import chalk from 'chalk';
import { visibleWidth } from '../tui.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../theme/tokens.js';
import type { TextStyle } from '../ui/attributes/text-style.js';
import { composeAnsi } from '../ui/chrome/text-style-to-ansi.js';

/** Render the classic pane title line. New `titleStyle` option is
 *  additive — callers that omit it keep the pre-P4b behaviour
 *  byte-for-byte. `titleStyle` is wrapped around the LABEL only
 *  (not the surrounding '━' / '─' glyphs) so theme-driven tint on
 *  the line itself stays untouched. */
export function paneTitle(
  title: string,
  active: boolean,
  w: number,
  theme: ThemeTokens = DEFAULT_THEME_TOKENS,
  titleStyle?: TextStyle | null,
): string {
  const raw = `┤ ${title} ├`;
  const rawW = visibleWidth(raw);
  const wrapLabel = (s: string): string => {
    if (!titleStyle) return s;
    const { open, close } = composeAnsi(titleStyle, theme);
    if (!open) return s;
    return `${open}${s}${close}`;
  };
  if (active) {
    const label = wrapLabel(chalk.bold.hex(theme.pane.titleActive)(raw));
    const line = chalk.hex(theme.pane.titleActive)('━');
    return line + label + chalk.hex(theme.pane.titleActive)('━'.repeat(Math.max(0, w - rawW - 1)));
  } else {
    const label = wrapLabel(chalk.hex(theme.pane.titleInactive)(raw));
    const line = chalk.hex(theme.pane.titleInactive)('─');
    return line + label + chalk.hex(theme.pane.titleInactive)('─'.repeat(Math.max(0, w - rawW - 1)));
  }
}

/** Compact border label variant for pane chrome. Unlike `paneTitle()`,
 *  this does not paint a whole row; it only styles + truncates the
 *  title fragment that higher-level chrome renderers stamp into an
 *  existing border line. Kept here so pane title semantics stay in
 *  one place across widgets, VWs, and future declarative consumers. */
export function paneBorderTitle(
  title: string,
  state: 'active' | 'inactive' | 'pulse-a' | 'pulse-b',
  maxWidth: number,
  theme: ThemeTokens = DEFAULT_THEME_TOKENS,
): string {
  const clean = title.trim();
  if (!clean || maxWidth <= 0) return '';
  const raw = truncateVisible(clean, maxWidth);
  if (state === 'pulse-b') {
    return chalk.bold.hex(theme.colors.warning)(raw);
  }
  if (state === 'active' || state === 'pulse-a') {
    return chalk.bold.hex(theme.pane.titleActive)(raw);
  }
  return chalk.hex(theme.pane.titleInactive)(raw);
}

function truncateVisible(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  let out = '';
  for (const ch of text) {
    const next = out + ch;
    if (visibleWidth(next) > maxWidth - 1) break;
    out = next;
  }
  return out + '…';
}
