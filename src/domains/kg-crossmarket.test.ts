import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, getEdges } from './kg-store.js';
import { correlateCrossMarketBatch } from './kg-crossmarket.js';
import type { PriceBar } from './kg-correlation.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

function fromRets(rets: number[], start = 100): PriceBar[] {
  const c = [start]; for (const r of rets) c.push(c[c.length - 1]! * (1 + r / 100));
  return c.map((x, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, close: x }));
}
const R = [2, -3, 1, -2, 3, -1, 2, -3, 1, -2, 2, -1, 1, 2, -2, 1];

function seed(db: Database): void {
  upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: '마이크론', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성', firstSeen: NOW, lastSeen: NOW });
}

describe('kg-crossmarket — 전종목 lead-lag 배치(추천3)', () => {
  test('★US 선행 동조 페어 → cross_market + correlates(lead_lag)', () => {
    const db = freshDb(); seed(db);
    // 삼성 = 마이크론을 2일 지연 추종(마이크론 선행)
    const us = fromRets(R);
    const kr = fromRets([0.5, -0.5, ...R]);   // 2 스텝 지연
    const r = correlateCrossMarketBatch(db, {
      now: NOW, regime: 'RISK_ON', window: 60, minAbsCorr: 0.3,
      usPrices: new Map([['MU', us]]), krPrices: new Map([['005930', kr]]),
    });
    expect(r.edges).toBe(1);
    const corr = getEdges(db, { src: 'company:MU', relation: 'correlates' })[0]!;
    expect(corr.dst).toBe('company:005930');
    expect(corr.leadLag).toBe(2);         // 마이크론 2일 선행
    expect(corr.weight!).toBeGreaterThan(0.9);
    // cross_market 토폴로지도 생성
    expect(getEdges(db, { src: 'company:MU', relation: 'cross_market' })).toHaveLength(1);
  });
  test('KR 선행 페어는 cross_market 제외(requireUsLeads)', () => {
    const db = freshDb(); seed(db);
    const us = fromRets([0.5, -0.5, ...R]);   // 미국이 2일 지연(KR 선행)
    const kr = fromRets(R);
    const r = correlateCrossMarketBatch(db, {
      now: NOW, minAbsCorr: 0.3, requireUsLeads: true,
      usPrices: new Map([['MU', us]]), krPrices: new Map([['005930', kr]]),
    });
    expect(r.edges).toBe(0);   // US가 선행 아니라 제외
  });
  test('약한 상관 페어 제외(임계 초과 불가)', () => {
    const db = freshDb(); seed(db);
    const r = correlateCrossMarketBatch(db, {
      now: NOW, minAbsCorr: 1.01,   // 어떤 상관도 통과 못함
      usPrices: new Map([['MU', fromRets(R)]]), krPrices: new Map([['005930', fromRets(R)]]),
    });
    expect(r.edges).toBe(0);
  });
  test('노드 없으면 no-op', () => {
    const db = freshDb();
    expect(correlateCrossMarketBatch(db, { now: NOW })).toEqual({ pairs: 0, edges: 0 });
  });
  test('maxKr 상한 적용', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: 'MU', firstSeen: NOW, lastSeen: NOW });
    for (let i = 0; i < 10; i++) upsertNode(db, { id: `company:00${i}000`, kind: 'company', market: 'KR', name: `k${i}`, firstSeen: NOW, lastSeen: NOW });
    const r = correlateCrossMarketBatch(db, { now: NOW, maxKr: 3, usPrices: new Map([['MU', fromRets(R)]]), krPrices: new Map() });
    expect(r.pairs).toBeLessThanOrEqual(3);   // KR 3개로 제한
  });
});
