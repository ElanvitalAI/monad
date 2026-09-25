// ── 백테스팅 승격 게이트 (B2 · backtest-gate · 2026-07-08) ────────────────
//
// 미니 백테스트 결과(experiment_results)를 학술 기준으로 판정해 페이퍼/실자금
// 승격 자격을 결정하는 순수 함수. 캡스톤 12단계 검증 스택(López de Prado AFML)
// 계승 — 과최적화 차단이 목적:
//  - PBO(Probability of Backtest Overfitting) < 10%  (Bailey-López de Prado 2015)
//  - DSR(Deflated Sharpe Ratio) > 0                  (다중검정 보정)
//  - CPCV positive path ≥ 85%                        (Combinatorial Purged CV)
//  - OOS Sharpe(walk-forward mean) > 1.5             (정직한 M-3)
//  - WRC(White Reality Check) pass                   (data-snooping 보정)
//  - Pre-Bull robust                                 (강세장 의존 배제)
//  - cost-adjusted Sharpe > 1.0                      (슬리피지 후 생존)
//
// 판정: 필수(안전) 실패 → REJECTED · 필수 통과+성과 충족 → CONFIRMED · 경계 → INCONCLUSIVE.
// 상세 [[PLAN-quant-backtest-retro-loops-2026-07-08]] §4.2 · [[RESEARCH-...]] §2.2.

import type { ExperimentResult, Verdict } from './backtest-store.js';

/** 게이트 기준(캡스톤 계승·2026-07-08 강화: confirmed 4/4 과최적화 경보 대응).
 *  강세장 편향·간이 메트릭 통과를 막기 위해 pbo·cpcv·cost 상향. 단일 조정점. */
export const GATE = {
  pboMax: 0.05,            // PBO < 5% (0.10→0.05 · 과최적화 더 엄격)
  dsrMin: 0,              // DSR > 0
  cpcvPositiveMin: 0.90,  // CPCV positive ≥ 90% (0.85→0.90)
  oosSharpeMin: 1.5,      // walk-forward mean Sharpe > 1.5
  costSharpeMin: 1.2,     // cost-adjusted Sharpe > 1.2 (1.0→1.2 · 슬리피지 후 여유)
  wfWinRateMin: 0.45,     // walk-forward win rate ≥ 45% (0.40→0.45)
  subwindowMin: 3,        // 1y/2y/3y 전부 양수(로버스트)
} as const;

export interface GateVerdict {
  verdict: Verdict;
  cpcvPositivePct: number;
  dsr: number;
  pbo: number;
  wrcPass: boolean;
  prebullRobust: boolean;
  reasons: string[];      // 판정 근거(통과/실패 항목)
}

/** 필수(안전) 기준 — 하나라도 실패하면 REJECTED. 과최적화·강세의존 차단. */
function failsSafety(r: ExperimentResult): string[] {
  const fails: string[] = [];
  if (r.pbo >= GATE.pboMax) fails.push(`PBO ${r.pbo.toFixed(2)} ≥ ${GATE.pboMax}(과최적화)`);
  if (r.dsr <= GATE.dsrMin) fails.push(`DSR ${r.dsr.toFixed(2)} ≤ ${GATE.dsrMin}(다중검정 미통과)`);
  if (!r.wrcPass) fails.push('WRC 미통과(data-snooping)');
  if (!r.prebullRobust) fails.push('Pre-Bull 비로버스트(강세 의존)');
  return fails;
}

/** 성과 기준 — 필수 통과 후 CONFIRMED 자격. 미충족은 INCONCLUSIVE. */
function meetsPerformance(r: ExperimentResult): string[] {
  const gaps: string[] = [];
  if (r.cpcvPositivePct < GATE.cpcvPositiveMin) gaps.push(`CPCV positive ${(r.cpcvPositivePct * 100).toFixed(0)}% < ${GATE.cpcvPositiveMin * 100}%`);
  if (r.wfMeanSharpe < GATE.oosSharpeMin) gaps.push(`OOS Sharpe ${r.wfMeanSharpe.toFixed(2)} < ${GATE.oosSharpeMin}`);
  if (r.costAdjustedSharpe < GATE.costSharpeMin) gaps.push(`cost-adj Sharpe ${r.costAdjustedSharpe.toFixed(2)} < ${GATE.costSharpeMin}`);
  if (r.wfWinRate < GATE.wfWinRateMin) gaps.push(`WF win rate ${(r.wfWinRate * 100).toFixed(0)}% < ${GATE.wfWinRateMin * 100}%`);
  if (r.subwindowPositive < GATE.subwindowMin) gaps.push(`서브윈도우 양수 ${r.subwindowPositive}/3 < ${GATE.subwindowMin}`);
  return gaps;
}

/** 승격 게이트 판정(순수). 안전 실패→REJECTED · 성과 충족→CONFIRMED · 경계→INCONCLUSIVE. */
export function evaluateGate(r: ExperimentResult): GateVerdict {
  const safetyFails = failsSafety(r);
  const perfGaps = meetsPerformance(r);
  let verdict: Verdict;
  const reasons: string[] = [];

  if (safetyFails.length > 0) {
    verdict = 'REJECTED';
    reasons.push(...safetyFails.map(f => `✗ ${f}`));
  } else if (perfGaps.length === 0) {
    verdict = 'CONFIRMED';
    reasons.push('✓ 안전 4기준 통과(PBO·DSR·WRC·Pre-Bull)', '✓ 성과 5기준 충족(CPCV·OOS Sharpe·cost·WF·서브윈도우)');
  } else {
    verdict = 'INCONCLUSIVE';
    reasons.push('✓ 안전 기준 통과', ...perfGaps.map(g => `△ ${g}`));
  }

  return {
    verdict,
    cpcvPositivePct: r.cpcvPositivePct, dsr: r.dsr, pbo: r.pbo,
    wrcPass: r.wrcPass, prebullRobust: r.prebullRobust, reasons,
  };
}

/** CONFIRMED 만 페이퍼 승격 자격(B3). INCONCLUSIVE·REJECTED 는 페이퍼 진입 불가. */
export function isPaperEligible(v: GateVerdict): boolean {
  return v.verdict === 'CONFIRMED';
}
