/**
 * hue-signature.ts — ***「화면의 «색감»이 같은 쪽인가」***.
 *
 * ⛔⭐⭐ ⚪H 의 «둘째» 축이다. 첫째(`brightness-family`)가 ***「밝은가 어두운가」***를 답하고,
 *    그 자의 사각이 ***`hue-blind: 색상을 «안» 본다 — 남색과 진녹색이 같은 밝기면 «같다»고 한다"***
 *    라고 «미리» 적어 뒀다. 이 파일이 그 칸이다.
 *
 * 📏 ***짓기 «전»에 관문 셋을 통과시켰다***(2026-09-13 🅕 · 밝기 1차 후보가 그것을 «안 해서» 떨어졌다):
 * ```
 * 관문①  같은 그림 두 번            → 색상 거리 ***0.00°***     ✅ 잡음이 아니다
 * 관문②  원본(파랑 212.9°) ↔ 산출(라임 94.3°)  → ***118.6°***   ✅ 갈랐다
 *        ⭐ ***그 쌍을 밝기 축은 「거리 0.070 · 같은 계열」로 «못 가른다»***
 * 관문③  명도를 «맞춘» 합성 쌍      → 색상 ***117.4°*** 갈림 · 명도 ***0.000*** 조용
 *        ✅ ***두 축이 서로 «다른 것»을 본다***
 * ```
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const HUE_BLIND_SPOTS: readonly string[] = [
  'achromatic-undefined: ***회색·검정·흰색에는 색상이 «없다»*** — 채도로 가중하고, 유효 픽셀이 모자라면 «못 쟀다»를 낸다',
  'one-number: 화면 «전체»의 «한» 각도다 — 「파랑 바탕에 주황 강조」 같은 ***두 색 구성***은 못 본다',
  'weighted-by-area: ***면적이 큰 쪽이 이긴다*** — 작지만 «강렬한» 강조색은 묻힐 수 있다',
  'not-taste: ***「보기에 같다」가 «아니다»*** — 이 자도 «대용»이다(밝기 축과 같은 계급)',
  'one-viewport: «첫 화면» 한 폭만 본다',
  // 📏 2026-09-13 실측(35판 · 파이썬 탐침 ↔ magick 산출 대조)에서 «나온» 사각이다 — 지어낸 것이 아니다.
  'two-cluster-flip: ***색이 «둘»로 갈린 화면***은 가중치를 조금만 바꿔도 각이 «튄다» — '
    + 'nike(빨강⊕검정) 46.9° · ycombinator 17.1° · euronews(파랑⊕주황) 17.1° 가 두 구현 사이에서 그만큼 갈렸다. '
    + '한 색이 지배하는 24판은 ***2.5° 안***으로 붙었다',
];

/** ⭐ 색상이 «있다」고 볼 최소 채도·명도. ⛔ 실측이 아니라 «논증»이다 — 반증되면 바꾼다. */
export const HUE_SATURATION_FLOOR = 0.15;
export const HUE_VALUE_FLOOR = 0.06;
/** ⛔ 유효 픽셀이 이보다 적으면 ***「못 쟀다」***(0 이 아니다). */
export const HUE_MIN_CHROMATIC_RATIO = 0.005;

/**
 * ⭐⭐ ***색상환은 «원»이다*** — 350° 와 10° 는 ***20도*** 차이지 340도가 «아니다».
 * ⛔ 이 한 줄을 빼먹으면 자가 「가장 가까운 쌍」을 「가장 먼 쌍」으로 낸다.
 */
export function hueGap(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.abs(a - b) % 360;
  return Math.round(Math.min(d, 360 - d) * 10) / 10;
}

/** ⭐ 색상환 12등분(시계 눈금). ⛔ ***내 표본 «밖»***에서 온 경계다 — 밝기 축의 삼등분과 같은 규율. */
export const HUE_FAMILY_COUNT = 12;

export function hueFamily(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return Math.floor(d / (360 / HUE_FAMILY_COUNT));
}

export interface HueGap {
  readonly a: number;
  readonly b: number;
  /** 원형 거리 0~180 */
  readonly gap: number;
  readonly familyA: number;
  readonly familyB: number;
  readonly sameFamily: boolean;
}

