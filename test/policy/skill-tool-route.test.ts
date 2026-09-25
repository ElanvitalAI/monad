// H6 P3 Bundle 1 · PolicyDecide + PolicyExplain LLM tool dispatchers.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import { UsageStore, _setUsageStoreForTesting, _resetUsageStoreForTesting } from '../../src/budget/usage-store';
import { OverrideStore, _setOverrideStoreForTesting, _resetOverrideStoreForTesting } from '../../src/policy/override-store';
import { PolicyRouter, _setPolicyRouterForTesting, _resetPolicyRouterForTesting } from '../../src/policy/router';
import type { UsageSnapshot, UsageProvider } from '../../src/budget/types';
import {
  dispatchPolicyDecide,
  dispatchPolicyExplain,
} from '../../src/skills/tools/route';

const NOW = 1_700_000_000_000;

function makeSnapshot(brand: UsageProvider, usedPct: number): UsageSnapshot {
  return {
    provider: brand,
    windows: [
      {
        kind: 'weekly',
        windowMinutes: 10_080,
        limit: 100,
        used: usedPct,
        remainingPercent: 100 - usedPct,
        resetsAt: NOW + 86_400_000,
      },
    ],
    fetchedAt: NOW,
    source: 'oauth-api',
  };
}

describe('dispatchPolicyDecide', () => {
  let tmp: string;
  let usage: UsageStore;
  let overrides: OverrideStore;
  let history: BudgetHistoryStore;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'rt-model-'));
    history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
    usage = new UsageStore({ storageDir: join(tmp, 'u'), historyStore: history, now: () => NOW });
    overrides = new OverrideStore({ storageDir: join(tmp, 'o'), now: () => NOW });
    usage.registerFetcher('codex', { fetch: async () => makeSnapshot('codex', 20) });
    usage.registerFetcher('claude', { fetch: async () => makeSnapshot('claude', 20) });
    usage.registerFetcher('gemini', { fetch: async () => makeSnapshot('gemini', 20) });
    await usage.refresh();
    _setUsageStoreForTesting(usage);
    _setOverrideStoreForTesting(overrides);
    _setPolicyRouterForTesting(new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW }));
  });

  afterEach(() => {
    history.close();
    _resetUsageStoreForTesting();
    _resetOverrideStoreForTesting();
    _resetPolicyRouterForTesting();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('rejects empty task', async () => {
    const r = await dispatchPolicyDecide({ task: '' });
    expect(r.isError).toBe(true);
  });

  test('returns decision + alternatives', async () => {
    const r = await dispatchPolicyDecide({ task: 'write a unit test' });
    expect(r.isError).toBeUndefined();
    expect(r.metadata.decision.brand).toBeDefined();
    expect(r.metadata.alternatives.length).toBeGreaterThan(0);
    expect(r.metadata.trace.steps.length).toBeGreaterThan(0);
  });

  test('readableSummary includes brand label + confidence', async () => {
    const r = await dispatchPolicyDecide({ task: 'hello' });
    expect(r.output).toContain('PolicyDecide');
    expect(r.output).toContain('conf=');
  });

  test('strengths filter passed through', async () => {
    const r = await dispatchPolicyDecide({ task: 'long doc', strengths: ['long-context'] });
    expect(r.isError).toBeUndefined();
  });

  test('preferred hint surfaces as per-turn', async () => {
    const r = await dispatchPolicyDecide({
      task: 'debug',
      preferred: { brand: 'gemini', model: 'pro' },
    });
    expect(r.metadata.decision.brand).toBe('gemini');
  });

  test('requiresConfirmation true when all brands throttled', async () => {
    // Re-wire with all throttled.
    _resetUsageStoreForTesting();
    usage.registerFetcher('codex', { fetch: async () => makeSnapshot('codex', 97) });
    usage.registerFetcher('claude', { fetch: async () => makeSnapshot('claude', 97) });
    usage.registerFetcher('gemini', { fetch: async () => makeSnapshot('gemini', 97) });
    await usage.refresh();
    _setUsageStoreForTesting(usage);
    _setPolicyRouterForTesting(new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW }));
    const r = await dispatchPolicyDecide({ task: 'x' });
    expect(r.metadata.decision.requiresConfirmation).toBe(true);
  });
});

describe('dispatchPolicyExplain', () => {
  let tmp: string;
  let usage: UsageStore;
  let overrides: OverrideStore;
  let history: BudgetHistoryStore;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'rt-explain-'));
    history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
    usage = new UsageStore({ storageDir: join(tmp, 'u'), historyStore: history, now: () => NOW });
    overrides = new OverrideStore({ storageDir: join(tmp, 'o'), now: () => NOW });
    usage.registerFetcher('codex', { fetch: async () => makeSnapshot('codex', 20) });
    await usage.refresh();
    _setUsageStoreForTesting(usage);
    _setOverrideStoreForTesting(overrides);
    _setPolicyRouterForTesting(new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW }));
  });

  afterEach(() => {
    history.close();
    _resetUsageStoreForTesting();
    _resetOverrideStoreForTesting();
    _resetPolicyRouterForTesting();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('no prior decision + no task → informational output', async () => {
    const r = await dispatchPolicyExplain({});
    expect(r.metadata.decision).toBeNull();
    expect(r.output).toContain('no prior decision');
  });

  test('with task → fresh decide + full trace', async () => {
    const r = await dispatchPolicyExplain({ task: 'analyze codebase' });
    expect(r.metadata.decision).not.toBeNull();
    expect(r.metadata.trace.steps.length).toBeGreaterThan(0);
  });

  test('after PolicyDecide, no-task explain returns cached trace', async () => {
    await dispatchPolicyDecide({ task: 'do the thing' });
    const r = await dispatchPolicyExplain({});
    expect(r.metadata.decision).not.toBeNull();
    expect(r.metadata.trace.steps.length).toBeGreaterThan(0);
  });
});
