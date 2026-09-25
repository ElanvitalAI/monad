// ── Presentation P4b · modal-adapter decoration translator ──
//
// Tests the BoxDecoration → ModalShadowSpec shim in modal-adapter. The
// decoration path is opt-in: legacy callers that omit `decoration` must
// see zero behaviour change.

import { describe, test, expect } from 'bun:test';
import {
  deriveShadowFromDecoration,
} from '../src/ui/modal-adapter.js';
import { BoxDecoration, BoxShadow } from '../src/ui/attributes/index.js';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../src/theme/tokens.js';

const themeWithShadow: ThemeTokens = {
  ...DEFAULT_THEME_TOKENS,
  modal: { ...DEFAULT_THEME_TOKENS.modal, shadow: '#111111' },
};

const themeNoShadow: ThemeTokens = {
  ...DEFAULT_THEME_TOKENS,
  modal: { ...DEFAULT_THEME_TOKENS.modal, shadow: undefined },
};

describe('deriveShadowFromDecoration · empty inputs', () => {
  test('undefined decoration returns null', () => {
    expect(deriveShadowFromDecoration(undefined, themeWithShadow)).toBeNull();
  });

  test('undefined theme returns null even with decoration present', () => {
    expect(
      deriveShadowFromDecoration(
        new BoxDecoration({ boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 } })] }),
        undefined,
      ),
    ).toBeNull();
  });

  test('decoration without boxShadow returns null', () => {
    expect(
      deriveShadowFromDecoration(new BoxDecoration({ color: 'surface' }), themeWithShadow),
    ).toBeNull();
  });

  test('empty boxShadow array returns null', () => {
    expect(
      deriveShadowFromDecoration(new BoxDecoration({ boxShadow: [] }), themeWithShadow),
    ).toBeNull();
  });
});

describe('deriveShadowFromDecoration · derivation', () => {
  test('boxShadow + theme shadow → ModalShadowSpec { theme, enabled: true }', () => {
    const decoration = new BoxDecoration({
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 } })],
    });
    const result = deriveShadowFromDecoration(decoration, themeWithShadow);
    expect(result).not.toBeNull();
    expect(result?.theme).toBe(themeWithShadow);
    expect(result?.enabled).toBe(true);
  });

  test('resolved ColorToken substitutes when theme.modal.shadow absent', () => {
    const decoration = new BoxDecoration({
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 }, color: 'border.focused' })],
    });
    const result = deriveShadowFromDecoration(decoration, themeNoShadow);
    expect(result).not.toBeNull();
    expect(result?.theme).toBe(themeNoShadow);
  });

  test('no theme.modal.shadow AND no resolvable color → null', () => {
    const decoration = new BoxDecoration({
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 }, color: 'not.a.real.token' })],
    });
    expect(deriveShadowFromDecoration(decoration, themeNoShadow)).toBeNull();
  });

  test('opacity 0 + zero offset = disabled (null)', () => {
    const decoration = new BoxDecoration({
      boxShadow: [
        new BoxShadow({ offset: { dx: 0, dy: 0 }, opacity: 0, color: 'border.focused' }),
      ],
    });
    expect(deriveShadowFromDecoration(decoration, themeWithShadow)).toBeNull();
  });

  test('multiple shadows · only first drives derivation', () => {
    const decoration = new BoxDecoration({
      boxShadow: [
        new BoxShadow({ offset: { dx: 1, dy: 1 }, color: 'border.focused' }),
        new BoxShadow({ offset: { dx: 2, dy: 2 }, color: 'accent' }),
      ],
    });
    const result = deriveShadowFromDecoration(decoration, themeWithShadow);
    expect(result).not.toBeNull();
    expect(result?.theme).toBe(themeWithShadow);
  });
});
