// ── 세션 입력 arbiter — 턴 소유권 (PLAN §P3·§4-2 대표 확정 · 2026-07-16) ────────────
//
// 대화 세션에 2+ 서피스가 동시 구독(P0~P2)하면 입력 경쟁이 생긴다. 대표 확정: **턴 소유권**
// — 한 번에 한 서피스가 턴을 홀드하고 나머지는 대기(+누가 어느 서피스에서 넣었나 attribution).
// Orca revision 낙관동시성(편집형)은 대화엔 과함. 기존 채널내부 락(discord/telegram-lock)
// 위의 **세션레벨 계층**.
//
// 런타임 ephemeral — 턴은 한 왕복 수명이라 영속 안 함(프로세스 로컬 Map). 데몬 재시작이 곧
// 턴 리셋(자연스러움). 실제 입력 경로(tg/dc/TUI 가 입력 前 acquireTurn)로의 배선은
// dogfood-gated 후속 — 본 모듈은 arbiter 로직 + 관측 + 교착 셀프힐이 본분.
//
// 제1원칙 heal(§P3): 소유권 교착(홀더가 안 놓음) → maxHold 초과 시 강제 해제 + 다음 승격.

import { recordSessionObservation } from './session-observation.js';

interface TurnState {
  /** 현재 턴 홀더(subscriberKey `<surface>:<endpoint>`). null = 자유. */
  holder: string | null;
  /** 대기열(FIFO·중복 없음). */
  queue: string[];
  /** 홀드 시각(ms) — 교착 셀프힐 판정. */
  heldAt: number | null;
}

const turns = new Map<string, TurnState>();

function stateOf(sessionId: string): TurnState {
  let s = turns.get(sessionId);
  if (!s) { s = { holder: null, queue: [], heldAt: null }; turns.set(sessionId, s); }
  return s;
}

export interface AcquireResult {
  /** 턴을 잡았나(true=지금 입력 가능) 아니면 대기열인가. */
  granted: boolean;
  /** 현재 홀더. */
  holder: string;
  /** granted=false 일 때 대기 위치(1-based). */
  position?: number;
}

/** 턴 획득 시도. 자유면 홀드(granted), 이미 내가 홀드면 멱등(granted), 남이 홀드면 대기열 등록. */
export function acquireTurn(sessionId: string, key: string, now: number = Date.now()): AcquireResult {
  const s = stateOf(sessionId);
  if (s.holder === null) {
    s.holder = key; s.heldAt = now;
    recordSessionObservation({ sessionId, subsystem: 'input', event: 'granted', subscriberKey: key, rationale: '턴 소유권 획득(자유)' });
    return { granted: true, holder: key };
  }
  if (s.holder === key) return { granted: true, holder: key }; // 멱등
  if (!s.queue.includes(key)) {
    s.queue.push(key);
    recordSessionObservation({ sessionId, subsystem: 'input', event: 'queued', subscriberKey: key, rationale: `턴 대기(홀더 ${s.holder})`, refs: { holder: s.holder, position: s.queue.length } });
  }
  return { granted: false, holder: s.holder, position: s.queue.indexOf(key) + 1 };
}

export interface ReleaseResult {
  released: boolean;
  /** 승격된 다음 홀더(대기열 있었으면) 또는 null(자유). */
  nextHolder: string | null;
}

/** 턴 해제. 내가 홀더면 다음 대기자 승격. 대기열에만 있으면 대기 취소. */
export function releaseTurn(sessionId: string, key: string, now: number = Date.now()): ReleaseResult {
  const s = stateOf(sessionId);
  if (s.holder !== key) {
    // 대기열에서 이탈(입력 포기).
    const qi = s.queue.indexOf(key);
    if (qi >= 0) { s.queue.splice(qi, 1); return { released: false, nextHolder: s.holder }; }
    return { released: false, nextHolder: s.holder };
  }
  const next = s.queue.shift() ?? null;
  s.holder = next; s.heldAt = next ? now : null;
  recordSessionObservation({
    sessionId, subsystem: 'input', event: next ? 'transferred' : 'released', subscriberKey: key,
    rationale: next ? `턴 이전 → ${next}` : '턴 해제(자유)', refs: next ? { to: next } : undefined,
  });
  return { released: true, nextHolder: next };
}

/** 현재 턴 홀더(없으면 null) — attribution "누가 입력 중". */
export function currentTurnHolder(sessionId: string): string | null {
  return turns.get(sessionId)?.holder ?? null;
}

/** 대기열 스냅샷(진단·PWA presence 카드). */
export function turnQueue(sessionId: string): string[] {
  return [...(turns.get(sessionId)?.queue ?? [])];
}

/** 교착 셀프힐(§P3) — 홀더가 maxHoldMs 초과 홀드 시 강제 해제 + 다음 승격. 반환=강제해제됐나. */
export function reconcileTurn(
  sessionId: string, opts: { maxHoldMs?: number; now?: number } = {},
): { forced: boolean; nextHolder: string | null } {
  const s = turns.get(sessionId);
  const maxHold = opts.maxHoldMs ?? 2 * 60_000;
  const now = opts.now ?? Date.now();
  if (!s || s.holder === null || s.heldAt === null) return { forced: false, nextHolder: s?.holder ?? null };
  if (now - s.heldAt <= maxHold) return { forced: false, nextHolder: s.holder };
  const stale = s.holder;
  const heldMs = now - s.heldAt;
  const next = s.queue.shift() ?? null;
  s.holder = next; s.heldAt = next ? now : null;
  recordSessionObservation({
    sessionId, subsystem: 'input', event: 'forced-release', subscriberKey: stale,
    rationale: `턴 교착 강제해제(홀드 ${Math.round(heldMs / 1000)}s > ${Math.round(maxHold / 1000)}s) → ${next ?? '자유'}`,
    stateful: true, importance: 5, refs: { stale, to: next, heldMs },
  });
  return { forced: true, nextHolder: next };
}

/** 테스트 seam — 턴 상태 초기화. */
export function _clearTurnsForTest(): void {
  turns.clear();
}
