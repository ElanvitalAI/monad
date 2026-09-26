// 자율 PR 리뷰 재작업 발산 방어 (R2 · RFC-autonomous-pr-review §3d/3e · 2026-07-20)
//
// 문제: 리뷰 verdict=fail → 재작업 → 재리뷰 → ... 가 수렴 안 하면 무한 루프(리소스 소모·미션 교착).
// mission-coevolve-loop 의 발산방어(집합기반·diverged/exhausted/stalled·keep-best 정신)를 리뷰-재작업
// 라운드에 이식한다. K회 상한 + 개선 없으면(정체/발산) escalate HITL. "무한 재작업 차단"(대표 필수).
//
// 전부 순수·결정론(단위테스트 대상·I/O 없음). 라운드 이력은 State review 채널(append)이 durable 보관하고,
// run-mission 이 그 이력에서 (round, 직전 블로커)을 읽어 이 함수로 판정한다.

import { type ReviewResult, reviewToPhaseFields, worseVerdict } from './mission-critique.js';

/** 리뷰-재작업 판정 — rework(재작업 1회 더) 또는 escalate(수렴 실패·HITL 개입·재작업 중단). */
export type ReviewReworkAction = 'rework' | 'escalate';

export interface ReviewReworkDecision {
  action: ReviewReworkAction;
  reason: string;
  round: number;      // 이번 fail 이 몇 번째(1-base)
  resolved: number;   // 직전 블로커 중 이번에 해소된 수
  persisted: number;  // 여전히 남은(안 고쳐진) 블로커 수
}

/** 리뷰 블로커(mustFix 한 줄) → 안정 키(내용기반·정규화) — coevolve criticalKey 패턴. 순수.
 *  같은 지적의 사소한 표현차를 흡수해 "동일 블로커 반복(정체)"을 정확히 판정. */
export function reviewBlockerKey(blocker: string): string {
  return blocker.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim().slice(0, 80);
}

/** 리뷰 재작업 K회 상한(기본) — coevolve maxRounds(기본 2) 동형. ELANOUS_REVIEW_MAX_ROUNDS override. */
export const DEFAULT_REVIEW_MAX_ROUNDS = 2;

/**
 * ★ 리뷰-재작업 라운드 판정(순수·evalCoevolveRound 이식) — verdict=fail 일 때만 호출.
 * round=이번 fail 이 몇 번째(1-base·이전 fail 수 + 1). prevMustFix=직전 리뷰 fail 의 블로커·
 * currentMustFix=이번 블로커. 판정:
 *   - round 1(첫 fail)          → rework(1회 기회)
 *   - round > maxRounds(상한 소진) → escalate(HITL)
 *   - 발산(블로커 증가)          → escalate(더 돌수록 악화 — coevolve stop-diverged)
 *   - 정체(직전 블로커 해소 0)    → escalate(같은 지적 반복 — stop-stalled)
 *   - 개선(일부 해소)            → rework(1회 더)
 */
export function evalReviewRework(input: {
  prevMustFix: readonly string[];
  currentMustFix: readonly string[];
  round: number;
  maxRounds?: number;
}): ReviewReworkDecision {
  const maxRounds = input.maxRounds && input.maxRounds > 0 ? input.maxRounds : DEFAULT_REVIEW_MAX_ROUNDS;
  const prevK = new Set(input.prevMustFix.map(reviewBlockerKey));
  const curK = new Set(input.currentMustFix.map(reviewBlockerKey));
  const resolved = [...prevK].filter((k) => !curK.has(k)).length;
  const persisted = [...curK].filter((k) => prevK.has(k)).length;
  const base = { round: input.round, resolved, persisted };
  // 첫 리뷰 fail — 무조건 재작업 1회 기회(이전 이력 없음).
  if (input.round <= 1) return { action: 'rework', reason: '첫 리뷰 fail — 재작업 1회', ...base };
  // K회 상한 소진 — 더 안 돈다(escalate HITL).
  if (input.round > maxRounds) return { action: 'escalate', reason: `리뷰 재작업 ${input.round}회 — K(${maxRounds}) 상한 소진(HITL)`, ...base };
  // 발산 — 이번이 블로커를 늘림(악화). 즉시 escalate(coevolve stop-diverged).
  if (curK.size > prevK.size) return { action: 'escalate', reason: `발산 — 블로커 증가(${prevK.size}->${curK.size}) HITL`, ...base };
  // 정체 — 직전 블로커를 하나도 못 고침(같은 지적 반복).
  if (resolved === 0) return { action: 'escalate', reason: '정체 — 동일 블로커 반복(개선 0) HITL', ...base };
  // 개선 중 — 일부 해소. 1회 더 재작업.
  return { action: 'rework', reason: `개선 중(해소 ${resolved}) — 재작업`, ...base };
}

