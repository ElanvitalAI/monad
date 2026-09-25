// B5 · 미니 백테스트 시뮬레이터 단위테스트 (순수·합성 데이터).
import { describe, expect, test } from 'bun:test';
import { runMiniBacktest, portfolioReturns, cumReturn, maxDrawdown, type SimDeps } from './backtest-sim.js';
import { makeRng } from './backtest-metrics.js';
import type { PortfolioHypothesis } from './backtest-hypothesis.js';
import type { PortfolioExperiment } from './backtest-store.js';

const H: PortfolioHypothesis = {
  concept: 'momentum-ts', universe: ['A', 'B'], strategy: 'external_regime_adaptive',
  params: {}, hypothesis: 'h', sourceSignals: [],
};
const EXP: PortfolioExperiment = {
  id: 'exp:x', runDate: '2026-07-08', concept: 'momentum-ts', hypothesis: 'h',
  universe: ['A', 'B'], strategy: 'external_regime_adaptive', params: {}, sourceSignals: [], createdAt: 't',
};

describe('시뮬 헬퍼', () => {
  test('cumReturn 복리', () => {
    expect(cumReturn([0.1, 0.1])).toBeCloseTo(0.21);
    expect(cumReturn([0])).toBe(0);
  });
  test('maxDrawdown 음수', () => {
    expect(maxDrawdown([0.1, -0.2, 0.05])).toBeLessThan(0);
    expect(maxDrawdown([0.01, 0.01])).toBe(0);
  });
  test('portfolioReturns equal-weight 평균', () => {
    const m = new Map([['A', [0.02, 0.04]], ['B', [0.00, 0.00]]]);
    expect(portfolioReturns(m, ['A', 'B'])).toEqual([0.01, 0.02]);
  });
  test('빈 유니버스 → 빈 배열', () => {
    expect(portfolioReturns(new Map(), ['X'])).toEqual([]);
  });
});

describe('runMiniBacktest', () => {
  test('데이터 부족 → null', () => {
    const deps: SimDeps = { loadDailyReturns: () => new Map([['A', [0.01, 0.02]]]) };
    expect(runMiniBacktest(H, EXP, deps)).toBeNull();
  });

  test('양의 추세 → ExperimentResult 조립(전 필드)', () => {
    const rng = makeRng(11);
    const series = Array.from({ length: 252 }, () => 0.0008 + (rng() - 0.5) * 0.01);
    const deps: SimDeps = { loadDailyReturns: () => new Map([['A', series], ['B', series.map(r => r * 0.9)]]), now: () => 't' };
    const r = runMiniBacktest(H, EXP, deps)!;
    expect(r).not.toBeNull();
    expect(r.sharpe).toBeGreaterThan(0);
    expect(r.cpcvPaths).toBeGreaterThan(0);
    expect(['CONFIRMED', 'INCONCLUSIVE', 'REJECTED']).toContain(r.verdict);
    expect(typeof r.dsr).toBe('number');
    expect(typeof r.wrcPass).toBe('boolean');
    expect(r.wfWinRate).toBeGreaterThanOrEqual(0);
  });

  test('강한 일관 양의 추세 → 로버스트 지표', () => {
    const series = Array.from({ length: 300 }, (_, i) => 0.001 + (i % 2 ? 0.0003 : -0.0001));
    const deps: SimDeps = { loadDailyReturns: () => new Map([['A', series], ['B', series]]), trialsToday: 1, now: () => 't' };
    const r = runMiniBacktest(H, EXP, deps)!;
    expect(r.roi).toBeGreaterThan(0);
    expect(r.subwindowPositive).toBe(3);        // 전 구간 양수
    expect(r.prebullRobust).toBe(true);
    expect(r.cpcvPositivePct).toBeGreaterThan(0.5);
  });

  test('trialsToday 많으면 DSR 하락(다중검정)', () => {
    const rng = makeRng(5);
    const series = Array.from({ length: 252 }, () => 0.0003 + (rng() - 0.5) * 0.018);
    const mk = (n: number): SimDeps => ({ loadDailyReturns: () => new Map([['A', series], ['B', series]]), trialsToday: n, now: () => 't' });
    const dsr1 = runMiniBacktest(H, EXP, mk(1))!.dsr;
    const dsr50 = runMiniBacktest(H, EXP, mk(50))!.dsr;
    expect(dsr50).toBeLessThanOrEqual(dsr1);
  });

  test('하락 추세 → 전략 방어(null 게이팅) 또는 non-CONFIRMED', () => {
    const rng = makeRng(2);
    const series = Array.from({ length: 252 }, () => -0.001 + (rng() - 0.5) * 0.01);
    // external_regime_adaptive + NEUTRAL → 하락 종목 게이팅(전량 현금 → null) 이 올바른 방어.
    const deps: SimDeps = { loadDailyReturns: () => new Map([['A', series], ['B', series]]), regime: 'NEUTRAL', now: () => 't' };
    const r = runMiniBacktest(H, EXP, deps);
    expect(r === null || r.verdict !== 'CONFIRMED').toBe(true);
  });

  test('강세 regime → 하락도 추종(all-in·게이팅 없음)', () => {
    const rng = makeRng(2);
    const series = Array.from({ length: 252 }, () => 0.0008 + (rng() - 0.5) * 0.01);
    const deps: SimDeps = { loadDailyReturns: () => new Map([['A', series], ['B', series]]), regime: 'RISK_ON', now: () => 't' };
    expect(runMiniBacktest(H, EXP, deps)).not.toBeNull();  // 강세=추종
  });
});
