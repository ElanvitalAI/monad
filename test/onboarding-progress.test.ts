// ── Wizard progress indicator (PR γ of setup-tui-overhaul) ──
//
// Phase 3 augments the step header with a glanceable `●●●○○` row.
// Tests pin the dot count math, mono-fallback shape, and the SGR
// emission policy so a TTY-capable host gets color and a piped /
// LANG=C host gets plain ASCII.

import { describe, expect, test } from 'bun:test';
import {
  progressDots,
  progressDotsFallback,
} from '../src/onboarding/progress';

describe('progressDots', () => {
  test('mono profile emits no SGR escape codes', () => {
    const s = progressDots(3, 5, { profile: 'mono' });
    expect(s).toBe('●●●○○');
    expect(s).not.toContain('\x1b[');
  });

  test('truecolor profile emits SGR escape codes around dots', () => {
    const s = progressDots(3, 5, { profile: 'truecolor' });
    expect(s).toContain('\x1b[');     // some color emission
    // Stripped of SGR, the visible payload is the same dot row.
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('●●●○○');
  });

  test('current=0 → all empty dots', () => {
    expect(progressDots(0, 4, { profile: 'mono' })).toBe('○○○○');
  });

  test('current=total → all filled dots', () => {
    expect(progressDots(4, 4, { profile: 'mono' })).toBe('●●●●');
  });

  test('current > total → clamps to total', () => {
    expect(progressDots(99, 5, { profile: 'mono' })).toBe('●●●●●');
  });

  test('current < 0 → clamps to 0', () => {
    expect(progressDots(-3, 5, { profile: 'mono' })).toBe('○○○○○');
  });

  test('NaN current → treated as 0', () => {
    expect(progressDots(Number.NaN, 5, { profile: 'mono' })).toBe('○○○○○');
  });
});

describe('progressDotsFallback', () => {
  test('returns ASCII bracket row', () => {
    expect(progressDotsFallback(3, 5)).toBe('[###--]');
  });
  test('current=0 / total=4 → all dashes', () => {
    expect(progressDotsFallback(0, 4)).toBe('[----]');
  });
  test('current=total → all hashes', () => {
    expect(progressDotsFallback(4, 4)).toBe('[####]');
  });
});
