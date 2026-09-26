// ── 세션별 «턴 중 대기 발화» 레지스트리 ────────────────────────────────────
//
// 🚨 무엇을 푸는가 (대표 지시 ②)
//   대표: *"큐잉된게 «설계된 타이밍»에 들어가서 인터럽트 비슷한게 걸리면서 기존 작업을 트리아지"*
//
// ⛔ 왜 클로저가 아니라 «레지스트리»인가 — 라이브 실측(2026-08-19):
//   TUI 의 큐는 대시보드에, 에이전트 루프는 ACP «서버» 쪽 `runCoreTurn` 에 있다.
//   ⭐ 둘은 ***같은 프로세스***다(로그 스토어가 같다: `llm.router` 와 `chat-main.plain-turn`
//     둘 다 `test:elanous-drive-Og2Z6M`) — 그러나 «RPC 경계»가 사이에 있어 클로저를 못 넘긴다.
//   ⇒ 그래서 «세션 id 로 만나는» 자리를 하나 둔다.
//
// ⚠️ 한계(정직하게): 이것은 ***같은 프로세스*** 전제다. 데몬이 다른 프로세스인 구성에서는
//   ACP 에 진짜 `steer` 메서드가 필요하다(`clientSessionSteer` 가 이미 있으나 elanous 자체
//   backend 는 `steer()` 를 «구현하지 않는다» — 호출자도 0이다). 그 확장은 별건이다.

import { debug } from '../debug/log.js';

interface PendingBucket {
  items: string[];
  /** 배수될 때 «원본 큐»도 비우라고 알린다 — 안 그러면 같은 발화가 턴 끝에 «또» 나간다. */
  onDrained?: (drained: readonly string[]) => void;
}

const buckets = new Map<string, PendingBucket>();

/** 이 세션의 도는 턴에 끼워 넣을 발화를 쌓는다. */
export function enqueuePendingUserInput(
  sessionId: string,
  text: string,
  onDrained?: (drained: readonly string[]) => void,
): void {
  const trimmed = text.trim();
  if (!sessionId || trimmed.length === 0) return;
  const bucket = buckets.get(sessionId) ?? { items: [] };
  bucket.items.push(trimmed);
  if (onDrained) bucket.onDrained = onDrained;
  buckets.set(sessionId, bucket);
  debug.log('llm.interjection', 'enqueued', { sessionId, queued: bucket.items.length });
}

/**
 * ★ 쌓인 발화를 «비우면서» 낸다. 루프 경계에서 불린다.
 * ⛔ 비우는 것이 계약이다 — 안 비우면 매 바퀴 같은 발화가 다시 들어간다.
 */
export function drainPendingUserInput(sessionId: string): string[] {
  const bucket = buckets.get(sessionId);
  if (!bucket || bucket.items.length === 0) return [];
  const drained = bucket.items;
  bucket.items = [];
  try { bucket.onDrained?.(drained); } catch { /* 통지 실패가 배수를 막지 않는다 */ }
  return drained;
}

/** 지금 이 세션에 대기 중인 수(관측·표시용). 비우지 «않는다». */
export function pendingUserInputCount(sessionId: string): number {
  return buckets.get(sessionId)?.items.length ?? 0;
}

/**
 * 턴/세션이 끝나면 버린다 — 남겨 두면 다음 턴에 «유령 발화»가 들어간다.
 * promotedInput 이 있으면 정식 프롬프트로 승격된 그 발화 하나만 떨어낸다.
 * 부분 삭제는 소비자 배수가 아니므로 bucket 과 onDrained 콜백을 보존하고 콜백을 호출하지 않는다.
 */
export function clearPendingUserInput(sessionId: string, promotedInput?: string): void {
  if (promotedInput === undefined) {
    buckets.delete(sessionId);
    return;
  }

  const bucket = buckets.get(sessionId);
  if (!bucket) return;

  const matchIndex = bucket.items.indexOf(promotedInput);
  if (matchIndex === -1) return;
  bucket.items.splice(matchIndex, 1);
}
