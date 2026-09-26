// ── 미션 자기인지 관측 관문 (RFC 자기인지 3박자·P1 · 2026-07-14) ────────────────
//
// 문제(RFC §2b): 미션 셀프힐 분기 16+ 지점이 전부 log()->console.log(run.log 파일)로만
// 흐르고 logs.db 에 한 줄도 안 간다. 그래서 `elanous logs` 로 셀프힐이 0건 조회되고(실측),
// 셀프판단(triage/heal)이 자기 관측을 소스로 쓸 수 없다 — 대표 넘버원 원칙의 병목.
//
// 설계(RFC §3.1): 모든 셀프힐 분기가 통과하는 단일 관문. 통과하면 3박자에 구조적으로
// 팬아웃한다(fail-soft·새 저장소 없음·기존 인프라 재사용):
//   ① 로그(항상)      — debug.log('mission.selfheal.<stage>', ...) → logs.db → `elanous logs`
//   ② 자기인지(중대)  — injectSelfMemory(importance>=THRESHOLD) → self-memory ambient 회상
//   ③ 운영전이(상태성) — recordOpsEventSafe(stateful) → ops_events → `elanous ops` timeline
//
// se-bridge 의 log() 는 삭제가 아니라 이 관문을 겸용한다(사람용 서사 유지 + 구조화 관측).
// 회귀 0 지향(로그 라인 그대로·팬아웃 실패는 삼킨다).

import { debug } from '../debug/log.js';
import { recordOpsEventSafe } from '../domains/ops-log.js';
import { injectSelfMemory } from '../domains/self-awareness.js';

/** 셀프힐 폐루프의 의사결정 단계(RFC §3.1). 로그 카테고리 `mission.selfheal.<stage>` 로 매핑. */
export type SelfHealStage =
  | 'diagnose' // grounded 검증(이미 충족? 미충족?)
  | 'prevent' // 재시도 rung 전 예방(#4110 — 이미충족 단축·missing 주입)
  | 'recover' // 시스템 리커버리(#4109 — no-op 후 타겟 복구)
  | 'deadlock' // 구현자-검증자 교착(#4111 — 리커버리도 no-op)
  | 'triage' // 적응형 재시도 갈림길(retry/split/revise/skip/escalate)
  | 'escalate' // terra->opus 폴백·예산 상향·계단 소진
  | 'pass' // 페이즈 충족(자동 PASS)
  | 'rebuild' // 자율 재구현 발동
  | 'review' // 자율 PR 리뷰 판정(R0·RFC-autonomous-pr-review — verdict=fail 이면 재작업 유발)
  | 'decision' // 운영자/에이전트 결정 주입(re-ground·defer·check-pass·boundary — RFC-mission-decision-injection·2026-07-15)
  | 'edit'; // 미션 구조 편집(insert-arc·reorder·delete·skip·arc-status — 종합 히스토리·2026-07-15)

export type SelfHealVerdict =
  | 'pass' // 충족·수렴
  | 'fail' // 미충족·실패 유지
  | 'no-op' // 변경 0(가짜/정당)
  | 'converge' // 자율 수렴 성공
  | 'stuck' // 교착(수렴 불가 확정)
  | 'inject' // 다음 rung 에 진단 주입(예방)
  | 'event'; // 기타 관측

export interface SelfHealEvent {
  missionId: string;
  phaseId: string;
  phaseTitle: string;
  stage: SelfHealStage;
  verdict?: SelfHealVerdict;
  /** 왜 이 판단인가 — comprehension-debt 방지(ops_events.rationale·self-memory.text 로도 흐른다). */
  rationale: string;
  /** grounded 미충족 타겟(진단·예방·복구·교착에서). */
  missing?: string;
  /** triage 갈림길 종류(retry-escalate/split/revise/skip/escalate). */
  triageKind?: string;
  /** 상태 전이인가 — true 면 ops_events(elanous ops timeline)에도 기록. */
  stateful?: boolean;
  /** 0-10 현저성. >=SELF_MEMORY_IMPORTANCE 면 self-memory ambient 로도 흐른다. */
  importance?: number;
  /** 크로스참조(buildId·branch·attempt·backend 등). */
  refs?: Record<string, unknown>;
}

/** 이 임계 이상이면 self-memory(ambient 회상)에 주입 — 교착·수렴 같은 중대 판단만(노이즈 방지). */
export const SELF_MEMORY_IMPORTANCE = 6;

/** 테스트/커스텀 주입용 sink seam — 미주입 시 실 배선(debug.log·recordOpsEventSafe·injectSelfMemory). */
export interface ObservationSinks {
  logSink?: (category: string, event: string, data: unknown) => void;
  opsSink?: (input: Parameters<typeof recordOpsEventSafe>[0]) => void;
  memorySink?: (input: Parameters<typeof injectSelfMemory>[0]) => void;
}

