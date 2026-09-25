// H6 P1 Bundle 1 · BudgetHistoryStore SQLite contract tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import type { TurnSummary } from '../../src/budget/types';

function makeTurn(overrides: Partial<TurnSummary> = {}): TurnSummary {
  return {
    turnId: 'codex:evt-1',
    sessionId: 'sess-a',
    provider: 'codex',
    model: 'gpt-5-codex',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    completedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('BudgetHistoryStore', () => {
  let tmp: string;
  let dbPath: string;
  let store: BudgetHistoryStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'budget-history-'));
    dbPath = join(tmp, 'history.sqlite');
    store = new BudgetHistoryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('appendTurn inserts a new row and returns true', () => {
    expect(store.appendTurn(makeTurn())).toBe(true);
    expect(store.size()).toBe(1);
  });

  test('appendTurn is idempotent on turnId (dedup)', () => {
    expect(store.appendTurn(makeTurn())).toBe(true);
    expect(store.appendTurn(makeTurn())).toBe(false);
    expect(store.size()).toBe(1);
  });

  test('appendTurns batch inserts only new rows', () => {
    const turns: TurnSummary[] = [
      makeTurn({ turnId: 'codex:a' }),
      makeTurn({ turnId: 'codex:b' }),
      makeTurn({ turnId: 'codex:a' }),
    ];
    expect(store.appendTurns(turns)).toBe(2);
    expect(store.size()).toBe(2);
  });

  test('queryTurns filters by time window', () => {
    store.appendTurn(makeTurn({ turnId: 'codex:old', completedAt: 1_000 }));
    store.appendTurn(makeTurn({ turnId: 'codex:mid', completedAt: 2_000 }));
    store.appendTurn(makeTurn({ turnId: 'codex:new', completedAt: 3_000 }));
    const rows = store.queryTurns({ fromMs: 1_500, toMs: 2_500 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.turnId).toBe('codex:mid');
  });

  test('queryTurns filters by provider', () => {
    store.appendTurn(makeTurn({ turnId: 'codex:a' }));
    store.appendTurn(makeTurn({ turnId: 'claude:a', provider: 'claude' }));
    const claudeOnly = store.queryTurns({
      fromMs: 0,
      toMs: Number.MAX_SAFE_INTEGER,
      provider: 'claude',
    });
    expect(claudeOnly.length).toBe(1);
    expect(claudeOnly[0]?.provider).toBe('claude');
  });

  test('queryTurns filters by model', () => {
    store.appendTurn(makeTurn({ turnId: 'codex:a', model: 'gpt-5-codex' }));
    store.appendTurn(makeTurn({ turnId: 'codex:b', model: 'gpt-5-mini' }));
    const mini = store.queryTurns({
      fromMs: 0,
      toMs: Number.MAX_SAFE_INTEGER,
      model: 'gpt-5-mini',
    });
    expect(mini.length).toBe(1);
    expect(mini[0]?.model).toBe('gpt-5-mini');
  });

  test('aggregate sums token counts and cost', () => {
    store.appendTurn(makeTurn({ turnId: 'a', inputTokens: 100, outputTokens: 50, costUsd: 0.01 }));
    store.appendTurn(makeTurn({ turnId: 'b', inputTokens: 200, outputTokens: 75, costUsd: 0.03 }));
    const agg = store.aggregate({ fromMs: 0, toMs: Number.MAX_SAFE_INTEGER });
    expect(agg.turns).toBe(2);
    expect(agg.inputTokens).toBe(300);
    expect(agg.outputTokens).toBe(125);
    expect(agg.costUsd).toBeCloseTo(0.04, 5);
  });

  test('aggregate returns zeroes on empty window', () => {
    const agg = store.aggregate({ fromMs: 0, toMs: 1 });
    expect(agg.turns).toBe(0);
    expect(agg.inputTokens).toBe(0);
    expect(agg.costUsd).toBe(0);
  });

  test('pruneOld deletes rows older than retentionMs', () => {
    const now = 10_000_000;
    store.appendTurn(makeTurn({ turnId: 'old', completedAt: 100 }));
    store.appendTurn(makeTurn({ turnId: 'new', completedAt: now - 1 }));
    const removed = store.pruneOld(1_000_000, now);
    expect(removed).toBe(1);
    expect(store.size()).toBe(1);
    const remaining = store.queryTurns({ fromMs: 0, toMs: Number.MAX_SAFE_INTEGER });
    expect(remaining[0]?.turnId).toBe('new');
  });

  test('preserves optional cache/cost fields round-trip', () => {
    store.appendTurn(
      makeTurn({
        turnId: 'rt',
        cacheReadTokens: 7,
        cacheCreateTokens: 3,
        costUsd: 0.123,
      }),
    );
    const [row] = store.queryTurns({ fromMs: 0, toMs: Number.MAX_SAFE_INTEGER });
    expect(row?.cacheReadTokens).toBe(7);
    expect(row?.cacheCreateTokens).toBe(3);
    expect(row?.costUsd).toBeCloseTo(0.123, 5);
  });

  test('reopens existing db file without schema churn', () => {
    store.appendTurn(makeTurn({ turnId: 'persist' }));
    store.close();
    const reopened = new BudgetHistoryStore(dbPath);
    try {
      expect(reopened.size()).toBe(1);
    } finally {
      reopened.close();
    }
  });
});
