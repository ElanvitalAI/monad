// ── 세션 자기인지 관측 관문 (제1원칙·PLAN §0.5 · 2026-07-16) ────────────────────
//
// 세션 패브릭 = elanous 가 자기 대화를 서피스 경계 넘어 인지하는 자기인지 표면. 그래서 세션
// 생애 이벤트(subscribe/leave/handoff/fork/fan-out/표현변환/입력조정/검색/reconcile)는 반드시
// 관측을 남긴다 — 안 남기면 "구독 드롭·fan-out 실패·표현 폴백"이 안 보여 셀프힐이 자기 관측을
// 소스로 못 쓴다(대표 넘버원 원칙).
//
// mission-observation.ts(recordMissionObservation)의 **세션판 자매** — 재구현 0, 같은 3박자:
//   ① 로그(항상)     — debug.log('session.<subsystem>', event, payload) → logs.db → `elanous logs`
//   ② 자기인지(중대)  — injectSelfMemory(importance>=THRESHOLD) → self-memory ambient 회상
//   ③ 운영전이(상태성) — recordOpsEventSafe(stateful·entityType='session') → `elanous ops` timeline
//
// fail-soft — 어떤 sink 가 던져도 관문은 던지지 않는다(관측이 세션 실행을 막지 않음).

import { debug } from '../debug/log.js';
import { recordOpsEventSafe } from '../domains/ops-log.js';
import { injectSelfMemory } from '../domains/self-awareness.js';

/** 세션 생애 서브시스템 — 로그 카테고리 `session.<subsystem>` 으로 매핑. */
export type SessionSubsystem =
  | 'subscribe' // 구독 합류/이탈(join/leave)
  | 'handoff' // 서피스 이동(attach/detach·크로스서피스 이어가기)
  | 'fork' // 세션 포크·타임트래블
  | 'fanout' // 출력 fan-out(전 구독자 브로드캐스트)
  | 'render' // 표현법 변환(서피스별 렌더)
  | 'input' // 동시 입력 조정(턴 소유권)
  | 'presence' // presence 전이(활성/유예/이탈)
  | 'search' // 세션 검색(=기억 회상)
  | 'reconcile' // 고아 세션 정합(기록 vs 현실)
  | 'parity' // cutover parity — 옛 배달 대상 vs 새 fan-out 대상 대조(C0)
  | 'chunk-parity'; // C5 청크 parity — 스트림 누적 vs 최종 메시지 대조(청크 유실 감지)

export interface SessionObservationEvent {
  sessionId: string;
  subsystem: SessionSubsystem;
  /** 이벤트명 — 'joined'|'left'|'delivered'|'failed'|'converted'|'fallback'|'granted'|'orphaned' 등. */
  event: string;
  /** 왜 이 이벤트인가 — comprehension-debt 방지(ops rationale·self-memory text 로도 흐른다). */
  rationale?: string;
  /** 관여 서피스(telegram/discord/pwa/cli/acp/voice). */
  surface?: string;
  /** 관여 구독자 키(`<surface>:<endpoint>`). */
  subscriberKey?: string;
  /** 상태 전이인가 — true 면 ops_events(elanous ops timeline)에도 기록. */
  stateful?: boolean;
  /** 0-10 현저성. >=SESSION_MEMORY_IMPORTANCE 면 self-memory ambient 로도 흐른다. */
  importance?: number;
  refs?: Record<string, unknown>;
}

/** 이 임계 이상이면 self-memory 주입 — 핸드오프·정합 같은 중대만(세션 이벤트는 잦아 노이즈 방지). */
export const SESSION_MEMORY_IMPORTANCE = 6;

/** 테스트/커스텀 주입용 sink seam — 미주입 시 실 배선. */
export interface SessionObservationSinks {
  logSink?: (category: string, event: string, data: unknown) => void;
  opsSink?: (input: Parameters<typeof recordOpsEventSafe>[0]) => void;
  memorySink?: (input: Parameters<typeof injectSelfMemory>[0]) => void;
}

/**
 * 단일 관측 관문 — 세션 생애 이벤트를 3박자에 팬아웃(각 sink 독립 fail-soft).
 * mission-observation.recordMissionObservation 자매.
 */
