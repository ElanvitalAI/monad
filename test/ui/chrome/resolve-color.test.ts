// ── Presentation P4a · ColorToken resolver ──

import { describe, test, expect } from 'bun:test';
import {
  resolveColorToken,
  resolveColorOrText,
} from '../../../src/ui/chrome/resolve-color.js';
import { DEFAULT_THEME_TOKENS } from '../../../src/theme/tokens.js';

describe('resolveColorToken', () => {
  test('null input returns null', () => {
    expect(resolveColorToken(null, DEFAULT_THEME_TOKENS)).toBeNull();
    expect(resolveColorToken(undefined, DEFAULT_THEME_TOKENS)).toBeNull();
  });

  test('raw hex pass-through', () => {
    expect(resolveColorToken('#ff00aa', DEFAULT_THEME_TOKENS)).toBe('#ff00aa');
    expect(resolveColorToken('#abc', DEFAULT_THEME_TOKENS)).toBe('#abc');
  });

  test('maps "text" token to theme colors.text', () => {
    expect(resolveColorToken('text', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.text,
    );
  });

  test('maps "text.muted" to theme colors.muted', () => {
    expect(resolveColorToken('text.muted', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.muted,
    );
  });

  test('maps "border.focused" to theme colors.accent', () => {
    expect(resolveColorToken('border.focused', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.accent,
    );
  });

  test('semantic status tokens preserve mapping', () => {
    expect(resolveColorToken('success', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.success,
    );
    expect(resolveColorToken('error', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.error,
    );
    expect(resolveColorToken('warning', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.warning,
    );
  });

  test('unknown string token returns null (silent)', () => {
    expect(resolveColorToken('made.up.token', DEFAULT_THEME_TOKENS)).toBeNull();
    expect(resolveColorToken('blue', DEFAULT_THEME_TOKENS)).toBeNull();
  });

  test('empty string returns null', () => {
    expect(resolveColorToken('', DEFAULT_THEME_TOKENS)).toBeNull();
    expect(resolveColorToken('   ', DEFAULT_THEME_TOKENS)).toBeNull();
  });
});

describe('resolveColorOrText', () => {
  test('falls back to theme.colors.text when token is null', () => {
    expect(resolveColorOrText(null, DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.text,
    );
  });

  test('falls back when token unrecognized', () => {
    expect(resolveColorOrText('not.a.thing', DEFAULT_THEME_TOKENS)).toBe(
      DEFAULT_THEME_TOKENS.colors.text,
    );
  });

  test('honours raw hex pass-through', () => {
    expect(resolveColorOrText('#010203', DEFAULT_THEME_TOKENS)).toBe('#010203');
  });
});
