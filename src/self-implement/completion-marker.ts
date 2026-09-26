// ── 자식 goal-loop 완료 선언 판정(순수) ──────────────────────────────────────
//
// ⚠️ 실측 결함(2026-07-27 · run-16161538 · run-6572db2c) — **같은 질문에 두 규칙이 답했다.**
//   `headless-elanous-driver` 의 poll 루프는 `snap.includes('GOAL-COMPLETE')` 로 대기를 **끊고**,
//   같은 함수의 결과 회계는 `/^\s*GOAL-COMPLETE\s*$/m` 로 **완료가 아니라**고 적었다.
//   ⇒ *끊어놓고 미완으로 기록하는* 상태가 구조적으로 가능하다. 실측이 정확히 그 상태였다
//     (`timedOut:false` ⊕ `reachedCompletion:false` ⊕ 자식은 살아 있음).
//
// ⭐ **자기 참조 함정** — elanous 가 elanous 를 개발하면 자식은 **이 마커가 박힌 소스를 읽는다**.
//   부분일치는 소스·grep 결과·산문 속 마커를 완료 선언으로 오인한다. 실측에서 자식이
//   *"…미검증·불완전 상태이며 GOAL-COMPLETE 를 선언(하지 않겠다)"* 이라고 **말한 문장** 때문에
//   부모가 완료로 끊었다 — **완료를 부정하는 문장이 완료 판정을 만들었다.**
//   ⇒ 이 결함은 자기 자신을 고치려는 self-dev 런까지 죽인다(수리 골이 마커를 언급할 수밖에 없다).
//
// ⇒ 완료 선언은 **한 줄이 통째로 마커일 때만** 인정한다. 판정은 이 파일 하나가 소유한다.

/** 자식 goal-loop 이 완료를 선언할 때 단독 줄로 출력하는 마커. */
export const COMPLETION_MARKER = 'GOAL-COMPLETE';

/** ⚠️ 실화면을 견디는 앞뒤 여백 — 터미널 우측 패딩 공백·CR·ANSI 제거 후 잔여 공백·NBSP.
 *  너무 조이면 **진짜 완료를 놓쳐** 자식이 max-wait 까지 헛돈다(반대 방향 손해가 더 크다).
 *
 *  ⭐ 마커 문자열은 `COMPLETION_MARKER` **한 곳에서만** 온다(리뷰 should-fix) — 상수와 정규식에
 *  각각 하드코딩하면 둘이 어긋나도 **깨지는 테스트가 없다**(조용한 드리프트).
 *  `\s` 는 NBSP(U+00A0)를 포함하지 않으므로 명시적으로 더한다. */
const MARKER_LINE = new RegExp(`^[\\s\\u00a0]*${COMPLETION_MARKER}[\\s\\u00a0]*$`);

/**
 * 완료 선언을 만든 줄을 돌려준다(없으면 undefined).
 *
 * ⭐ boolean 이 아니라 **줄**을 돌려주는 이유 — 끊은 근거를 관측에 실을 수 있어야 한다.
 * 오탐이 재발하면 *"무엇을 마커로 오인했나"* 가 로그 한 줄로 드러난다. 지금은 그걸 알려면
 * 이미 사라진 PTY 화면을 복원해야 했다.
 */
export function findCompletionMarkerLine(screen: string): string | undefined {
  // 값싼 사전 컷 — 대부분의 tick 은 마커를 아예 담지 않는다(poll 은 초당 1회 전 화면을 훑는다).
  if (!screen.includes(COMPLETION_MARKER)) return undefined;
  for (const line of screen.split(/\r?\n/)) {
    if (MARKER_LINE.test(line)) return line;
  }
  return undefined;
}

/** 화면/트랜스크립트에 자식의 완료 **선언**이 있나. 언급(산문·소스)은 선언이 아니다. */
export function hasCompletionMarker(screen: string): boolean {
  return findCompletionMarkerLine(screen) !== undefined;
}

/**
 * ⭐ 재발 감지용 — 마커를 **담고는 있는데 선언은 아닌** 화면인가.
 *
 * 이 결함의 서명이 정확히 이것이다(부분일치 참 · 라인일치 거짓). 값이 참인 채로 루프가 끊기면
 * 부분일치 규칙이 어딘가에 되살아난 것이다. 판정에는 쓰지 않고 관측에만 쓴다.
 */
export function mentionsMarkerWithoutDeclaring(screen: string): boolean {
  return screen.includes(COMPLETION_MARKER) && findCompletionMarkerLine(screen) === undefined;
}
