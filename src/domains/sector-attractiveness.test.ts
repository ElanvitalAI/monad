import { test, expect, describe } from 'bun:test';
import {
  windowReturnPct, flattenSectors, computeSectorScores, usSectorChains, KR_CHAINS, WINDOW_DAYS,
  type PriceBar,
} from './sector-attractiveness.js';

const NOW = '2026-07-07T00:00:00.000Z';
// 삼성 실측 유사(date asc): 6/7 근처 ~ 7/7.
const bars = (pairs: Array<[string, number]>): PriceBar[] => pairs.map(([date, close]) => ({ date, close }));

describe('windowReturnPct — rolling window 수익률', () => {
  const series = bars([
    ['2026-06-07', 300_000], ['2026-06-30', 334_000], ['2026-07-06', 318_000], ['2026-07-07', 296_000],
  ]);
  test('daily(1일전) = 7/6 대비', () => {
    // 7/7 cutoff = 7/6. base=318000, latest=296000 → -6.92%
    expect(windowReturnPct(series, 'daily', NOW)).toBeCloseTo((296000 / 318000 - 1) * 100, 2);
  });
  test('weekly(7일전 6/30) 대비', () => {
    // cutoff=6/30. base=334000 → -11.38%
    expect(windowReturnPct(series, 'weekly', NOW)).toBeCloseTo((296000 / 334000 - 1) * 100, 2);
  });
  test('monthly(30일전 6/7) 대비', () => {
    // cutoff=6/7. base=300000 → -1.33%
    expect(windowReturnPct(series, 'monthly', NOW)).toBeCloseTo((296000 / 300000 - 1) * 100, 2);
  });
  test('데이터 부족(1개)·기준 없음 → null', () => {
    expect(windowReturnPct(bars([['2026-07-07', 100]]), 'daily', NOW)).toBeNull();
    // monthly cutoff(6/7)보다 이른 데이터 없음 → base null
    expect(windowReturnPct(bars([['2026-07-06', 100], ['2026-07-07', 110]]), 'monthly', NOW)).toBeNull();
  });
  test('WINDOW_DAYS 정의(대표: 1/7/30)', () => {
    expect(WINDOW_DAYS).toEqual({ daily: 1, weekly: 7, monthly: 30 });
  });
});

describe('flattenSectors — granularity', () => {
  const chains = { A: { s1: ['1', '2'], s2: ['3'] }, B: { s3: ['4'] } };
  test('category = 카테고리 묶음(2개)', () => {
    const g = flattenSectors(chains, 'category');
    expect(g).toEqual([{ chain: 'A', codes: ['1', '2', '3'] }, { chain: 'B', codes: ['4'] }]);
  });
  test('subchain = 서브체인 독립(3개·이름 카테고리·서브)', () => {
    const g = flattenSectors(chains, 'subchain');
    expect(g.map(x => x.chain)).toEqual(['A·s1', 'A·s2', 'B·s3']);
  });
  test('KR_CHAINS subchain 승격 → 30개+ 세분화', () => {
    expect(flattenSectors(KR_CHAINS, 'subchain').length).toBeGreaterThanOrEqual(30);
    expect(flattenSectors(KR_CHAINS, 'category').length).toBe(18);
  });
});

describe('computeSectorScores — 매력도 계산', () => {
  const now = NOW;
  // 2섹터: 강섹터(둘 다 상승), 약섹터(둘 다 하락).
  const prices = new Map<string, PriceBar[]>([
    ['S1', bars([['2026-06-07', 100], ['2026-07-07', 110]])],   // +10%
    ['S2', bars([['2026-06-07', 100], ['2026-07-07', 108]])],   // +8%
    ['W1', bars([['2026-06-07', 100], ['2026-07-07', 90]])],    // -10%
    ['W2', bars([['2026-06-07', 100], ['2026-07-07', 95]])],    // -5%
  ]);
  const chains = { 강한섹터: { sub: ['S1', 'S2'] }, 약한섹터: { sub: ['W1', 'W2'] } };

  test('강섹터가 rank 1 · mom/breadth 반영', () => {
    const r = computeSectorScores(prices, chains, { market: 'KR', window: 'monthly', now });
    expect(r.length).toBe(2);
    const strong = r.find(s => s.chain.startsWith('강한섹터'))!;
    const weak = r.find(s => s.chain.startsWith('약한섹터'))!;
    expect(strong.rank).toBe(1);
    expect(strong.mom).toBeCloseTo(9, 1);       // (10+8)/2
    expect(strong.breadth).toBe(100);           // 둘 다 상승
    expect(weak.breadth).toBe(0);               // 둘 다 하락
    expect(strong.score).toBeGreaterThan(weak.score);
  });
  test('minN 미만 유효종목 섹터 제외', () => {
    const sparse = new Map<string, PriceBar[]>([['S1', bars([['2026-06-07', 100], ['2026-07-07', 110]])]]);
    const r = computeSectorScores(sparse, chains, { market: 'KR', window: 'monthly', now, minN: 2 });
    expect(r.length).toBe(0);   // 각 섹터 1종목뿐 → 제외
  });
  test('데이터 전무 → 빈 배열(never throws)', () => {
    expect(computeSectorScores(new Map(), chains, { market: 'KR', window: 'daily', now })).toEqual([]);
  });
});

describe('US 섹터 — usSectorChains + momOnly', () => {
  test('usSectorChains — 각 ETF 1섹터·이름(티커)', () => {
    const c = usSectorChains({ XLK: '테크', XLF: '금융' }, { SPY: 'S&P500' });
    expect(Object.keys(c)).toEqual(['테크(XLK)', '금융(XLF)', 'S&P500(SPY)']);
    expect(c['테크(XLK)']).toEqual({ etf: ['XLK'] });
  });
  test('momOnly=true → score=z(mom)만(breadth 무시)', () => {
    const now = NOW;
    const prices = new Map<string, PriceBar[]>([
      ['XLK', bars([['2026-06-07', 100], ['2026-07-07', 112]])],   // +12%
      ['XLF', bars([['2026-06-07', 100], ['2026-07-07', 104]])],   // +4%
    ]);
    const chains = usSectorChains({ XLK: '테크', XLF: '금융' });
    const r = computeSectorScores(prices, chains, { market: 'US', window: 'monthly', now, minN: 1, momOnly: true, granularity: 'category' });
    expect(r.length).toBe(2);
    expect(r[0]!.chain).toBe('테크(XLK)');   // 높은 mom → rank 1
    expect(r[0]!.rank).toBe(1);
    expect(r[0]!.market).toBe('US');
    // 둘 다 상승(breadth 100) → momOnly 라 breadth 기여 0, mom z만으로 변별.
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });
});
