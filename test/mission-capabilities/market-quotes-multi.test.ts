import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { $ } from 'bun';
import provider, { createMarketQuotesMultiProvider, probeMarketQuotesMulti, readMarketIndexMoves, readMarketQuoteCoverage } from '../../src/mission-capabilities/market/quotes.multi.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE dim_instrument (instrument_id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, region_key TEXT NOT NULL); CREATE TABLE fact_market_daily (date TEXT NOT NULL, instrument_id INTEGER NOT NULL, px_close REAL, ret_1d REAL);');
  return db;
}
function seedBackbone(db: Database): void {
  const instrument = db.prepare('INSERT INTO dim_instrument VALUES (?, ?, ?)');
  const daily = db.prepare('INSERT INTO fact_market_daily VALUES (?, ?, ?, ?)');
  [[1, '^GSPC', 'US'], [2, '^IXIC', 'US'], [3, 'EWY', 'KR'], [4, 'EWJ', 'JP'], [5, 'FXI', 'CN']].forEach(([id, symbol, region]) => { instrument.run(id, symbol, region); daily.run('2026-08-31', id, 100 + Number(id), Number(id)); });
}

describe('market.quotes.multi capability provider', () => {
  test('reads the actual latest close and return for configured US, KR, JP, and CN instruments', () => {
    const db = freshDb();
    try {
      seedBackbone(db);
      db.run('INSERT INTO fact_market_daily VALUES (?, ?, ?, ?)', ['2026-08-30', 1, 1, -99]);
      expect(readMarketIndexMoves(db)).toEqual([
        { symbol: '^GSPC', region: 'US', date: '2026-08-31', close: 101, return1d: 1 }, { symbol: '^IXIC', region: 'US', date: '2026-08-31', close: 102, return1d: 2 }, { symbol: 'EWY', region: 'KR', date: '2026-08-31', close: 103, return1d: 3 }, { symbol: 'EWJ', region: 'JP', date: '2026-08-31', close: 104, return1d: 4 }, { symbol: 'FXI', region: 'CN', date: '2026-08-31', close: 105, return1d: 5 },
      ]);
    } finally { db.close(); }
  });
  test('does not fabricate a row when its stored daily value is absent', () => {
    const db = freshDb();
    try { seedBackbone(db); db.run('DELETE FROM fact_market_daily WHERE instrument_id = 5'); expect(readMarketIndexMoves(db).map(move => move.symbol)).not.toContain('FXI'); } finally { db.close(); }
  });
  test('rejects a configured symbol whose stored region does not match its required region', () => {
    const db = freshDb();
    try {
      seedBackbone(db);
      db.run("UPDATE dim_instrument SET region_key = 'US' WHERE symbol = 'FXI'");
      expect(readMarketIndexMoves(db).map(move => move.symbol)).not.toContain('FXI');
    } finally { db.close(); }
  });
  test('agrees with the consumer when all latest returns are available', () => {
    const db = freshDb();
    try {
      seedBackbone(db);
      expect(probeMarketQuotesMulti(() => readMarketQuoteCoverage(db))).toEqual({ ok: true });
      expect(readMarketIndexMoves(db)).toHaveLength(5);
    } finally { db.close(); }
  });
  test('agrees with the consumer when all latest returns are unavailable', () => {
    const db = freshDb();
    try {
      seedBackbone(db);
      db.run('UPDATE fact_market_daily SET ret_1d = NULL');
      const result = probeMarketQuotesMulti(() => readMarketQuoteCoverage(db));
      expect(readMarketIndexMoves(db)).toEqual([]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('ret_1d for ^GSPC');
        expect(result.repairHint?.what).toContain('Run scripts/collect-market-daily.sh');
        expect(result.repairHint?.paths).toEqual(['scripts/collect-market-daily.sh']);
        expect(result.repairHint?.paths?.every(path => !path.startsWith('/Users/') && !path.startsWith('~/.claude/skills/'))).toBe(true);
      }
    } finally { db.close(); }
  });
  test('agrees with the consumer for only symbols whose latest returns are unavailable', () => {
    const db = freshDb();
    try {
      seedBackbone(db);
      db.run("UPDATE fact_market_daily SET ret_1d = NULL WHERE instrument_id = 5");
      const result = probeMarketQuotesMulti(() => readMarketQuoteCoverage(db));
      expect(readMarketIndexMoves(db).map(move => move.symbol)).not.toContain('FXI');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('ret_1d for FXI');
        expect(result.reason).not.toContain('^GSPC');
      }
    } finally { db.close(); }
  });
  test('reports a repairable failure when fact_market_daily is empty and delegates injected coverage', async () => {
    const db = freshDb();
    try { expect(probeMarketQuotesMulti(() => readMarketQuoteCoverage(db)).ok).toBe(false); } finally { db.close(); }
    let calls = 0;
    const injected = createMarketQuotesMultiProvider(() => { calls++; return ['US:^GSPC', 'US:^IXIC', 'KR:EWY', 'JP:EWJ', 'CN:FXI']; });
    expect(provider.id).toBe('market.quotes.multi'); expect(await injected.probe()).toEqual({ ok: true }); expect(calls).toBe(1);
  });

  test('keeps the repository daily collector executable and preserves a failed collector status', async () => {
    const wrapper = join(import.meta.dir, '../../scripts/collect-market-daily.sh');
    await access(wrapper, constants.X_OK);
    const source = await readFile(wrapper, 'utf8');
    expect(source).toContain('yahoo_fetch_daily.py');
    expect(source).toContain('LOGDIR="$HOME/.monad/logs/collect"');
    expect(source).toContain('rc=$?');
    expect(source).toContain('exit "$rc"');

    const root = await mkdtemp(join(tmpdir(), 'market-daily-'));
    try {
      const skillScripts = join(root, 'skill', 'scripts');
      const skillData = join(root, 'skill', 'data');
      await $`mkdir -p ${skillScripts}`.quiet();
      await mkdir(skillData, { recursive: true });
      await writeFile(join(skillData, 'x_asset.db'), '');
      await writeFile(join(skillScripts, 'yahoo_fetch_daily.py'), `exit 23
`);
      const runnable = source
        .replace('SK="$HOME/.claude/skills/apify-x-asset-sentiment"', `SK="${join(root, 'skill')}"`);
      const wrapperCopy = join(root, 'collect-market-daily.sh');
      await writeFile(wrapperCopy, runnable, { mode: 0o755 });
      const child = Bun.spawn([wrapperCopy], { env: { ...process.env, HOME: root, PY: '/bin/zsh' } });
      expect(await child.exited).toBe(23);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
