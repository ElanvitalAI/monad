// ── 미션빌드 Coordinator 실행 드라이버 + shadow parity (재설계 2단계·BC2) ───────────
// RFC-mission-build-coordinator-2026-07-16 §5. BC1 순수 코어(scheduleStages·blackboard·
// isConverged) 위의 실행 계층. ★ 아직 실 단계를 재실행하지 않는다(집행 0·배달 무변경).
//
// shadow = 선형 se-mission-prepare 가 이미 실행한 단계 결과를 coordinator 스케줄러로 "재생
// (replay)"해, 스케줄 계약(BUILD_STAGE_DEPS)이 선형 현실과 일치하는지 대조(parity)한다.
// LLM 출력은 비결정적이라 값 == 대조가 무의미하므로, coverage(선형이 실행한 단계를 다 스케줄
// 하나)·의존 정합(고아 없나)·수렴 판정(선형 성공==isConverged)을 본다. 이게 cutover(BC5) 전에
// 잡아야 할 유일한 계약 drift 다. 실 병렬 재실행 cutover=BC5·역방향 피드백 재실행=BC3.
// [[feedback_mission_fabric_llm_logic_balance_2026_07_16]] — 스케줄/의존/수렴은 결정론 로직.

import {
  BUILD_STAGES, BUILD_STAGE_DEPS, scheduleStages, emptyBlackboard, foldResult, isConverged,
  isAllowedFeedbackEdge,
  type BuildStage, type BuildAgentResult, type Blackboard,
} from './mission-build-coordinator.js';
import type { DecompCritiqueResult, PhaseCritiqueVerdict } from './mission-decomp-critique.js';

/** 단계 1회 실행 함수(주입) — blackboard 를 받아 결과 반환. 실 단계 래핑(BC5) 또는 replay(BC2). */
export type RunStageFn = (stage: BuildStage, bb: Blackboard) => Promise<BuildAgentResult>;

export interface CoordinatorRunOptions {
  /** 대상 단계(기본 전체 8단계). 미션 shape 별 부분집합 가능(밖의 의존은 무시). */
  stages?: readonly BuildStage[];
  /** 그룹 실행 직전 관측 훅(관측 관문 배선용). */
  onGroup?: (group: BuildStage[], groupIdx: number) => void;
  /** 단계 결과 fan-in 직후 관측 훅. */
  onResult?: (r: BuildAgentResult) => void;
  /** 초기 blackboard(선행 실행 결과 seed) — 분할 실행(clarify 게이트 사이) 시 후행이 선행 결과 참조. */
  seed?: Blackboard;
}

export interface CoordinatorRunResult {
  blackboard: Blackboard;
  groups: BuildStage[][];
  converged: boolean;
}

/** Coordinator forward 실행 — 의존 병렬 그룹 순서로 runStage 호출·blackboard fan-in. 역방향
 *  피드백 재실행 없음(BC3). 같은 그룹은 Promise.all(의존 없음). 그룹 순서는 scheduleStages 가
 *  입력 순서를 보존하므로 결정론(runStage 자체가 결정론이면 결과도 결정론). */
export async function runBuildCoordinator(
  runStage: RunStageFn,
  opts: CoordinatorRunOptions = {},
): Promise<CoordinatorRunResult> {
  const stages = opts.stages ?? BUILD_STAGES;
  const groups = scheduleStages(stages);
  let bb: Blackboard = opts.seed ? { results: { ...opts.seed.results }, decisions: opts.seed.decisions ?? {} } : emptyBlackboard();
  for (let gi = 0; gi < groups.length; gi++) {
    opts.onGroup?.(groups[gi], gi);
    const results = await Promise.all(groups[gi].map((s) => runStage(s, bb)));
    for (const r of results) { bb = foldResult(bb, r); opts.onResult?.(r); }
  }
  return { blackboard: bb, groups, converged: isConverged(bb, stages) };
}

/** 선형 스크립트가 실제 실행한 단계 결과(미션 shape 별 부분집합·light 는 decompose 이후 없음). */
export type LinearTrace = Partial<Record<BuildStage, BuildAgentResult>>;

