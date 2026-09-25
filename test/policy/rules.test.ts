// H6 P3 Bundle 1 · 7 default rule behaviours.
//
// Each rule is unit-tested in isolation against a hand-built
// RouteContext. The router-level integration test covers rule
// interaction (short-circuit · filter chaining).

import { describe, test, expect } from 'bun:test';
import {
  ruleSessionLock,
  rulePerTurnMention,
  ruleBudgetThrottle,
  ruleBudgetWarn,
  ruleCapabilityFilter,
  rulePersistentDefault,
  ruleCloudFirstOrdering,
} from '../../src/policy/rules';
import { FallbackChain } from '../../src/policy/fallback-chain';
import type {
  BudgetView,
  OverrideView,
  RouteCandidate,
  RouteContext,
  ThrottleBypass,
} from '../../src/policy/types';
import type { UsageProvider, UsageSnapshot } from '../../src/budget/types';
import type { BudgetRecommendation } from '../../src/budget/forecaster';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = 1_700_000_000_000;

function snapshot(brand: UsageProvider): UsageSnapshot {
  return { provider: brand, windows: [], fetchedAt: NOW, source: 'oauth-api' };
}

function cand(
  brand: UsageProvider,
  model: string,
  availability: RouteCandidate['availability'] = 'ok',
  ctxOverrides: Partial<RouteCandidate['capability']> = {},
): RouteCandidate {
  return {
    brand, model, availability,
    capability: {
      brand, model,
      contextWindow: 100_000,
      costTier: 'mid',
      strengths: ['code', 'chat'],
      available: availability === 'ok' || availability === 'budget-saturated',
      ...ctxOverrides,
    },
  };
}

function makeCtx(opts: {
  overrides?: Partial<OverrideView>;
  recs?: Map<UsageProvider, BudgetRecommendation>;
  snapshots?: Map<UsageProvider, UsageSnapshot>;
  estimatedInputTokens?: number;
  strengths?: RouteContext['strengths'];
  preferred?: RouteContext['preferred'];
  hasLocalLLM?: boolean;
}): RouteContext {
  const budget: BudgetView = {
    snapshots: opts.snapshots ?? new Map(),
    recommendations: opts.recs ?? new Map(),
    hasLocalLLM: opts.hasLocalLLM ?? false,
  };
  const overrides: OverrideView = {
    throttleBypasses: opts.overrides?.throttleBypasses ?? [],
    ...(opts.overrides?.sessionLock ? { sessionLock: opts.overrides.sessionLock } : {}),
    ...(opts.overrides?.perTurn ? { perTurn: opts.overrides.perTurn } : {}),
    ...(opts.overrides?.persistentDefault ? { persistentDefault: opts.overrides.persistentDefault } : {}),
  };
  return {
    task: 'test',
    budget,
    overrides,
    now: NOW,
    ...(opts.estimatedInputTokens !== undefined ? { estimatedInputTokens: opts.estimatedInputTokens } : {}),
    ...(opts.strengths ? { strengths: opts.strengths } : {}),
    ...(opts.preferred ? { preferred: opts.preferred } : {}),
  };
}

// ─── R1 session-lock ─────────────────────────────────────────────────

