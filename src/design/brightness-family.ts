/**
 * brightness-family.ts — ***「보기에 «밝은» 화면인가 «어두운» 화면인가」***.
 *
 * ⛔⭐⭐ 왜 있나(2026-09-12 🅕) — 로드맵 ⚪H 는 *"「보기에 그 스타일인가」를 묻는 자가 «없다»"* 였다.
 *    🩸 **틀렸다. 자는 «있었다»** — `measure-fidelity` 의 `originPixelStats.meanLuminance` 가
 *    ***실제 화면 픽셀***로 그것을 낸다. ⛔ 그런데 ***클론 비교(`compare-style`)에 «안 꽂혀» 있었다.***
 *
 * 📏 그 결손의 크기(2026-09-12 실측 · 대상 `aialy.app`):
 *      원본 0.193 · ***클론을 «시도»한 산출 0.123***(거리 0.070) · ***«시도조차 안 한» 산출 0.874***(거리 0.681)
 *    ⇒ ***픽셀 명도는 둘을 «9.7배»로 가른다.*** 같은 쌍을 구조 자(활자 분포)는 0.744 ↔ 0.756 으로 «붙여» 놨다.
 *
 * ⛔⭐ **CSS 배경색으로는 못 한다** — 첫 시도가 그렇게 했고 ***대조에서 떨어졌다***:
 *    원본의 어둠은 ***히어로 «사진/영상»***에서 오는데 `backgroundColor` 는 그것을 «못 본다».
 *    (그 자로는 원본↔C 가 0.403, 원본↔B 가 0.426 으로 ***C 가 더 가깝다***고 나왔다 — 눈과 «반대»)
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const BRIGHTNESS_BLIND_SPOTS: readonly string[] = [
  'one-number: 화면 «전체»의 평균 하나다 — 「위는 어둡고 아래는 밝다」 같은 «구성»은 못 본다',
  'hue-blind: ***색상(hue)을 «안» 본다*** — 남색 화면과 진녹색 화면이 같은 밝기면 «같다»고 한다',
  'one-viewport: «첫 화면» 한 폭만 본다 — 스크롤 뒤의 반전 구간은 다른 축이다',
  'late-paint: 늦게 뜨는 것(영상·지연 로드)이 «찍히기 전»이면 다른 수가 나온다 — 그 시점은 부하가 바꾼다',
  'not-taste: 「밝기 계열이 같다」가 ***「보기에 같다」가 «아니다»*** — 이 자도 여전히 «대용»이다',
];

/**
 * ⭐ 경계는 ***삼등분***이다. ⛔ ***내 표본에 맞춘 값이 아니다*** —
 *    「어둡다/중간/밝다」를 가르는 «관례»에서 왔고, 그래서 이 판의 수를 몰라도 같은 값이 나온다.
 */
export const BRIGHTNESS_DARK_MAX = 1 / 3;
export const BRIGHTNESS_LIGHT_MIN = 2 / 3;

export type BrightnessFamily = 'dark' | 'mid' | 'light';

export function brightnessFamily(meanLuminance: number): BrightnessFamily {
  if (meanLuminance < BRIGHTNESS_DARK_MAX) return 'dark';
  if (meanLuminance > BRIGHTNESS_LIGHT_MIN) return 'light';
  return 'mid';
}

export interface BrightnessGap {
  readonly a: number;
  readonly b: number;
  /** `|a - b|` */
  readonly gap: number;
  readonly familyA: BrightnessFamily;
  readonly familyB: BrightnessFamily;
  readonly sameFamily: boolean;
}

/**
 * ⛔ 한쪽이라도 «못 쟀으면» `null` — ***「같다」도 「다르다」도 아니다***
 * (이 저장소의 「0」과 「못 쟀음」을 가른다 의 형제다).
 */
export function judgeBrightnessGap(a: number | null, b: number | null): BrightnessGap | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const familyA = brightnessFamily(a);
  const familyB = brightnessFamily(b);
  return {
    a: Math.round(a * 1000) / 1000,
    b: Math.round(b * 1000) / 1000,
    gap: Math.round(Math.abs(a - b) * 1000) / 1000,
    familyA, familyB,
    sameFamily: familyA === familyB,
  };
}

const FAMILY_KO: Record<BrightnessFamily, string> = { dark: '어둡다', mid: '중간', light: '밝다' };

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「같다」로 쓰지 않는다. */
export function renderBrightnessGap(report: BrightnessGap | null): string {
  if (report === null) {
    return '⚪ 못 쟀다 — 한쪽 화면 밝기를 «못 읽었다»(「같다」도 「다르다」도 아니다)';
  }
  const head = report.sameFamily
    ? `✅ 같은 밝기 계열(둘 다 «${FAMILY_KO[report.familyA]}»)`
    : `⚠️ ***다른 밝기 계열*** — A 는 «${FAMILY_KO[report.familyA]}» · B 는 «${FAMILY_KO[report.familyB]}»`;
  // ⛔⭐ 판정과 «다른 줄»로 수를 낸다 — 계열이 같아도 거리가 멀 수 있다.
  return `${head} (A ${report.a} · B ${report.b} · 거리 ${report.gap})`
    + '\n  ⚪ ⛔ 이 자는 ***색상(hue)을 «안» 본다*** — 밝기가 같으면 남색과 진녹색을 «같다»고 한다(사각 참조)';
}
