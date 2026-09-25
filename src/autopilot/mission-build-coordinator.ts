// ── 미션빌드 Coordinator 순수 코어 (재설계 2단계·BC1) ─────────────────────────
// RFC-mission-build-coordinator-2026-07-16. 선형 8단계 파이프라인을 각 단계=addressable 빌드
// 에이전트로 보고 coordinator 가 조율(의존 병렬·fan-in·역방향 피드백·stuck). 이 파일은 순수
// 계약 + 스케줄러 + blackboard 코어 — 배선(실 단계 래핑·실행)은 BC2. 집행 0·비파괴.
//
// ★ 대표 결정(2026-07-16): 역방향 피드백 범위 = critique→decompose 만(보수·무한루프 위험 최소).
// [[feedback_mission_fabric_llm_logic_balance_2026_07_16]] — 조율 판단은 LLM(단계 내부), 스케줄/
// 의존/수렴은 결정론 로직(이 코어). 균형.

import type { MissionArc } from '../task-orchestrator/mission.js';

/** 빌드 단계 = 현 se-mission-prepare 선형 스크립트의 8단계를 1급 에이전트로. */
export type BuildStage =
  | 'research' | 'ground' | 'dedup' | 'clarify' | 'shape' | 'decompose' | 'critique' | 'granularity';

export const BUILD_STAGES: readonly BuildStage[] = [
  'research', 'ground', 'dedup', 'clarify', 'shape', 'decompose', 'critique', 'granularity',
];

/** 단계 의존 그래프 — 이 단계가 실행되려면 선행이 ok 여야. 독립(빈 배열)은 병렬 가능. */
export const BUILD_STAGE_DEPS: Record<BuildStage, readonly BuildStage[]> = {
  research: [],
  ground: [],
  dedup: [],
  clarify: ['research', 'ground'], // 조사·코드 컨텍스트 위에서 모호도 판정
  shape: ['research', 'ground'],   // 골 형태 판정도 조사/grounding 근거
  decompose: ['clarify', 'ground'], // 확정 설계 + 코드 기준 분해
  critique: ['decompose'],
  granularity: ['decompose'],
};

/** 빌드 에이전트 1회 실행 결과 — blackboard 로 fan-in. */
export interface BuildAgentResult {
  stage: BuildStage;
  ok: boolean;
  output?: unknown;
  /** ★역방향 피드백(BC3) — 이 단계가 앞 단계 재실행을 요청(대표 결정: critique→decompose 만 허용). */
  feedback?: { toStage: BuildStage; reason: string };
  /** stuck — no-op/실패로 진전 없음. coordinator 가 AA triage 로 처리(BC4). */
  stuck?: { reason: string };
}

/** 역방향 피드백 허용 엣지(대표 결정·보수) — critique→decompose 만. 다른 역류는 무시(로그만). 순수. */
export function isAllowedFeedbackEdge(from: BuildStage, to: BuildStage): boolean {
  return from === 'critique' && to === 'decompose';
}

/** 의존 그래프 → 병렬 실행 그룹(위상정렬·같은 레벨=동시 실행 가능). 순수·결정론(입력 순서 보존).
 *  사이클/미지정 의존은 조용히 폴백(남은 단계를 마지막 그룹에)해 진행을 막지 않는다(fail-soft). */
export function scheduleStages(
  stages: readonly BuildStage[] = BUILD_STAGES,
  deps: Record<BuildStage, readonly BuildStage[]> = BUILD_STAGE_DEPS,
): BuildStage[][] {
  const remaining = new Set(stages);
  const done = new Set<BuildStage>();
  const groups: BuildStage[][] = [];
  // 의존은 stages 집합 안으로 한정(밖의 선행은 무시 — 부분 실행 지원).
  const inScope = (s: BuildStage): readonly BuildStage[] => (deps[s] ?? []).filter((d) => remaining.has(d) || done.has(d));
  let guard = stages.length + 1;
  while (remaining.size > 0 && guard-- > 0) {
    const ready = [...remaining].filter((s) => inScope(s).every((d) => done.has(d)));
    const level = ready.length > 0 ? ready : [...remaining]; // 사이클 폴백 — 남은 전부 한 그룹
    groups.push(level);
    for (const s of level) { remaining.delete(s); done.add(s); }
  }
  return groups;
}

