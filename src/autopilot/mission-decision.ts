// ── 미션 결정 패브릭 (Layer 1 · RFC-mission-decision-injection-2026-07-15) ──────
//
// 운영자·에이전트가 미션에 대해 내린 결정(re-ground·defer·check-pass·boundary 등)을 단일 창구로
// 새긴다. 근거 사건: a6230f 완주 중 운영자 결정이 raw 스크립트로 store 만 바꿔 미션이 "왜"를 모름
// (제1원칙 위반). 이 함수는 결정을 **3박자**로 흐르게 한다:
//   ① 워킹메모리(jsonl·provenance='decision') → 후속 페이즈 빌드 프롬프트 주입(자기인지)
//   ② 관측 관문(recordMissionObservation·stage='decision') → logs.db + surface_events(통합 기억·
//      전 서피스 ambient 회상) + ops_events timeline
// = "프롬프트엔 노출·셀프힐 판단엔 미노출" 비대칭 해소. inject/check 도 이 창구로 수렴 가능.

import { coordinatorRecordMemory } from './pipeline/coordinator-memory.js';
import { recordMissionObservation, type ObservationSinks } from './mission-observation.js';

/** 결정 종류 — revise(전체 재분해) 외의 세밀한 운영 결정을 1급화. */
export type MissionDecisionKind =
  | 're-ground' // acceptance 재조정(criterion 완화·경계 명시·정의모듈 한계 인정)
  | 'defer' // arming/HITL/후속으로 미룸(이 게이트를 지금 강제 안 함)
  | 'check-pass' // 감사/확인 통과 근거(에이전트 검증 불가·사람이 확인)
  | 'scope-note' // 범위/전제 메모(재투쟁 방지)
  | 'boundary' // 완주/책임 경계 결정(예: A3=arming HITL)
  | 'reuse' // 재사용 경계 지정
  | 'accept'; // 산출물 수용(build no-op 이 정당)

export interface MissionDecision {
  kind: MissionDecisionKind;
  /** 결정 요약(한 줄). */
  note: string;
  /** 왜 — comprehension-debt 방지(triage·기억·ops 로 흐른다). */
  rationale?: string;
  /** 대상 — 아크 핸들·페이즈·criterion 등(예: "A1 criterion 2"). */
  appliesTo?: string;
  /** 누가 — operator·agent·telegram:<user>·voice 등. */
  actor?: string;
  /** 대상 페이즈 task.id(선택·워킹메모리/관측 스코핑). */
  phaseId?: string;
  phaseTitle?: string;
  /** 대상 아크 arcId(선택·아크 메이트 컨텍스트 태깅). */
  arcId?: string;
  /** 출처 태그(기본 'decision'). 외부 코드 가이드면 'external'. */
  provenance?: 'external' | 'decision';
}

/** 미션 구조 편집 종류 — 종합 히스토리·관측용. */
export type MissionEditOp =
  | 'insert-arc' | 'reorder-arc' | 'delete-arc' | 'arc-status'
  | 'insert-phase' | 'delete-phase' | 'skip-phase' | 'split-phase';

export interface MissionEdit {
  op: MissionEditOp;
  /** 대상(아크 핸들/이름·페이즈 handle·arcId 등). */
  target: string;
  /** 무엇을 했나(전후·요약). */
  detail: string;
  actor?: string;
  arcId?: string;
}

/**
 * 미션 구조 편집 기록 통합 창구 — insert/reorder/delete/skip/split/arc-status 를 **관측 3박자**로
 * (기존 debug.log 만이던 갭·raw 스크립트 휘발 갭 해소). 종합 히스토리(mission-history)가 이걸 읽는다.
 * fail-soft. sinks 주입 seam.
 */
export function recordMissionEdit(missionId: string, e: MissionEdit, sinks: ObservationSinks = {}): string {
  const who = e.actor ?? 'operator';
  const line = `[${who}·${e.op}] ${e.target} — ${e.detail}`;
  const phaseId = `edit:${e.op}`;
  coordinatorRecordMemory(missionId, {
    phaseId, phaseTitle: `[편집] ${e.op}`, kind: 'operational',
    summary: line, reusables: [], decisions: [], artifacts: [],
    provenance: 'decision',
    ...(e.arcId ? { arcId: e.arcId } : {}),
  });
  recordMissionObservation({
    missionId, phaseId, phaseTitle: `[편집] ${e.op}`,
    stage: 'edit', verdict: 'event', rationale: line, stateful: true,
    refs: { op: e.op, target: e.target, ...(e.actor ? { actor: e.actor } : {}), ...(e.arcId ? { arcId: e.arcId } : {}) },
  }, sinks);
  return line;
}

/** 결정을 사람이 읽을 한 줄로. */
export function formatDecision(d: MissionDecision): string {
  const who = d.actor ?? 'operator';
  const tgt = d.appliesTo ? ` [${d.appliesTo}]` : '';
  const why = d.rationale ? ` — ${d.rationale}` : '';
  return `[${who}·${d.kind}]${tgt} ${d.note}${why}`;
}

/**
 * 미션 결정 기록 통합 창구(Layer 1) — 워킹메모리 + 관측 관문(3박자). fail-soft(각 다리 독립).
 * sinks 주입 seam(테스트/커스텀). 반환=기록된 한 줄 요약.
 */
export function recordMissionDecision(
  missionId: string,
  d: MissionDecision,
  sinks: ObservationSinks = {},
): string {
  const line = formatDecision(d);
  const phaseId = d.phaseId ?? `decision:${d.kind}`;
  const phaseTitle = d.phaseTitle ?? `[결정] ${d.kind}`;
  // ① 워킹메모리 — 후속 페이즈 프롬프트 주입(자기인지). decisions[] 로 계약화.
  coordinatorRecordMemory(missionId, {
    phaseId, phaseTitle, kind: 'operational',
    summary: line,
    // reuse 종류면 note 를 재사용 경계로도 실어 후속 페이즈가 준수(중복/dead-code 방지).
    reusables: d.kind === 'reuse' ? [d.note] : [],
    decisions: [
      d.note,
      ...(d.appliesTo ? [`대상: ${d.appliesTo}`] : []),
      ...(d.rationale ? [`이유: ${d.rationale}`] : []),
    ],
    artifacts: [],
    provenance: d.provenance ?? 'decision',
    ...(d.arcId ? { arcId: d.arcId } : {}),
  });
  // ② 관측 관문 — logs.db(mission.selfheal.decision) + surface_events(기억·ambient) + ops_events.
  recordMissionObservation({
    missionId, phaseId, phaseTitle,
    stage: 'decision',
    verdict: 'inject',
    rationale: line,
    stateful: true, // 미션을 다스리는 전이 → ops timeline
    refs: {
      kind: d.kind,
      ...(d.actor ? { actor: d.actor } : {}),
      ...(d.appliesTo ? { appliesTo: d.appliesTo } : {}),
      ...(d.arcId ? { arcId: d.arcId } : {}),
    },
  }, sinks);
  return line;
}
