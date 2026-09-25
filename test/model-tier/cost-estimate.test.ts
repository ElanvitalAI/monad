// M1-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Cost-estimate tests. Pure function · no IO.

import { describe, expect, test } from 'bun:test';
import {
  projectSttAllTiers,
  projectSttTierMonthlyCost,
  type UsageSample,
} from '../../src/model-tier/index.js';

const MS_PER_DAY = 86_400_000;
const REF_NOW = Date.parse('2026-05-12T12:00:00Z');

function sample(daysAgo: number, audioMin: number): UsageSample {
  return {
    surface: 'stt',
    audioMinutes: audioMin,
    usd: audioMin * 0.003,
    at: REF_NOW - daysAgo * MS_PER_DAY,
  };
}

describe('M1-1 · projectSttTierMonthlyCost', () => {
  test('empty samples → monthlyUsd 0', () => {
    const est = projectSttTierMonthlyCost('best', { samples: [], now: REF_NOW });
    expect(est.monthlyUsd).toBe(0);
    expect(est.audioMinPerDay).toBe(0);
    expect(est.sampleCount).toBe(0);
    expect(est.windowDays).toBe(14);
  });

  test('default window is 14 days', () => {
    const est = projectSttTierMonthlyCost('balanced', {
      samples: [sample(2, 5)],
      now: REF_NOW,
    });
    expect(est.windowDays).toBe(14);
  });

  test('samples older than window are filtered out', () => {
    const samples = [
      sample(2, 10), // inside 14-day window
      sample(20, 10), // outside · ignored
    ];
    const est = projectSttTierMonthlyCost('balanced', { samples, now: REF_NOW });
    expect(est.sampleCount).toBe(1);
    // 10 minutes / 14 days = 0.7143... min/day
    expect(est.audioMinPerDay).toBeCloseTo(10 / 14, 6);
    // monthly = (10/14) * 30 * 0.003
    expect(est.monthlyUsd).toBeCloseTo((10 / 14) * 30 * 0.003, 6);
  });

  test('best tier × 100 min over window projects to expected USD', () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample(i + 1, 10));
    // 100 audio-min over 14 days = 7.142... min/day · 30 days = 214.28 min/mo
    // best = $0.017/min → ~$3.64
    const est = projectSttTierMonthlyCost('best', { samples, now: REF_NOW });
    expect(est.audioMinPerDay).toBeCloseTo(100 / 14, 6);
    expect(est.monthlyUsd).toBeCloseTo((100 / 14) * 30 * 0.017, 6);
  });

  test('loaded tier projection includes surcharge', () => {
    const samples = [sample(1, 60)];
    const best = projectSttTierMonthlyCost('best', { samples, now: REF_NOW });
    const loaded = projectSttTierMonthlyCost('loaded', { samples, now: REF_NOW });
    expect(loaded.monthlyUsd).toBeGreaterThan(best.monthlyUsd);
  });

  test('budget tier projects to $0 regardless of usage', () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i, 30));
    const est = projectSttTierMonthlyCost('budget', { samples, now: REF_NOW });
    expect(est.monthlyUsd).toBe(0);
    expect(est.audioMinPerDay).toBeGreaterThan(0);
  });

  test('non-stt samples are ignored', () => {
    const samples: UsageSample[] = [
      { surface: 'llm', tokens: 10_000, usd: 0.02, at: REF_NOW - MS_PER_DAY },
      { surface: 'tts', chars: 500, usd: 0.01, at: REF_NOW - MS_PER_DAY },
    ];
    const est = projectSttTierMonthlyCost('best', { samples, now: REF_NOW });
    expect(est.sampleCount).toBe(0);
    expect(est.monthlyUsd).toBe(0);
  });

  test('future-dated samples are ignored (clock skew defense)', () => {
    const samples = [{ ...sample(0, 5), at: REF_NOW + MS_PER_DAY }];
    const est = projectSttTierMonthlyCost('balanced', { samples, now: REF_NOW });
    expect(est.sampleCount).toBe(0);
  });
});

describe('M1-1 · projectSttAllTiers', () => {
  test('returns one estimate per tier · usage consistent across tiers', () => {
    const samples = [sample(1, 30)];
    const all = projectSttAllTiers({ samples, now: REF_NOW });
    expect(Object.keys(all)).toHaveLength(5);
    // audioMinPerDay is rate-independent → identical for every tier.
    const minPerDay = all.balanced.audioMinPerDay;
    for (const tier of ['budget', 'balanced', 'better', 'best', 'loaded'] as const) {
      expect(all[tier].audioMinPerDay).toBeCloseTo(minPerDay, 9);
    }
    // monthly cost increases with tier (budget free, loaded most expensive).
    expect(all.budget.monthlyUsd).toBe(0);
    expect(all.balanced.monthlyUsd).toBeLessThan(all.better.monthlyUsd);
    expect(all.better.monthlyUsd).toBeLessThan(all.best.monthlyUsd);
    expect(all.best.monthlyUsd).toBeLessThan(all.loaded.monthlyUsd);
  });
});