// ── 리뷰 결과 → PhaseResult 결정(C · 순수 추출·2026-07-20) ─────────────────────
// 종전 run-mission 리뷰 노드에 인라인(스크립트라 단위테스트 불가)이던 핵심 결정 — verdict-gate + 발산
// 방어 bound + escalate 처리 + reviewPassed 게이트 — 를 순수 함수로 추출한다. run-mission 은 이 결과를
// res 에 적용 + 부수효과(관측·워킹메모리·HITL)만. dogfood 리뷰어가 반복 요청한 "핵심 배선 검증"을 가능케.

/** 리뷰 결과가 PhaseResult 에 남길 최종 상태 + 취한 액션. run-mission 이 res 에 그대로 적용. */
export interface ReviewOutcome {
  /** pass=통과 · warn=주석(재작업 아님) · rework=[CRITIQUE:FAIL] 재작업 · escalate=재작업 중단·HITL. */
  action: 'pass' | 'warn' | 'rework' | 'escalate';
  /** PhaseResult 패치(최종값·pre-PR critique 병합 반영). escalate 는 clearCritique=true(critique 해제). */
  patch: {
    critiqueVerdict?: 'warn' | 'fail';
    critiqueFindings?: string[];
    reviewEscalated?: string[];
    reviewPassed?: boolean;
    clearCritique?: boolean;
  };
  /** fail 일 때 이번 라운드(1-base)·발산방어 판정(관측용). */
  round: number;
  rework?: ReviewReworkDecision;
}

/**
 * ★ 리뷰 결과 → PhaseResult 결정(순수·C). pre-PR critique(prevCritique*) 와 병합해 최종 patch 산출.
 *   - pass  : reviewed=true 면 reviewPassed(실 리뷰 통과·자동머지 대상)·fail-soft pass 는 패치 없음.
 *   - warn  : critique warn 주석 병합(재작업 아님).
 *   - fail  : evalReviewRework(round/직전 블로커) → rework([CRITIQUE:FAIL] 병합 각인) | escalate(critique
 *             해제 + [REVIEW:ESCALATED]·무한루프 차단). round 1=rework·K상한/정체/발산=escalate.
 */
export function decideReviewOutcome(input: {
  review: ReviewResult;
  priorFailFindings: readonly string[];
  priorFailCount: number;
  prevCritiqueVerdict?: string;
  prevCritiqueFindings?: readonly string[];
  maxRounds?: number;
}): ReviewOutcome {
  const { review } = input;
  const prevV: 'pass' | 'warn' | 'fail' =
    input.prevCritiqueVerdict === 'warn' || input.prevCritiqueVerdict === 'fail' ? input.prevCritiqueVerdict : 'pass';
  const prevFindings = input.prevCritiqueFindings ?? [];

  if (review.verdict === 'pass') {
    // 실제 리뷰 통과만 reviewPassed(fail-soft pass 는 미검토 → 자동머지 배제).
    return { action: 'pass', patch: review.reviewed ? { reviewPassed: true } : {}, round: input.priorFailCount };
  }

  if (review.verdict === 'warn') {
    const wf = reviewToPhaseFields(review); // {critiqueVerdict:'warn', critiqueFindings: shouldFix}
    if (!wf.critiqueVerdict) return { action: 'warn', patch: {}, round: input.priorFailCount };
    return {
      action: 'warn',
      patch: {
        critiqueVerdict: worseVerdict(prevV, wf.critiqueVerdict) as 'warn' | 'fail',
        critiqueFindings: [...prevFindings, ...(wf.critiqueFindings ?? []).map((f) => `[리뷰] ${f}`)],
      },
      round: input.priorFailCount,
    };
  }

  // fail — 발산방어 라운드 판정.
  const round = input.priorFailCount + 1;
  const rework = evalReviewRework({
    prevMustFix: input.priorFailFindings, currentMustFix: review.mustFix, round,
    ...(input.maxRounds ? { maxRounds: input.maxRounds } : {}),
  });
  if (rework.action === 'rework') {
    return {
      action: 'rework', round, rework,
      patch: {
        critiqueVerdict: worseVerdict(prevV, 'fail') as 'warn' | 'fail',
        critiqueFindings: [...prevFindings, ...review.mustFix.map((f) => `[리뷰] ${f}`)],
      },
    };
  }
  // escalate — critique 해제(rebuild 재큐 차단) + [REVIEW:ESCALATED] 안전마커.
  return {
    action: 'escalate', round, rework,
    patch: { clearCritique: true, reviewEscalated: review.mustFix.slice(0, 3) },
  };
}
