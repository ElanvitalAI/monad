/**
 * ⌨️ **타이핑 판정 — 「이 칸에 이 글을 쳐도 되나」**
 *
 * 하니스의 세 번째 브라우저 조작 판정기.
 * 경계(`decideActionBoundary`) · 되돌림(`decideReversibility`) 옆에 둔다.
 *
 * ⛔ 이 모듈은 **판정만** 한다. 키 이벤트를 보내지 않고, 제출하지 않고,
 *    CLI 표면(`harness browser-type`)을 이 판에서 열지 않는다.
 *    실행은 별개 판이다 — 글을 쳐도 제출하지 않으면 아무 데도 안 남고,
 *    제출은 `decideReversibility` 가 이미 막는다.
 *
 * 판정 로직은 `src/harness/bot-type-request.ts` 의 `judgeTypeRequest` 를 재사용한다(봇랩 `bot-type.ts` 와 같은 판정기).
 * ⛔ 로직을 복제하지 않는다.
 */

import { judgeTypeRequest, type TypeTarget } from './bot-type-request.js';

export type { TypeTarget };

export type TypeActionDecision = {
  allowed: boolean;
  reason: string;
};

export function decideTypeAction(params: {
  readonly url: string;
  readonly selector: string;
  readonly text: string;
  readonly actionHosts: readonly string[];
  readonly armed: boolean;
  readonly target: TypeTarget | null;
  readonly maxChars?: number;
}): TypeActionDecision {
  const verdict = judgeTypeRequest(params);
  return { allowed: verdict.allowed, reason: verdict.reason };
}
