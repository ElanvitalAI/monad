/**
 * ⚖️ **「되돌리기」가 «없다» — 그러면 «무엇을 누르나»를 좁힌다.**
 *
 * 📌 대표 이 2026-08-28 에 「쓴다」를 승인했다. 그런데 이 축에는 ***되돌리기 장치가 없다*** —
 *    잘못 누른 폼 제출·구매·전송을 되돌리는 길이 «없다».
 *    ⇒ 🔑 그러므로 «막을 수 있는 것»은 되돌리기가 아니라 ***「무엇을 누를 수 있나」***다.
 *
 * ⛔⭐ **낱말로 판정하지 않는다.** 「구매」·「Submit」 같은 문자열 짐작은
 *    ⓐ 언어마다 다르고 ⓑ 틀렸을 때 ***「막았다」는 «거짓 안심»***을 준다.
 *    ⇒ ✅ 대신 ***DOM 구조***로 가른다 — 폼 안인가 · 버튼인가 · 앵커인가.
 *
 * ⚠️ 그리고 이것은 ***「안전하다」를 보장하지 않는다.*** 이동조차 부작용을 낼 수 있다(GET 으로 지우는 사이트).
 *    이 장치가 하는 것은 ***「가장 흔한 되돌릴 수 없는 것을 «구조로» 거른다」***뿐이고, 그 한계를 여기 적는다.
 */

/** ⛔ 이름을 «행동»으로 짓는다 — 'button' 같은 태그 이름이 아니라 「무엇을 일으키나」로. */
export type ClickKind =
  /** `<a href>` — 이동을 일으킨다. 이 축이 «허용»하는 유일한 종류다. */
  | 'navigation'
  /** 폼 안이거나 버튼이다 — ***제출·전송·구매일 수 있다***. 되돌릴 길이 없다. */
  | 'submit'
  /** 앵커도 버튼도 아니다 — 무엇을 일으킬지 «모른다». */
  | 'other';

export type ReversibilityPolicy =
  /** 무인 경로의 기본 — 이동만 누른다. */
  | 'navigation-only'
  /** 사람이 «그 한 번»을 명시로 연 경우. ⛔ 무인 루틴이 이것을 쓰면 안 된다. */
  | 'any';

export type ReversibilityDecision =
  | { allowed: true; kind: ClickKind; detail: string }
  | { allowed: false; kind: ClickKind; detail: string };

/**
 * 클릭 «전»에 정한다. ⛔ 누른 «뒤»에 판정하면 그것은 판정이 아니라 «기록»이다.
 *
 * ⛔ `kind` 를 «못 읽었으면»(undefined) 거부한다 — 「모른다」를 「괜찮다」로 읽지 않는다.
 */
export function decideReversibility(params: {
  kind: ClickKind | undefined;
  policy: ReversibilityPolicy;
}): ReversibilityDecision {
  const { kind, policy } = params;
  if (kind === undefined) {
    return { allowed: false, kind: 'other', detail: '클릭 «종류»를 못 읽었다 — 「모른다」를 「괜찮다」로 읽지 않는다' };
  }
  if (policy === 'any') {
    return { allowed: true, kind, detail: `정책이 «any» 다 — ${kind} 를 누른다(사람이 그 한 번을 열었다)` };
  }
  if (kind === 'navigation') {
    return { allowed: true, kind, detail: '이동(<a href>)이다 — 되돌릴 수 없는 제출이 아니다' };
  }
  return {
    allowed: false,
    kind,
    detail: kind === 'submit'
      ? '⛔ 폼 안이거나 버튼이다 — ***제출·전송·구매일 수 있고 되돌릴 길이 «없다»***. 사람이 열려면 --allow any'
      : '⛔ 앵커도 버튼도 아니라 «무엇을 일으킬지 모른다» — 무인 경로는 이동만 누른다. 사람이 열려면 --allow any',
  };
}

/**
 * 브라우저 «안»에서 종류를 정하는 표현식 조각.
 * ⛔ 이 문자열은 `clickExpression` 안에 끼워 넣는다 — 별도 왕복을 «안 만든다».
 */
export const CLICK_KIND_EXPRESSION = `(() => {
    // ⛔ 폼 «안»이면 앵커라도 제출로 본다 — <a> 가 폼을 submit 하는 사이트가 있다.
    if (element.closest('form')) return 'submit';
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'submit';
    if (tag === 'input') {
      const type = (element.getAttribute('type') || '').toLowerCase();
      return (type === 'submit' || type === 'button' || type === 'image') ? 'submit' : 'other';
    }
    // ⛔ href «없는» <a> 는 이동이 아니다 — 자바스크립트 핸들러다.
    if (tag === 'a' && element.hasAttribute('href')) {
      const href = element.getAttribute('href') || '';
      // ⛔ javascript: 는 이동이 아니라 «실행»이다.
      if (/^\\s*javascript:/i.test(href)) return 'other';
      return 'navigation';
    }
    if (element.getAttribute('role') === 'button') return 'submit';
    return 'other';
  })()`;
