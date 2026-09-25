// ── F8 modal-adapter · chrome default propagation tests ──
//
// ROADMAP-ui-core-separation §4 Phase S2.
//
// Verifies that `mountViewAsModalSurface` substitutes the per-tier
// `chromeDefaults` decoration when the caller doesn't pass one
// explicitly and the theme has opted in. Existing call sites that
// do pass `decoration` keep winning; themes without `chromeDefaults`
// keep getting un-framed surfaces (pre-S2 contract).

import { describe, expect, test } from 'bun:test';
import {
  mountViewAsModalSurface,
  __resetModalAdapterThemeForTests,
} from '../../src/ui/modal-adapter.js';
import { SelectView } from '../../src/ui/widgets/select-view.js';
import { stripAnsi } from '../../src/tui.js';
import { BoxDecoration } from '../../src/ui/attributes/box-decoration.js';
import { BorderSpec, BorderRadius } from '../../src/ui/attributes/border.js';
import { EdgeInsets } from '../../src/ui/attributes/edge-insets.js';
import {
  BUILT_IN_CHROME_DEFAULTS,
  type ChromeDefaults,
} from '../../src/ui/chrome-defaults.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../../src/theme/tokens.js';

function makeView(): SelectView<string> {
  return new SelectView<string>({
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
    onSubmit: () => {},
  });
}

function themeWithDefaults(defaults: ChromeDefaults): ThemeTokens {
  return { ...DEFAULT_THEME_TOKENS, chromeDefaults: defaults };
}

describe('F8 · modal-adapter · chrome default propagation', () => {
  test('themes WITHOUT chromeDefaults paint un-framed (pre-S2 contract)', () => {
    __resetModalAdapterThemeForTests();
    const h = mountViewAsModalSurface({
      id: 'no-defaults',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'dialog',
      theme: DEFAULT_THEME_TOKENS,
    });
    const out = stripAnsi(h.surface.paint());
    // Without chromeDefaults the adapter does NOT inject a border —
    // the rendered output is the raw view content with no border glyphs.
    expect(out).toContain('Alpha');
    expect(out).not.toMatch(/[╭┌╰└]/); // no top/bottom corner glyphs
  });

  test('themes WITH chromeDefaults auto-frame matching tier modals', () => {
    __resetModalAdapterThemeForTests();
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
    });
    const h = mountViewAsModalSurface({
      id: 'with-defaults',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'dialog',
      theme,
    });
    const out = stripAnsi(h.surface.paint());
    // Border + rounded corners + horizontal/vertical pad.
    expect(out).toMatch(/[╭┌]/);
    expect(out).toMatch(/[╰└]/);
    expect(out).toMatch(/[─]/);
    expect(out).toMatch(/[│]/);
  });

  test('explicit `decoration` wins over theme chromeDefaults', () => {
    __resetModalAdapterThemeForTests();
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog, // would normally apply
    });
    const explicit = new BoxDecoration({
      // Different border style → produces double-line glyphs the
      // built-in does not emit.
      border: BorderSpec.all({ style: 'double' }),
    });
    const h = mountViewAsModalSurface({
      id: 'explicit-wins',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'dialog',
      theme,
      decoration: explicit,
    });
    const out = stripAnsi(h.surface.paint());
    expect(out).toMatch(/[╔╗╚╝═║]/); // double-line glyphs
  });

  test('non-chrome tiers (vw / execution / picker / tooltip) skip auto-default', () => {
    __resetModalAdapterThemeForTests();
    const theme = themeWithDefaults({
      // Even if a theme injected a dialog default, picker tier opts out.
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
    });
    const h = mountViewAsModalSurface({
      id: 'picker-no-frame',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'picker',
      theme,
    });
    const out = stripAnsi(h.surface.paint());
    expect(out).not.toMatch(/[╭┌╰└]/);
  });

  test('per-tier override — only the tiers themed get auto-chrome', () => {
    __resetModalAdapterThemeForTests();
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
      // popup / menu / terminal absent.
    });
    const dialog = mountViewAsModalSurface({
      id: 'd',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'dialog',
      theme,
    });
    const popup = mountViewAsModalSurface({
      id: 'p',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'popup',
      theme,
    });
    expect(stripAnsi(dialog.surface.paint())).toMatch(/[╭╰]/);
    expect(stripAnsi(popup.surface.paint())).not.toMatch(/[╭╰]/);
  });

  test('inner view dims shrink when chrome auto-applies', () => {
    __resetModalAdapterThemeForTests();
    // Very narrow modal · without chrome the layout sees the full 12
    // cells of width; with the dialog default (border + 1 pad each
    // side) it sees 12 - 2(border) - 2(pad) = 8.
    let layoutWidth = -1;
    let layoutHeight = -1;
    const view = {
      layout(b: { width: number; height: number }): void {
        layoutWidth = b.width;
        layoutHeight = b.height;
      },
      takeFocus(_dir: 'front' | 'back'): void {},
      blur(): void {},
      handleKey(_k: unknown): 'consumed' | 'passthrough' { return 'passthrough'; },
      handleMouse(_m: unknown): 'consumed' | 'passthrough' { return 'passthrough'; },
      draw(_p: unknown): void {},
    };
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mountViewAsModalSurface({
      id: 'shrink',
      bounds: { row: 1, col: 1, width: 12, height: 6 },
      view: view as never,
      tier: 'dialog',
      theme,
    });
    expect(layoutWidth).toBe(12 - 2 - 2);
    expect(layoutHeight).toBe(6 - 2 - 2);
  });

  test('theme overrides via copyWith preserve other built-in fields', () => {
    __resetModalAdapterThemeForTests();
    // Theme that wants square corners but otherwise the built-in shape.
    const square = BUILT_IN_CHROME_DEFAULTS.dialog.copyWith({
      borderRadius: BorderRadius.circular(0),
    });
    const theme = themeWithDefaults({ dialog: square });
    const h = mountViewAsModalSurface({
      id: 'square',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      tier: 'dialog',
      theme,
    });
    const out = stripAnsi(h.surface.paint());
    // No rounded corners now.
    expect(out).not.toMatch(/[╭╮╯╰]/);
    // But still a square frame.
    expect(out).toMatch(/[┌┐└┘]/);
  });

  test('caller without `tier` keeps un-framed even if theme has chromeDefaults', () => {
    __resetModalAdapterThemeForTests();
    const theme = themeWithDefaults({
      dialog: BUILT_IN_CHROME_DEFAULTS.dialog,
    });
    const h = mountViewAsModalSurface({
      id: 'no-tier',
      bounds: { row: 1, col: 1, width: 20, height: 6 },
      view: makeView(),
      // tier omitted — resolveChromeDefault sees undefined → returns undefined
      theme,
    });
    const out = stripAnsi(h.surface.paint());
    expect(out).not.toMatch(/[╭┌╰└]/);
  });

  test('theme-provided custom decoration with padding renders the padding rows', () => {
    __resetModalAdapterThemeForTests();
    const heavy = new BoxDecoration({
      border: BorderSpec.all({ style: 'solid' }),
      padding: EdgeInsets.all(2),
    });
    const theme = themeWithDefaults({ popup: heavy });
    const h = mountViewAsModalSurface({
      id: 'pad-2',
      bounds: { row: 1, col: 1, width: 20, height: 8 },
      view: makeView(),
      tier: 'popup',
      theme,
    });
    const out = stripAnsi(h.surface.paint());
    expect(out).toMatch(/[┌┐└┘]/);
  });
});
