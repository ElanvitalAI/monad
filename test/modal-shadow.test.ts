// IDX-6 Phase 5 — modal shadow rendering tests.
//
// When `mountViewAsModalSurface` is given a `shadow: { theme, ... }`
// option, its paint() output appends extra cells below + to the
// right of bounds, painted in the theme's modal.shadow colour. When
// shadow is absent or disabled, paint() matches pre-Phase-5 output.

import { describe, expect, test } from 'bun:test';
import { mountViewAsModalSurface, resolveShadowAnsi } from '../src/ui/modal-adapter.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import {
  CATPPUCCIN_MOCHA,
  CATPPUCCIN_LATTE,
  MONAD_PASTEL_DEFAULT,
} from '../src/themes/index.js';
import type { ThemeTokens } from '../src/theme/tokens.js';

function stubView() {
  return new SelectView<string>({
    options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    onSubmit: () => {},
  });
}

describe('resolveShadowAnsi', () => {
  test('returns null when spec is undefined', () => {
    expect(resolveShadowAnsi(undefined)).toBeNull();
  });

  test('returns null when enabled is explicitly false', () => {
    expect(
      resolveShadowAnsi({ theme: CATPPUCCIN_MOCHA, enabled: false }),
    ).toBeNull();
  });

  test('returns an ANSI prefix for a theme that ships a shadow hex', () => {
    // Ensure at least one preset has a shadow slot; Catppuccin mocha
    // does via its widgetTokens.modal.shadow.
    const res = resolveShadowAnsi({ theme: CATPPUCCIN_MOCHA });
    expect(res).not.toBeNull();
    expect(res!.ansi).toMatch(/^\x1b\[/);
    expect(res!.glyph).toBe('▓');
  });

  test('honors MONAD_ASCII_ICONS=1 by falling back to # glyph', () => {
    const orig = process.env.MONAD_ASCII_ICONS;
    process.env.MONAD_ASCII_ICONS = '1';
    try {
      const res = resolveShadowAnsi({ theme: CATPPUCCIN_MOCHA });
      expect(res).not.toBeNull();
      expect(res!.glyph).toBe('#');
    } finally {
      if (orig === undefined) delete process.env.MONAD_ASCII_ICONS;
      else process.env.MONAD_ASCII_ICONS = orig;
    }
  });

  test('returns null when a theme omits the shadow slot', () => {
    const noShadow: ThemeTokens = {
      ...CATPPUCCIN_MOCHA,
      modal: { ...CATPPUCCIN_MOCHA.modal, shadow: undefined },
      widgetTokens: CATPPUCCIN_MOCHA.widgetTokens
        ? {
            ...CATPPUCCIN_MOCHA.widgetTokens,
            modal: {
              ...CATPPUCCIN_MOCHA.widgetTokens.modal,
              shadow: undefined,
            },
          }
        : undefined,
    };
    expect(resolveShadowAnsi({ theme: noShadow })).toBeNull();
  });

  test('different themes produce different ANSI', () => {
    const a = resolveShadowAnsi({ theme: CATPPUCCIN_MOCHA });
    const b = resolveShadowAnsi({ theme: CATPPUCCIN_LATTE });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.ansi).not.toBe(b!.ansi);
  });

  test('custom glyph takes precedence over both defaults', () => {
    const res = resolveShadowAnsi({ theme: CATPPUCCIN_MOCHA, glyph: '░' });
    expect(res!.glyph).toBe('░');
  });
});

describe('mountViewAsModalSurface shadow emission', () => {
  test('no shadow config → paint output unchanged (backward compat)', () => {
    const hWith = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
    });
    const out = hWith.surface.paint();
    // No cursor-move to bounds.row + height (the row below), no
    // move to bounds.col + width (column to the right).
    expect(out).not.toContain('\x1b[9;10H');  // bottom-left shadow edge
    expect(out).not.toContain('\x1b[3;30H');  // top-right shadow col
  });

  test('shadow config adds right-edge + bottom-edge cells', () => {
    const handle = mountViewAsModalSurface({
      id: 'shadow-test',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: CATPPUCCIN_MOCHA },
    });
    expect(handle.surface.interactiveBounds).toEqual({ row: 3, col: 10, width: 20, height: 6 });
    expect(handle.surface.visualBounds).toEqual({ row: 3, col: 10, width: 21, height: 7 });
    expect(handle.surface.backdropBounds).toEqual({ row: 3, col: 10, width: 20, height: 6 });
    const out = handle.surface.paint();
    // Right edge — rows 4..8 (bounds.row + 1..bounds.row + 5), col = 30.
    expect(out).toContain('\x1b[4;30H');
    expect(out).toContain('\x1b[8;30H');
    // Bottom edge — row = 9 (bounds.row + height), starting col = 11.
    expect(out).toContain('\x1b[9;11H');
    // Top row of bounds should NOT have a right-edge shadow (light
    // from upper-left heuristic).
    expect(out).not.toContain('\x1b[3;30H');
    // The shadow glyph ▓ appears in the output.
    expect(out).toContain('▓');
  });

  test('shadow enabled=false disables emission even when theme supplied', () => {
    const handle = mountViewAsModalSurface({
      id: 'shadow-off',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: CATPPUCCIN_MOCHA, enabled: false },
    });
    const out = handle.surface.paint();
    expect(out).not.toContain('▓');
    expect(out).not.toContain('\x1b[4;30H');
  });

  test('different themes produce different shadow ANSI', () => {
    const mocha = mountViewAsModalSurface({
      id: 'm',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: CATPPUCCIN_MOCHA },
    }).surface.paint();
    const latte = mountViewAsModalSurface({
      id: 'l',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: CATPPUCCIN_LATTE },
    }).surface.paint();
    expect(mocha).not.toBe(latte);
    expect(mocha).toContain('▓');
    expect(latte).toContain('▓');
  });

  test('custom glyph flows to the paint output', () => {
    const handle = mountViewAsModalSurface({
      id: 'glyph',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: MONAD_PASTEL_DEFAULT, glyph: '░' },
    });
    const out = handle.surface.paint();
    expect(out).toContain('░');
    expect(out).not.toContain('▓');
  });

  test('disposed modal paints empty — shadow does not appear', () => {
    const handle = mountViewAsModalSurface({
      id: 'disposed',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view: stubView(),
      shadow: { theme: CATPPUCCIN_MOCHA },
    });
    handle.dispose();
    expect(handle.surface.paint()).toBe('');
  });
});
