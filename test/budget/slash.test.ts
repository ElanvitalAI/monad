// H6 P1 Bundle 2 · /budget slash handler tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBudgetSlash } from '../../src/skills/tools/budget-slash';
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

function patch(tmp: string): {
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

function stubFetcher(s: UsageSnapshot): ProviderFetcher {
  return { fetch: async () => s };
}

function snap(used = 25): UsageSnapshot {
  return {
    provider: 'codex',
    windows: [{ kind: 'session', windowMinutes: 300, limit: 100, used, remainingPercent: 100 - used, resetsAt: Date.now() + 60_000 }],
    fetchedAt: Date.now(),
    source: 'cli-rpc',
  };
}

describe('executeBudgetSlash', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'budget-slash-'));
  });
  afterEach(() => {
    restoreSingletons();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns null for non-budget commands', async () => {
    patch(tmp);
    const r = await executeBudgetSlash({ name: 'theme', args: [] });
    expect(r).toBeNull();
  });

  test('/budget prints status matrix', async () => {
    const { store } = patch(tmp);
    store.registerFetcher('codex', stubFetcher(snap()));
    await store.refresh();
    const r = await executeBudgetSlash({ name: 'budget', args: [] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toContain('codex');
  });

  test('/budget <brand> filters', async () => {
    const { store } = patch(tmp);
    store.registerFetcher('codex', stubFetcher(snap()));
    store.registerFetcher('claude', stubFetcher(snap()));
    await store.refresh();
    const r = await executeBudgetSlash({ name: 'budget', args: ['codex'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toContain('codex');
    expect(r?.logLines.join('\n')).not.toContain('claude');
  });

  test('/budget set persists a user limit', async () => {
    const { limits } = patch(tmp);
    const r = await executeBudgetSlash({
      name: 'budget',
      args: ['set', 'codex', 'session', '80'],
    });
    expect(r?.ok).toBe(true);
    expect(limits.getEffective('codex', 'session')?.quota).toBe(80);
  });

  test('/budget set rejects invalid input', async () => {
    patch(tmp);
    const r = await executeBudgetSlash({
      name: 'budget',
      args: ['set', 'bogus', 'session', '80'],
    });
    expect(r?.ok).toBe(false);
  });

  test('/budget refresh invokes fetcher and reports timing', async () => {
    const { store } = patch(tmp);
    let calls = 0;
    store.registerFetcher('codex', {
      fetch: async () => {
        calls++;
        return snap();
      },
    });
    const r = await executeBudgetSlash({ name: 'budget', args: ['refresh', 'codex'] });
    expect(r?.ok).toBe(true);
    expect(calls).toBe(1);
    expect(r?.logLines[0]).toContain('/budget refresh codex');
  });

  test('/budget help returns usage text', async () => {
    patch(tmp);
    const r = await executeBudgetSlash({ name: 'budget', args: ['help'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('/budget set'))).toBe(true);
  });

  test('unknown subcommand surfaces help pointer', async () => {
    patch(tmp);
    const r = await executeBudgetSlash({ name: 'budget', args: ['foobar'] });
    expect(r?.ok).toBe(false);
    expect(r?.logLines.join('\n')).toContain('help');
  });
});
