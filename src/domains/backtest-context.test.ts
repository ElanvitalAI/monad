// B5 · MarketContext 조립 단위테스트 (순수·합성).
import { describe, expect, test } from 'bun:test';
import { buildMarketContext, momentum121, pricesToReturns, type ContextDeps } from './backtest-context.js';

describe('pricesToReturns', () => {
  test('close 시계열 → pct change', () => {
    const r = pricesToReturns([{ close: 100 }, { close: 110 }, { close: 99 }]);
    expect(r.length).toBe(2);
    expect(r[0]!).toBeCloseTo(0.1);
    expect(r[1]!).toBeCloseTo(-0.1);
  });
  test('0/비유한 방어', () => {
    expect(pricesToReturns([{ close: 0 }, { close: 100 }])).toEqual([]);
    expect(pricesToReturns([{ close: 100 }])).toEqual([]);
  });
});

describe('momentum121 (12-1m)', () => {
  test('데이터 부족 → null', () => {
    expect(momentum121([0.01, 0.02])).toBeNull();
  });
  test('최근 21일 제외·누적수익', () => {
    // 252+21일: 앞 252일 +0.001, 최근 21일 -0.05(제외되어야)
    const r = [...Array(252).fill(0.001), ...Array(21).fill(-0.05)];
    const m = momentum121(r)!;
    expect(m).toBeGreaterThan(0);   // 최근 급락 제외 → 양수 유지
  });
});

describe('buildMarketContext', () => {
  const base: ContextDeps = {
    getRegime: () => 'RISK_ON',
    universe: ['A', 'B', 'C'],
    loadReturns: () => new Map([
      ['A', Array(280).fill(0.002)],   // 강한 상승
      ['B', Array(280).fill(0.0005)],  // 약한 상승
      ['C', Array(280).fill(-0.001)],  // 하락
    ]),
    date: '2026-07-08',
  };

  test('regime·momentum 조립', () => {
    const ctx = buildMarketContext(base);
    expect(ctx.regime).toBe('RISK_ON');
    expect(ctx.date).toBe('2026-07-08');
    expect(ctx.momentumTs.length).toBe(3);
    // A가 최강 → relRank 1
    expect(ctx.momentumXs[0]!.symbol).toBe('A');
    expect(ctx.momentumXs[0]!.relRank).toBe(1);
  });

  test('momentumTs — C(하락)는 음수 ret', () => {
    const ctx = buildMarketContext(base);
    const c = ctx.momentumTs.find(m => m.symbol === 'C');
    expect(c!.ret).toBeLessThan(0);
  });

  test('데이터 부족 심볼 제외', () => {
    const ctx = buildMarketContext({ ...base, loadReturns: () => new Map([['A', Array(280).fill(0.001)], ['B', [0.01]]]) });
    expect(ctx.momentumTs.map(m => m.symbol)).toEqual(['A']);  // B 부족 제외
  });

  test('sectorLeaders·pulseNotables 주입', () => {
    const ctx = buildMarketContext({
      ...base,
      getSectorLeaders: () => [{ sector: '반도체', symbols: ['005930', '000660'] }],
      getPulseNotables: () => ['NVDA', 'SOXL'],
    });
    expect(ctx.sectorLeaders![0]!.sector).toBe('반도체');
    expect(ctx.pulseNotables).toEqual(['NVDA', 'SOXL']);
  });

  test('선택 deps 부재 → 빈 배열(fail-soft)', () => {
    const ctx = buildMarketContext(base);
    expect(ctx.sectorLeaders).toEqual([]);
    expect(ctx.pulseNotables).toEqual([]);
  });
});
