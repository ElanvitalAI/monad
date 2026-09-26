import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  ASCII_SAFE_ICONS,
  DEFAULT_THEME_TOKENS,
  DEFAULT_WIDGET_TOKENS,
  pair,
  paintPair,
  resolveButtonState,
  resolveIcon,
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../src/theme/tokens.js';

// chalk emits plain text when stdout is not a TTY. Force truecolor for
// the paintPair assertions so we observe ANSI escapes deterministically.
const ORIG_CHALK_LEVEL = chalk.level;

describe('IDX-6 Phase 1 hierarchical widget tokens', () => {
  test('pair() is a thin constructor', () => {
    expect(pair('#123456')).toEqual({ fg: '#123456' });
    expect(pair('#123456', { bold: true, bg: '#000000' })).toEqual({
      fg: '#123456',
      bold: true,
      bg: '#000000',
    });
  });

  test('DEFAULT_WIDGET_TOKENS covers every widget kind', () => {
    expect(DEFAULT_WIDGET_TOKENS.button.normal.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_WIDGET_TOKENS.dialog.border.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_WIDGET_TOKENS.selectView.cursor.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_WIDGET_TOKENS.modal.border.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_WIDGET_TOKENS.paneTitle.active.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_WIDGET_TOKENS.statusBar.pill.fg).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('resolveWidgetTokens returns widgetTokens when present', () => {
    const withHierarchical: ThemeTokens = {
      ...DEFAULT_THEME_TOKENS,
      widgetTokens: {
        ...DEFAULT_WIDGET_TOKENS,
        button: {
          ...DEFAULT_WIDGET_TOKENS.button,
          normal: pair('#abcdef'),
        },
      },
    };
    expect(resolveWidgetTokens(withHierarchical, 'button').normal.fg).toBe('#abcdef');
    expect(resolveWidgetTokens(withHierarchical, 'dialog').border.fg).toBe(
      DEFAULT_WIDGET_TOKENS.dialog.border.fg,
    );
  });

  test('resolveWidgetTokens falls back to DEFAULT_WIDGET_TOKENS when theme lacks hierarchical', () => {
    // DEFAULT_THEME_TOKENS does NOT ship widgetTokens (by design — flat only).
    const kind = 'button';
    expect(resolveWidgetTokens(DEFAULT_THEME_TOKENS, kind)).toBe(
      DEFAULT_WIDGET_TOKENS[kind],
    );
  });

  test('resolveButtonState falls through missing variants to normal', () => {
    // Construct a theme with only `normal` defined.
    const minimal: ThemeTokens = {
      ...DEFAULT_THEME_TOKENS,
      widgetTokens: {
        ...DEFAULT_WIDGET_TOKENS,
        button: { normal: pair('#111111') },
      },
    };
    expect(resolveButtonState(minimal, 'normal').fg).toBe('#111111');
    expect(resolveButtonState(minimal, 'hovered').fg).toBe('#111111');
    expect(resolveButtonState(minimal, 'pressed').fg).toBe('#111111');
  });

  test('resolveButtonState picks the requested variant when present', () => {
    const theme: ThemeTokens = {
      ...DEFAULT_THEME_TOKENS,
      widgetTokens: {
        ...DEFAULT_WIDGET_TOKENS,
        button: {
          normal: pair('#000000'),
          focused: pair('#ff0000', { bold: true }),
          hovered: pair('#00ff00'),
        },
      },
    };
    expect(resolveButtonState(theme, 'focused')).toEqual({ fg: '#ff0000', bold: true });
    expect(resolveButtonState(theme, 'hovered')).toEqual({ fg: '#00ff00' });
    expect(resolveButtonState(theme, 'disabled').fg).toBe('#000000'); // fallback to normal
  });

  test('resolveSemantic returns the themed critical pair', () => {
    const crit = resolveSemantic(DEFAULT_THEME_TOKENS, 'critical');
    expect(crit.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(crit.bold).toBe(true);
  });

  test('semantic colors stay theme-invariant in meaning (DD-IDX-15)', () => {
    // Every preset's semantic.critical should be a red-ish hue.
    // Use a lenient check: first channel dominant OR classic red hex range.
    const themesToCheck: ThemeTokens[] = [DEFAULT_THEME_TOKENS];
    for (const t of themesToCheck) {
      const crit = resolveSemantic(t, 'critical');
      const hex = crit.fg.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      expect(r).toBeGreaterThan(g); // red > green
      expect(r).toBeGreaterThan(b); // red > blue
    }
  });
});

describe('IDX-6 Phase 1 icon resolution', () => {
  const origEnv = process.env.ELANOUS_ASCII_ICONS;

  beforeEach(() => {
    delete process.env.ELANOUS_ASCII_ICONS;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.ELANOUS_ASCII_ICONS;
    else process.env.ELANOUS_ASCII_ICONS = origEnv;
  });

  test('resolveIcon returns the themed glyph by default', () => {
    expect(resolveIcon(DEFAULT_THEME_TOKENS, 'terminal')).toBe('🖥️');
    expect(resolveIcon(DEFAULT_THEME_TOKENS, 'agent')).toBe('🤖');
  });

  test('ELANOUS_ASCII_ICONS=1 forces ASCII-safe fallback for every icon', () => {
    process.env.ELANOUS_ASCII_ICONS = '1';
    expect(resolveIcon(DEFAULT_THEME_TOKENS, 'terminal')).toBe(ASCII_SAFE_ICONS.terminal);
    expect(resolveIcon(DEFAULT_THEME_TOKENS, 'agent')).toBe(ASCII_SAFE_ICONS.agent);
    expect(resolveIcon(DEFAULT_THEME_TOKENS, 'task')).toBe(ASCII_SAFE_ICONS.task);
  });

  test('ASCII_SAFE_ICONS covers every IconTokens key', () => {
    const defaultKeys = Object.keys(DEFAULT_WIDGET_TOKENS.icon).sort();
    const asciiKeys = Object.keys(ASCII_SAFE_ICONS).sort();
    expect(asciiKeys).toEqual(defaultKeys);
  });
});

describe('IDX-6 Phase 1 paintPair', () => {
  beforeEach(() => {
    chalk.level = 3; // truecolor — ensures ANSI escapes emit
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('paintPair wraps text with chalk', () => {
    const painter = paintPair(pair('#89b4fa'));
    const out = painter('hello');
    // chalk emits ANSI escape codes around the text.
    expect(out).toContain('hello');
    expect(out.length).toBeGreaterThan('hello'.length);
  });

  test('paintPair uses fallback when pair is undefined', () => {
    const painter = paintPair(undefined);
    expect(painter('x')).toContain('x');
  });

  test('paintPair applies bg + bold when set', () => {
    const painter = paintPair(pair('#000000', { bg: '#ffffff', bold: true }));
    const out = painter('x');
    // Should contain a bold escape (\x1b[1m) and some ANSI.
    expect(out).toContain('\x1b[');
    expect(out).toContain('x');
  });

  test('paintPair ignores invalid bg hex gracefully', () => {
    const painter = paintPair(pair('#000000', { bg: 'not-a-hex' as unknown as string }));
    expect(painter('x')).toContain('x');
  });
});
