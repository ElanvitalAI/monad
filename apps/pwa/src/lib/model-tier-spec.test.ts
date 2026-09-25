// M1-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// PWA mirror invariants. Catches drift between this file and
// `src/model-tier/tier-map.ts`.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  STT_TIER_MAP,
  formatMonthlyUsd,
  modelTierRank,
  projectSttMonthlyCost,
  sttTierEffectiveUsdPerMin,
} from './model-tier-spec';

describe('M1-2 · PWA STT_TIER_MAP mirror', () => {
  test('5 ticks · monotone non-decreasing effective rate', () => {
    expect(MODEL_TIERS).toHaveLength(5);
    let prev = -1;
    for (const tier of MODEL_TIERS) {
      const rate = sttTierEffectiveUsdPerMin(tier);
      expect(rate).toBeGreaterThanOrEqual(prev);
      prev = rate;
    }
  });

  test('budget tier is free + WIP', () => {
    expect(STT_TIER_MAP.budget.usdPerMinAudio).toBe(0);
    expect(STT_TIER_MAP.budget.status).toBe('wip');
  });

  test('loaded surcharge layers on top of best', () => {
    expect(STT_TIER_MAP.loaded.model).toBe(STT_TIER_MAP.best.model);
    expect(sttTierEffectiveUsdPerMin('loaded'))
      .toBeGreaterThan(sttTierEffectiveUsdPerMin('best'));
  });

  test('rank order matches left → right slider', () => {
    expect(modelTierRank('budget')).toBe(0);
    expect(modelTierRank('balanced')).toBe(1);
    expect(modelTierRank('loaded')).toBe(4);
  });

  test('DEFAULT_MODEL_TIER is balanced (zero-config baseline)', () => {
    expect(DEFAULT_MODEL_TIER).toBe('balanced');
  });
});

describe('M1-2 · projectSttMonthlyCost', () => {
  test('zero or invalid daily-avg → 0', () => {
    expect(projectSttMonthlyCost('best', 0)).toBe(0);
    expect(projectSttMonthlyCost('best', -5)).toBe(0);
    expect(projectSttMonthlyCost('best', Number.NaN)).toBe(0);
    expect(projectSttMonthlyCost('best', Number.POSITIVE_INFINITY)).toBe(0);
  });

  test('balanced × 10 min/day = $0.90/mo', () => {
    expect(projectSttMonthlyCost('balanced', 10)).toBeCloseTo(0.9, 6);
  });

  test('best × 10 min/day = $5.10/mo', () => {
    expect(projectSttMonthlyCost('best', 10)).toBeCloseTo(5.1, 6);
  });

  test('budget tier always projects to $0', () => {
    expect(projectSttMonthlyCost('budget', 100)).toBe(0);
  });
});

describe('M1-2 · formatMonthlyUsd', () => {
  test('handles edge cases without crashing', () => {
    expect(formatMonthlyUsd(0)).toBe('$0/mo');
    expect(formatMonthlyUsd(Number.NaN)).toBe('$0/mo');
    expect(formatMonthlyUsd(-1)).toBe('$0/mo');
  });

  test('sub-cent → "<$0.01/mo"', () => {
    expect(formatMonthlyUsd(0.005)).toBe('<$0.01/mo');
  });

  test('two-decimal precision under $10', () => {
    expect(formatMonthlyUsd(2.3)).toBe('$2.30/mo');
    expect(formatMonthlyUsd(5.123)).toBe('$5.12/mo');
  });

  test('one-decimal precision under $100', () => {
    expect(formatMonthlyUsd(24.7)).toBe('$24.7/mo');
  });

  test('whole dollars at $100+', () => {
    expect(formatMonthlyUsd(123.45)).toBe('$123/mo');
  });
});
