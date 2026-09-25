/**
 * ua-default-leak.ts — ***「브라우저 «기본값»이 아직 살아 있는 자리」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-12 🅕) — ***이 창에서 «같은 계급»의 사고가 «넷» 났다:***
 * ```
 *   색    `rgb(0, 0, 0)`   상속이 끊긴 기본 글자색이 «토큰 밖»으로 잡혔다
 *   간격  `p { margin: 1em 0 }`        ③ 대조 ①  ⇒ 14 · 15 · 17px 가 «눈금 밖»
 *   간격  `p·dl·dd { margin }`         ③ 대조 ②  ⇒ 15px
 *   간격  `figure { margin: 1em 40px }` dongne-moksori ⇒ 15px × ***10회***(figure 5개 × 위아래)
 * ```
 * 🔑 ***「1em」 은 «그 요소의 글자 크기»라, 활자 사다리 값이 «간격»으로 흘러든다.***
 * ⛔⭐ 그리고 ***기본값은 «하나씩» 새어 나온다*** — `blockquote` 를 껐는데 `figure` 가 남아 있었다.
 *    ⇒ ***「리셋을 한 번 했다」가 «끝»이 아니다.***
 *
 * ⛔ 이 자가 답하는 것: ***「지금 화면에서, 기본값이 «살아 있는» 태그가 무엇인가」***.
 * ⛔ 답하지 «않는» 것: 「그것이 결함인가」 — ***의도일 수 있다.*** 그래서 «관측»으로 낸다.
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const UA_DEFAULT_BLIND_SPOTS: readonly string[] = [
  'known-tags-split: ***아는 태그***는 `leaked` 로, ***모르는 태그***는 `suspects` 로 «갈라» 낸다 — 뒤쪽은 «신뢰가 낮다»',
  'em-shaped-only: 「그 요소 글자 크기의 «배수»」꼴만 잡는다 — `40px` 같은 «고정» 기본값은 이 자의 축이 아니다',
  'intent-blind: 「기본값을 «남겨 둔 것»이 의도인지」는 안 묻는다 — 그래서 «경고»가 아니라 «관측»이다',
  'one-moment: 한 시점만 본다 — 뒤에 붙는 요소의 기본값은 안 본다',
  'author-may-match: 사람이 «우연히» 같은 값을 적었어도 이 자는 «기본값»이라 부른다 — 완전히는 못 가른다',
  'ladder-filtered: ***선언된 «간격 눈금»에 있는 값은 «뺀다»*** — 그것은 사람이 쓴 토큰일 가능성이 훨씬 높다',
];

/**
 * ⭐ 브라우저 기본 마진이 ***「그 요소 글자 크기의 배수」***로 붙는 태그들.
 * ⛔ 수를 여기 «박지 않는다» — 배수는 브라우저마다 다르고, 이 자는 ***「배수꼴인가」***만 본다.
 */
export const EM_MARGIN_TAGS: readonly string[] = [
  'p', 'blockquote', 'figure', 'dl', 'dd', 'pre', 'menu', 'ul', 'ol', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'fieldset',
];

/** 한 태그의 관측. */
export interface TagMargin {
  readonly tag: string;
  readonly count: number;
  /** 세로 마진(px) — 위·아래 중 «0이 아닌» 대표값 */
  readonly marginPx: number;
  /** 그 요소의 글자 크기(px) */
  readonly fontSizePx: number;
}

export interface LeakedTag {
  readonly tag: string;
  readonly count: number;
  readonly marginPx: number;
  /** `marginPx / fontSizePx` — 1 이나 0.5 근처면 «기본값의 모양»이다 */
  readonly emRatio: number;
}