export interface ShadowParityVerdict {
  ok: boolean;
  /** 선형이 실행한 단계집합. */
  executedStages: BuildStage[];
  /** coordinator 스케줄러가 배치한 단계(flat). */
  scheduledStages: BuildStage[];
  /** 의존 병렬 그룹(스케줄 결과). */
  groups: BuildStage[][];
  /** 스케줄됐지만 선행이 (실행집합 내에서) ok 아님 — 계약 drift. */
  orphans: { stage: BuildStage; missingDeps: BuildStage[] }[];
  /** 선형은 실행했으나 coordinator 스케줄에서 누락 — coverage 갭. */
  uncovered: BuildStage[];
  /** 선형 성공 여부와 coordinator isConverged 판정 일치. */
  convergedMatch: boolean;
  detail: string;
}

/** shadow parity — 선형이 실행한 단계집합을 coordinator 스케줄러로 재생(replay), 스케줄 계약이
 *  현실과 일치하는지 대조. 실 재실행 없음(집행 0). 순수·동기(replay 는 trace 조회뿐). */
export function shadowParityCheck(
  trace: LinearTrace,
  opts: { linearSucceeded?: boolean } = {},
): ShadowParityVerdict {
  const executed = (Object.keys(trace) as BuildStage[]).filter((s) => trace[s] !== undefined);
  // 실행집합만 스케줄(부분 실행 — 밖의 의존은 scheduleStages 가 무시).
  const groups = scheduleStages(executed);
  const scheduled = groups.flat();
  // blackboard 재생 — trace 결과를 스케줄 순서대로 fan-in.
  let bb = emptyBlackboard();
  for (const g of groups) for (const s of g) { const r = trace[s]; if (r) bb = foldResult(bb, r); }
  // 고아: 실행집합 내 선행이 ok 아닌 단계(계약이 요구하는 선행이 선형에서 실패/미실행).
  const orphans: { stage: BuildStage; missingDeps: BuildStage[] }[] = [];
  for (const s of executed) {
    const inSetDeps = (BUILD_STAGE_DEPS[s] ?? []).filter((d) => executed.includes(d));
    const missing = inSetDeps.filter((d) => trace[d]?.ok !== true);
    if (missing.length) orphans.push({ stage: s, missingDeps: missing });
  }
  const uncovered = executed.filter((s) => !scheduled.includes(s));
  const converged = isConverged(bb, executed);
  const convergedMatch = opts.linearSucceeded === undefined ? true : converged === opts.linearSucceeded;
  const ok = orphans.length === 0 && uncovered.length === 0 && convergedMatch;
  const detail = ok
    ? `parity OK — ${executed.length}단계 스케줄 정합(그룹 ${groups.length}·수렴 ${converged})`
    : `parity DRIFT — 고아 ${orphans.length}·미커버 ${uncovered.length}·수렴 ${convergedMatch ? 'ok' : 'mismatch'}`;
  return { ok, executedStages: executed, scheduledStages: scheduled, groups, orphans, uncovered, convergedMatch, detail };
}

// ── 역방향 피드백 critique→decompose (BC3) ───────────────────────────────────────
// RFC §5 BC3. critique 가 치명(과대·미명세·허상)을 잡으면 decompose 재실행을 요청한다. ★ 대표 결정
// (2026-07-16): 자율 수준 = **원탭 HITL 제안**(자동 루프 아님). 이 순수 함수들은 "재분해가 필요한가·
// 무슨 지시로"를 결정론으로 판정하고, 실 트리거는 대표 탭(콜백 배선). isAllowedFeedbackEdge 로
// critique→decompose 만 허용(대표 보수 결정). [[feedback_mission_fabric_llm_logic_balance_2026_07_16]].

/** critique 치명 비평 최대 재분해 예산(무한 재분해 방지·대표 보수). 초과 시 버튼 미노출. */
export const MAX_REDECOMPOSE = 2;

/** critique 결과 → decompose 재실행 피드백(허용 엣지만). 치명 없으면 undefined. 순수. */
export function deriveDecompositionFeedback(
  critique: DecompCritiqueResult,
): { toStage: BuildStage; reason: string } | undefined {
  if (!critique.hasCritical) return undefined;
  if (!isAllowedFeedbackEdge('critique', 'decompose')) return undefined; // 불변식(항상 true) 명시.
  const crit = critique.critiques.filter((c) => c.severity === 'critical');
  return { toStage: 'decompose', reason: `치명 ${crit.length}건(${crit.map((c) => c.verdict).join(',')})` };
}