/** ⛔ 한쪽이라도 «못 쟀으면» `null` — ***「같다」도 「다르다」도 아니다***. */
export function judgeHueGap(a: number | null, b: number | null): HueGap | null {
  const gap = hueGap(a, b);
  if (gap === null || a === null || b === null) return null;
  const familyA = hueFamily(a);
  const familyB = hueFamily(b);
  return {
    a: Math.round(a * 10) / 10, b: Math.round(b * 10) / 10,
    gap, familyA, familyB, sameFamily: familyA === familyB,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「같다」로 쓰지 않는다. */
export function renderHueGap(report: HueGap | null): string {
  if (report === null) {
    return '⚪ 색감을 «못 쟀다» — 한쪽 화면에 ***색이 거의 없다***(회색·검정뿐이면 색상은 «정의되지 않는다»)';
  }
  const head = report.sameFamily
    ? `✅ 같은 색감 무리(${report.a}° ↔ ${report.b}° · 거리 ${report.gap}°)`
    : `⚠️ ***다른 색감***(${report.a}° ↔ ${report.b}° · 거리 ***${report.gap}°***)`;
  return `${head}\n  ⚪ ⛔ 이 자는 ***면적이 큰 쪽에 이끌린다*** — 작지만 «강렬한» 강조색은 묻힐 수 있다(사각 참조)`;
}

/**
 * ⭐ 탐침이 낸 두 수(각 ⊕ 유채 픽셀 비율)를 ***「쓸 수 있는 각」 또는 «못 쟀다»***로 접는다.
 *
 * ⛔⭐⭐ ***바닥 `HUE_MIN_CHROMATIC_RATIO` 는 이 파일이 «먼저» 박았고, 뒤에 실측이 그것을 시험했다***
 *    (`#17930` 착지 = 2026-09-13 03:1x · 아래 실측 = 03:4x). ⇒ ***피판정자가 낸 값에서 온 수가 아니다.***
 *
 * 📏 그 시험(35판 · 실물 화면):  바닥 0.5% 로 접었더니 ***파이썬 참조 탐침이 「못 쟀다」라 한 «여덟»과
 *    정확히 «같은» 여덟***을 접었다(faa · nextjs · example · bun.sh ×2 · airbnb · 대조 픽스처 ×4 중 4).
 *    ⇒ ⭐ ***두 구현이 「어디서 포기하나」에 대해 «독립으로» 같은 답을 냈다.***
 *
 * 🩸 ⛔ ***비율을 안 보고 각만 읽으면 «틀린다»*** — 대조 픽스처 넷은 유채 픽셀이 ***0.0%***인데
 *    각은 `51.4°` 라는 «그럴듯한 수»를 냈다. ***「0」과 「못 쟀음」을 가르는 것이 이 함수다.***
 */
export function readHueProbe(
  meanHue: number | null,
  chromaticRatio: number | null,
): number | null {
  if (meanHue === null || !Number.isFinite(meanHue)) return null;
  if (chromaticRatio === null || !Number.isFinite(chromaticRatio)) return null;
  if (chromaticRatio < HUE_MIN_CHROMATIC_RATIO) return null;
  // ⛔ 두 번 나머지를 취하면 `213.9` 가 `213.89999999999998` 로 샌다 — 이 파일의 다른 자리와 같은 자리수로 접는다.
  return Math.round((((meanHue % 360) + 360) % 360) * 10) / 10;
}

/**
 * ⭐⭐ ***`two-cluster-flip` 사각을 닫는 칸.*** 한 각으로는 「파랑 바탕에 주황 강조」를 못 본다.
 *
 * ⛔ 새 관례를 만들지 «않는다» — ***이미 있는 `HUE_FAMILY_COUNT`(12등분)***으로 무게를 모은다.
 * 📏 짓기 «전»에 관문 셋을 통과시켰다(2026-09-13 🅕):
 * ```
 * ①  단색 파랑          1위 ***0.890*** · 2위 ***0***
 * ②  파랑+주황 반반      ***0.500*** (주황 칸) ⊕ ***0.445*** (파랑 칸) — 두 칸이 «멀리» 떨어졌다
 * ③  실물 nike(빨강⊕검정) 1위 0.040(주황쪽) · ***2위 0.006(빨강 칸)*** — ⚠️ «순위로는» 뜨지만 무게가 작다
 * ```
 * ⚪ ***12등분 경계에 걸친 색은 «두 칸으로 쪼개진다»*** — 이 자의 «성질»이지 결함이 아니다.
 */
export interface HueCluster {
  /** 0~11 · 각 칸의 중심각은 `family * 30 + 15` 도다. */
  readonly family: number;
  /** 전체 S×V 무게 대비 비율 0~1. */
  readonly weight: number;
}

export interface HueClusters {
  readonly first: HueCluster;
  readonly second: HueCluster | null;
  /** 1위가 2위의 몇 배인가. ⛔ 「한 색인가 두 색인가」를 «판정하지 않는다» — 수만 낸다. */
  readonly dominance: number | null;
}

export function hueFamilyCenterDegrees(family: number): number {
  return family * (360 / HUE_FAMILY_COUNT) + (360 / HUE_FAMILY_COUNT) / 2;
}

/**
 * ⛔ 무게 배열(길이 `HUE_FAMILY_COUNT`)에서 상위 «둘»을 고른다.
 * ⛔ 전부 0이면 `null` — ***「무채색」과 「1위가 0」을 같은 값으로 내지 않는다.***
 * ⛔⭐ ***「한 색이다/두 색이다」를 판정하지 않는다*** — 배치 자와 같은 규율(임계가 내 표본에서 올 것이므로).
 */
export function topHueClusters(weights: readonly number[]): HueClusters | null {
  if (weights.length !== HUE_FAMILY_COUNT) return null;
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const ranked = weights
    .map((w, family) => ({ family, weight: Math.round((w / total) * 10000) / 10000 }))
    .sort((a, b) => b.weight - a.weight);
  const first = ranked[0]!;
  const second = ranked[1]!.weight > 0 ? ranked[1]! : null;
  return {
    first,
    second,
    dominance: second === null ? null : Math.round((first.weight / second.weight) * 10) / 10,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「한 색이다」를 말하지 않는다 — 두 칸과 배수를 보인다. */
export function renderHueClusters(report: HueClusters | null): string {
  if (report === null) return '⚪ 색 무리를 «못 쟀다» — 화면에 색이 없다';
  // ⛔ 자릿수를 «무게의 정밀도»에 맞춘다 — `0.0%` 로 찍고 「1위가 9999배」라 하면 «모순처럼» 읽힌다.
  const fam = (c: HueCluster) => `${hueFamilyCenterDegrees(c.family)}°대 ${(c.weight * 100).toFixed(2)}%`;
  if (report.second === null) return `${fam(report.first)} (둘째 무리 «없다»)`;
  return `${fam(report.first)}  ⊕  ${fam(report.second)}  (1위가 ${report.dominance}배)\n`
    + `  ⚪ ⛔ ***「한 색이냐 두 색이냐」를 «안» 판정한다*** — 배수를 보고 읽는 사람이 정한다`;
}
