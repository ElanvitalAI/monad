// H6 P1 Bundle 1 · UsageStore behaviour contract.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import { UsageStore, type ProviderFetcher } from '../../src/budget/usage-store';
import type { UsageSnapshot } from '../../src/budget/types';

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    provider: 'codex',
    windows: [
      {
        kind: 'session',
        windowMinutes: 300,
        limit: 100,
        used: 25,
        remainingPercent: 75,
        resetsAt: 1_800_000_000_000,
      },
    ],
    fetchedAt: 1_700_000_000_000,
    source: 'cli-rpc',
    ...overrides,
  };
}

function stubFetcher(impl: () => Promise<UsageSnapshot>): ProviderFetcher {
  return { fetch: impl };
}

describe('UsageStore', () => {
  let tmp: string;
  let history: BudgetHistoryStore;
  let store: UsageStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'usage-store-'));
    history = new BudgetHistoryStore(join(tmp, 'history.sqlite'));
    store = new UsageStore({ storageDir: tmp, historyStore: history });
  });

  afterEach(() => {
    history.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('registerFetcher adds a provider', () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    expect(store.listProviders()).toEqual(['codex']);
  });

  test('refresh commits snapshot on success', async () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    await store.refresh('codex');
    expect(store.getSnapshot('codex')?.windows.length).toBe(1);
    expect(store.getError('codex')).toBeUndefined();
  });

  test('refresh all providers when no target given', async () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot({ provider: 'codex' })));
    store.registerFetcher(
      'claude',
      stubFetcher(async () => makeSnapshot({ provider: 'claude', source: 'oauth-api' })),
    );
    await store.refresh();
    expect(store.getSnapshot('codex')).toBeDefined();
    expect(store.getSnapshot('claude')).toBeDefined();
  });

  test('first failure with prior snapshot is swallowed (failure-gate)', async () => {
    let call = 0;
    store.registerFetcher(
      'codex',
      stubFetcher(async () => {
        if (call++ === 0) return makeSnapshot();
        throw new Error('transient');
      }),
    );
    await store.refresh('codex');
    await store.refresh('codex');
    expect(store.getError('codex')).toBeUndefined();
    expect(store.getSnapshot('codex')).toBeDefined();
  });

  test('second consecutive failure surfaces error', async () => {
    store.registerFetcher(
      'codex',
      stubFetcher(async () => makeSnapshot()),
    );
    await store.refresh('codex');
    store.unregisterFetcher('codex');
    store.registerFetcher(
      'codex',
      stubFetcher(async () => {
        throw new Error('fail-1');
      }),
    );
    await store.refresh('codex');
    await store.refresh('codex');
    expect(store.getError('codex')).toBe('fail-1');
  });

  test('initial failure without prior data surfaces immediately', async () => {
    store.registerFetcher(
      'codex',
      stubFetcher(async () => {
        throw new Error('no-data');
      }),
    );
    await store.refresh('codex');
    expect(store.getError('codex')).toBe('no-data');
    expect(store.getSnapshot('codex')).toBeUndefined();
  });

  test('recordTurn appends to history and reports novelty', () => {
    const turn = {
      turnId: 't-1',
      sessionId: 's-1',
      provider: 'codex' as const,
      model: 'gpt-5-codex',
      inputTokens: 10,
      outputTokens: 20,
      completedAt: 1,
    };
    expect(store.recordTurn(turn)).toBe(true);
    expect(store.recordTurn(turn)).toBe(false);
    expect(history.size()).toBe(1);
  });

  test('getAggregateUsed sums windows across brands', async () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    store.registerFetcher(
      'claude',
      stubFetcher(async () =>
        makeSnapshot({
          provider: 'claude',
          source: 'oauth-api',
          windows: [
            {
              kind: 'session',
              windowMinutes: 300,
              limit: 100,
              used: 40,
              remainingPercent: 60,
              resetsAt: 0,
            },
          ],
        }),
      ),
    );
    await store.refresh();
    expect(store.getAggregateUsed({ window: 'session' })).toBe(65);
    expect(store.getAggregateUsed({ window: 'session', provider: 'claude' })).toBe(40);
  });

  test('subscribe fires on refresh commit', async () => {
    let calls = 0;
    store.subscribe(() => {
      calls++;
    });
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    await store.refresh('codex');
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test('persists state.json atomically after refresh', async () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    await store.refresh('codex');
    const statePath = join(tmp, 'state.json');
    expect(existsSync(statePath)).toBe(true);
  });

  test('restores snapshot from state.json on construction', async () => {
    store.registerFetcher('codex', stubFetcher(async () => makeSnapshot()));
    await store.refresh('codex');

    const reopened = new UsageStore({ storageDir: tmp, historyStore: history });
    expect(reopened.getSnapshot('codex')?.windows[0]?.used).toBe(25);
  });
});