/**
 * 단일 관측 관문 — 셀프힐 이벤트를 3박자에 팬아웃(각 sink 독립 fail-soft).
 * 어떤 sink 가 던져도 관문은 던지지 않는다(셀프힐 실행을 관측이 막지 않음).
 */
export function recordMissionObservation(ev: SelfHealEvent, sinks: ObservationSinks = {}): void {
  const importance = ev.importance ?? defaultImportance(ev.stage);
  const payload = {
    missionId: ev.missionId,
    phaseId: ev.phaseId,
    phaseTitle: ev.phaseTitle,
    verdict: ev.verdict ?? 'event',
    rationale: ev.rationale,
    ...(ev.missing ? { missing: ev.missing } : {}),
    ...(ev.triageKind ? { triageKind: ev.triageKind } : {}),
    ...(ev.refs ? { refs: ev.refs } : {}),
  };

  // ① 로그(항상) — 관측툴 조회 가능해짐. 카테고리 규약 `<component>.<subsystem>.<event>` 준수.
  try {
    const logFn = sinks.logSink ?? ((c, e, d) => debug.log(c, e, d));
    logFn(`mission.selfheal.${ev.stage}`, ev.verdict ?? 'event', payload);
  } catch { /* fail-soft */ }

  // ② 자기인지(중대) — self-memory ambient 로 봇이 "이 미션 왜 막혔나" 회상 가능.
  if (importance >= SELF_MEMORY_IMPORTANCE) {
    try {
      const memFn = sinks.memorySink ?? ((input) => { void injectSelfMemory(input).catch(() => {}); });
      memFn({
        tool: 'autopilot',
        kind: 'mission-selfheal',
        importance,
        summary: `[${ev.stage}:${ev.verdict ?? 'event'}] ${ev.phaseTitle.slice(0, 48)}`,
        text: `${ev.rationale}${ev.missing ? `\n미충족: ${ev.missing}` : ''}`.slice(0, 600),
        refs: { missionId: ev.missionId, phaseId: ev.phaseId, stage: ev.stage, ...(ev.refs ?? {}) },
      });
    } catch { /* fail-soft */ }
  }

  // ③ 운영전이(상태성) — ops_events(elanous ops timeline)에 상태 전이로 기록.
  if (ev.stateful) {
    try {
      const opsFn = sinks.opsSink ?? recordOpsEventSafe;
      opsFn({
        entityType: 'task',
        entityId: ev.phaseId,
        event: 'status_change',
        actor: 'triage',
        rationale: `[selfheal:${ev.stage}] ${ev.rationale}`.slice(0, 300),
        refs: { missionId: ev.missionId, stage: ev.stage, verdict: ev.verdict ?? 'event', ...(ev.refs ?? {}) },
        importance,
      });
    } catch { /* fail-soft */ }
  }
}

/** stage 별 기본 현저성 — 교착/복구실패는 중대(self-memory), 진단/예방은 로그 위주. */
function defaultImportance(stage: SelfHealStage): number {
  switch (stage) {
    case 'deadlock': return 7; // 수렴 불가 확정 — 가장 중대
    case 'decision': return 7; // 운영자 결정은 미션을 다스리는 전제 — 기억(≥6)+ops 전이로 흐른다
    case 'edit': return 6; // 미션 구조 편집 — 종합 히스토리·기억(≥6)로 흐른다
    case 'triage': return 6; // 갈림길 판단
    case 'recover': return 6; // 복구 시도
    case 'escalate': return 6; // 최강 모델 폴백
    case 'rebuild': return 6; // 자율 재구현
    case 'review': return 6; // PR 리뷰 fail->재작업 — 재구현 동급 중대(self-memory 회상)
    case 'pass': return 5; // 수렴 성공(참고)
    case 'diagnose': return 5;
    case 'prevent': return 4; // 예방 주입은 로그만
    default: return 4;
  }
}

/**
 * missionId·task 컨텍스트를 바인딩한 관측기 — se-bridge 등에서 `observe({stage, ...})` 로 간결 호출.
 * 컨텍스트(missionId·phaseId·phaseTitle)를 매번 반복하지 않게 한다.
 */
export function makeMissionObserver(
  ctx: { missionId: string; phaseId: string; phaseTitle: string },
  sinks: ObservationSinks = {},
): (ev: Omit<SelfHealEvent, 'missionId' | 'phaseId' | 'phaseTitle'>) => void {
  return (ev) => recordMissionObservation({ ...ctx, ...ev }, sinks);
}