/** ★ 결정 채널(RFC P2·컨텍스트 교환 1급화 2026-07-17) — 스테이지 산출(results)과 별도로, 조율자가
 *  스테이지 간 재전달하는 구조화 결정을 담는다. 대표 지적("조율자가 신호를 충분히 받아 다시 전달해야
 *  하는데 빠졌다·컨텍스트 교환")의 실체. 종전엔 결정이 텍스트(reviseContext)로 다운그레이드되어 끊겼다. */
export interface BuildDecisions {
  /** Intake clarify 확정 아크 수 — decompose 구조화 제약 + granularity 아크 정합 검증(소비자). */
  arcHint?: number;
  /** 확정 범위(clarify scope) — 향후 critique 범위이탈 검증 소비자. */
  scope?: string[];
  /** #4498 3A — 결정론 파생 아크 그룹 + coherence version(= 파생 근거 arcHint).
   *  ★ 축A A2(2026-07-18 봉합): 현재 소비자 0 — 같은 blackboard 내 arcHint 재갱신 경로가 없어서
   *  (clarify=process.exit→재-spawn=blackboard 리셋·coevolve 재분해도 arcHint 불변) supersede 가 일어날
   *  곳이 없다. Versioned/supersedeDecision 인프라 자체는 frame 시간여행(#4510~)에서 실사용 중. 이
   *  arcGroups 는 그 재갱신 경로가 생기면 supersedeDecision 으로 배선(현재는 인프라 선착). */
  arcGroups?: Versioned<MissionArc[]>;
}

/**
 * ★ ANS 축A A2 — 구조화 결정 coherence(MESI 축소). value + version(파생 근거·예: arcHint).
 * 갱신 시 옛 값을 supersededBy 로 무효 마킹(S→I) → 하류가 stale 결정을 안 쓴다.
 */
export interface Versioned<T> { value: T; version: number; supersededBy?: number }

/** MESI 축소 — 새 값이 다른 version 이면 옛 것 supersededBy 마킹, 새 것 current. 순수·결정론. */
export function supersedeDecision<T>(
  prev: Versioned<T> | undefined,
  value: T,
  version: number,
): { current: Versioned<T>; superseded?: Versioned<T> } {
  if (prev && prev.version !== version && prev.supersededBy === undefined) {
    return { current: { value, version }, superseded: { ...prev, supersededBy: version } };
  }
  return { current: { value, version } };
}

/** blackboard — 단계 결과 fan-in 원장(순수 in-memory) + 결정 채널(P2). 워킹메모리 persist 는 BC2 배선. */
export interface Blackboard {
  results: Partial<Record<BuildStage, BuildAgentResult>>;
  decisions: BuildDecisions;
}

export function emptyBlackboard(): Blackboard { return { results: {}, decisions: {} }; }

/** 결과 fan-in(불변 — 새 blackboard 반환). decisions 채널은 보존. 순수. */
export function foldResult(bb: Blackboard, r: BuildAgentResult): Blackboard {
  return { results: { ...bb.results, [r.stage]: r }, decisions: bb.decisions };
}

/** 이 단계의 선행이 blackboard 에서 다 ok 인가(실행 가능 판정). 순수. */
export function stageReady(
  bb: Blackboard, stage: BuildStage,
  deps: Record<BuildStage, readonly BuildStage[]> = BUILD_STAGE_DEPS,
): boolean {
  return (deps[stage] ?? []).every((d) => bb.results[d]?.ok === true);
}

/** 수렴 판정 — 모든 대상 단계가 ok·미해결 stuck/피드백 없음. 순수. */
export function isConverged(bb: Blackboard, stages: readonly BuildStage[] = BUILD_STAGES): boolean {
  return stages.every((s) => {
    const r = bb.results[s];
    return r?.ok === true && !r.stuck && !r.feedback;
  });
}

/** 미해결 역방향 피드백(허용 엣지만) 수집 — coordinator 가 재실행 스케줄. 순수. */
export function pendingFeedback(bb: Blackboard): { from: BuildStage; to: BuildStage; reason: string }[] {
  const out: { from: BuildStage; to: BuildStage; reason: string }[] = [];
  for (const r of Object.values(bb.results)) {
    if (r?.feedback && isAllowedFeedbackEdge(r.stage, r.feedback.toStage)) {
      out.push({ from: r.stage, to: r.feedback.toStage, reason: r.feedback.reason });
    }
  }
  return out;
}
