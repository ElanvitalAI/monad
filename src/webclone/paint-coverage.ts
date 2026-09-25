/**
 * paint-coverage.ts — ***「미러가 원본보다 «덜» 칠했나」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-11 🅕): `spotify` 미러가 ***거의 비어 있었는데***
 *    있던 자들이 «전부» 놓쳤다:
 * ```
 *    ① 미러 본문   115.2%        ← DOM 엔 텍스트가 «있다»(원본보다 «더»!)
 *       near-blank not-near-blank ← 쿠키 배너 «한 줄»이 전면 편차를 450배 올린다
 *    ② 픽셀 RMSE   27.16%        ← 잡긴 했지만 «왜»를 못 말한다
 * ```
 *
 * 🩸 첫 처방은 ***「near-blank 를 타일로 재자」***였고 ***실측이 그것을 반증했다***:
 * ```
 *    spotify 미러(진짜 빈 것)          blankTileRatio 0.833
 *    hero-dark(여백 넓은 «정상» 디자인) blankTileRatio 0.750   ← 여유 1.11배 — 갈리지 «않는다»
 * ```
 * ⇒ ⭐ ***질문이 틀렸다.*** 「이 그림이 비었나」는 «절대» 물음이고,
 *    디자인은 원래 여백이 넓을 수 있다. ***실제 물음은 「미러가 원본보다 «덜» 칠했나」***다.
 *
 * ✅ 그래서 이 자는 ***두 그림을 «대 본다»***:
 * ```
 *    spotify   원본 0.000 → 미러 0.833   ⇒ 미러가 83.3%p «덜» 칠했다
 *    자작 13개 원본 == 미러             ⇒ 0
 * ```
 * ⭐ 그리고 이 축은 ***원본이 여백 디자인이든 사진 페이지든 상관없다*** —
 *    판별 사다리 ③(「정답을 «옮겨도» 답이 그대로인가」)을 만족한다.
 *
 * ⛔ 이 파일은 이미지를 «안 읽는다» — 타일 편차 목록을 «받는다».
 *    실제 측정은 `scripts/webclone/measure-fidelity.ts`(ImageMagick)이 한다.
 */

/**
 * ⛔⭐ 이 자가 ***원리상 «못 보는»*** 것들. 산출에 «값으로» 실린다 —
 *    이 저장소가 반복해서 밟은 함정이 ***「0건」을 「없다」로 읽는 것***이라, 자가 자기 사각을 스스로 낸다.
 *    (같은 규율을 `AFFORDANCE_BLIND_SPOTS`·`MEDIA_BLIND_SPOTS`·`LAYOUT_BLIND_SPOTS` 가 이미 쓴다.)
 */
export const PAINT_COVERAGE_BLIND_SPOTS: readonly string[] = [
  'tile-grid: 타일 격자에 «걸친» 얇은 내용은 「빈 타일」로 셀 수 있다(160px 격자다)',
  'same-size-only: 원본과 사본의 타일 «수»가 다르면 «못 쟀음»이다 — 다른 크기를 비교하지 않는다',
  'one-moment: «한 시점»만 본다 — 애니메이션 중에 찍히면 다른 값이 나온다',
  'not-why: 「덜 칠했다」까지만 안다 — ***«왜»는 이 자가 모른다***(`check-mirror-runtime` 의 몫)',
  'viewport-only: 크롭된 «뷰포트»만 본다 — 스크롤 아래는 «안 본다»',
];

/**
 * ⭐ 「빈 타일」의 문턱. 실측(2026-09-11 · `magick -colorspace Gray -crop 160x160`):
 * ```
 *   빈 흰 화면 / 빈 검은 화면   타일 sd = 0        (48/48)
 *   저대비 그라디언트            타일 sd ≤ 0.0193   (48/48)
 *   spotify 미러의 «빈» 부분     타일 sd = 0        (40/48)
 *   spotify 원본 / 사진          타일 sd ≥ 0.06     (0/48)
 * ```
 * ⇒ 0.02 는 그라디언트를 「빈 것」으로 «잡고» 실제 내용은 «놓아준다».
 */
export const MAX_BLANK_TILE_STD_DEV = 0.02;

/** 타일 한 판의 요약. ⛔ 「빈 타일 0개」와 「타일을 못 쟀음」은 다른 값이다. */
export interface TileCoverage {
  readonly blank: number;
  readonly total: number;
  /** 0~1. `blank / total` */
  readonly ratio: number;
}

