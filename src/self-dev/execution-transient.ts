// ── 실행 축의 「이 실패가 일시적인가」 판정자 (2026-08-19) ──────────────────
//
// ⛔⭐ **왜 «또» 만드나 — 공통 모듈을 찾다가 「어휘가 다르다」를 재서 알았다.**
//   이미 `session-runtime/retry-policy.ts` 의 `classifyError` 가 같은 질문에 답한다.
//   그런데 그 자가 아는 세계는 **LLM 툴 루프**다 — context window · quota · rate limit ·
//   safety filter · tool-not-found. 실행 축(git · worktree · 파일 락)의 어휘는 **하나도 없다**.
//
//   📏 2026-08-19 실측 — 북극성 조각 ③의 실물 에러를 그 자에게 물었더니:
//     "git worktree base sync failed … cannot lock ref 'refs/remotes/origin/main'"
//       → classifyError = 'network-transient' → decideRetry = retry   ✅ 결론은 옳다
//     그런데 **옳은 이유가 틀렸다** — 메시지에 우연히 `fetch failed` 가 섞여 있었을 뿐이고,
//     같은 병의 순수한 판본은 «모른다»고 답한다:
//       "fatal: Unable to create '/r/.git/index.lock': File exists."  → 'unknown' → **abort**
//   ⇒ 📌 ***우연히 맞는 판정자는 「맞는 판정자」가 아니다.*** 그래서 실행 축 어휘를 여기 둔다.
//
// ⛔ 그렇다고 재발명하지 않는다 — 이 모듈은 **`classifyError` 를 «먼저» 물어보고**,
//   그 자가 「모른다(unknown)」고 할 때만 실행 축 어휘로 판정한다. LLM 축의 판단이 이긴다.
//
// 🔑 무엇이 걸린 판정인가: 이 값이 참이면 런 슈퍼바이저가 **그 조각을 그대로 다시 건다**.
//   거짓이면 사람에게 간다. ⇒ ⛔ **틀리는 방향이 비대칭이다** —
//   ⓐ 일시적인데 「아니다」라고 하면 → 사람이 손으로 다시 건다(느리지만 안전)
//   ⓑ 영구 결손인데 「일시적」이라고 하면 → **같은 실패를 무한히 반복한다**(자원을 태운다)
//   ⇒ 그래서 어휘는 **좁게** 유지한다. 애매하면 거짓이다. 상한은 호출자가 따로 건다.

import { classifyError } from '../session-runtime/retry-policy.js';

/** 실행 축에서 「다시 하면 대개 풀리는」 실패의 어휘. ⛔ 좁게 유지한다(위 비대칭). */
const TRANSIENT_EXECUTION_PATTERNS: readonly string[] = [
  // git ref/index 락 경합 — 형제 프로세스가 같은 ref 를 동시에 갱신할 때.
  // 📏 북극성 조각 ③이 이것으로 죽었고 하류 둘을 함께 데려갔다(2026-08-19).
  'cannot lock ref',
  'unable to create',        // "Unable to create '<path>/index.lock': File exists"
  'index.lock',
  'another git process',     // "Another git process seems to be running in this repository"
  'ref is at',               // "is at <sha> but expected <sha>" — 경합의 다른 문면
  // 파일시스템 일시 자원 부족
  'resource temporarily unavailable',
  'eagain',
  'ebusy',
];

export interface TransientExecutionObservation {
  readonly transient: boolean;
}

/**
 * 순수: 실행 축 실패가 「다시 걸면 대개 풀리는」 것인가를 관측값으로 분류한다.
 *
 * ⛔ LLM 축(`classifyError`)을 «먼저» 묻는다 — 그 자가 아는 병이면 그 판정을 쓴다(재발명 0).
 *   그 자가 `unknown` 이라고 할 때만 실행 축 어휘로 본다.
 *
 * ⛔ `quota-exceeded` 는 일시적이 «아니다» — 시간이 지나야 풀리고 다시 걸면 그냥 또 실패한다.
 *   `rate-limit`·`overloaded` 도 여기선 거짓으로 둔다: 조각 재실행은 «분 단위»가 아니라
 *   «십분 단위» 비용이라, 백오프로 푸는 LLM 축과 계산이 다르다.
 */
export function classifyTransientExecutionFailure(
  message: string,
  code?: string,
): TransientExecutionObservation {
  const text = `${message ?? ''}`.toLowerCase();
  if (!text.trim()) return { transient: false };

  // ⭐ LLM 축이 아는 병이면 그 판정이 이긴다.
  const known = classifyError(new Error(message));
  if (known === 'network-transient') return { transient: true };
  if (known !== 'unknown') return { transient: false }; // quota·rate-limit·safety 등 — 다시 걸어도 같다

  if (code && code.toLowerCase().includes('dep_failed')) return { transient: false }; // 상류 실패는 다른 칸
  return { transient: TRANSIENT_EXECUTION_PATTERNS.some((p) => text.includes(p)) };
}

/** 기존 실행 경로의 boolean 계약을 유지하는 관측 classifier 호출자. */
export function isTransientExecutionFailure(message: string, code?: string): boolean {
  return classifyTransientExecutionFailure(message, code).transient;
}
