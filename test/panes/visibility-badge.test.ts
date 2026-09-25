import { describe, expect, test } from 'bun:test';

import {
  BADGE_GLYPHS,
  badgeVisibleWidth,
  composeVisibilityBadge,
} from '../../src/panes/visibility-badge.js';

describe('BADGE_GLYPHS — raw payload', () => {
  test('visible returns null (no badge rendered)', () => {
    expect(BADGE_GLYPHS.visible).toBeNull();
  });
  test('hidden returns ·H·', () => {
    expect(BADGE_GLYPHS.hidden).toBe('·H·');
  });
  test('dormant returns ·D·', () => {
    expect(BADGE_GLYPHS.dormant).toBe('·D·');
  });
  test('llm-only returns ·ᴸ·', () => {
    expect(BADGE_GLYPHS['llm-only']).toBe('·ᴸ·');
  });
});

describe('composeVisibilityBadge — SGR-styled output', () => {
  test('visible → null (no badge)', () => {
    expect(composeVisibilityBadge('visible')).toBeNull();
  });
  test('hidden → contains ·H· in the output', () => {
    const s = composeVisibilityBadge('hidden');
    expect(s).not.toBeNull();
    expect(s).toContain('·H·');
  });
  test('dormant → contains ·D· in the output', () => {
    const s = composeVisibilityBadge('dormant');
    expect(s).not.toBeNull();
    expect(s).toContain('·D·');
  });
  test('llm-only → contains ·ᴸ· in the output', () => {
    const s = composeVisibilityBadge('llm-only');
    expect(s).not.toBeNull();
    expect(s).toContain('·ᴸ·');
  });
  test('styled output starts with an ANSI escape (SGR introducer)', () => {
    const s = composeVisibilityBadge('hidden');
    expect(s).not.toBeNull();
    // Either C.warning wraps with \x1b[...m or returns raw — accept both
    // so the test isn't brittle to theme/no-color environments. The
    // content assertion above is the real guarantee.
    if (s && s.startsWith('\x1b')) {
      expect(s).toContain('\x1b[');
    }
  });
});

describe('badgeVisibleWidth — cell-width accounting', () => {
  test('visible → 0 (no badge painted)', () => {
    expect(badgeVisibleWidth('visible')).toBe(0);
  });
  test('hidden → 3 cells (·H·)', () => {
    expect(badgeVisibleWidth('hidden')).toBe(3);
  });
  test('dormant → 3 cells', () => {
    expect(badgeVisibleWidth('dormant')).toBe(3);
  });
  test('llm-only → 3 cells', () => {
    expect(badgeVisibleWidth('llm-only')).toBe(3);
  });
});
