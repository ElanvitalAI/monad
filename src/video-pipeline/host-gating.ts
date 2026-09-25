/**
 * ⛔⭐⭐ ***긍정과 부정이 «같은 무게가 아니다».***
 *
 * 골 `ASK-installed-and-usable-right-now-are-different-values-2026-09-22` 가 못 박았다:
 * > *「벤더 로그가 connected 라 말한다」와 「포트가 열려 있다」는 ***같은 종류의 증거***다 —
 * >  둘 다 «다른 무언가가 그렇게 보인다»일 뿐 «그것이 내 요청에 답한다»가 아니다.*
 * > ***reachable 의 긍정은 언제나 «프로토콜 왕복»이다. 관측은 «부정에만» 싸게 쓴다.***
 *
 * ⇒ 그래서 이 문은 ***한 방향으로만 연다***:
 *   - `disconnected`(벤더가 «명시적으로» 아니라고 답했다) ⇒ 후보에서 «뺀다»
 *   - 그 밖 전부(`unmeasured`·`no-field`·`not-asked`·`no-host-key`·`connected`) ⇒ ***안 뺀다***
 *
 * ⛔ 「못 쟀다」를 「없다」로 접지 않는다. 접으면 서버가 잠깐 느린 날 전 스택이 사라진다.
 */
export type HostState =
  | 'not-asked' | 'no-host-key' | 'unmeasured' | 'no-field' | 'connected' | 'disconnected';

/** ⛔ 이 술어가 «유일한» 배제 근거다 — 호출부가 조건을 다시 쓰면 교리가 갈린다. */
export function isDefinitelyDown(state: HostState): boolean {
  return state === 'disconnected';
}

/**
 * 후보에서 「명시적으로 안 붙은 것」만 걷어 낸다.
 * @returns `kept` 와 `dropped` — ⛔ 뺀 것을 «돌려준다». 조용히 빼면 「원래 없었다」와 구별이 안 된다.
 */
export function gateByHost<T>(
  impls: readonly T[],
  stateOf: (impl: T) => HostState,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const i of impls) (isDefinitelyDown(stateOf(i)) ? dropped : kept).push(i);
  return { kept, dropped };
}

/**
 * ⛔⭐ 상태 → 사람이 읽는 한 줄. ***교리와 «같은 파일»에 둔다*** — 갈라 두면 문면만 과해진다.
 *
 * 🩸 #19814 에서 `connected` 를 «✅앱 붙어 있다 (실측)» 이라 찍었다. 벤더 보고를 ***왕복으로 승격***한 것이다.
 *   ⇒ 긍정은 「벤더가 그렇게 «답했다»」까지만 말한다. 부정은 그대로 쓴다(부정은 싸게 믿어도 된다).
 *
 * ⛔ 「못 쟀다」가 «셋»인 이유: 고치는 자리가 전부 다르다(선언 · 서버·망 · 키 이름).
 *   한 칸으로 접으면 처방이 안 나온다.
 */
export function hostLabel(state: HostState, hostKey?: string): string {
  switch (state) {
    case 'not-asked':    return '앱 «미확인» (--verify-hosts 로 물어본다)';
    case 'no-host-key':  return '앱 «못 쟀다» — 이 선언에 hostKey 가 없다';
    case 'unmeasured':   return '앱 «못 쟀다» — 호스트 상태를 물었으나 답을 못 얻었다';
    case 'no-field':     return `앱 «못 쟀다» — 응답에 '${hostKey ?? '?'}' 칸이 없다`;
    case 'connected':    return '벤더가 connected 라 «답했다» — ⛔ «왕복»은 아니다(실제 도구를 한 번 불러야 확정)';
    case 'disconnected': return '앱이 «안 붙었다» (벤더 보고) — 이 구현은 지금 못 쓴다';
  }
}
