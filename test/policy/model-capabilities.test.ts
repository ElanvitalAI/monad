// H6 P3 Bundle 1 · CapabilitiesStore + buildCandidatesFromCapabilities.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilitiesStore,
  DEFAULT_CAPABILITIES,
  buildCandidatesFromCapabilities,
} from '../../src/policy/model-capabilities';
import type {
  BudgetView,
  ModelCapability,
  RouteContext,
} from '../../src/policy/types';
import type { UsageProvider, UsageSnapshot } from '../../src/budget/types';
import type { BudgetRecommendation } from '../../src/budget/forecaster';

function makeCtx(opts: {
  snapshots?: ReadonlyMap<UsageProvider, UsageSnapshot>;
  recommendations?: ReadonlyMap<UsageProvider, BudgetRecommendation>;
  hasLocalLLM?: boolean;
}): RouteContext {
  const budget: BudgetView = {
    snapshots: opts.snapshots ?? new Map(),
    recommendations: opts.recommendations ?? new Map(),
    hasLocalLLM: opts.hasLocalLLM ?? false,
  };
  return {
    task: 'test task',
    budget,
    overrides: { throttleBypasses: [] },
    now: 1_700_000_000_000,
  };
}

function dummySnapshot(brand: UsageProvider): UsageSnapshot {
  return {
    provider: brand,
    windows: [],
    fetchedAt: 1_700_000_000_000,
    source: 'oauth-api',
  };
}

describe('CapabilitiesStore', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'policy-caps-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test('list() returns all defaults when no overrides', () => {
    const store = new CapabilitiesStore({ storageDir: tmp });
    const list = store.list();
    expect(list.length).toBe(DEFAULT_CAPABILITIES.length);
    expect(list.some((c) => c.brand === 'claude' && c.model === 'opus')).toBe(true);
    expect(list.some((c) => c.brand === 'local-llm' && !c.available)).toBe(true);
  });

  test('setOverride shadows a default entry', () => {
    const store = new CapabilitiesStore({ storageDir: tmp });
    store.setOverride({
      brand: 'claude', model: 'opus',
      contextWindow: 300_000, costTier: 'premium',
      strengths: ['code'], available: true,
    });
    expect(store.get('claude', 'opus')?.contextWindow).toBe(300_000);
  });

  test('clearOverride restores the default', () => {
    const store = new CapabilitiesStore({ storageDir: tmp });
    store.setOverride({ brand: 'claude', model: 'opus', contextWindow: 9, costTier: 'cheap', strengths: [], available: true });
    store.clearOverride('claude', 'opus');
    expect(store.get('claude', 'opus')?.contextWindow).toBe(200_000);
  });

  test('overrides persist across reloads', () => {
    const a = new CapabilitiesStore({ storageDir: tmp });
    a.setOverride({ brand: 'gemini', model: 'pro', contextWindow: 2_000_000, costTier: 'mid', strengths: ['vision'], available: true });
    const b = new CapabilitiesStore({ storageDir: tmp });
    expect(b.get('gemini', 'pro')?.contextWindow).toBe(2_000_000);
  });
});

describe('buildCandidatesFromCapabilities', () => {
  test('labels local-llm as not-yet-implemented when hasLocalLLM=false', () => {
    const ctx = makeCtx({ hasLocalLLM: false });
    const cands = buildCandidatesFromCapabilities(ctx);
    const local = cands.filter((c) => c.brand === 'local-llm');
    expect(local.length).toBeGreaterThan(0);
    expect(local.every((c) => c.availability === 'not-yet-implemented')).toBe(true);
  });

  test('labels cloud brands unavailable when no snapshot exists', () => {
    const ctx = makeCtx({});
    const cands = buildCandidatesFromCapabilities(ctx);
    const claude = cands.find((c) => c.brand === 'claude' && c.model === 'opus');
    expect(claude?.availability).toBe('unavailable');
  });

  test('labels cloud brands budget-saturated when recommendation=throttle', () => {
    const snaps = new Map<UsageProvider, UsageSnapshot>();
    snaps.set('claude', dummySnapshot('claude'));
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'throttle');
    const ctx = makeCtx({ snapshots: snaps, recommendations: recs });
    const cands = buildCandidatesFromCapabilities(ctx);
    const claude = cands.find((c) => c.brand === 'claude' && c.model === 'opus');
    expect(claude?.availability).toBe('budget-saturated');
  });

  test('labels ok when snapshot exists and recommendation not throttle', () => {
    const snaps = new Map<UsageProvider, UsageSnapshot>();
    snaps.set('claude', dummySnapshot('claude'));
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    recs.set('claude', 'safe');
    const ctx = makeCtx({ snapshots: snaps, recommendations: recs });
    const cands = buildCandidatesFromCapabilities(ctx);
    const claude = cands.find((c) => c.brand === 'claude' && c.model === 'opus');
    expect(claude?.availability).toBe('ok');
  });

  test('accepts custom capabilities list', () => {
    const custom: ModelCapability[] = [
      { brand: 'claude', model: 'custom', contextWindow: 1, costTier: 'free', strengths: [], available: true },
    ];
    const snaps = new Map<UsageProvider, UsageSnapshot>();
    snaps.set('claude', dummySnapshot('claude'));
    const ctx = makeCtx({ snapshots: snaps, recommendations: new Map() });
    const cands = buildCandidatesFromCapabilities(ctx, custom);
    expect(cands.length).toBe(1);
    expect(cands[0]!.model).toBe('custom');
  });
});
