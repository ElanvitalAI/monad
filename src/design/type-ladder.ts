/**
 * type-ladder.ts — ***「화면이 칠한 «크기»가 «선언된 사다리»에서 왔나」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-12 🅕) — ***③ 칸(다른 컨셉으로 재생성)의 자다.***
 *
 * 📏 이 창에서 씨앗 29개를 네 축으로 쟀다:
 * ```
 *   기준 단위(간격)          7 / 29   (24%)
 *   반응형 비례(간격)        1 / 29   ( 3%)
 *   ***활자 모듈러 스케일***  ***0 / 20***
 *   「읽었는데 버린 줄」      0 / 29   ⇒ 파서 탓이 «아니다»
 * ```
 * ⊕ 씨앗을 건너뛰고 ***원본 페이지에서 직접*** 재도 같은 판정이 나왔다(nike·starbucks).
 * ⇒ 🔑 ***웹은 «값»은 담고 «관계»는 거의 안 담는다.***
 *
 * ⛔⭐⭐ 그래서 이 자는 ***씨앗과 «안» 댄다.*** 씨앗과 대면 그것은 ②재현이지 ③다른 컨셉이 아니다.
 *    ***「자기가 선언한 사다리」와 「자기가 칠한 크기」***를 댄다 — ***컨셉이 달라도 성립한다.***
 *
 * ⭐ `token-adherence`(색)의 «활자» 쌍둥이다. 둘 다 ***정밀도***(precision) 축이고,
 *    conform 일곱 축(재현율)과 «반대 방향»이다.
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들 — 「0건」을 「없다」로 읽지 않게 «값으로» 낸다. */
export const TYPE_LADDER_BLIND_SPOTS: readonly string[] = [
  'declared-only: 사다리는 «준 값»에서만 읽는다 — 다른 곳에 선언된 크기는 「밖」으로 센다',
  'size-only: «크기»만 본다 — 굵기·행간·자간은 이 자의 축이 아니다',
  'one-moment-one-page: «한 시점·한 페이지»만 본다 — 가리킴·반응형 분기의 크기는 안 본다',
  'no-opinion-on-the-ladder: 「그 사다리가 «좋은가»」는 안 묻는다 — 「선언한 것을 쓰나」만 묻는다',
  'px-only: px 로 해석되는 값만 센다 — em/ex/ch 처럼 «문맥에 따라 달라지는» 단위는 못 푼다',
  'needs-three-sizes: 칠한 크기가 셋 미만이면 «변별하지 않는다» — 「이탈 0」이 거의 언제나 참이 된다',
];

/**
 * ⭐ 「같다」의 눈. ⛔ 브라우저는 `0.9375rem` 을 `15px` 로 주지만 «반올림 찌꺼기»가 붙는다.
 *    ⛔ 그렇다고 크게 잡으면 `15` 와 `16` 이 «같아진다» — 사다리 칸이 1px 인 사이트가 실제로 있다
 *    (📏 starbucks 원본: 12·13·14·15·16·17).
 */
export const LADDER_EPSILON_PX = 0.5;

/**
 * ⛔⭐⭐ ***이 축이 «변별하는» 최소 「칠한 크기 종류」 수.***
 *
 * 🩸 2026-09-12 실측 — `www.airbnb.co.kr` 은 «한 장»에서 크기를 ***두 종류***만 칠한다(14·28).
 *    그 페이지에 이 자를 대면 ***「전부 사다리 안」이 거의 «언제나» 참***이다.
 * ⇒ 🔑 그 ✅ 는 「사다리를 잘 지켰다」가 «아니라» ***「이 자가 여기선 «변별하지 않는다»」***다.
 * ⛔ `token-pair-validity` 의 `DISCRIMINATING_GROUND_COUNT` 와 ***같은 계급***이고,
 *    ⛔ 둘 다 ***실측이 아니라 «논증»에서 나온 수***다 — 반증되면 바꾼다.
 */
export const DISCRIMINATING_SIZE_COUNT = 3;

/** 한 크기가 «몇 자리»에 쓰였나. */
export interface SizeUse {
  readonly px: number;
  readonly count: number;
}

export interface TypeLadder {
  /** 화면이 칠한 «구별되는» 크기 수. ⛔ 이것이 분모다 */
  readonly used: number;
  /** 선언된 사다리의 칸 수 */
  readonly declared: number;
  /** 사다리 «밖». ⛔ 수가 아니라 «값»으로 낸다 — 이름이 없으면 고칠 수 없다 */
  readonly offLadder: readonly SizeUse[];
  /** `offLadder` 가 쓰인 «횟수» 합 */
  readonly offLadderHits: number;
  /** 0~1 */
  readonly ratio: number;
  /**
   * ⭐⭐ ***선언했는데 «한 번도 안 쓴» 칸.*** ⛔ 이것은 「결함」이 아니라 «관측»이다 —
   *    사다리는 여러 장을 덮으므로 한 장에서 안 쓰이는 것이 정상이다.
   *    ⚠️ 그러나 ***모든 장에서 안 쓰이면 그 칸은 「죽은 선언」***이다. 그 판정은 부르는 쪽이 한다.
   */
  readonly unusedRungs: readonly number[];
  /**
   * ⛔⭐⭐ 칠한 크기가 `DISCRIMINATING_SIZE_COUNT` 보다 적으면 ***이 축은 «변별하지 않는다».***
   *    「이탈 0」을 ***「잘 지켰다」로 읽지 마라*** — 「안 재고 있다」에 가깝다.
   */
  readonly discriminating: boolean;
}

