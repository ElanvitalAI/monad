// Spot-check the 297-entry diacritic table against yazi's exact
// codepoints. These indices are the ones most likely to silently
// drift during a copy-paste port.

import { describe, test, expect } from 'bun:test';
import {
  DIACRITICS,
  DIACRITIC_COUNT,
  PLACEHOLDER,
  diacriticAt,
} from '../../src/kgp/diacritics.js';

describe('diacritics — table integrity', () => {
  test('exactly 297 entries (matches yazi kgp.rs:14-312)', () => {
    expect(DIACRITIC_COUNT).toBe(297);
    expect(DIACRITICS.length).toBe(297);
  });

  // Yazi's table spot-checks: first, second, a middle, the last.
  test('entry[0]   = U+0305 combining overline', () => {
    expect(DIACRITICS[0]).toBe(String.fromCodePoint(0x0305));
  });
  test('entry[1]   = U+030D', () => {
    expect(DIACRITICS[1]).toBe(String.fromCodePoint(0x030D));
  });
  test('entry[16]  = U+035B', () => {
    expect(DIACRITICS[16]).toBe(String.fromCodePoint(0x035B));
  });
  test('entry[296] = U+1D244 (last)', () => {
    expect(DIACRITICS[296]).toBe(String.fromCodePoint(0x1D244));
  });
});

describe('diacritics — saturating accessor', () => {
  test('diacriticAt(0) returns entry[0]', () => {
    expect(diacriticAt(0)).toBe(DIACRITICS[0]);
  });
  test('negative clamps to entry[0]', () => {
    expect(diacriticAt(-5)).toBe(DIACRITICS[0]);
  });
  test('over-range clamps to last entry', () => {
    expect(diacriticAt(1000)).toBe(DIACRITICS[DIACRITICS.length - 1]);
  });
});

describe('placeholder base char', () => {
  test('PLACEHOLDER is U+10EEEE', () => {
    expect(PLACEHOLDER).toBe(String.fromCodePoint(0x10EEEE));
    // Surrogate-pair-aware length: U+10EEEE encodes as two UTF-16 units.
    expect(PLACEHOLDER.length).toBe(2);
    expect(PLACEHOLDER.codePointAt(0)).toBe(0x10EEEE);
  });
});
