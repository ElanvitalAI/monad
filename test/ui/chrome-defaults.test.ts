// ── F8 chrome-defaults · resolver + built-in shapes tests ──
//
// ROADMAP-ui-core-separation §4 Phase S2.

import { describe, test, expect } from 'bun:test';
import {
  BUILT_IN_CHROME_DEFAULTS,
  isChromeTier,
  resolveChromeDefault,
  type ChromeDefaults,
} from '../../src/ui/chrome-defaults.js';
import { BoxDecoration } from '../../src/ui/attributes/box-decoration.js';
import { BorderSpec } from '../../src/ui/attributes/border.js';
import { BorderRadius } from '../../src/ui/attributes/border.js';
import { EdgeInsets } from '../../src/ui/attributes/edge-insets.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../../src/theme/tokens.js';

function themeWithDefaults(defaults: ChromeDefaults): ThemeTokens {
  return { ...DEFAULT_THEME_TOKENS, chromeDefaults: defaults };
}

describe('F8 · isChromeTier', () => {
  test('classifies dialog/popup/menu/terminal as chrome tiers', () => {
    expect(isChromeTier('dialog')).toBe(true);
    expect(isChromeTier('popup')).toBe(true);
    expect(isChromeTier('menu')).toBe(true);
    expect(isChromeTier('terminal')).toBe(true);
  });

  test('rejects non-chrome tiers (host overlays + caller-managed)', () => {
    expect(isChromeTier('vw')).toBe(false);
    expect(isChromeTier('execution')).toBe(false);
    expect(isChromeTier('picker')).toBe(false);
    expect(isChromeTier('tooltip')).toBe(false);
  });

  test('rejects undefined / null', () => {
    expect(isChromeTier(undefined)).toBe(false);
    expect(isChromeTier(null)).toBe(false);
  });
});

describe('F8 · BUILT_IN_CHROME_DEFAULTS', () => {
  test('every chrome tier has a renderable BoxDecoration', () => {
    for (const tier of ['dialog', 'popup', 'menu', 'terminal'] as const) {
      const d = BUILT_IN_CHROME_DEFAULTS[tier];
      expect(d).toBeInstanceOf(BoxDecoration);
      expect(d.border).toBeInstanceOf(BorderSpec);
      expect(d.border?.top).toBeTruthy();
      expect(d.border?.bottom).toBeTruthy();
      expect(d.border?.left).toBeTruthy();
      expect(d.border?.right).toBeTruthy();
    }
  });

  test('dialog gets full padding (1) and rounded corners', () => {
    const d = BUILT_IN_CHROME_DEFAULTS.dialog;
    expect(d.padding).toBeInstanceOf(EdgeInsets);
    expect(d.padding?.top).toBe(1);
    expect(d.padding?.bottom).toBe(1);
    expect(d.padding?.left).toBe(1);
    expect(d.padding?.right).toBe(1);
    expect(d.borderRadius).toBeInstanceOf(BorderRadius);
    expect(d.borderRadius?.topLeft).toBe(1);
  });

  test('popup uses horizontal-only padding (compact)', () => {
    const d = BUILT_IN_CHROME_DEFAULTS.popup;
    expect(d.padding?.top).toBe(0);
    expect(d.padding?.bottom).toBe(0);
    expect(d.padding?.left).toBe(1);
    expect(d.padding?.right).toBe(1);
  });

  test('terminal uses zero padding (terminal owns its content area)', () => {
    const d = BUILT_IN_CHROME_DEFAULTS.terminal;
    expect(d.padding?.top).toBe(0);
    expect(d.padding?.bottom).toBe(0);
    expect(d.padding?.left).toBe(0);
    expect(d.padding?.right).toBe(0);
  });

  test('borders use semantic "border.focused" token (theme accent)', () => {
    for (const tier of ['dialog', 'popup', 'menu', 'terminal'] as const) {
      const d = BUILT_IN_CHROME_DEFAULTS[tier];
      expect(d.border?.top?.color).toBe('border.focused');
      expect(d.border?.top?.style).toBe('solid');
    }
  });

  test('frozen — runtime can not mutate the registry by accident', () => {
    expect(() => {
      // @ts-expect-error -- Object.freeze runtime guard
      BUILT_IN_CHROME_DEFAULTS.dialog = new BoxDecoration();
    }).toThrow();
  });
});