export interface UaDefaultLeak {
  /** 본 태그 관측 수(«아는» 태그). ⛔ 이것이 분모다 */
  readonly inspected: number;
  readonly leaked: readonly LeakedTag[];
  /** ⭐ 「그 마진들이 «몇 자리»에 붙었나」 — 하나와 열은 다르다 */
  readonly leakedPlaces: number;
  /**
   * ⛔⭐ ***모르는 태그***인데 「기본값 모양」인 것들 — ***신뢰가 «낮다»***.
   * 🩸 첫 판은 아는 태그 «열여덟»만 봐서 두 사이트의 출처를 ***못 짚었다.***
   * ⇒ 이제 갈라서 «둘 다» 낸다. ⛔ 이것을 `leaked` 와 «같은 무게»로 읽지 마라 —
   *    `div`·`span` 의 1em 마진은 ***사람이 적었을 가능성이 훨씬 높다.***
   */
  readonly suspects: readonly LeakedTag[];
}

/** ⛔ 「기본값의 모양」으로 볼 배수들. 브라우저가 쓰는 값이다(1em · 0.5em · 0.67em · 0.83em …). */
/**
 * ⛔⭐⭐ ***제목의 UA 기본 «글자 크기» 비율*** — 위 `UA_EM_RATIOS`(«마진»)와 ***다른 축***이다.
 *
 * 🩸 왜 있나(2026-09-13 🅕 실측): 두 모델의 산출이 활자 사다리 ***`[16, 18.72, 24, 32]` 로 «완전히 동일»***
 *    하게 나왔고, 나는 그것을 ***「같은 눈을 주니 «수렴»했다」***고 읽으려 했다.
 *    ⛔ **틀렸다.** 그 넷은 ***전부 UA 기본값***이다 —
 *      `16=1em(기본)` · `18.72=1.17em(h3)` · `24=1.5em(h2)` · `32=2em(h1)` ⇒ ***4/4***.
 *    ⇒ ***「같은 칸을 골랐다」가 아니라 «둘 다 제목을 «안 칠했다»»*** 였다.
 *    📏 방증: 두 산출의 CSS 어디에도 `18.72`·`1.17` 이 ***0건***이다(브라우저가 계산한 값이다).
 *
 * ⛔ **「기본값 «모양»인가」이지 「기본값이다」가 «아니다»** — 사람이 같은 값을 적었을 수 있다.
 *    그래서 이 자도 ***판정이 아니라 «관측»***이다(위 `looksLikeUaMargin` 과 같은 계급).
 */
export const UA_HEADING_FONT_RATIOS: Readonly<Record<string, number>> = {
  h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67,
};

/** ⛔ 「이 글자 크기가 «어느 제목의» UA 기본값 모양인가」 — 아니면 `null`. */
export function uaHeadingDefaultTag(fontSizePx: number, basePx = 16): string | null {
  if (!Number.isFinite(fontSizePx) || !Number.isFinite(basePx) || basePx <= 0) return null;
  for (const [tag, ratio] of Object.entries(UA_HEADING_FONT_RATIOS)) {
    if (Math.abs(fontSizePx - basePx * ratio) <= EM_RATIO_EPSILON * basePx) return tag;
  }
  return null;
}

/**
 * ⭐ 사다리에서 ***UA 기본값 «모양»인 칸***을 골라낸다.
 * 🔑 쓰는 법: ***공유 칸이 「전부」 이것이면 「수렴」이 아니라 「둘 다 안 칠했다」***다.
 */
export function uaDefaultRungs(rungs: readonly number[], basePx = 16): readonly { px: number; tag: string }[] {
  const out: { px: number; tag: string }[] = [];
  for (const px of rungs) {
    const tag = uaHeadingDefaultTag(px, basePx);
    if (tag !== null) out.push({ px, tag });
  }
  return out;
}

export const UA_EM_RATIOS: readonly number[] = [1, 0.5, 0.67, 0.83, 1.33, 1.5, 1.67, 2.33];
export const EM_RATIO_EPSILON = 0.03;

