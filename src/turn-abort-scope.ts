// ── 턴 취소의 «범위» — 「턴을 멈춘다」와 「자식을 죽인다」를 가른다 ────────────────────
//
// 🚨 왜 이 모듈이 있나 (2026-08-19 · 대표 지시)
//   ⛔ 종전엔 신호가 «하나»였다. 턴의 `AbortController` 를 취소하면 LLM 스트림도 멎고,
//     툴 루프도 멎고, ***하니스 자식 goal-loop PTY 와 서브에이전트도 함께 죽었다***.
//     (`self-implement.ts` 의 `signal: ctx.signal` — `#21` 이 «의도»로 그렇게 배선했다.)
//   ⇒ 그래서 사용자가 스트리밍을 멈추려고 ESC 를 누르면 ***몇 십 분짜리 하니스 런이 같이 사라졌다.***
//
// 대표 *"ESC 에 하니스 자식이라던지 sub agent 를 죽이는 일이 없도록 해주세요."*
// 대표 *"최소 hitl 로 방어를 해야 합니다."*
//   ⇒ 📌 그래서 방어를 «확인창»이 아니라 ***「범위」***로 둔다. 물어서 막는 것이 아니라
//     ***닿지 못하게*** 만든다. ref codex 가 `cancellation_token.child_token()` 으로 하는 것과 같은 축이다.
//
// ⛔⭐ 하위호환 규칙 — ***뜻이 «없는» 취소는 종전대로 자식까지 죽인다.***
//   이 모듈을 안 거치는 기존 경로(`/cancel` 포함)의 계약을 바꾸지 않기 위해서다.
//   바뀌는 것은 ***「turn-only 라고 «명시»한 취소」가 자식에 안 내려간다***는 것 하나뿐이다.

/** 취소가 «무엇까지» 끄려는가. */
export type TurnAbortScope =
  /** 도는 턴만 — 자식(하니스 런·서브에이전트)은 계속 산다. ESC 가 이것이다. */
  | 'turn-only'
  /** 턴과 자식을 함께. `/cancel` 같은 «명시 명령»이 이것이다. */
  | 'kill-children';

/** `AbortController.abort(reason)` 에 실리는 값. 문자열이라 프로세스·직렬화 경계를 넘어도 산다. */
export const TURN_ABORT_TURN_ONLY = 'elanous:turn-abort/turn-only' as const;
export const TURN_ABORT_KILL_CHILDREN = 'elanous:turn-abort/kill-children' as const;

/** 턴만 멈춘다 — 자식은 살려 둔다. */
export function abortTurnOnly(controller: AbortController): void {
  controller.abort(TURN_ABORT_TURN_ONLY);
}

/** 턴을 멈추고 자식도 죽인다. */
export function abortAndKillChildren(controller: AbortController): void {
  controller.abort(TURN_ABORT_KILL_CHILDREN);
}

/**
 * 이 신호의 취소가 «어떤 범위»였나.
 *
 * ⛔⭐ 뜻이 실리지 않은 취소는 `'kill-children'` 이다 — ***모르는 것을 「살려 둔다」로 읽지 않는다.***
 *   이 기본값이 하위호환을 만든다: 이 모듈을 안 쓰는 모든 기존 취소 경로가 종전 동작을 유지한다.
 */
export function turnAbortScope(signal: Pick<AbortSignal, 'reason'>): TurnAbortScope {
  return signal.reason === TURN_ABORT_TURN_ONLY ? 'turn-only' : 'kill-children';
}

/** 이 취소가 자식을 죽여야 하는가. */
export function abortShouldKillChildren(signal: Pick<AbortSignal, 'aborted' | 'reason'>): boolean {
  return signal.aborted && turnAbortScope(signal) === 'kill-children';
}

/**
 * ★ ***자식 수명 신호*** — 부모가 `kill-children` 뜻으로 취소했을 때 «만» 함께 취소된다.
 *
 * ⭐ 이것이 이 모듈의 본체다. 자식을 띄우는 자리에서 `ctx.signal` 대신 이 값을 넘기면,
 *   ***ESC(turn-only)는 자식에 «구조적으로» 닿지 못한다.*** 자식 쪽 코드가 뜻을 검사할 필요가 없다.
 *
 * ⚠️ 부모가 없으면 `undefined` 를 낸다 — 호출부가 「신호 없음」을 그대로 전달할 수 있게(기존 관용구 보존).
 * ⚠️ 부모가 «이미» 취소된 채로 들어오면 그 뜻을 그대로 반영한다(경합 창 없음).
 */
export function childLifetimeSignal(parent?: AbortSignal): AbortSignal | undefined {
  if (!parent) return undefined;
  const child = new AbortController();
  if (parent.aborted) {
    if (abortShouldKillChildren(parent)) child.abort(parent.reason);
    return child.signal;
  }
  parent.addEventListener('abort', () => {
    if (abortShouldKillChildren(parent)) child.abort(parent.reason);
  }, { once: true });
  return child.signal;
}
