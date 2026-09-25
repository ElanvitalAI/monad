// 하니스 실패 조사 원장(C4·Waza 차용 B) — 순수·2026-07-23
//
// [[RFC-plan-as-rfc-generation-2026-07-22]] §8 C4 · [[BACKLOG-waza-borrowings-bcd-wiring-2026-07-23]] §B.
// Waza Hunt 규율("원인은 한 문장·로그는 yes/no probe·같은 증상이면 이전 가설 폐기·세 가설 뒤 handoff")을
// self-harness 실패에 적용한다. 종전 하니스는 실패를 **횟수로만** 셌다(maxReviewRounds/maxReplans blind count).
// 여기서 실패마다 **무엇이(Capsule successCriteria 대비) 왜 안 됐는지**를 조사 엔트리로 남겨:
//   (1) 스톨/handoff 시 HITL 번들이 "무슨 가설을 무슨 probe 가 반증했나"를 담고(자기인지·디버깅),
//   (2) 재시도가 하니스 결함인지 feature 결함인지 구분되게 한다.
//
// ⚠️ 골루프-우선 불변식(§8·대표 지적): 이 원장은 **진단(렌즈)**이지 골루프를 자르는 가름이 아니다.
//   기본(observe)은 기록·관측·handoff 번들 첨부만 — 제어 흐름(maxReviewRounds/maxReplans 캡)은 무접촉.
//   shouldHandoff(가설 연속 미지지 → HITL 단축)는 순수 판정으로 **제공**하되, 실제 루프 단축 집행은 opt-in
//   상위 레벨(대표 결정 대기)에서만. 오늘 골루프는 이 원장 때문에 더 일찍 잘리지 않는다.

import type { HarnessContextCapsule } from '../self-implement/context-capsule.js';

export type FailureStage = 'execute' | 'review' | 'replan';

/** probe 반증 판정 — Waza Hunt: 가설을 discriminating probe 로 시험한 결과.
 *  supported=원인 확인(rework 근거) · refuted=반증(그 patch 누적 금지) · inconclusive=미결(HITL 정보). */
export type InvestigationVerdict = 'supported' | 'refuted' | 'inconclusive';

/** 한 실패의 조사 — 원인 한 문장(hypothesis) + yes/no probe + 결과. Waza B model(전체 필드). */
export interface FailureInvestigation {
  stage: FailureStage;
  attempt: number;
  /** 실제 증상(리뷰 findings·구현 summary 등 — 날조 금지·손에 있는 신호만). */
  symptoms: string[];
  /** 이 실패가 침해한 Capsule 성공기준(나침반 대비 — C2 인터뷰가 채운 것). 없으면 빈 배열. */
  unmetCriteria: string[];
  /** 원인 한 문장(가설). LLM/휴리스틱 추정이며 사실 아님 — verdict 로만 승격. */
  hypothesis: string;
  /** 가설을 시험한 yes/no probe(무엇을 봤나). */
  probe: string;
  /** probe 가 supported 면 관측될 것(가설의 예측). */
  expectedIfTrue: string;
  /** 실제 관측(probe 결과). */
  observed: string;
  verdict: InvestigationVerdict;
  /** 증거 참조(경로·digest만·비밀값/원문 금지). */
  evidenceRefs: string[];
}

export type FailureLedger = readonly FailureInvestigation[];

/** handoff 판정 임계 — 최근 N개 가설이 모두 미지지(refuted/inconclusive)면 자율 재시도 중단 후보. */
export const HANDOFF_THRESHOLD = 3;

export interface OpenInvestigationInput {
  stage: FailureStage;
  attempt: number;
  symptoms: readonly string[];
  hypothesis: string;
  probe: string;
  expectedIfTrue: string;
  observed: string;
  verdict: InvestigationVerdict;
  /** 있으면 이 실패가 침해한 성공기준을 나침반에서 뽑는다. */
  capsule?: HarnessContextCapsule;
  evidenceRefs?: readonly string[];
}

/** ★ C4 — 실패 조사 엔트리 생성(순수). Capsule 이 있으면 unmetCriteria 를 나침반(successCriteria)에서 채운다.
 *  probe 결과 없이 실행-근거 신호로만 채우므로 날조 없음(호출자가 손에 있는 신호를 넘긴다). */
export function openInvestigation(input: OpenInvestigationInput): FailureInvestigation {
  return {
    stage: input.stage,
    attempt: input.attempt,
    symptoms: [...input.symptoms].slice(0, 8),
    unmetCriteria: input.capsule ? [...input.capsule.successCriteria].slice(0, 8) : [],
    hypothesis: input.hypothesis,
    probe: input.probe,
    expectedIfTrue: input.expectedIfTrue,
    observed: input.observed,
    verdict: input.verdict,
    evidenceRefs: input.evidenceRefs ? [...input.evidenceRefs].slice(0, 8) : [],
  };
}

/** ★ handoff 판정(순수·Waza Hunt "세 가설 뒤 handoff") — 최근 HANDOFF_THRESHOLD 개 조사가 모두 supported
 *  가 아니면(반증/미결) 자율 재시도가 벽을 치고 있다는 신호 → HITL 표면화 후보. **판정만**(제어 흐름은 호출자·
 *  기본 observe 에선 소비 안 함). 엔트리가 임계 미만이면 false(아직 시도 여지). */
export function shouldHandoff(ledger: FailureLedger): boolean {
  if (ledger.length < HANDOFF_THRESHOLD) return false;
  const recent = ledger.slice(-HANDOFF_THRESHOLD);
  return recent.every((inv) => inv.verdict !== 'supported');
}

/** handoff 번들/관측용 요약(순수) — 비면 ''. 가설·verdict·미충족 기준을 한 화면으로.
 *  ⚠️ ACP review should-fix(#5197): 종전 `slice(-HANDOFF_THRESHOLD)`(최근 3건)은 조사 >3 누적 시(maxReviewRounds
 *  >3 + replan) 앞쪽 조사를 HITL 번들에서 누락시켰다 → **전체 조사 렌더** + 건수 헤더로 정보 완전성 확보. */
export function renderLedger(ledger: FailureLedger): string {
  if (!ledger.length) return '';
  const lines = [`[실패 조사 원장 (${ledger.length}건) — 무슨 가설을 무슨 probe 가 어떻게 판정했나]`];
  for (const inv of ledger) {
    lines.push(`- [${inv.stage} r${inv.attempt}·${inv.verdict}] ${inv.hypothesis} (probe: ${inv.probe} → ${inv.observed})`);
  }
  const unmet = [...new Set(ledger.flatMap((i) => i.unmetCriteria))].slice(0, 6);
  if (unmet.length) lines.push(`미충족 성공기준: ${unmet.join(' · ')}`);
  return lines.join('\n');
}