export function recordSessionObservation(
  evRaw: SessionObservationEvent,
  sinks: SessionObservationSinks = {},
): void {
  // ⭐ **이 이벤트가 어느 PTY 안에서 났나** — 관측 태깅이다.
  //   ⛔ **pty↔session 결속의 증명이 아니다**: 세션은 nexus 데몬이 소유하고 TUI 는 ACP 로 말하므로,
  //     **데몬이 내는 세션 이벤트에는 이 태그가 안 붙는다**(매뉴얼 §0a ⑶b · #5730 · 2026-08-01).
  //   ⇒ 관문에서 한 번만 얹는다 — 각 호출부가 기억할 일이 아니다(재발명·누락 방지).
  const ptyId = process.env.ELANOUS_PTY_ID?.trim();
  const ev = ptyId ? { ...evRaw, refs: { ...(evRaw.refs ?? {}), ptyId } } : evRaw;
  const importance = ev.importance ?? defaultImportance(ev.subsystem);
  const payload = {
    sessionId: ev.sessionId,
    ...(ev.surface ? { surface: ev.surface } : {}),
    ...(ev.subscriberKey ? { subscriberKey: ev.subscriberKey } : {}),
    ...(ev.rationale ? { rationale: ev.rationale } : {}),
    ...(ev.refs ? { refs: ev.refs } : {}),
  };

  // ① 로그(항상) — `elanous logs --category session.*` 로 조회 가능해짐.
  try {
    const logFn = sinks.logSink ?? ((c, e, d) => debug.log(c, e, d));
    logFn(`session.${ev.subsystem}`, ev.event, payload);
  } catch { /* fail-soft */ }

  // ② 자기인지(중대) — 봇이 "이 세션 누가·왜 넘어갔나" 회상 가능.
  if (importance >= SESSION_MEMORY_IMPORTANCE) {
    try {
      const memFn = sinks.memorySink ?? ((input) => { void injectSelfMemory(input).catch(() => {}); });
      memFn({
        tool: 'session',
        kind: 'session-observation',
        importance,
        summary: `[${ev.subsystem}:${ev.event}] ${ev.sessionId.slice(0, 8)}${ev.surface ? ` ·${ev.surface}` : ''}`,
        text: `${ev.rationale ?? ev.event}`.slice(0, 600),
        refs: { sessionId: ev.sessionId, subsystem: ev.subsystem, ...(ev.refs ?? {}) },
      });
    } catch { /* fail-soft */ }
  }

  // ③ 운영전이(상태성) — ops_events(elanous ops timeline).
  if (ev.stateful) {
    try {
      const opsFn = sinks.opsSink ?? recordOpsEventSafe;
      opsFn({
        entityType: 'session',
        entityId: ev.sessionId,
        event: 'status_change',
        actor: 'session',
        rationale: `[session:${ev.subsystem}] ${ev.rationale ?? ev.event}`.slice(0, 300),
        refs: { subsystem: ev.subsystem, event: ev.event, ...(ev.refs ?? {}) },
        importance,
      });
    } catch { /* fail-soft */ }
  }
}

/** subsystem 별 기본 현저성 — 핸드오프/정합은 중대(self-memory), fan-out/render 는 로그 위주. */
function defaultImportance(subsystem: SessionSubsystem): number {
  switch (subsystem) {
    case 'reconcile': return 7; // 고아 세션 정합 — 자기인지 부정합 확정
    case 'handoff': return 6; // 서피스 이동 — "왜 텔레그램으로 넘어갔나" 회상 대상
    case 'fork': return 5; // 세션 분기(참고)
    case 'presence': return 4; // presence 전이
    case 'subscribe': return 4; // 합류/이탈
    case 'input': return 3; // 턴 소유권 이전
    case 'search': return 3; // 검색(=기억 회상)
    case 'fanout': return 3; // 정상 fan-out 은 로그만(실패 시 호출자가 importance 상향)
    case 'render': return 2; // 표현 변환은 로그만
    default: return 3;
  }
}

/**
 * sessionId 를 바인딩한 관측기 — `observe({subsystem, event, ...})` 로 간결 호출.
 * makeMissionObserver 자매.
 */
export function makeSessionObserver(
  sessionId: string,
  sinks: SessionObservationSinks = {},
): (ev: Omit<SessionObservationEvent, 'sessionId'>) => void {
  return (ev) => recordSessionObservation({ sessionId, ...ev }, sinks);
}
