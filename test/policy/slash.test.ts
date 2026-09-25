// H6 P3 Bundle 1 · /route slash dispatcher.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import { UsageStore, _setUsageStoreForTesting, _resetUsageStoreForTesting } from '../../src/budget/usage-store';
import { OverrideStore, _setOverrideStoreForTesting, _resetOverrideStoreForTesting } from '../../src/policy/override-store';
import { PolicyRouter, _setPolicyRouterForTesting, _resetPolicyRouterForTesting } from '../../src/policy/router';
import type { UsageSnapshot, UsageProvider } from '../../src/budget/types';
import { executeRouteSlash } from '../../src/skills/tools/route-slash';

const NOW = 1_700_000_000_000;

function makeSnapshot(brand: UsageProvider, usedPct: number): UsageSnapshot {
  return {
    provider: brand,
    windows: [{
      kind: 'weekly', windowMinutes: 10_080, limit: 100, used: usedPct,
      remainingPercent: 100 - usedPct, resetsAt: NOW + 86_400_000,
    }],
    fetchedAt: NOW, source: 'oauth-api',
  };
}

describe('/route slash', () => {
  let tmp: string;
  let usage: UsageStore;
  let overrides: OverrideStore;
  let history: BudgetHistoryStore;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'route-slash-'));
    history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
    usage = new UsageStore({ storageDir: join(tmp, 'u'), historyStore: history, now: () => NOW });
    overrides = new OverrideStore({ storageDir: join(tmp, 'o'), now: () => NOW });
    usage.registerFetcher('codex', { fetch: async () => makeSnapshot('codex', 20) });
    usage.registerFetcher('claude', { fetch: async () => makeSnapshot('claude', 20) });
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

  test('unknown command returns null', async () => {
    const r = await executeRouteSlash({ name: 'not-route', args: [] });
    expect(r).toBeNull();
  });

  test('/route (no args) prints help', async () => {
    const r = await executeRouteSlash({ name: 'route', args: [] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('budget-aware policy router'))).toBe(true);
  });

  test('/route help also prints help', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['help'] });
    expect(r?.logLines.some((l) => l.includes('/route test'))).toBe(true);
  });

  test('/route <task> runs decide', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['build', 'a', 'parser'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('PolicyDecide'))).toBe(true);
  });

  test('/route test <task> runs decide + explain + alternatives', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['test', 'write', 'tests'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('— trace —'))).toBe(true);
    expect(r?.logLines.some((l) => l.includes('— alternatives —'))).toBe(true);
  });

  test('/route test (empty task) errors', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['test'] });
    expect(r?.ok).toBe(false);
  });

  test('/route explain with no prior decision still ok', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['explain'] });
    expect(r?.ok).toBe(true);
  });

  test('/route explain <task> runs fresh decide', async () => {
    const r = await executeRouteSlash({ name: 'route', args: ['explain', 'debug'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('PolicyExplain'))).toBe(true);
  });
});
