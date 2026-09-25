// R4 v1.1 — 라이브 수집층·KR bars·매력도 Δ방향·한글 레이블 (대표 피드백 2026-07-07).

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { collectLiveSnapshot, readLiveSnapshot, ingestKrBars, KR_SECTOR_ETFS } from '../src/domains/market-live.js';
import { dashboardHeatmap, labelKo } from '../src/domains/dashboard-data.js';
import { openPulseDb } from '../src/domains/us-pulse.js';

describe('market-live (라이브 스냅샷)', () => {
  test('수집 → 캐시 → 읽기 · 신선도 게이트', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    const out = join(dir, 'live.json');
    const fake = (base: number) => (_symbol: string) => ({ last: base, prevClose: base / 1.02 }); // +2%
    const r = collectLiveSnapshot({
      session: { us: 'OPEN', kr: 'CLOSED' }, outPath: out,
      toss: fake(100), omni: fake(7000),
      indices: [{ symbol: 'GSPC.INDX', name: 'S&P500' }],
      stocks: [{ symbol: 'NVDA', name: '엔비디아', market: 'us' }],
    });
    expect(r.count).toBeGreaterThan(15); // 앵커3+US섹터11+KR섹터8+지수1+종목1
    const s = readLiveSnapshot(150, out)!;
    expect(s.usSectors.length).toBe(11);
    expect(s.krSectors.length).toBe(Object.keys(KR_SECTOR_ETFS).length);
    expect(s.usSectors[0]!.dayPct).toBeCloseTo(2, 0);
    // A future timestamp makes the former elapsed-time-only `>` check return this
    // snapshot for maxAge 0; no-retention must reject it without consulting elapsed time.
    writeFileSync(out, JSON.stringify({ ...s, ts: '2999-01-01T00:00:00.000Z' }));
    expect(readLiveSnapshot(0, out)).toBeNull();
    expect(readLiveSnapshot(-1, out)).toBeNull();
    expect(readLiveSnapshot(150, out)).not.toBeNull();
    writeFileSync(out, JSON.stringify({ ...s, ts: '2000-01-01T00:00:00.000Z' }));
    expect(readLiveSnapshot(150, out)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('quote 실패 종목은 조용히 제외 (fail-soft)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    const out = join(dir, 'live.json');
    const r = collectLiveSnapshot({
      session: { us: 'CLOSED', kr: 'OPEN' }, outPath: out,
      toss: () => null, omni: () => null,
      indices: [], stocks: [],
    });
    expect(r.count).toBe(0);
    expect(readLiveSnapshot(150, out)!.usSectors).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('ingestKrBars — 멱등 누적 (fake fetch)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    const dbPath = join(dir, 'pulse.db');
    const fake = () => [{ date: '2026-07-04', close: 100 }, { date: '2026-07-06', close: 103 }];
    expect(ingestKrBars(dbPath, fake, ['091160'])).toBe(2);
    expect(ingestKrBars(dbPath, fake, ['091160'])).toBe(0); // 멱등
    const db = openPulseDb(dbPath);
    expect((db.prepare(`SELECT COUNT(*) n FROM bars WHERE symbol='091160'`).get() as any).n).toBe(2);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('heatmap v1.1 (Δ방향·KR·레이블)', () => {
  test('매력도 delta/dir — 직전 as_of 대비', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-'));
    const scoresDb = join(dir, 'scores.db');
    const db = new Database(scoresDb);
    db.run(`CREATE TABLE cross_asset_scores(preset_hash TEXT, as_of TEXT, asset_class TEXT, symbol TEXT, score REAL, z_score REAL, signal TEXT, rank INT)`);
    const ins = db.prepare(`INSERT INTO cross_asset_scores VALUES ('h', ?, ?, ?, ?, 0, 'HOLD', 1)`);
    ins.run('2026-07-01', 'crypto', 'IBIT.US', 40);
    ins.run('2026-07-05', 'crypto', 'IBIT.US', 46);   // +6 → up
    ins.run('2026-07-01', 'gold', 'GLD.US', 60);
    ins.run('2026-07-05', 'gold', 'GLD.US', 55);      // -5 → down
    ins.run('2026-07-05', 'financials', 'XLF.US', 70); // 직전 없음 → dir null
    db.close();
    const h = dashboardHeatmap({ scoresDb, pulseDb: join(dir, 'no.db'), signalsDb: join(dir, 'no2.db'), liveSnapshot: join(dir, 'no.json') });
    const a = h.attractiveness! as any;
    expect(a.prevAsOf).toBe('2026-07-01');
    const crypto = a.asset.find((c: any) => c.key === 'crypto');
    expect(crypto.dir).toBe('up'); expect(crypto.delta).toBe(6);
    expect(crypto.label).toBe('크립토');
    expect(a.asset.find((c: any) => c.key === 'gold').dir).toBe('down');
    expect(a.sector.find((c: any) => c.key === 'financials').dir).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('labelKo — 복합 태그·미등록 원문 유지', () => {
    expect(labelKo('semis,sw')).toBe('반도체·소프트웨어');
    expect(labelKo('equities_kr')).toBe('한국주식');
    expect(labelKo('unknown_tag')).toBe('unknown_tag');
  });
});
