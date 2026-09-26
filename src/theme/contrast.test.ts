import { describe, expect, test } from 'bun:test';
import { measureContrast, WCAG_NORMAL_TEXT_CONTRAST_RATIO } from './contrast.js';
import { THEME_REGISTRY } from '../themes/index.js';
import type { TokenPair } from './tokens.js';

const EXPECTED_BELOW_NORMAL_TEXT: Readonly<Record<string, ReadonlyArray<string>>> = {
  'catppuccin-mocha': [],
  'mocha-pastel-accent': [],
  'catppuccin-latte': [
    'button.focused',
    'button.pressed',
    'selectView.cursor',
    'selectView.selected',
    'statusBar.pillActive',
    'statusBar.pillHovered',
  ],
  'rose-pine-dawn': [
    'button.focused',
    'button.pressed',
    'selectView.cursor',
    'statusBar.pillActive',
  ],
  'nord-light': [
    'button.focused',
    'button.pressed',
    'selectView.cursor',
    'statusBar.pillActive',
  ],
  'elanous-pastel-default': [],
};

function directTokenPairs(value: unknown, path = ''): Array<{ name: string; pair: TokenPair }> {
  if (!value || typeof value !== 'object') return [];

  const candidate = value as Partial<TokenPair>;
  if (typeof candidate.fg === 'string' && typeof candidate.bg === 'string') {
    return [{ name: path, pair: candidate as TokenPair }];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    directTokenPairs(child, path ? `${path}.${key}` : key),
  );
}

describe('theme contrast measurement', () => {
  test('distinguishes a clearly high-contrast pair from identical colors', () => {
    const highContrast = measureContrast('#000000', '#ffffff');
    const identical = measureContrast('#336699', '#336699');

    expect(highContrast).toBeGreaterThan(identical!);
    expect(identical).toBeCloseTo(1);
  });

  test('returns null for colors rejected by the shared hex parser', () => {
    expect(measureContrast('not-a-color', '#ffffff')).toBeNull();
  });
});

describe('elanous pastel default accent roles', () => {
  const theme = THEME_REGISTRY.find(({ name }) => name === 'elanous-pastel-default');
  const widgetTokens = theme?.widgetTokens;
  const focused = widgetTokens?.button?.focused;
  const pressed = widgetTokens?.button?.pressed;
  const cursor = widgetTokens?.selectView?.cursor;
  const pillActive = widgetTokens?.statusBar?.pillActive;
  if (!theme || !focused || !pressed || !cursor || !pillActive) {
    throw new Error('missing elanous-pastel-default accent token');
  }

  test('uses normal-text contrast for the four repaired accent pairs', () => {
    for (const pair of [focused, pressed, cursor, pillActive]) {
      expect(measureContrast(pair.fg, pair.bg!)).toBeGreaterThanOrEqual(WCAG_NORMAL_TEXT_CONTRAST_RATIO);
    }
  });

  test('keeps bright accent fills separate from dark accent text', () => {
    const fillAccent = theme.colors.accent;
    const textAccent = cursor.fg;

    expect(fillAccent).toBeString();
    expect(textAccent).toBeString();
    expect(fillAccent).not.toBe(textAccent);
  });
});

describe('theme registry contrast audit', () => {
  for (const theme of THEME_REGISTRY) {
    test(`${theme.name} audits every directly declared foreground/background pair`, () => {
      const inspectedPairs = directTokenPairs(theme.widgetTokens);
      expect(inspectedPairs.length).toBeGreaterThan(0);

      const belowThreshold = inspectedPairs
        .filter(({ pair }) => measureContrast(pair.fg, pair.bg!)! < WCAG_NORMAL_TEXT_CONTRAST_RATIO)
        .map(({ name }) => name);

      const expectedBelowThreshold = EXPECTED_BELOW_NORMAL_TEXT[theme.name];
      if (!expectedBelowThreshold) throw new Error(`missing audit expectation for ${theme.name}`);
      expect(belowThreshold).toEqual([...expectedBelowThreshold]);
    });
  }
});
