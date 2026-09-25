import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import provider, {
  createMarketSurgeListProvider,
  listSurges,
  probeMarketSurgeList,
} from '../../src/mission-capabilities/market/surge.list.js';

function freshDb(path = ':memory:'): Database {
  const db = new Database(path);
  db.run('CREATE TABLE bars(symbol TEXT, date TEXT, close REAL NOT NULL, PRIMARY KEY(symbol, date))');
  return db;
}

function addBars(db: Database, symbol: string, closes: number[]): void {
  const insert = db.prepare('INSERT INTO bars(symbol, date, close) VALUES (?, ?, ?)');
  closes.forEach((close, index) => insert.run(symbol, `2026-08-${String(index + 1).padStart(2, '0')}`, close));
}

function temporaryDatabasePath(name: string): string {
  const path = join(tmpdir(), `market-surge-list-${process.pid}-${name}.db`);
  if (existsSync(path)) unlinkSync(path);
  return path;
}

describe('market.surge.list capability provider', () => {
  test('reports a file-specific failure when the US price-bars database is missing', () => {
    const result = probeMarketSurgeList(undefined, {}, temporaryDatabasePath('missing'));

    expect(provider.id).toBe('market.surge.list');
    expect(result).toEqual({
      ok: false,
      reason: 'The US price-bars database file is unavailable.',
      repairHint: {
        paths: ['src/domains/sector-store.ts'],
        what: 'Restore the US price-bars database file used by the market data pipeline.',
      },
    });
  });

  test('reports a distinct collection failure when the existing database has no bars', () => {
    const path = temporaryDatabasePath('empty');
    const db = freshDb(path);
    db.close();

    const result = probeMarketSurgeList(undefined, {}, path);
    if (existsSync(path)) unlinkSync(path);

    expect(result).toEqual({
      ok: false,
      reason: 'The US price-bars database contains no bars.',
      repairHint: {
        paths: ['src/domains/sector-store.ts'],
        what: 'Restore collection of US price bars in the market data pipeline.',
      },
    });
  });

  test('treats readable bars with no qualifying surges as available', () => {
    const path = temporaryDatabasePath('flat');
    const db = freshDb(path);
    addBars(db, 'MODEST', [100, 101.5, 103.02]);
    db.close();

    expect(probeMarketSurgeList(undefined, {}, path)).toEqual({ ok: true });
    if (existsSync(path)) unlinkSync(path);
  });

  test('lists qualifying two- and three-day gain streaks but rejects a one-day jump', () => {
    const db = freshDb();
    addBars(db, 'TWO', [100, 103, 106.09]);
    addBars(db, 'THREE', [100, 103, 106.09, 109.27]);
    addBars(db, 'JUMP', [100, 100, 110]);

    expect(listSurges(db, { minDays: 2, minDailyPct: 2.5 })).toEqual([
      { symbol: 'THREE', days: 3, cumulativePct: expect.closeTo(9.27, 2) },
      { symbol: 'TWO', days: 2, cumulativePct: expect.closeTo(6.09, 2) },
    ]);
  });

  test('resets a streak when a non-positive bar appears between gains', () => {
    const db = freshDb();
    addBars(db, 'BROKEN', [100, 103, 0, 106.09, 109.27]);

    expect(listSurges(db, { minDays: 2, minDailyPct: 2.5 })).toEqual([]);
  });

  test('preserves the configurable daily-gain threshold', () => {
    const db = freshDb();
    addBars(db, 'MODEST', [100, 101.5, 103.02]);

    expect(listSurges(db, { minDays: 2, minDailyPct: 2 })).toEqual([]);
    expect(listSurges(db, { minDays: 2, minDailyPct: 1 })).toEqual([
      { symbol: 'MODEST', days: 2, cumulativePct: expect.closeTo(3.02, 2) },
    ]);
  });

  test('provider delegates to the injected read-only collector and its criteria', async () => {
    let seen: { minDays?: number; minDailyPct?: number } | undefined;
    const injected = createMarketSurgeListProvider(criteria => {
      seen = criteria;
      return [{ symbol: 'SENTINEL', days: 2, cumulativePct: 5 }];
    }, { minDays: 2, minDailyPct: 2.5 });

    expect(await injected.probe()).toEqual({ ok: true });
    expect(seen).toEqual({ minDays: 2, minDailyPct: 2.5 });
  });

  test('treats injected empty and qualifying readable collectors as available', () => {
    expect(probeMarketSurgeList(() => [])).toEqual({ ok: true });
    expect(probeMarketSurgeList(() => [{ symbol: 'SENTINEL', days: 2, cumulativePct: 5 }])).toEqual({ ok: true });
  });
});