/** ⛔ 「기본값 «모양»인가」 — ⚠️ 「기본값이다」가 «아니다»(사람이 같은 값을 적었을 수 있다). */
export function looksLikeUaMargin(marginPx: number, fontSizePx: number): boolean {
  if (!Number.isFinite(marginPx) || !Number.isFinite(fontSizePx)) return false;
  if (marginPx <= 0 || fontSizePx <= 0) return false;
  const ratio = marginPx / fontSizePx;
  return UA_EM_RATIOS.some((r) => Math.abs(ratio - r) <= EM_RATIO_EPSILON);
}

/**
 * ⛔ 본 것이 «하나도» 없으면 `null` — ***「새는 곳 0」이 «아니다»***.
 */
export function judgeUaDefaultLeak(
  observed: readonly TagMargin[],
  /**
   * ⛔⭐⭐ 🩸 2026-09-12 전수에서 ***13개 중 «열둘»이 걸렸다*** — 「거의 전부」는 퇴화의 모양이다.
   *    눌러 보니 `p 16px @ 16px` 처럼 ***사람이 «눈금 토큰»으로 적은 값***이 「1em」과 «우연히» 같았다.
   * ⇒ ✅ ***선언된 눈금에 «있는» 값은 «뺀다».*** 그것은 사람이 쓴 것일 가능성이 훨씬 높다.
   * ⛔ 눈금을 «안 주면» 거르지 않는다 — 「못 거른다」를 「0」으로 만들지 않기 위해서다.
   */
  declaredLadder: readonly number[] = [],
  epsilon = 0.5,
): UaDefaultLeak | null {
  if (observed.length === 0) return null;
  const known = new Set(EM_MARGIN_TAGS);
  const shaped = observed
    .filter((o) => looksLikeUaMargin(o.marginPx, o.fontSizePx))
    .map((o) => ({
      tag: o.tag.toLowerCase(),
      count: o.count,
      marginPx: o.marginPx,
      emRatio: Math.round((o.marginPx / o.fontSizePx) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  // ⛔ 「눈금에 있는 값」은 사람이 쓴 것으로 본다 — 분자를 오염에서 뺀다.
  const onLadder = (px: number) => declaredLadder.some((r) => Math.abs(r - px) <= epsilon);
  const offLadderShaped = shaped.filter((l) => !onLadder(l.marginPx));
  const leaked = offLadderShaped.filter((l) => known.has(l.tag));
  const suspects = offLadderShaped.filter((l) => !known.has(l.tag));
  return {
    inspected: observed.filter((o) => known.has(o.tag.toLowerCase())).length,
    leaked,
    // ⭐ 세로 마진은 «위·아래» 둘이라 자리 수는 요소 수의 두 배로 잡는다.
    leakedPlaces: leaked.reduce((s, l) => s + l.count * 2, 0),
    suspects,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderUaDefaultLeak(report: UaDefaultLeak | null): string {
  if (report === null) return '⚪ 못 쟀다 — 「기본 마진이 붙는」 태그를 «하나도» 못 봤다(「새는 곳 0」이 아니다)';
  // ⛔ 「모르는 태그」는 «신뢰가 낮다»고 «문면»이 말한다 — 같은 무게로 읽히면 안 된다.
  const tail = report.suspects.length === 0 ? ''
    : ` ⊕ ⚪ «모르는 태그»에도 같은 모양 ${report.suspects.length}종(신뢰 낮음): `
      + report.suspects.slice(0, 4).map((l) => `${l.tag} ${l.marginPx}px(×${l.count} · ${l.emRatio}em)`).join(' · ');
  if (report.leaked.length === 0) {
    return `✅ 본 태그 ${report.inspected}종에 «기본값 모양»의 마진이 없다` + tail;
  }
  const names = report.leaked.map((l) => `${l.tag} ${l.marginPx}px(×${l.count} · ${l.emRatio}em)`).join(' · ');
  return `⚪ ***기본값이 «살아 있는» 태그 ${report.leaked.length}종***(자리 ${report.leakedPlaces}) — ${names}`
    + ' ⚠️ 결함이 아니라 «관측»이다 — 의도일 수 있다' + tail;
}
