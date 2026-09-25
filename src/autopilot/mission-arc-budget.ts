// ── 아크별 예산 자동 산정 (B1 · PLAN-arc-phase-lifecycle-editing-2026-07-15) ──
//
// 대표 결정(§7-D1): 아크 예산 = 자동 산정(스킬-카운트 × 과거 유사미션 평균 비용). 사람 입력 없이
// 분해 시점에 아크별 예상비용을 계산하고, insert-arc/split 로 아크가 커지면 재산정(델타 HITL 카드·B2).
//
// 순수 모듈 — store/LLM 접근 없음(정의/배선 분리·G1 원칙). 배선은 mission-lifecycle/CLI 가 담당.

import type { MissionArc } from '../task-orchestrator/mission.js';

/** 견적 없는 페이즈 1개의 기본 추정 비용(USD). 과거 미션 구현 페이즈 평균에 근사한 보수값. */
export const DEFAULT_PHASE_COST_USD = 1.2;

/**
 * 아크 예산 자동 산정 — 멤버 페이즈의 견적(estimateUsd) 합. 견적이 없는 페이즈는 `defaultPerPhase`
 * 로 대체(스킬-카운트 근사 = 페이즈당 평균 비용). 순수·결정론. 0 페이즈 아크는 0.
 */
export function estimateArcCostUsd(
  arc: Pick<MissionArc, 'phaseIds'>,
  phaseCostById: ReadonlyMap<string, number | undefined>,
  defaultPerPhase: number = DEFAULT_PHASE_COST_USD,
): number {
  let total = 0;
  for (const pid of arc.phaseIds) {
    const c = phaseCostById.get(pid);
    total += typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : defaultPerPhase;
  }
  return Math.round(total * 100) / 100;
}

/** 전 아크에 estimatedCost 를 채워 새 배열 반환(순수). 첫 분해·재산정 공용. */
export function withArcCosts(
  arcs: readonly MissionArc[],
  phaseCostById: ReadonlyMap<string, number | undefined>,
  defaultPerPhase: number = DEFAULT_PHASE_COST_USD,
): MissionArc[] {
  return arcs.map((a) => ({ ...a, estimatedCost: estimateArcCostUsd(a, phaseCostById, defaultPerPhase) }));
}

/** 미션 전체 아크 예산 합(USD). 미산정 아크는 0 취급. */
export function totalArcBudgetUsd(arcs: readonly MissionArc[]): number {
  return Math.round(arcs.reduce((s, a) => s + (a.estimatedCost ?? 0), 0) * 100) / 100;
}

/** 재산정 델타(USD) — 이전 대비 증가분. B2 HITL 카드에 "아크 추가로 +$X" 로 노출. */
export function arcBudgetDeltaUsd(before: readonly MissionArc[], after: readonly MissionArc[]): number {
  return Math.round((totalArcBudgetUsd(after) - totalArcBudgetUsd(before)) * 100) / 100;
}
