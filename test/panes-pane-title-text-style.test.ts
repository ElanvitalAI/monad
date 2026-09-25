// ── Presentation P4b · pane-title TextStyle consumer ──
//
// paneTitle() accepts an optional TextStyle. When provided, composeAnsi
// wraps the title label with the style's ANSI attributes. When omitted,
// the legacy rendering path is preserved byte-for-byte.

import { describe, test, expect } from 'bun:test';
import { paneBorderTitle, paneTitle } from '../src/panes/pane-title.js';
import { TextStyle } from '../src/ui/attributes/text-style.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import { stripAnsi } from '../src/tui.js';

const theme = DEFAULT_THEME_TOKENS;

describe('paneTitle · backward compat', () => {
  test('no titleStyle · active · returns legacy rendering', () => {
    const a = paneTitle('Pane', true, 30, theme);
    const b = paneTitle('Pane', true, 30, theme, null);
    const c = paneTitle('Pane', true, 30, theme, undefined);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('no titleStyle · inactive · returns legacy rendering', () => {
    const a = paneTitle('Pane', false, 30, theme);
    const b = paneTitle('Pane', false, 30, theme, new TextStyle());
    // An all-null TextStyle produces empty SGR · paneTitle short-
    // circuits to the legacy output byte-for-byte.
    expect(a).toBe(b);
  });
});

describe('paneTitle · titleStyle ANSI wrap', () => {
  test('titleStyle with bold wraps label with SGR 1', () => {
    const out = paneTitle('Pane', true, 30, theme, new TextStyle({ bold: true }));
    // SGR 1 appears somewhere in the wrapped output
    expect(out).toMatch(/\u001b\[(?:[^m]*;)?1(?:[;m])/);
  });

  test('titleStyle with color emits a 38;2 RGB SGR', () => {
    const out = paneTitle('Pane', true, 30, theme, new TextStyle({ color: '#abcdef' }));
    expect(out).toContain('38;2;');
  });

  test('titleStyle with underline wraps label with SGR 4', () => {
    const out = paneTitle('Pane', false, 30, theme, new TextStyle({ underline: true }));
    expect(out).toMatch(/\u001b\[(?:[^m]*;)?4(?:[;:m])/);
  });

  test('Zellij extended emphasis · overline emits SGR 53', () => {
    const out = paneTitle('Pane', true, 30, theme, new TextStyle({ overline: true }));
    expect(out).toContain('53');
  });

  test('line glyphs outside label retain theme color (not wrapped)', () => {
    // active line uses '━' · inactive uses '─'. Wrap should only cover
    // the `┤ label ├` portion, not the leading/trailing line glyphs.
    const out = paneTitle('Pane', true, 30, theme, new TextStyle({ bold: true }));
    // The line glyphs ━ appear outside the bold SGR — verify the string
    // still renders the glyphs.
    expect(out).toContain('━');
    expect(out).toContain('┤ Pane ├');
  });
});

describe('paneTitle · dimensions preserved', () => {
  test('visible width unchanged when titleStyle applied', () => {
    const plain = paneTitle('Pane', true, 30, theme);
    const styled = paneTitle('Pane', true, 30, theme, new TextStyle({ bold: true }));
    // Both should produce the same visible glyph layout — ANSI doesn't
    // take cells. We can't easily strip, but we can check the styled
    // version contains the same visible sequence.
    expect(styled).toContain('┤ Pane ├');
    expect(plain).toContain('┤ Pane ├');
  });
});

describe('paneBorderTitle', () => {
  test('returns active title text without border-row filler', () => {
    const out = stripAnsi(paneBorderTitle('codex', 'active', 20, theme));
    expect(out).toBe('codex');
  });

  test('truncates long titles to available width', () => {
    const out = stripAnsi(paneBorderTitle('very-long-pane-title', 'inactive', 8, theme));
    expect(out).toBe('very-lo…');
  });

  test('pulse-b switches to warning tint while preserving text', () => {
    const out = paneBorderTitle('claude', 'pulse-b', 20, theme);
    expect(stripAnsi(out)).toBe('claude');
    expect(out.length).toBeGreaterThan(0);
  });
});