describe('ruleSessionLock', () => {
  test('no lock → pass', () => {
    const r = ruleSessionLock().evaluate(makeCtx({}), [cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
  test('lock matches → filter to single candidate', () => {
    const ctx = makeCtx({ overrides: { sessionLock: { brand: 'claude', model: 'opus', setAt: NOW } } });
    const r = ruleSessionLock().evaluate(ctx, [cand('claude', 'opus'), cand('codex', 'gpt-5')]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept.length).toBe(1);
  });
  test('lock target unavailable → pass (lock ignored)', () => {
    const ctx = makeCtx({ overrides: { sessionLock: { brand: 'claude', model: 'opus', setAt: NOW } } });
    const r = ruleSessionLock().evaluate(ctx, [cand('claude', 'opus', 'budget-saturated')]);
    expect(r.kind).toBe('pass');
  });
});

// ─── R2 per-turn ─────────────────────────────────────────────────────

describe('rulePerTurnMention', () => {
  test('no preferred → pass', () => {
    const r = rulePerTurnMention().evaluate(makeCtx({}), [cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
  test('preferred brand matches → filter', () => {
    const ctx = makeCtx({ preferred: { brand: 'codex', model: 'gpt-5' } });
    const r = rulePerTurnMention().evaluate(ctx, [cand('claude', 'opus'), cand('codex', 'gpt-5')]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept[0]!.brand).toBe('codex');
  });
  test('preferred target not-yet-implemented → pass', () => {
    const ctx = makeCtx({ preferred: { brand: 'local-llm' } });
    const r = rulePerTurnMention().evaluate(ctx, [cand('local-llm', 'qwen2.5-coder-7b', 'not-yet-implemented')]);
    expect(r.kind).toBe('pass');
  });
});

// ─── R3 budget-throttle ──────────────────────────────────────────────

describe('ruleBudgetThrottle', () => {
  test('no throttled brands → pass', () => {
    const r = ruleBudgetThrottle().evaluate(makeCtx({}), [cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
  test('some throttled, some safe → filter drops throttled', () => {
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'throttle');
    const ctx = makeCtx({ recs });
    const r = ruleBudgetThrottle().evaluate(ctx, [cand('claude', 'opus'), cand('codex', 'gpt-5')]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept.every((c) => c.brand !== 'claude')).toBe(true);
  });
  test('all throttled, no bypass → flag-confirm', () => {
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'throttle');
    const ctx = makeCtx({ recs });
    const r = ruleBudgetThrottle().evaluate(ctx, [cand('claude', 'opus')]);
    expect(r.kind).toBe('flag-confirm');
  });
  test('all throttled + matching bypass → prefer (skip HITL)', () => {
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'throttle');
    const bypass: ThrottleBypass = {
      brand: 'claude', model: 'opus', window: 'weekly',
      expiresAt: NOW + 60_000, createdAt: NOW,
    };
    const ctx = makeCtx({ recs, overrides: { throttleBypasses: [bypass] } });
    const r = ruleBudgetThrottle().evaluate(ctx, [cand('claude', 'opus')]);
    expect(r.kind).toBe('prefer');
  });
});

// ─── R4 budget-warn ──────────────────────────────────────────────────

describe('ruleBudgetWarn', () => {
  test('no warn brands → pass', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rule-warn-'));
    try {
      const fc = new FallbackChain({ storageDir: tmp });
      const r = ruleBudgetWarn({ chain: fc }).evaluate(makeCtx({}), [cand('claude', 'opus')]);
      expect(r.kind).toBe('pass');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test('top candidate on warn brand → prefer different brand (not same-brand model swap)', () => {
    // Warn is a brand-level budget window (Claude weekly 85%). Swapping
    // Opus → Sonnet still bills the warn window, so R4 must step to a
    // different brand entirely.
    const tmp = mkdtempSync(join(tmpdir(), 'rule-warn-'));
    try {
      const fc = new FallbackChain({ storageDir: tmp });
      const recs = new Map<UsageProvider, BudgetRecommendation>();
      recs.set('claude', 'warn');
      const ctx = makeCtx({ recs });
      const r = ruleBudgetWarn({ chain: fc }).evaluate(ctx, [
        cand('claude', 'opus'),
        cand('claude', 'sonnet'),
        cand('codex', 'gpt-5'),
      ]);
      expect(r.kind).toBe('prefer');
      expect(r.kind === 'prefer' && r.winner.brand).toBe('codex');
      expect(r.kind === 'prefer' && r.winner.model).toBe('gpt-5');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test('warn brand top + chain exhausted → pass', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rule-warn-'));
    try {
      const fc = new FallbackChain({ storageDir: tmp });
      fc.setChain([{ brand: 'claude', model: 'opus' }]);
      const recs = new Map<UsageProvider, BudgetRecommendation>();
      recs.set('claude', 'warn');
      const ctx = makeCtx({ recs });
      const r = ruleBudgetWarn({ chain: fc }).evaluate(ctx, [cand('claude', 'opus')]);
      expect(r.kind).toBe('pass');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─── R5 capability-filter ────────────────────────────────────────────

describe('ruleCapabilityFilter', () => {
  test('no constraints → pass', () => {
    const r = ruleCapabilityFilter().evaluate(makeCtx({}), [cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
  test('context-window exceeds → filters out smaller models', () => {
    const ctx = makeCtx({ estimatedInputTokens: 300_000 });
    const small = cand('claude', 'small', 'ok', { contextWindow: 50_000 });
    const big = cand('gemini', 'pro', 'ok', { contextWindow: 1_000_000 });
    const r = ruleCapabilityFilter().evaluate(ctx, [small, big]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept.some((c) => c.model === 'small')).toBe(false);
    expect(r.kind === 'filter' && r.kept.some((c) => c.model === 'pro')).toBe(true);
  });
  test('strength-tag mismatch → filters out non-matching', () => {
    const ctx = makeCtx({ strengths: ['vision'] });
    const vision = cand('gemini', 'pro', 'ok', { strengths: ['vision'] });
    const noVision = cand('claude', 'opus', 'ok', { strengths: ['code'] });
    const r = ruleCapabilityFilter().evaluate(ctx, [vision, noVision]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept.every((c) => c.model !== 'opus')).toBe(true);
  });
  test('all candidates fail constraints → pass (skip filter rather than reject)', () => {
    const ctx = makeCtx({ strengths: ['vision'] });
    const none = cand('claude', 'opus', 'ok', { strengths: ['code'] });
    const r = ruleCapabilityFilter().evaluate(ctx, [none]);
    expect(r.kind).toBe('pass');
  });
});

// ─── R6 persistent-default ───────────────────────────────────────────

describe('rulePersistentDefault', () => {
  test('no default → pass', () => {
    const r = rulePersistentDefault().evaluate(makeCtx({}), [cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
  test('default matches available candidate → prefer', () => {
    const ctx = makeCtx({ overrides: { persistentDefault: { brand: 'codex', model: 'gpt-5' } } });
    const r = rulePersistentDefault().evaluate(ctx, [cand('claude', 'opus'), cand('codex', 'gpt-5')]);
    expect(r.kind).toBe('prefer');
    expect(r.kind === 'prefer' && r.winner.brand).toBe('codex');
  });
  test('default brand unavailable → pass (fallthrough)', () => {
    const ctx = makeCtx({ overrides: { persistentDefault: { brand: 'local-llm' } } });
    const r = rulePersistentDefault().evaluate(ctx, [cand('local-llm', 'q', 'not-yet-implemented'), cand('claude', 'opus')]);
    expect(r.kind).toBe('pass');
  });
});

// ─── R7 cloud-first-ordering ─────────────────────────────────────────

describe('ruleCloudFirstOrdering', () => {
  test('cloud + local present → reorder cloud first', () => {
    const r = ruleCloudFirstOrdering().evaluate(makeCtx({}), [
      cand('local-llm', 'q'),
      cand('claude', 'opus'),
    ]);
    expect(r.kind).toBe('filter');
    expect(r.kind === 'filter' && r.kept[0]!.brand).toBe('claude');
  });
  test('only cloud → pass', () => {
    const r = ruleCloudFirstOrdering().evaluate(makeCtx({}), [cand('claude', 'opus'), cand('codex', 'gpt-5')]);
    expect(r.kind).toBe('pass');
  });
  test('only local → pass', () => {
    const r = ruleCloudFirstOrdering().evaluate(makeCtx({}), [cand('local-llm', 'q')]);
    expect(r.kind).toBe('pass');
  });
});
