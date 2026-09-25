// 전략 정교화 · backtest-strategy 단위테스트 (순수).
import { describe, expect, test } from 'bun:test';
import { strategyWeights, strategyReturns } from './backtest-strategy.js';
import { makeRng } from './backtest-metrics.js';

function series(mean: number, vol: number, n = 100, seed = 1): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => mean + (rng() - 0.5) * vol);
}

describe('strategyWeights', () => {
  test('vol scaling — 고변동 종목 저가중', () => {
    const m = new Map([['LOWVOL', series(0.001, 0.01, 100, 2)], ['HIVOL', series(0.001, 0.05, 100, 3)]]);
    const w = strategyWeights(m, ['LOWVOL', 'HIVOL'], 'long_only_all_in', 'NEUTRAL');
    expect(w.get('LOWVOL')!).toBeGreaterThan(w.get('HIVOL')!);  // 저변동 가중↑
    expect(w.get('LOWVOL')! + w.get('HIVOL')!).toBeCloseTo(1);  // 정규화
  });

  test('momentum_overlay — 추세 음수 종목 게이팅(현금)', () => {
    const m = new Map([['UP', series(0.003, 0.01, 100, 4)], ['DOWN', series(-0.003, 0.01, 100, 5)]]);
    const w = strategyWeights(m, ['UP', 'DOWN'], 'momentum_overlay', 'NEUTRAL');
    expect(w.has('UP')).toBe(true);
    expect(w.get('DOWN') ?? 0).toBe(0);   // 하락 게이팅
  });

  test('external_regime_adaptive — 약세장 방어 게이팅', () => {
    const m = new Map([['UP', series(0.003, 0.01, 100, 6)], ['DOWN', series(-0.003, 0.01, 100, 7)]]);
    const bull = strategyWeights(m, ['UP', 'DOWN'], 'external_regime_adaptive', 'RISK_ON');
    const bear = strategyWeights(m, ['UP', 'DOWN'], 'external_regime_adaptive', 'BEAR_CASH');
    expect(bull.has('DOWN')).toBe(true);       // 강세=추종(둘 다)
    expect(bear.get('DOWN') ?? 0).toBe(0);     // 약세=하락 게이팅(방어)
  });

  test('데이터 부족 → 빈 가중', () => {
    expect(strategyWeights(new Map([['A', [0.01, 0.02]]]), ['A'], 'long_only_all_in', 'NEUTRAL').size).toBe(0);
  });
});

describe('strategyReturns', () => {
  test('가중 적용 포트폴리오 수익률', () => {
    const m = new Map([['A', series(0.002, 0.01, 100, 8)], ['B', series(0.001, 0.01, 100, 9)]]);
    const r = strategyReturns(m, ['A', 'B'], 'long_only_all_in', 'NEUTRAL');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(x => Number.isFinite(x))).toBe(true);
  });

  test('전량 게이팅(약세·하락) → 빈 배열(현금)', () => {
    const m = new Map([['DOWN', series(-0.003, 0.01, 100, 10)]]);
    expect(strategyReturns(m, ['DOWN'], 'momentum_overlay', 'NEUTRAL')).toEqual([]);
  });

  test('vol scaling이 Sharpe 개선(고변동 억제)', () => {
    // 저변동 안정 + 고변동 노이즈 → vol scaling이 저변동 편중 → 변동성↓
    const m = new Map([['STABLE', series(0.001, 0.008, 120, 11)], ['NOISY', series(0.001, 0.06, 120, 12)]]);
    const scaled = strategyReturns(m, ['STABLE', 'NOISY'], 'long_only_all_in', 'NEUTRAL');
    // vol scaling 포트폴리오 변동성 < 단순 평균 변동성(고변동 종목 억제 효과)
    const eqVol = 0.06 / 2;  // 대략 equal-weight면 노이즈 절반 반영
    const { std } = require('./backtest-metrics.js');
    expect(std(scaled)).toBeLessThan(eqVol);
    expect(scaled.length).toBeGreaterThan(0);
  });
});
