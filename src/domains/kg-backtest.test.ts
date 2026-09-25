import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from './kg-store.js';
import { backtestEdge, backtestLeadLagEdges } from './kg-backtest.js';
import type { PriceBar } from './kg-correlation.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';
function fromRets(rets: number[], start = 100): PriceBar[] {
  const c = [start]; for (const r of rets) c.push(c[c.length - 1]! * (1 + r / 100));
  return c.map((x, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, close: x }));
}
const R = [2, -3, 1, -2, 3, -1, 2, -3, 1, -2, 2, -1, 3, -2, 1, 2];

describe('kg-backtest — backtestEdge(순수)', () => {
  test('★완벽 lead 예측 → hitRate 1.0', () => {
    // dst = src를 2일 지연 완전추종 → weight +, lag 2 → 100% hit
    const src = fromRets(R);
    const dst = fromRets([0.1, 0.2, ...R]);   // 2스텝 지연
    const bt = backtestEdge(src, dst, 2, 1);
    expect(bt.hitRate).toBeGreaterThan(0.9);
    expect(bt.ic!).toBeGreaterThan(0.9);
  });
  test('역관계(weight 음) 예측', () => {
    const src = fromRets(R);
    const dst = fromRets(R.map(x => -x));   // 반대 동시
    const bt = backtestEdge(src, dst, 0, -1);   // weight 음 → 반대 예측
    expect(bt.hitRate).toBeGreaterThan(0.9);
  });
  test('무관 시계열 → hitRate ~0.5 근방', () => {
    const src = fromRets(R);
    const dst = fromRets([1, 1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1]);
    const bt = backtestEdge(src, dst, 0, 1);
    expect(bt.hitRate).toBeGreaterThanOrEqual(0);
    expect(bt.hitRate).toBeLessThanOrEqual(1);
  });
});

describe('kg-backtest — backtestLeadLagEdges(집계)', () => {
  test('correlates 엣지 백테스트 집계', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: 'MU', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'correlates', weight: 0.9, leadLag: 2, validAt: NOW });
    const src = fromRets(R), dst = fromRets([0.1, 0.2, ...R]);
    const s = backtestLeadLagEdges(db, {
      minN: 5,
      usPrices: new Map([['MU', src]]), krPrices: new Map([['005930', dst]]),
    });
    expect(s.tested).toBe(1);
    expect(s.avgHitRate).toBeGreaterThan(0.9);
    expect(s.strong).toBe(1);   // hitRate>=0.6
  });
  test('표본 부족 엣지 제외', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:A', kind: 'company', market: 'US', name: 'A', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: 'B', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'company:A', dst: 'company:005930', relation: 'correlates', weight: 0.5, leadLag: 0, validAt: NOW });
    const s = backtestLeadLagEdges(db, {
      minN: 50,   // 높은 최소 표본
      usPrices: new Map([['A', fromRets(R)]]), krPrices: new Map([['005930', fromRets(R)]]),
    });
    expect(s.tested).toBe(0);
  });
  test('비종목/무측정 엣지 제외', () => {
    const db = freshDb();
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'company:005930', dst: 'chain:반도체', relation: 'belongs_to', validAt: NOW });
    expect(backtestLeadLagEdges(db, {}).tested).toBe(0);   // belongs_to·chain 제외
  });
});