/** px 수를 뽑는다. ⛔ 못 풀면 `null` — 0 으로 접지 않는다. */
export function parsePx(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*px\s*$/i.exec(value);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ⛔ 사다리 «안»인가 — `LADDER_EPSILON_PX` 보다 가까운 칸이 있으면 그렇다. */
export function onLadder(px: number, ladder: readonly number[], epsilon = LADDER_EPSILON_PX): boolean {
  return ladder.some((rung) => Math.abs(rung - px) <= epsilon);
}

/**
 * 「선언한 사다리」와 「칠한 크기」를 댄다.
 *
 * ⛔⭐ ***사다리가 «비면» `null`*** — ***「이탈 0」이 «아니라» 「잴 수 없다」***다.
 *    🩸 이 창의 자작 13개가 바로 그 상태였다(`--font-size-*` 토큰이 «0개»).
 *      그때 「이탈 0」을 내면 ***가장 나쁜 사이트가 만점을 받는다.***
 * ⛔ 칠한 크기가 «비어도» `null` — 못 읽은 것을 「깨끗」으로 내지 않는다.
 */
export function judgeTypeLadder(
  painted: readonly SizeUse[],
  declaredLadder: readonly number[],
  epsilon = LADDER_EPSILON_PX,
): TypeLadder | null {
  const ladder = [...new Set(declaredLadder.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (ladder.length === 0) return null;
  const uses = painted.filter((u) => Number.isFinite(u.px) && u.px > 0);
  if (uses.length === 0) return null;
  const offLadder = uses
    .filter((u) => !onLadder(u.px, ladder, epsilon))
    .sort((a, b) => b.count - a.count || a.px - b.px);
  const unusedRungs = ladder.filter((rung) => !uses.some((u) => Math.abs(u.px - rung) <= epsilon));
  return {
    used: uses.length,
    declared: ladder.length,
    offLadder,
    offLadderHits: offLadder.reduce((sum, u) => sum + u.count, 0),
    ratio: offLadder.length / uses.length,
    unusedRungs,
    discriminating: uses.length >= DISCRIMINATING_SIZE_COUNT,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderTypeLadder(report: TypeLadder | null): string {
  if (report === null) {
    return '⚪ 못 쟀다 — «선언된 활자 사다리»가 없거나 칠한 크기를 못 읽었다(「이탈 0」이 아니다)';
  }
  // ⛔⭐ 분모가 모자라면 «수»보다 「변별 안 함」을 «먼저» 말한다 — 안 그러면 ✅ 가 성과로 읽힌다.
  if (!report.discriminating) {
    return `⚪ 칠한 크기가 ${report.used}종뿐이라 이 축은 «변별하지 않는다»`
      + `(${DISCRIMINATING_SIZE_COUNT}종 이상이라야 한다) — 「이탈 ${report.offLadder.length}」을 «성과로 읽지 마라»`;
  }
  const head = report.offLadder.length === 0
    ? `✅ 칠한 크기 ${report.used}종이 «전부» 선언된 사다리(${report.declared}칸) 안이다`
    : `⚠️ 칠한 크기 ${report.used}종 중 ${report.offLadder.length}종(${(report.ratio * 100).toFixed(0)}%)이 사다리 «밖» — `
      + report.offLadder.map((u) => `${u.px}px×${u.count}`).join(' · ');
  // ⛔ 「안 쓴 칸」은 «관측»이라 경고 문면을 안 쓴다.
  // ⛔⭐⭐ 🩸 2026-09-12([S] 지적) — ***판정 줄 «안»에 붙이면 「통과」의 옷을 입는다.***
  //    이 관측은 ***판정과 «다른 축»***이다(「밖을 밟았나」 ↔ 「칸을 안 썼나」 — `containment` 와 같은 갈림).
  //    ⇒ ***제 줄***로 내고, ***무엇을 하라는지***까지 담는다.
  const tail = report.unusedRungs.length === 0 ? ''
    : `\n      ⚪ 이 장에서 «안 쓴» 칸: ${report.unusedRungs.join('px · ')}px`
      + ' — ⛔ «이탈이 아니다». 이 장이 안 쓴 것뿐이니 «다른 장»을 재거나 사다리를 줄여라';
  return head + tail;
}