/** 재분해 제안 버튼 노출 여부(순수 예산 예측) — 치명 있고 예산 남고 opt-in 켜졌을 때만. */
export function shouldOfferRedecompose(
  hasCritical: boolean, taps: number, enabled: boolean, max: number = MAX_REDECOMPOSE,
): boolean {
  return enabled && hasCritical && taps < max;
}

const REDECOMPOSE_VERDICT_LABEL: Record<PhaseCritiqueVerdict, string> = {
  ok: '', over_scope: '과대(관심사 혼재)', under_specified: '미명세', ungrounded: '근거부족(허상)',
};

/** critique 치명 지적 → decompose 재실행 reviseContext(--comment 로 흐름). 순수·ASCII+한글. */
export function buildRedecomposeComment(critique: DecompCritiqueResult): string {
  const crit = critique.critiques.filter((c) => c.severity === 'critical');
  const lines = ['분해 비평(critique) 자동 정련 — 아래 치명 지적을 반영해 재분해하라:'];
  for (const c of crit) {
    lines.push(`- [${REDECOMPOSE_VERDICT_LABEL[c.verdict] || c.verdict}] ${c.phaseTitle}: ${c.reason.slice(0, 160)}`);
    if (c.suggestion) lines.push(`  제안: ${c.suggestion.slice(0, 160)}`);
    if (c.needsClarification) lines.push(`  확정 필요: ${c.needsClarification.slice(0, 160)}`);
  }
  lines.push('각 페이즈는 단일책임·명세완성·기존 재사용근거·현실적 스코프를 지켜라.');
  return lines.join('\n');
}

// ── stuck 처리 (BC4) ─────────────────────────────────────────────────────────────
// RFC §5 BC4. 빌드 단계가 no-op/드롭으로 진전 없을 때(예: research rate-limit 드롭) coordinator 가
// 어떻게 처리할지 결정. ★ 자율 수준(대표 넘버원 원칙): ①확신 있는 일시 오류는 예산 내 자동 재시도
// (스스로 힐링·최우선) → ②소진/구조적이면 escalate(안 되면 HITL+충분 정보). decideAutonomousAct 의
// **기본거부(default-deny) 정신** 반영 — 확신 있는 transient 만 자동, 나머지는 보수적. 순수·결정론.

/** stuck 종류 — transient(일시·재시도 가치)·empty(빈 결과·우회)·structural(구조적·escalate). */
export type StuckKind = 'transient' | 'empty' | 'structural';
/** stuck 처리 액션 — retry(예산 내 재시도)·reroute(단계 우회·진행)·escalate(자율 소진·HITL/관측). */
export type StuckAction = 'retry' | 'reroute' | 'escalate';

/** 조사 단계 재시도 예산(대표 2026-07-15 결: 일시 실패는 보수적 1회 재시도·isTransientLlmError 정신). */
export const MAX_STUCK_RETRY = 1;

/** stuck 사유 → 종류 분류. isTransient 는 isTransientLlmError(호출측) 결과 주입(순수 유지). */
export function classifyStuckReason(reason: string, isTransient: boolean): StuckKind {
  if (isTransient) return 'transient';
  if (/no-?op|빈 결과|결과 없음|empty|드롭|dropped|없음/i.test(reason)) return 'empty';
  return 'structural';
}

export interface StuckDecision { action: StuckAction; kind: StuckKind; reason: string; }

/** stuck 종류·시도횟수 → 처리 결정(기본거부 정신·예산). 순수·결정론. */
export function decideStuckAction(kind: StuckKind, attempts: number, max: number = MAX_STUCK_RETRY): StuckDecision {
  if (kind === 'transient' && attempts < max) {
    return { action: 'retry', kind, reason: `일시 오류 — 예산 내 자동 재시도 (${attempts + 1}/${max})` };
  }
  if (kind === 'empty') {
    return { action: 'reroute', kind, reason: '빈 결과 — 이 단계 우회(비블로킹·다음 단계 진행)' };
  }
  return {
    action: 'escalate', kind,
    reason: kind === 'transient' ? '재시도 예산 소진 — escalate(관측·진행)' : '구조적 정체 — escalate(HITL/관측)',
  };
}