describe('F8 · resolveChromeDefault', () => {
  test('returns undefined for non-chrome tiers', () => {
    expect(resolveChromeDefault('vw', DEFAULT_THEME_TOKENS)).toBeUndefined();
    expect(resolveChromeDefault('execution', DEFAULT_THEME_TOKENS)).toBeUndefined();
    expect(resolveChromeDefault('picker', DEFAULT_THEME_TOKENS)).toBeUndefined();
    expect(resolveChromeDefault('tooltip', DEFAULT_THEME_TOKENS)).toBeUndefined();
  });

  test('returns undefined when theme is missing', () => {
    expect(resolveChromeDefault('dialog', undefined)).toBeUndefined();
    expect(resolveChromeDefault('dialog', null)).toBeUndefined();
  });

  test('returns undefined when theme has no chromeDefaults field', () => {
    // DEFAULT_THEME_TOKENS does not ship chromeDefaults — keeps the
    // pre-S2 contract (themes that haven't opted in get no auto-chrome).
    expect(resolveChromeDefault('dialog', DEFAULT_THEME_TOKENS)).toBeUndefined();
  });

  test('returns the theme override when present', () => {
    const custom = new BoxDecoration({
      border: BorderSpec.all({ style: 'double' }),
      padding: EdgeInsets.all(2),
    });
    const theme = themeWithDefaults({ dialog: custom });
    expect(resolveChromeDefault('dialog', theme)).toBe(custom);
  });

  test('returns undefined for tiers the theme did NOT override', () => {
    const custom = new BoxDecoration({ padding: EdgeInsets.all(1) });
    const theme = themeWithDefaults({ dialog: custom });
    // Theme only provides dialog; popup/menu/terminal explicitly absent.
    expect(resolveChromeDefault('dialog', theme)).toBe(custom);
    expect(resolveChromeDefault('popup', theme)).toBeUndefined();
    expect(resolveChromeDefault('menu', theme)).toBeUndefined();
    expect(resolveChromeDefault('terminal', theme)).toBeUndefined();
  });

  test('5-tier matrix when theme provides every chrome tier', () => {
    const make = (label: string): BoxDecoration =>
      new BoxDecoration({
        padding: EdgeInsets.all(1),
        border: BorderSpec.all({ style: 'solid', color: label }),
      });
    const dialogD = make('dialog-c');
    const popupD = make('popup-c');
    const menuD = make('menu-c');
    const termD = make('term-c');
    const theme = themeWithDefaults({
      dialog: dialogD,
      popup: popupD,
      menu: menuD,
      terminal: termD,
    });
    expect(resolveChromeDefault('dialog', theme)).toBe(dialogD);
    expect(resolveChromeDefault('popup', theme)).toBe(popupD);
    expect(resolveChromeDefault('menu', theme)).toBe(menuD);
    expect(resolveChromeDefault('terminal', theme)).toBe(termD);
  });

  test('built-in shapes are themselves valid theme overrides (round-trip)', () => {
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
      popup: BUILT_IN_CHROME_DEFAULTS.popup,
    });
    expect(resolveChromeDefault('dialog', theme)).toBe(BUILT_IN_CHROME_DEFAULTS.dialog);
    expect(resolveChromeDefault('popup', theme)).toBe(BUILT_IN_CHROME_DEFAULTS.popup);
  });

  test('themes can derive from built-ins via copyWith for palette overrides', () => {
    const customPad = EdgeInsets.all(3);
    const customDialog = BUILT_IN_CHROME_DEFAULTS.dialog.copyWith({ padding: customPad });
    const theme = themeWithDefaults({ dialog: customDialog });
    const resolved = resolveChromeDefault('dialog', theme);
    expect(resolved).toBe(customDialog);
    expect(resolved?.padding).toBe(customPad);
    // Border + radius preserved from baseline.
    expect(resolved?.border?.top?.color).toBe('border.focused');
    expect(resolved?.borderRadius?.topLeft).toBe(1);
  });
});
