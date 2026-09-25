// M3-1 (Phase 3) — BudgetGuard pure helper.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FALLBACK_TIER,
  DEFAULT_NOTIFY_AT_PCT,
  evaluateBudget,
} from '../../src/budget-guard/budget-guard.js';

describe('M3-1 · evaluateBudget', () => {
  test('passive mode (no cap) · always ok · percent null', () => {
    const r = evaluateBudget({ budget: undefined, monthSoFarUsd: 999 });
    expect(r.status).toBe('ok');
    expect(r.percent).toBeNull();
    expect(r.monthlyUsdCap).toBeUndefined();
    expect(r.recommendedFallback).toBeUndefined();
    expect(r.notifyAtPct).toBe(DEFAULT_NOTIFY_AT_PCT);
  });

  test('passive mode (cap = 0) treated same as undefined', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 0 }, monthSoFarUsd: 5 });
    expect(r.status).toBe('ok');
    expect(r.percent).toBeNull();
  });

  test('below default 80% threshold → ok with percent', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 50 }, monthSoFarUsd: 30 });
    expect(r.status).toBe('ok');
    expect(r.percent).toBe(60);
    expect(r.monthlyUsdCap).toBe(50);
    // recommendedFallback omitted while still 'ok' — no nag.
    expect(r.recommendedFallback).toBeUndefined();
  });

  test('exactly at default 80% threshold → warning', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 50 }, monthSoFarUsd: 40 });
    expect(r.status).toBe('warning');
    expect(r.percent).toBe(80);
    expect(r.recommendedFallback).toBe(DEFAULT_FALLBACK_TIER);
  });

  test('above threshold but below cap → warning with fallback tier', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 50 }, monthSoFarUsd: 45 });
    expect(r.status).toBe('warning');
    expect(r.percent).toBe(90);
    expect(r.recommendedFallback).toBe('budget');
  });

  test('cap reached → cap-exceeded', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 50 }, monthSoFarUsd: 50 });
    expect(r.status).toBe('cap-exceeded');
    expect(r.percent).toBe(100);
    expect(r.recommendedFallback).toBe(DEFAULT_FALLBACK_TIER);
  });

  test('cap exceeded by 2× → percent capped at 999', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 1 }, monthSoFarUsd: 9999 });
    expect(r.status).toBe('cap-exceeded');
    expect(r.percent).toBe(999);
  });

  test('custom notifyAtPct = 50 fires earlier', () => {
    const r = evaluateBudget({
      budget: { monthlyUsdCap: 100, notifyAtPct: 50 },
      monthSoFarUsd: 51,
    });
    expect(r.status).toBe('warning');
    expect(r.notifyAtPct).toBe(50);
  });

  test('custom notifyAtPct = 95 stays quiet at 80%', () => {
    const r = evaluateBudget({
      budget: { monthlyUsdCap: 100, notifyAtPct: 95 },
      monthSoFarUsd: 80,
    });
    expect(r.status).toBe('ok');
    expect(r.notifyAtPct).toBe(95);
  });

  test('custom fallbackTier echoed back', () => {
    const r = evaluateBudget({
      budget: { monthlyUsdCap: 50, fallbackTier: 'balanced' },
      monthSoFarUsd: 45,
    });
    expect(r.status).toBe('warning');
    expect(r.recommendedFallback).toBe('balanced');
  });

  test('negative monthSoFarUsd clamped to 0', () => {
    const r = evaluateBudget({ budget: { monthlyUsdCap: 50 }, monthSoFarUsd: -10 });
    expect(r.status).toBe('ok');
    expect(r.percent).toBe(0);
  });

  test('NaN notifyAtPct falls back to default', () => {
    const r = evaluateBudget({
      budget: { monthlyUsdCap: 50, notifyAtPct: Number.NaN },
      monthSoFarUsd: 40,
    });
    expect(r.notifyAtPct).toBe(DEFAULT_NOTIFY_AT_PCT);
    expect(r.status).toBe('warning');
  });
});
