// 하니스 plan-time 크기 게이트(C3) + 경량 Context Capsule 빌더(C1) — 순수·2026-07-23
//
// [[RFC-plan-as-rfc-generation-2026-07-22]] §8 (self-harness 결합 · Capsule = 경량 RFC).
// self-harness 의 plan seam 은 종전 steps[] 만 냈고 **실행-前 sizing 게이트가 없어**(완주-가능-크기 SSOT
// gradePhaseCompletability 는 미션패브릭 전용) 과대 스텝을 실행단 무한 split 로 떠넘겼다. 여기서:
//   C3 = 미션패브릭 SSOT(gradePhaseCompletability)를 **재발명 없이 재사용**해 plan 단계에서 스텝 크기를 채점.
//   C1 = Waza 차용 A(HarnessContextCapsule·buildHarnessContextCapsule)를 plan 의 산출물(설계 계약)로 빌드.
//
// ⚠️ 2026-07-19 과대게이트 오탐 교훈(feedback_granularity_gate_over_aggressive) 계승: 하니스 스텝은
//   텍스트뿐(files/est 실행근거 없음)이라 SSOT 의 텍스트-단독 too_large 억제가 그대로 적용된다 —
//   "A 하고 B 하고 C" 같은 결합/다관심사 스텝만 too_large 로 잡히고 평범한 스텝은 안 잡힌다(오탐 0).
//   판정은 **soft(관측·attach·권고)** — 자동 재분해는 하지 않는다(하드 집행은 대표 결정 대기 ·
//   arcConformance soft/hard 규율과 동일 = project_archint_soft_vs_hard_enforcement).

import { gradePhaseCompletability, type PhaseCompletabilityGrade } from '../autopilot/mission-phase-granularity.js';
import {
  buildHarnessContextCapsule,
  type HarnessContextCapsule,
  type HarnessGroundingRef,
} from '../self-implement/context-capsule.js';

/** C3 — plan 스텝 크기 채점 결과(순수). soft 신호 — 관측/attach 용이며 자동 재분해를 트리거하지 않는다. */
export interface PlanSizing {
  /** 각 스텝의 완주-가능-크기 등급(미션 SSOT 재사용). */
  grades: PhaseCompletabilityGrade[];
  /** too_large(결합·다관심사) 스텝 수 — under-decomposition(스텝이 한 실행에 담기 과다) 신호. */
  oversizedCount: number;
  /** too_small(과소·인접 병합 후보) 스텝 수. */
  tooSmallCount: number;
  /** 체계적 under-decomposition 의심 — 과대 스텝 ≥2. 미션패브릭 narrow-redecompose 임계
   *  (granularityOversizedCount ≥ 2)와 동형. soft(권고). */
  underDecomposed: boolean;
}

/** ★ C3 plan-time 크기 게이트(순수·결정론) — 스텝을 미션 SSOT(gradePhaseCompletability)로 채점한다.
 *  스텝은 텍스트뿐이므로 files/est 실행근거 없이 채점 → 결합/다관심사 스텝만 too_large(오탐 0).
 *  자동 재분해 안 함(soft) — 호출자는 결과를 관측/attach 하고 필요 시 HITL/권고로만 소비한다. */
export function gradePlanSteps(steps: readonly string[]): PlanSizing {
  const grades = steps.map((s, i) =>
    gradePhaseCompletability({ id: String(i + 1), title: s, prompt: s, acceptance: [] }),
  );
  const oversizedCount = grades.filter((g) => g.verdict === 'too_large').length;
  const tooSmallCount = grades.filter((g) => g.verdict === 'too_small').length;
  return { grades, oversizedCount, tooSmallCount, underDecomposed: oversizedCount >= 2 };
}

