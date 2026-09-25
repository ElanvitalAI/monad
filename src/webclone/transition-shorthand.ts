/**
 * transition-shorthand.ts — ***`transition` 한 줄을 길이·곡선·대상으로 «가른다»***.
 *
 * ⭐ 왜 따로 있나 — `state-motion.ts` 는 CSSOM 이 «이미 갈라 준» 롱핸드
 *    (`transition-duration` 등)를 읽는다. 그런데 ***`transition: var(--x)` 는 CSSOM 이 안 갈라 준다***.
 *    변수를 «푼 뒤»에는 우리가 직접 갈라야 한다. 그 자를 여기 둔다 —
 *    ⛔ 페이지 «안»이 아니라 «밖»에 두는 이유: ***표현식 문자열 안의 코드는 시험할 수 없다***.
 *
 * ⛔⭐ 이 자가 «못 하는 것»을 먼저 적는다:
 *    - `transition: all var(--a) var(--b)` 처럼 «부분»만 변수면 푼 뒤 문자열로 들어온다 — 그건 된다.
 *    - 그러나 ***값의 «순서»가 CSS 사양대로 「첫 시간 = 길이, 둘째 시간 = 지연」***이라는 것에 기댄다.
 *      한 칸에 시간이 셋 이상이면 셋째부터는 «대상»으로 새어 나간다(사양상 없는 문면).
 */

/** 사양이 정한 곡선 키워드. ⛔ 이름으로 치지 말고 «값»으로 친다. */
export const EASING_KEYWORDS: readonly string[] = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
];

/** 곡선 «함수». `cubic-bezier(…)` · `steps(…)` · `linear(…)`(CSS Easing L2) */
const EASING_FUNCTIONS = /^(cubic-bezier|steps|linear)\(/i;

const TIME = /^-?[\d.]+m?s$/i;

export interface TransitionParts {
  readonly durations: readonly string[];
  readonly easings: readonly string[];
  readonly properties: readonly string[];
  /** ⛔ 풀리지 않은 `var(` 가 남아 있는 칸 수. 0 이 아니면 위 셋은 «부분»이다. */
  readonly unresolved: number;
}

/** 괄호 깊이를 세며 자른다 — `cubic-bezier(0.4, 0, 0.2, 1)` 의 쉼표는 «구분자가 아니다». */
export function splitTopLevel(text: string, separator: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const isSep = depth === 0 && (separator === ',' ? ch === ',' : /\s/.test(ch));
    if (isSep) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * `color 0.2s cubic-bezier(0.4,0,0.2,1) 50ms, transform 300ms ease-out` 를 가른다.
 * ⛔ 「없는 칸」은 «만들어 넣지 않는다» — 곡선을 안 적었으면 `ease` 를 «넣지 않는다»(사양 기본값이지만
 *    그것은 «관측»이 아니라 «추론»이고, 이 저장소는 둘을 가른다).
 */
export function parseTransitionShorthand(text: string): TransitionParts {
  const durations: string[] = [];
  const easings: string[] = [];
  const properties: string[] = [];
  let unresolved = 0;
  for (const part of splitTopLevel(text, ',')) {
    if (part.includes('var(')) {
      unresolved += 1;
      continue;
    }
    let timesSeen = 0;
    for (const token of splitTopLevel(part, ' ')) {
      if (TIME.test(token)) {
        timesSeen += 1;
        // 사양: 첫 시간이 길이, 둘째가 «지연». 지연은 이 축이 재는 값이 아니다.
        if (timesSeen === 1) durations.push(token);
        continue;
      }
      if (EASING_FUNCTIONS.test(token) || EASING_KEYWORDS.includes(token.toLowerCase())) {
        easings.push(token);
        continue;
      }
      properties.push(token);
    }
  }
  return { durations, easings, properties, unresolved };
}

/** `animation` 단축형에서 «이름 아닌 것»들. ⛔ 이름으로 치지 말고 «모양»으로 친다. */
const ANIMATION_KEYWORDS = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
  'running', 'paused', 'forwards', 'backwards', 'both', 'initial', 'inherit', 'unset', 'revert',
]);

/**
 * `animation: spin 1s linear infinite` 에서 ***이름만*** 고른다.
 *
 * ⛔⭐ 2026-09-10 실측 — ***단축형에 `var()` 가 있으면 CSSOM 이 `animation-name` 을 «안 준다».***
 *    그래서 `animation: notification-show 320ms var(--ease-1) both` 로 걸린 움직임이
 *    ***「아무도 안 쓴다」로 보였다*** — 「정의만 됐다」와 구별이 안 된다.
 * ⇒ 변수를 «푼 뒤» 이 자로 이름을 집는다.
 *
 * ⛔ 이 자가 «못 하는 것»: 이름이 시간·키워드처럼 «생긴» 경우(`@keyframes infinite`)는 못 가른다.
 *    사양이 그런 이름을 막지 않지만, 실무에서 쓰면 브라우저도 헷갈린다.
 */
export function parseAnimationNames(text: string): string[] {
  const out: string[] = [];
  for (const part of splitTopLevel(text, ',')) {
    if (part.includes('var(')) continue;   // ⛔ 안 풀렸으면 «이름을 지어내지» 않는다
    for (const token of splitTopLevel(part, ' ')) {
      const lower = token.toLowerCase();
      if (TIME.test(token)) continue;
      if (ANIMATION_KEYWORDS.has(lower)) continue;
      if (EASING_FUNCTIONS.test(token) || EASING_KEYWORDS.includes(lower)) continue;
      if (/^-?[\d.]+$/.test(token)) continue;   // 반복 횟수
      out.push(token);
      break;                                    // 사양상 이름은 칸마다 «하나»
    }
  }
  return out;
}
