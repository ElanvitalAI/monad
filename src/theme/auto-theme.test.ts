import { describe, expect, test } from 'bun:test';
import type { TerminalBgResult } from '../panes/terminal-bg-query.js';
import { THEME_REGISTRY } from '../themes/index.js';
import { suggestAutoTheme } from './auto-theme.js';

function detected(rgb: { r: number; g: number; b: number }): TerminalBgResult {
  return { mode: 'dark', rgb, luminance: 0, reason: 'ok' };
}

const noExplicitSelection = {
  currentThemeName: 'catppuccin-mocha',
  hasExplicitUserSelection: false,
} as const;

describe('suggestAutoTheme', () => {
  test('suggests a dark registry theme for a dark terminal background', async () => {
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      query: async () => detected({ r: 0, g: 0, b: 0 }),
    });
    const theme = THEME_REGISTRY.find(({ name }) => name === suggestion.themeName);

    expect(suggestion.reason).toBe('terminal-background');
    expect(suggestion.mode).toBe('dark');
    expect(theme?.isDark).toBe(true);
  });

  test('suggests a light registry theme for a light terminal background', async () => {
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      query: async () => detected({ r: 255, g: 255, b: 255 }),
    });
    const theme = THEME_REGISTRY.find(({ name }) => name === suggestion.themeName);

    expect(suggestion.reason).toBe('terminal-background');
    expect(suggestion.mode).toBe('light');
    expect(theme?.isDark).toBe(false);
  });

  test('preserves an explicit user selection over the detected mode', async () => {
    const suggestion = await suggestAutoTheme({
      currentThemeName: 'user-choice',
      hasExplicitUserSelection: true,
      query: () => {
        throw new Error('the detector must not run for an explicit selection');
      },
    });

    expect(suggestion).toEqual({
      themeName: 'user-choice',
      reason: 'explicit-user-selection',
      mode: null,
    });
  });

  test('returns an explained no-suggestion result when detection is unavailable', async () => {
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      query: async () => ({ mode: null, rgb: null, luminance: null, reason: 'timeout' }),
    });

    expect(suggestion).toEqual({
      themeName: null,
      reason: 'terminal-background-unavailable',
      mode: null,
    });
  });

  test('converts synchronous detector throws and rejected promises into no suggestion', async () => {
    for (const query of [
      () => {
        throw new Error('sync failure');
      },
      async () => Promise.reject(new Error('async failure')),
    ]) {
      await expect(suggestAutoTheme({ ...noExplicitSelection, query })).resolves.toEqual({
        themeName: null,
        reason: 'terminal-background-unavailable',
        mode: null,
      });
    }
  });

  test('derives the suggestion from the supplied reduced registry order', async () => {
    const registry = [
      { name: 'only-light', isDark: false },
      { name: 'remaining-dark', isDark: true },
    ];
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      registry,
      query: async () => detected({ r: 0, g: 0, b: 0 }),
    });

    expect(suggestion.themeName).toBe(registry[1]!.name);
    expect(registry.some(({ name }) => name === suggestion.themeName)).toBe(true);
  });

  test('excludes themes with unknown brightness instead of treating them as light', async () => {
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      registry: [{ name: 'unknown-brightness' }],
      query: async () => detected({ r: 255, g: 255, b: 255 }),
    });

    expect(suggestion).toEqual({
      themeName: null,
      reason: 'no-matching-theme',
      mode: 'light',
    });
  });

  test('selects an explicitly light theme after skipping unknown brightness', async () => {
    const suggestion = await suggestAutoTheme({
      ...noExplicitSelection,
      registry: [
        { name: 'unknown-brightness' },
        { name: 'explicitly-light', isDark: false },
      ],
      query: async () => detected({ r: 255, g: 255, b: 255 }),
    });

    expect(suggestion.themeName).toBe('explicitly-light');
  });
});
