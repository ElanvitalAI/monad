import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THEME_TOKENS,
  isThemeColor,
  mergeThemeTokens,
  resolveThemeTokens,
} from '../src/theme/tokens.js';

describe('theme tokens', () => {
  test('resolves defaults when config is absent or malformed', () => {
    expect(resolveThemeTokens(null).name).toBe(DEFAULT_THEME_TOKENS.name);
    expect(resolveThemeTokens('bad').colors.accent).toBe(DEFAULT_THEME_TOKENS.colors.accent);
  });

  test('merges direct semantic token overrides', () => {
    const theme = resolveThemeTokens({
      name: 'mono-test',
      colors: { accent: '#123abc', error: 'not-a-color' },
      pane: { dividerActive: '#abcdef' },
      modal: { borderActive: '#010203' },
    });
    expect(theme.name).toBe('mono-test');
    expect(theme.colors.accent).toBe('#123abc');
    expect(theme.colors.error).toBe(DEFAULT_THEME_TOKENS.colors.error);
    expect(theme.pane.dividerActive).toBe('#abcdef');
    expect(theme.modal.borderActive).toBe('#010203');
  });

  test('accepts wrapper config shape for future theme references', () => {
    const theme = resolveThemeTokens({
      active: 'plugin:theme.demo',
      tokens: {
        widget: { accent: '#222222' },
      },
    });
    expect(theme.widget.accent).toBe('#222222');
  });

  test('merge returns a copy, not the default object', () => {
    const merged = mergeThemeTokens(DEFAULT_THEME_TOKENS, {});
    expect(merged).not.toBe(DEFAULT_THEME_TOKENS);
    expect(merged.colors).not.toBe(DEFAULT_THEME_TOKENS.colors);
  });

  test('validates hex colors only', () => {
    expect(isThemeColor('#fff')).toBe(true);
    expect(isThemeColor('#ffffff')).toBe(true);
    expect(isThemeColor('red')).toBe(false);
  });
});
