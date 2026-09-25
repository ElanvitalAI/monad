// B0 · 학술 메트릭 단위테스트 (순수·성질 기반).
import { describe, expect, test } from 'bun:test';
import {
  normCdf, normInv, annualizedSharpe, deflatedSharpe,
  cpcvPositive, probabilityBacktestOverfit, whiteRealityCheck, decileReturns,
  walkForwardSummary, makeRng,
} from './backtest-metrics.js';

describe('정규분포 헬퍼', () => {
  test('normCdf 표준값', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 3);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 2);
  });
  test('normInv normCdf 역함수', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 3);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normCdf(normInv(0.8))).toBeCloseTo(0.8, 3);
  });
});

describe('annualizedSharpe', () => {
  test('양의 일관 수익 → 높은 Sharpe', () => {
    const r = Array(252).fill(0.001);   // 무변동성 → 매우 높음
    expect(annualizedSharpe([...r, 0.0005, 0.0015])).toBeGreaterThan(1);
  });
  test('무수익 → 0', () => {
    expect(annualizedSharpe(Array(100).fill(0))).toBe(0);
  });
});

describe('deflatedSharpe (다중검정 보정)', () => {
  test('시도 많을수록 DSR 하락(같은 성과)', () => {
    const rng = makeRng(7);
    // 약한 신호(DSR 비포화 범위) — nTrials 보정 효과 관찰용.
    const returns = Array.from({ length: 252 }, () => 0.0003 + (rng() - 0.5) * 0.018);
    const dsr1 = deflatedSharpe(returns, 1);
    const dsr200 = deflatedSharpe(returns, 200);
    expect(dsr200).toBeLessThan(dsr1);   // nTrials↑ → 할인
  });
  test('강한 양의 성과 단일 시도 → DSR 높음', () => {
    const returns = Array(252).fill(0.001).map((v, i) => v + (i % 2 ? 0.0002 : -0.0001));
    expect(deflatedSharpe(returns, 1)).toBeGreaterThan(0.5);
  });
});

describe('cpcvPositive', () => {
  test('전부 양수 → positivePct 1', () => {
    const r = cpcvPositive([1.2, 0.8, 1.5, 0.3]);
    expect(r.positivePct).toBe(1);
    expect(r.paths).toBe(4);
  });
  test('혼합 → 비율', () => {
    expect(cpcvPositive([1, -1, 1, -1]).positivePct).toBe(0.5);
  });
});

describe('probabilityBacktestOverfit', () => {
  test('IS 강세·OOS 유지 → 낮은 PBO', () => {
    const pairs = [{ is: 1.2, oos: 1.1 }, { is: 1.0, oos: 0.9 }, { is: 1.3, oos: 1.2 }, { is: 0.9, oos: 0.8 }];
    expect(probabilityBacktestOverfit(pairs)).toBeLessThan(0.5);
  });
  test('IS 강세·OOS 붕괴 → 높은 PBO', () => {
    const pairs = [{ is: 2.0, oos: -0.5 }, { is: 1.8, oos: -0.3 }, { is: 1.5, oos: 0.5 }, { is: 1.9, oos: -0.4 }];
    expect(probabilityBacktestOverfit(pairs)).toBeGreaterThan(0.5);
  });
});

describe('whiteRealityCheck (data-snooping)', () => {
  test('강한 양의 수익 → 유의(pass·재현)', () => {
    const rng = makeRng(3);
    const returns = Array.from({ length: 252 }, () => 0.002 + (rng() - 0.5) * 0.004);
    const w = whiteRealityCheck(returns, { seed: 1 });
    expect(w.pass).toBe(true);
    expect(w.pValue).toBeLessThan(0.05);
    // 같은 seed → 재현
    expect(whiteRealityCheck(returns, { seed: 1 }).pValue).toBe(w.pValue);
  });
  test('노이즈(평균 0) → 비유의', () => {
    const rng = makeRng(9);
    const returns = Array.from({ length: 252 }, () => (rng() - 0.5) * 0.02);
    expect(whiteRealityCheck(returns, { seed: 2 }).pass).toBe(false);
  });
});

describe('decileReturns', () => {
  test('monotonic score→return → 십분위 증가', () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({ score: i, fwdReturn: i * 0.001 }));
    const d = decileReturns(pairs);
    expect(d.length).toBe(10);
    expect(d[9]!.meanReturn).toBeGreaterThan(d[0]!.meanReturn);
  });
  test('표본 < 10 → 빈 배열', () => {
    expect(decileReturns([{ score: 1, fwdReturn: 0.1 }])).toEqual([]);
  });
});

describe('walkForwardSummary (M-3)', () => {
  test('세그먼트 win rate·mean Sharpe', () => {
    const segs = [
      { dailyReturns: [0.01, 0.005, 0.008] },   // 양수
      { dailyReturns: [-0.01, -0.005, 0.002] }, // 음수 합
      { dailyReturns: [0.003, 0.004, 0.002] },  // 양수
    ];
    const w = walkForwardSummary(segs);
    expect(w.windows).toBe(3);
    expect(w.winRate).toBeCloseTo(2 / 3, 2);
  });
  test('빈 세그먼트 스킵', () => {
    expect(walkForwardSummary([{ dailyReturns: [] }]).windows).toBe(0);
  });
});

describe('makeRng 결정론', () => {
  test('같은 seed → 같은 수열', () => {
    const a = makeRng(42), b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
