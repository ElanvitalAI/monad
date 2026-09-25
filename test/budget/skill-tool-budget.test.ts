// H6 P1 Bundle 2 · LLM tool dispatcher tests.
//
// The tools read from module singletons (UsageStore, LimitsStore,
// BudgetHistoryStore). We substitute the UsageStore singleton with a
// tmp-backed instance via the `_resetUsageStoreForTesting` seam,
// then register a stub fetcher so we can assert on deterministic
// output without real OAuth.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BudgetHistoryStore,
  _setBudgetHistoryStoreForTesting,
  _resetBudgetHistoryStoreForTesting,
} from '../../src/budget/history-store';
import {
  UsageStore,
  _setUsageStoreForTesting,
  _resetUsageStoreForTesting,
  type ProviderFetcher,
} from '../../src/budget/usage-store';
import {
  LimitsStore,
  _setLimitsStoreForTesting,
  _resetLimitsStoreForTesting,
} from '../../src/budget/limits';
import type { UsageSnapshot } from '../../src/budget/types';

function patchSingletons(tmp: string): {
  history: BudgetHistoryStore;
  limits: LimitsStore;
  store: UsageStore;
} {
  const history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
  const limits = new LimitsStore({ storageDir: tmp, now: () => 1_000 });
  const store = new UsageStore({ storageDir: tmp, historyStore: history });
  _setBudgetHistoryStoreForTesting(history);
  _setUsageStoreForTesting(store);
  _setLimitsStoreForTesting(limits);
  return { history, limits, store };
}

function restoreSingletons(): void {
  _resetUsageStoreForTesting();
  _resetLimitsStoreForTesting();
  _resetBudgetHistoryStoreForTesting();
}

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    provider: 'codex',
    windows: [
      { kind: 'session', windowMinutes: 300, limit: 100, used: 25, remainingPercent: 75, resetsAt: 1_800_000_000_000 },
      { kind: 'weekly', windowMinutes: 10080, limit: 100, used: 40, remainingPercent: 60, resetsAt: 1_800_500_000_000 },
    ],
    fetchedAt: 1_000,
    source: 'cli-rpc',
    ...overrides,
  };
}

function stubFetcher(s: UsageSnapshot): ProviderFetcher {
  return { fetch: async () => s };
}

describe('BudgetStatus', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'skill-budget-status-'));
  });
  afterEach(() => {
    restoreSingletons();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns snapshots filtered by brand', async () => {
    const { store } = patchSingletons(tmp);
    store.registerFetcher('codex', stubFetcher(makeSnapshot()));
    store.registerFetcher('claude', stubFetcher(makeSnapshot({ provider: 'claude' })));
    await store.refresh();
    const { dispatchBudgetStatus } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetStatus({ brand: 'codex' });
    expect(result.metadata.snapshots.every((s) => s.brand === 'codex')).toBe(true);
    expect(result.metadata.snapshots.length).toBe(2); // 2 windows
  });

  test('returns snapshots filtered by window kind', async () => {
    const { store } = patchSingletons(tmp);
    store.registerFetcher('codex', stubFetcher(makeSnapshot()));
    await store.refresh();
    const { dispatchBudgetStatus } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetStatus({ brand: 'codex', window: 'session' });
    expect(result.metadata.snapshots.length).toBe(1);
    expect(result.metadata.snapshots[0]?.window).toBe('session');
  });

  test('refresh: true triggers fetcher + returns fresh data', async () => {
    const { store } = patchSingletons(tmp);
    let calls = 0;
    store.registerFetcher('codex', {
      fetch: async () => {
        calls++;
        return makeSnapshot();
      },
    });
    const { dispatchBudgetStatus } = await import('../../src/skills/tools/budget');
    await dispatchBudgetStatus({ refresh: true });
    expect(calls).toBe(1);
  });
});

describe('BudgetHistory', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'skill-budget-history-'));
  });
  afterEach(() => {
    restoreSingletons();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('rolls up per-day tokens from the history store', async () => {
    const { history } = patchSingletons(tmp);
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    history.appendTurns([
      {
        turnId: 'codex:a',
        sessionId: 's1',
        provider: 'codex',
        model: 'gpt-5-codex',
        inputTokens: 100,
        outputTokens: 50,
        completedAt: now - 2 * DAY,
      },
      {
        turnId: 'codex:b',
        sessionId: 's1',
        provider: 'codex',
        model: 'gpt-5-codex',
        inputTokens: 200,
        outputTokens: 75,
        completedAt: now - 1 * DAY,
      },
    ]);
    const { dispatchBudgetHistory } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetHistory({ brand: 'codex', days: 7 });
    expect(result.metadata.brand).toBe('codex');
    expect(result.metadata.aggregate.turns).toBe(2);
    expect(result.metadata.aggregate.inputTokens).toBe(300);
  });

  test('errors when brand missing', async () => {
    patchSingletons(tmp);
    const { dispatchBudgetHistory } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetHistory({});
    expect(result.isError).toBe(true);
  });
});

describe('BudgetForecast', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'skill-budget-forecast-'));
  });
  afterEach(() => {
    restoreSingletons();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns forecast rows with recommendation buckets', async () => {
    const { store } = patchSingletons(tmp);
    const now = Date.now();
    const snapshot = makeSnapshot({
      windows: [
        {
          kind: 'session',
          windowMinutes: 300,
          limit: 100,
          used: 90,
          remainingPercent: 10,
          resetsAt: now + 60 * 60 * 1000, // 1h away
        },
      ],
    });
    store.registerFetcher('codex', stubFetcher(snapshot));
    await store.refresh();
    const { dispatchBudgetForecast } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetForecast({ brand: 'codex' });
    expect(result.metadata.forecasts.length).toBe(1);
    expect(result.metadata.forecasts[0]?.recommendation).toBe('warn');
  });
});

describe('BudgetSetLimit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'skill-budget-set-'));
  });
  afterEach(() => {
    restoreSingletons();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('persists a user-config limit and reports prior', async () => {
    const { limits } = patchSingletons(tmp);
    const { dispatchBudgetSetLimit } = await import('../../src/skills/tools/budget');

    const first = await dispatchBudgetSetLimit({
      brand: 'codex',
      window: 'session',
      quota: 60,
    });
    expect(first.metadata.saved).toBe(true);
    const second = await dispatchBudgetSetLimit({
      brand: 'codex',
      window: 'session',
      quota: 75,
    });
    expect(second.metadata.saved).toBe(true);
    expect(second.metadata.previousLimit).toBe(60);
    expect(limits.getEffective('codex', 'session')?.quota).toBe(75);
  });

  test('errors on invalid brand', async () => {
    patchSingletons(tmp);
    const { dispatchBudgetSetLimit } = await import('../../src/skills/tools/budget');
    const result = await dispatchBudgetSetLimit({
      brand: 'invalid',
      window: 'session',
      quota: 50,
    });
    expect(result.isError).toBe(true);
  });
});
