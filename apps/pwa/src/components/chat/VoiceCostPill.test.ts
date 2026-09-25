/**
 * Voice 일원화 FU PP-V-2 (2026-05-07) — VoiceCostPill formatter test.
 *
 * The polling/render path requires a configured daemon + React DOM
 * which the bun test env doesn't provide; the cost formatter is the
 * pure helper that locks display behavior (sub-cent rounding,
 * negative/NaN guards). Component-level rendering is exercised by
 * future integration smoke (Phase 2 dogfood).
 */

import { describe, expect, it } from 'bun:test';
import { formatVoiceCost } from './VoiceCostPill';

describe('formatVoiceCost (Phase FU PP-V-2)', () => {
  it('formats positive USD with 2 decimals', () => {
    expect(formatVoiceCost(0.42)).toBe('$0.42');
    expect(formatVoiceCost(1)).toBe('$1.00');
    expect(formatVoiceCost(123.456)).toBe('$123.46');
  });

  it('returns "$0.00" for zero', () => {
    expect(formatVoiceCost(0)).toBe('$0.00');
  });

  it('guards against NaN / negative / non-finite (defensive)', () => {
    expect(formatVoiceCost(NaN)).toBe('$0.00');
    expect(formatVoiceCost(-5)).toBe('$0.00');
    expect(formatVoiceCost(Infinity)).toBe('$0.00');
    expect(formatVoiceCost(-Infinity)).toBe('$0.00');
  });

  it('rounds to nearest cent (banker-style toFixed)', () => {
    expect(formatVoiceCost(0.005)).toBe('$0.01');
    expect(formatVoiceCost(0.004)).toBe('$0.00');
  });
});