/**
 * 타일 편차 목록을 요약한다.
 * ⛔ 빈 목록은 `null`(«못 쟀음») — 0/0 을 「전부 칠했다」로 읽지 않는다.
 * ⛔ 유한하지 않은 값이 하나라도 있으면 `null` — 조용히 건너뛰면 분모가 «몰래» 줄어든다.
 */
export function summariseTiles(
  stdDevs: readonly number[],
  maxBlankStdDev: number = MAX_BLANK_TILE_STD_DEV,
): TileCoverage | null {
  if (stdDevs.length === 0) return null;
  if (!Number.isFinite(maxBlankStdDev) || maxBlankStdDev < 0) return null;
  let blank = 0;
  for (const sd of stdDevs) {
    if (!Number.isFinite(sd) || sd < 0) return null;
    if (sd <= maxBlankStdDev) blank += 1;
  }
  return { blank, total: stdDevs.length, ratio: blank / stdDevs.length };
}

export type PaintCoverageVerdict =
  /** 미러가 원본만큼 칠했다 */
  | 'matched'
  /** ⭐ 미러가 원본보다 «덜» 칠했다 — 재현 실패다 */
  | 'mirror-under-painted'
  /** 미러가 원본보다 «더» 칠했다 — ⛔ 결함이라 단정하지 않는다(덮개를 지웠을 수 있다) */
  | 'mirror-over-painted'
  /** ⛔ 한쪽이라도 못 쟀다 — 「같다」가 «아니다» */
  | 'unmeasured';

export interface PaintCoverage {
  readonly verdict: PaintCoverageVerdict;
  /** `mirror.ratio - origin.ratio`. 양수면 미러가 «더 비었다». 못 쟀으면 null */
  readonly drop: number | null;
  /** 사람이 읽을 한 줄. ⛔ 「왜」를 말한다 */
  readonly detail: string;
}

/**
 * ⭐ 문턱. 실측으로 정한다 — ⛔ 이 값을 «짐작»으로 고치지 마라.
 * (자작 13개는 원본·미러가 같은 파일이라 0 이고, `spotify` 는 0.833 이었다.
 *  그 사이를 채우는 표본은 §측정표가 canonical.)
 */
export const UNDER_PAINT_DROP = 0.2;

/**
 * 원본과 미러의 빈 타일 비율을 대 본다.
 * ⛔ 한쪽이라도 `null` 이면 `unmeasured` — ***못 잰 것을 「같다」로 접지 않는다***
 *    (이 저장소의 ⛔「0」과 「못 쟀음」을 가른다 의 형제다).
 */
export function judgePaintCoverage(
  origin: TileCoverage | null,
  mirror: TileCoverage | null,
  underPaintDrop: number = UNDER_PAINT_DROP,
): PaintCoverage {
  if (origin === null || mirror === null) {
    const missing = origin === null && mirror === null ? '원본과 사본 둘 다' : origin === null ? '원본' : '사본';
    return { verdict: 'unmeasured', drop: null, detail: `${missing} 타일을 «못 쟀다» — 「같다」가 아니다` };
  }
  // ⛔ 타일 수가 다르면 «다른 크기»를 비교한 수가 된다 — 그것은 못 쟀음이다.
  if (origin.total !== mirror.total) {
    return {
      verdict: 'unmeasured',
      drop: null,
      detail: `타일 수가 다르다(원본 ${origin.total} · 사본 ${mirror.total}) — «다른 크기»를 비교하지 않는다`,
    };
  }
  const drop = mirror.ratio - origin.ratio;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  if (drop >= underPaintDrop) {
    return {
      verdict: 'mirror-under-painted',
      drop,
      detail: `사본이 원본보다 ${pct(drop)}p «덜» 칠했다(빈 타일 원본 ${pct(origin.ratio)} → 사본 ${pct(mirror.ratio)}) — 그림이 «안 그려졌다»`,
    };
  }
  if (-drop >= underPaintDrop) {
    return {
      verdict: 'mirror-over-painted',
      drop,
      // ⛔ 「더 칠했다」를 결함으로 단정하지 않는다 — 덮개(쿠키 배너)를 지우면 이렇게 된다.
      detail: `사본이 원본보다 ${pct(-drop)}p «더» 칠했다 — ⛔ 결함이 아닐 수 있다(덮개를 지웠거나 lazy 가 펼쳐졌다)`,
    };
  }
  return { verdict: 'matched', drop, detail: `빈 타일 비율이 맞는다(원본 ${pct(origin.ratio)} · 사본 ${pct(mirror.ratio)})` };
}