/** C1 capsule 빌더 입력 — 시간(createdAt)은 호출자가 주입해 이 함수를 순수로 유지(IO 분리·같은 입력=같은 출력). */
export interface HarnessCapsuleInput {
  objective: string;
  /** 작업 대상(레포/외부). 기본 'repo'. G8 위험판정은 여기서 외부/배포 신호를 읽는다. */
  target?: string;
  /** plan 스텝 = inScope(범위). */
  steps: readonly string[];
  /** grounding provenance 참조([code|skill|memory|doc]). 사실 배경일 뿐 실존 파일 주장으로 승격 금지. */
  groundingRefs?: readonly HarnessGroundingRef[];
  successCriteria?: readonly string[];
  evidenceRequired?: readonly string[];
  outOfScope?: readonly string[];
  riskBoundaries?: readonly string[];
  createdAt: string;
}

/** ★ C2(§8) — 인터뷰가 채우는 Capsule 씨앗. clarify(analyzeGoalAmbiguity + foldAnswersIntoDesign)가 이미
 *  산출하는 ConfirmedDesign(scope/excluded/notes)을 텍스트 메모로 버리지 않고 **capsule 필드로 승격** — 골루프의
 *  나침반(무엇이 done · 범위 밖 · 위험 경계). 재발명 0: 기존 인터뷰 파이프라인의 구조화 산출을 재라우팅할 뿐.
 *  successCriteria = 확정 in-scope(done 목표) · outOfScope = 제외(후속) · riskBoundaries = 안전/용어 확인. */
export interface CapsuleSeed {
  successCriteria?: readonly string[];
  outOfScope?: readonly string[];
  riskBoundaries?: readonly string[];
}

/** self-implement 코드 executor 의 기본 완료 증거 — 변경 파일 tsc 0 + gate(test/build) 통과. */
const DEFAULT_EVIDENCE = ['변경 파일 tsc 0 에러', 'gate(test/build) 통과'] as const;

/**
 * ★ C1 — plan 의 산출물로서의 **경량 Context Capsule**(Waza 차용 A) 빌드. plan steps = inScope,
 * gate = evidenceRequired 기본(tsc/test). buildHarnessContextCapsule 을 재사용(provenance runtime 검증 포함).
 * 지금은 결정론 휴리스틱(스텝·gate 로 계약 골격만) — **인터뷰(C2)가 나중에 successCriteria/scope/risk 를
 * richer 로 채운다**. capsule 은 planner/executor/reviewer 가 공유하는 불변 계약이자 C4(ledger)·C5(markdown)의 축.
 */
export function buildHarnessCapsuleFromPlan(input: HarnessCapsuleInput): HarnessContextCapsule {
  return buildHarnessContextCapsule({
    objective: input.objective,
    target: input.target ?? 'repo',
    inScope: [...input.steps],
    outOfScope: input.outOfScope ? [...input.outOfScope] : [],
    successCriteria: input.successCriteria
      ? [...input.successCriteria]
      : ['계획된 모든 스텝이 구현되고 gate(tsc/test) 통과'],
    evidenceRequired: input.evidenceRequired ? [...input.evidenceRequired] : [...DEFAULT_EVIDENCE],
    riskBoundaries: input.riskBoundaries ? [...input.riskBoundaries] : [],
    groundingRefs: input.groundingRefs ? [...input.groundingRefs] : [],
    createdAt: input.createdAt,
  });
}

/** capsule 을 executor/reviewer 프롬프트에 실을 **한 화면 digest**(경량 RFC 본문). 빈 필드는 생략. */
export function renderCapsuleDigest(c: HarnessContextCapsule): string {
  const lines = ['[설계 계약(Context Capsule) — 이 목표·범위·성공기준·증거 안에서만 작업하라]', `목표: ${c.objective}`];
  if (c.inScope.length) lines.push(`범위(In): ${c.inScope.join(' · ')}`);
  if (c.outOfScope.length) lines.push(`범위 밖(Out): ${c.outOfScope.join(' · ')}`);
  if (c.successCriteria.length) lines.push(`성공기준: ${c.successCriteria.join(' · ')}`);
  if (c.evidenceRequired.length) lines.push(`완료 증거: ${c.evidenceRequired.join(' · ')}`);
  if (c.riskBoundaries.length) lines.push(`위험 경계: ${c.riskBoundaries.join(' · ')}`);
  return lines.join('\n');
}
