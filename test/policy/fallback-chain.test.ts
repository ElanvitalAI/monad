// H6 P3 Bundle 1 · FallbackChain.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FallbackChain, DEFAULT_FALLBACK_CHAIN } from '../../src/policy/fallback-chain';
import type { RouteCandidate } from '../../src/policy/types';
import type { UsageProvider } from '../../src/budget/types';
import type { BudgetRecommendation } from '../../src/budget/forecaster';

function cand(brand: UsageProvider, model: string, availability: RouteCandidate['availability'] = 'ok'): RouteCandidate {
  return {
    brand,
    model,
    availability,
    capability: {
      brand, model, contextWindow: 100_000, costTier: 'mid',
      strengths: [], available: availability === 'ok' || availability === 'budget-saturated',
    },
  };
}

describe('FallbackChain', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'policy-fc-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test('list() returns defaults', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    expect(fc.list()).toEqual(DEFAULT_FALLBACK_CHAIN);
  });

  test('pickNext walks chain and returns first ok candidate', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    const candidates = [
      cand('claude', 'opus'),
      cand('claude', 'sonnet'),
      cand('codex', 'gpt-5'),
    ];
    const next = fc.pickNext({ candidates, recommendations: new Map() });
    expect(next?.brand).toBe('claude');
    expect(next?.model).toBe('opus');
  });

  test('pickNext skips the excluded candidate', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    const excluded = cand('claude', 'opus');
    const candidates = [excluded, cand('claude', 'sonnet'), cand('codex', 'gpt-5')];
    const next = fc.pickNext({ candidates, recommendations: new Map(), excluded });
    expect(next?.model).toBe('sonnet');
  });

  test('pickNext skips throttled brands', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'throttle');
    const candidates = [cand('claude', 'opus'), cand('claude', 'sonnet'), cand('codex', 'gpt-5')];
    const next = fc.pickNext({ candidates, recommendations: recs });
    expect(next?.brand).toBe('codex');
  });

  test('pickNext returns undefined when chain exhausted', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    const candidates = [cand('claude', 'opus', 'budget-saturated')];
    const next = fc.pickNext({ candidates, recommendations: new Map() });
    expect(next).toBeUndefined();
  });

  test('setChain + resetToDefault roundtrip', () => {
    const fc = new FallbackChain({ storageDir: tmp });
    fc.setChain([{ brand: 'gemini', model: 'flash' }]);
    expect(fc.list()).toHaveLength(1);
    fc.resetToDefault();
    expect(fc.list().length).toBe(DEFAULT_FALLBACK_CHAIN.length);
  });

  test('chain persists across reload', () => {
    const a = new FallbackChain({ storageDir: tmp });
    a.setChain([{ brand: 'gemini', model: 'flash' }]);
    const b = new FallbackChain({ storageDir: tmp });
    expect(b.list()).toEqual([{ brand: 'gemini', model: 'flash' }]);
  });
});
