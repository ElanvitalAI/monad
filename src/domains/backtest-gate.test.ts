// B2 · 승격 게이트 단위테스트 (순수).
import { describe, expect, test } from 'bun:test';
import { evaluateGate, isPaperEligible, GATE } from './backtest-gate.js';
import type { ExperimentResult } from './backtest-store.js';

/** 전부 통과하는 baseline 결과. */
function goodResult(over: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    expId: 'exp:x', ts: 't', roi: 0.2, sharpe: 2.0, mdd: -0.1, calmar: 2.0, trades: 20,
    consistency: 1.5, subwindowPositive: 3, wfWinRate: 0.55, wfMeanSharpe: 1.8,
    cpcvPaths: 15, cpcvMeanSharpe: 1.5, cpcvPositivePct: 0.92, dsr: 0.6, pbo: 0.03,
    wrcPass: true, prebullRobust: true, slippageBps: 3, costAdjustedSharpe: 1.6,
    verdict: 'INCONCLUSIVE', ...over,
  };
}

describe('evaluateGate', () => {
  test('전부 통과 → CONFIRMED', () => {
    const v = evaluateGate(goodResult());
    expect(v.verdict).toBe('CONFIRMED');
    expect(isPaperEligible(v)).toBe(true);
  });

  test('PBO 과다 → REJECTED(과최적화)', () => {
    const v = evaluateGate(goodResult({ pbo: 0.15 }));
    expect(v.verdict).toBe('REJECTED');
    expect(v.reasons.some(r => r.includes('PBO'))).toBe(true);
    expect(isPaperEligible(v)).toBe(false);
  });

  test('DSR ≤ 0 → REJECTED(다중검정)', () => {
    expect(evaluateGate(goodResult({ dsr: -0.1 })).verdict).toBe('REJECTED');
  });

  test('WRC 실패 → REJECTED(data-snooping)', () => {
    expect(evaluateGate(goodResult({ wrcPass: false })).verdict).toBe('REJECTED');
  });

  test('Pre-Bull 비로버스트 → REJECTED(강세 의존)', () => {
    const v = evaluateGate(goodResult({ prebullRobust: false }));
    expect(v.verdict).toBe('REJECTED');
    expect(v.reasons.some(r => r.includes('Pre-Bull'))).toBe(true);
  });

  test('안전 통과·OOS Sharpe 미달 → INCONCLUSIVE', () => {
    const v = evaluateGate(goodResult({ wfMeanSharpe: 1.2 }));
    expect(v.verdict).toBe('INCONCLUSIVE');
    expect(v.reasons.some(r => r.includes('OOS Sharpe'))).toBe(true);
    expect(isPaperEligible(v)).toBe(false);
  });

  test('안전 통과·CPCV positive 미달 → INCONCLUSIVE', () => {
    expect(evaluateGate(goodResult({ cpcvPositivePct: 0.7 })).verdict).toBe('INCONCLUSIVE');
  });

  test('안전 통과·cost-adj Sharpe 미달 → INCONCLUSIVE(슬리피지 후 붕괴)', () => {
    expect(evaluateGate(goodResult({ costAdjustedSharpe: 0.8 })).verdict).toBe('INCONCLUSIVE');
  });

  test('안전 통과·서브윈도우 2/3 → INCONCLUSIVE(비로버스트)', () => {
    expect(evaluateGate(goodResult({ subwindowPositive: 2 })).verdict).toBe('INCONCLUSIVE');
  });

  test('안전 실패 우선(성과 좋아도 REJECTED)', () => {
    const v = evaluateGate(goodResult({ pbo: 0.2, wfMeanSharpe: 3.0 }));
    expect(v.verdict).toBe('REJECTED');
  });

  test('GATE 기준 노출(단일 조정점·2026-07-08 강화)', () => {
    expect(GATE.pboMax).toBe(0.05);
    expect(GATE.cpcvPositiveMin).toBe(0.90);
    expect(GATE.costSharpeMin).toBe(1.2);
  });
});
