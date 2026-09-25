// M1-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Tier-map invariants. Drives the contract between `STT_TIER_MAP` and
// `VOICE_COSTS` so price edits in voice-costs.ts can't silently desync
// the slider tooltip.

import { describe, expect, test } from 'bun:test';
import { VOICE_COSTS } from '../../src/models/voice-costs.js';
import {
  MODEL_TIERS,
  STT_TIER_MAP,
  modelTierRank,
  sttTierEffectiveUsdPerMin,
} from '../../src/model-tier/index.js';

describe('M1-1 · STT_TIER_MAP · invariants', () => {
  test('every tier in MODEL_TIERS has a spec', () => {
    for (const tier of MODEL_TIERS) {
      expect(STT_TIER_MAP[tier]).toBeDefined();
      expect(STT_TIER_MAP[tier].label.length).toBeGreaterThan(0);
      expect(STT_TIER_MAP[tier].rationale.length).toBeGreaterThan(0);
    }
  });

  test('non-zero usdPerMinAudio mirrors VOICE_COSTS exactly', () => {
    for (const tier of MODEL_TIERS) {
      const spec = STT_TIER_MAP[tier];
      if (spec.usdPerMinAudio === 0) continue;
      const cost = VOICE_COSTS[spec.costId];
      expect(cost.kind).toBe('stt');
      if (cost.kind === 'stt') {
        const rate: number = cost.usdPerMinAudio;
        expect(rate).toBe(spec.usdPerMinAudio);
      }
    }
  });

  test('effective rate is monotone non-decreasing across ticks', () => {
    // budget (local · 0) ≤ balanced ≤ better ≤ best ≤ loaded.
    // This guarantees the slider's "more = pricier" mental model.
    let prev = -1;
    for (const tier of MODEL_TIERS) {
      const rate = sttTierEffectiveUsdPerMin(tier);
      expect(rate).toBeGreaterThanOrEqual(prev);
      prev = rate;
    }
  });

  test('loaded tier surcharge sits on top of best base price', () => {
    expect(STT_TIER_MAP.loaded.usdPerMinAudio).toBe(STT_TIER_MAP.best.usdPerMinAudio);
    expect(STT_TIER_MAP.loaded.loadedExtraUsdPerMin).toBeGreaterThan(0);
    expect(sttTierEffectiveUsdPerMin('loaded'))
      .toBeGreaterThan(sttTierEffectiveUsdPerMin('best'));
  });

  test('budget tier is WIP and free at projection time', () => {
    expect(STT_TIER_MAP.budget.status).toBe('wip');
    expect(STT_TIER_MAP.budget.usdPerMinAudio).toBe(0);
    expect(sttTierEffectiveUsdPerMin('budget')).toBe(0);
  });
});

describe('M1-1 · modelTierRank', () => {
  test('ranks match the user-facing left → right order', () => {
    expect(modelTierRank('budget')).toBe(0);
    expect(modelTierRank('balanced')).toBe(1);
    expect(modelTierRank('better')).toBe(2);
    expect(modelTierRank('best')).toBe(3);
    expect(modelTierRank('loaded')).toBe(4);
  });
});
