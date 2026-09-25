import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, addEdge, getEdges } from './kg-store.js';
import { buildBasketIndex, correlateCrossMarket, correlateGroups } from './kg-correlate.js';
import type { PriceBar } from './kg-correlation.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

/** 일별 수익률(%) 배열 → bar 시계열(누적·시작 start). 상관은 수익률 기준이라 이게 명확. */
function fromRets(rets: number[], start = 100): PriceBar[] {
  const closes = [start];
  for (const r of rets) closes.push(closes[closes.length - 1]! * (1 + r / 100));
  return closes.map((c, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, close: c }));
}
// 진동 패턴(평균~0·분산>0) — 동조/역관계 테스트용
const R = [2, -3, 1, -2, 3, -1, 2, -3, 1, -2, 2, -1];
const NEG_R = R.map(x => -x);

describe('kg-correlate — 크로스마켓 상관(R6·R3)', () => {
  test('동조 페어(같은 일별 수익률) → correlates 양수', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'cross_market', validAt: '2000-01-01' });
    const n = correlateCrossMarket(db, {
      now: NOW, regime: 'RISK_ON',
      usPrices: new Map([['MU', fromRets(R)]]),
      krPrices: new Map([['005930', fromRets(R)]]),
    });
    expect(n).toBe(1);
    const e = getEdges(db, { src: 'company:MU', relation: 'correlates' })[0]!;
    expect(e.weight!).toBeGreaterThan(0.9);
    expect(e.regimeAt).toBe('RISK_ON');    // R2 국면 태깅
    expect(e.extractedBy).toBe('correlation');
  });
  test('minAbsCorr 미달 페어는 스킵', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'cross_market', validAt: '2000-01-01' });
    const n = correlateCrossMarket(db, {
      now: NOW, minAbsCorr: 1.01,
      usPrices: new Map([['MU', fromRets(R)]]), krPrices: new Map([['005930', fromRets(R)]]),
    });
    expect(n).toBe(0);
  });
  test('가격 없는 페어 fail-soft(스킵)', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'cross_market', validAt: '2000-01-01' });
    const n = correlateCrossMarket(db, { now: NOW, usPrices: new Map(), krPrices: new Map() });
    expect(n).toBe(0);
  });
});

describe('kg-correlate — 그룹 바스켓(R7·R8)', () => {
  test('★P7↔M7 역관계(반대 일별 수익률) → correlates 음수', () => {
    const db = freshDb();
    for (const m of ['MU', 'INTC']) addEdge(db, { src: `company:${m}`, dst: 'group:P7', relation: 'belongs_to', validAt: '2000-01-01' });
    for (const m of ['NVDA', 'AMZN']) addEdge(db, { src: `company:${m}`, dst: 'group:M7', relation: 'belongs_to', validAt: '2000-01-01' });
    const prices = new Map<string, PriceBar[]>([
      ['MU', fromRets(R)], ['INTC', fromRets(R)],          // P7 = R
      ['NVDA', fromRets(NEG_R)], ['AMZN', fromRets(NEG_R)], // M7 = -R (역관계)
    ]);
    const n = correlateGroups(db, { now: NOW, regime: 'RISK_ON', usPrices: prices });
    expect(n).toBe(1);
    const e = getEdges(db, { src: 'group:P7', relation: 'correlates' })[0]!;
    expect(e.dst).toBe('group:M7');
    expect(e.weight!).toBeLessThan(-0.8);   // ★음의 상관(적대·R8)
    expect(e.regimeAt).toBe('RISK_ON');
  });
  test('동조 그룹 → correlates 양수', () => {
    const db = freshDb();
    for (const m of ['MU', 'INTC']) addEdge(db, { src: `company:${m}`, dst: 'group:P7', relation: 'belongs_to', validAt: '2000-01-01' });
    for (const m of ['NVDA', 'AMZN']) addEdge(db, { src: `company:${m}`, dst: 'group:M7', relation: 'belongs_to', validAt: '2000-01-01' });
    const prices = new Map<string, PriceBar[]>([
      ['MU', fromRets(R)], ['INTC', fromRets(R)], ['NVDA', fromRets(R)], ['AMZN', fromRets(R)],
    ]);
    const n = correlateGroups(db, { now: NOW, usPrices: prices });
    expect(getEdges(db, { src: 'group:P7', relation: 'correlates' })[0]!.weight!).toBeGreaterThan(0.8);
    expect(n).toBe(1);
  });
  test('멤버 부족 그룹은 스킵', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'group:P7', relation: 'belongs_to', validAt: '2000-01-01' });
    const n = correlateGroups(db, { now: NOW, usPrices: new Map([['MU', fromRets(R)]]) });
    expect(n).toBe(0);
  });
});

describe('kg-correlate — buildBasketIndex', () => {
  test('멤버 정규화 평균 지수(시작 100)', () => {
    const idx = buildBasketIndex(new Map([['A', fromRets(R)], ['B', fromRets(R, 200)]]), ['A', 'B'])!;
    expect(idx[0]!.close).toBeCloseTo(100, 5);   // 시작 정규화 100
    expect(idx.length).toBeGreaterThan(4);
  });
  test('멤버 2 미만 = null', () => {
    expect(buildBasketIndex(new Map([['A', fromRets(R)]]), ['A'])).toBeNull();
  });
});
