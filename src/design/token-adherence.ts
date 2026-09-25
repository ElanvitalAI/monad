/**
 * token-adherence.ts — ***「내가 «선언한» 토큰을 화면이 «쓰나»」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-11 🅕): ***conform 일곱 축이 «전부 한 방향»이었다.***
 * ```ts
 *   colors.filter(token => !actual.has(token))    // 씨앗 토큰 중 페이지가 «안 쓴» 것
 *   seedSteps.filter(s => !pageValues.has(s.px))  // 씨앗 간격 중 페이지가 «안 쓴» 것
 * ```
 * ⇒ 그것은 ***재현율(recall)***이다. ⛔ ***「토큰을 다 쓰고 «그 밖에 아무거나 더» 썼다」도 만점***이다.
 *    📏 실측: 자작 13개가 `conform 7/7` 인데, ***그중 11개가 토큰 «밖» 색을 칠하고 있었다.***
 *
 * ⇒ 이 자가 «반대 방향»(정밀도)을 잰다 — ***화면이 칠한 값 중 토큰에서 «안 온» 것***.
 *
 * ⭐⭐ 그리고 ***이것은 정적 린터가 «원리상» 못 잡는다***:
 *    📏 실측에서 가장 흔한 이탈이 `rgb(0, 0, 0)`(글자색 14회)이었는데,
 *    ***그 색은 CSS 어디에도 «안 적혀» 있다*** — 상속이 끊겨 «브라우저 기본»이 나온 것이다.
 *    ⇒ `lint-artifact`(HTML/CSS 문자열)와 «다른 축»이고, 대체하지 않는다.
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/**
 * ⛔⭐ 이 자가 ***원리상 «못 보는»*** 것들 — 「0건」을 「없다」로 읽지 않게 «값으로» 낸다.
 */
export const TOKEN_ADHERENCE_BLIND_SPOTS: readonly string[] = [
  'image-pixels: «이미지 안»의 색은 못 본다 — CSS 가 칠한 것만 센다',
  'gradient-stops: `background-image` 의 그라디언트 정지색은 못 본다(computed 가 배경색으로 안 준다)',
  'alpha-composite: 알파색이 «무엇 위에» 놓였는지는 안 본다 — 합성 «결과»가 아니라 «선언값»을 센다',
  'one-moment-one-page: «한 시점·한 페이지»만 본다 — 가리킴·누름 상태의 색은 «안 본다»',
  'token-file-only: 토큰은 «준 파일»에서만 읽는다 — 다른 곳에 선언된 토큰은 「밖」으로 센다',
];

/** 색 하나를 비교 가능한 꼴로. ⛔ 못 풀면 `null`(0으로 접지 않는다). */
export interface ColorUse {
  readonly value: string;
  readonly count: number;
}

export interface TokenAdherence {
  /** 화면이 칠한 «구별되는» 색 수. 분모다 */
  readonly used: number;
  /** 그중 토큰 «밖». ⛔ 수가 아니라 «값»으로 낸다 — 이름이 없으면 고칠 수 없다 */
  readonly offToken: readonly ColorUse[];
  /** `offToken` 이 칠해진 «횟수» 합. ⭐ 「한 자리에 한 번」과 「사방에 백 번」은 다르다 */
  readonly offTokenHits: number;
  /** 0~1 */
  readonly ratio: number;
}

/**
 * ⛔ 「투명」은 «색»이 아니다 — 알파 0 을 `#000000` 으로 접으면 ***안 칠한 것이 검정으로 센다***.
 *    (기존 `normaliseColor` 는 알파를 «버린다» — 그 자의 계약이라 여기서 고치지 않고 이 자가 먼저 거른다.)
 */
export function isInvisibleColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'none') return true;
  const m = /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,/]+([\d.]+%?)\s*\)$/.exec(v);
  if (m === null) return false;
  const raw = m[1]!;
  const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(alpha) && alpha === 0;
}

/**
 * 화면이 칠한 색과 «선언된» 토큰 값을 대 본다.
 *
 * ⛔ 반환이 `null` 인 경우는 «못 쟀음»이다 — ***「이탈 0」이 «아니다»***:
 *   ⓐ 칠한 색을 하나도 못 읽었다(`painted` 가 비었다)
 *   ⓑ 토큰이 «하나도» 없다 — 분모가 없는 판정을 내지 않는다
 */
export function judgeTokenAdherence(
  painted: readonly ColorUse[],
  declaredValues: readonly string[],
  normalise: (value: string) => string | null,
): TokenAdherence | null {
  const tokens = new Set<string>();
  for (const value of declaredValues) {
    if (isInvisibleColor(value)) continue;
    const n = normalise(value);
    if (n !== null) tokens.add(n);
  }
  if (tokens.size === 0) return null;

  // ⛔ 같은 색이 배경·글자·획에 여러 번 나올 수 있다 — «구별되는 색»으로 접되 횟수는 «더한다».
  const byColor = new Map<string, { value: string; count: number }>();
  for (const use of painted) {
    if (isInvisibleColor(use.value)) continue;
    const n = normalise(use.value);
    if (n === null) continue;
    const prev = byColor.get(n);
    byColor.set(n, { value: prev?.value ?? use.value, count: (prev?.count ?? 0) + use.count });
  }
  if (byColor.size === 0) return null;

  const offToken: ColorUse[] = [];
  let offTokenHits = 0;
  for (const [n, entry] of byColor) {
    if (tokens.has(n)) continue;
    offToken.push({ value: entry.value, count: entry.count });
    offTokenHits += entry.count;
  }
  // ⭐ 많이 칠해진 것부터 — 고칠 순서가 곧 그 순서다.
  offToken.sort((a, b) => b.count - a.count);
  return { used: byColor.size, offToken, offTokenHits, ratio: offToken.length / byColor.size };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderTokenAdherence(report: TokenAdherence | null): string {
  if (report === null) return '⚪ 못 쟀다 — 칠한 색이나 토큰을 «하나도» 못 읽었다(「이탈 0」이 아니다)';
  if (report.offToken.length === 0) return `✅ 칠한 색 ${report.used}종이 «전부» 토큰에서 왔다`;
  const names = report.offToken.slice(0, 5).map((c) => `${c.value}(${c.count}회)`).join(' · ');
  return `⚠️ 칠한 색 ${report.used}종 중 ${report.offToken.length}종(${(report.ratio * 100).toFixed(1)}%)이 «토큰 밖» — ${names}`;
}
