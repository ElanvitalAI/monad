// ── 클론 충실성 계측 — 「둘이 얼마나 같나」를 «수»로 (2026-09-08) ──────────────
//
// ⛔⭐ 계기: elanous 는 `browser-verify` 로 ***「렌더가 되나」***는 답했지만
//    ***「둘이 얼마나 같나」***는 못 답했다(실측 2026-09-08: `pixelmatch|ssim|rmse|visual-diff`
//    저장소 전수 0건). 클론 검증에 필요한 것이 정확히 후자다.
//
// 🩸 그리고 첫 수동 측정이 «틀렸다» — 그 실패가 이 파일의 설계를 정했다:
//    headless Chrome 에 `--window-size=1280,900` 을 줘도 ***레이아웃 뷰포트는 813px***인데
//    `--screenshot` 은 900px 로 찍는다. 아래 87px 은 «페이지 내용이 아니다».
//    그 대역을 비교에 넣으면 오차가 ***한쪽으로만*** 기운다(항상 「더 다르다」).
//    📏 실측: B 재구축 RMSE 28.13% → 뷰포트로 자르니 18.87% (9.26%p 가 아티팩트)
//    ⇒ 🔑 ***그래서 이 모듈은 「창 크기」를 «절대» 믿지 않는다.*** 잰 값으로만 자른다.
//
// 원칙:
//   • ⛔ 순수 — 프로세스·네트워크를 안 탄다. 실행은 `scripts/webclone/measure-fidelity.ts`.
//   • ⭐ 독립변수와 종속변수를 «가른다» — `classifyRenderLocation`(독립) ↔ 충실성 수치(종속).
//   • ⛔ 「못 쟀다」를 「0」으로 접지 않는다. 전부 `null` 이 가능하고, 판정은 `unmeasured` 를 갖는다.

/** 태그·스크립트·스타일을 걷어낸 «사람이 읽는» 글자수. 결정론적이다. */
export function visibleTextLength(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return stripped.replace(/\s+/g, ' ').trim().length;
}

export type RenderLocation = 'server' | 'client' | 'mixed' | 'unmeasured';
export type CaptureScope = 'viewport' | 'full-page';
export type NearBlankCapture = 'near-blank' | 'not-near-blank' | 'unmeasured';

/** 캡처가 «정착한 뒤에» 찍혔나. ⛔ `unmeasured` 는 「정착했다」가 아니다. */
/**
 * ⛔⭐⭐⭐ 캡처가 «언제» 찍혔나. 2026-09-11 — ***세 사실이 하나로 접혀 있었다.***
 *
 * 🩸 `waitForRenderSettling` 은 ***성장을 «본 적이 있어야»*** `settled` 를 낸다(`sawGrowth`).
 *    ⇒ ***서버 렌더 페이지는 첫 관측에 이미 완성돼 있어 «성장이 없다»*** ⇒ `never-grew`.
 *    그런데 부르는 쪽이 `status !== 'settled'` 를 «전부» `timed-out` 으로 접었다.
 * 📏 실측(세 모양을 직접 먹여): `처음부터 완성 → never-grew(길이 31)` ·
 *    `자라다 멈춤 → capped(180)` · `빈 문서 → never-grew(0)`.
 * 🚨 결과: ***내 사이트 13개가 «전부» `pixelTrustworthy=false`*** 였다 — 픽셀 축이 죽어 있었다.
 *
 * ✅ 그래서 «넷»으로 가른다:
 *   `settled`          자라다가 «멈췄다»        — 믿는다
 *   `already-complete` ***처음부터 «완성»*** (본문 길이 > 0) — ⭐ 믿는다. 서버 렌더의 «정상»이다
 *   `blank`            처음부터 «비었다»(길이 0) — ⛔ 못 믿는다. 빈 그림끼리 비교하면 RMSE 가 0이 된다
 *   `timed-out`        자라다가 «상한»에 걸렸다   — ⛔ 못 믿는다
 * ⛔ 「안 자랐다」와 「끝내 안 끝났다」를 «같은 값»으로 접지 마라 —
 *    이 저장소의 ⛔「0」과 「못 쟀음」을 가른다 의 형제다.
 */
export type CaptureSettling = 'settled' | 'already-complete' | 'blank' | 'timed-out' | 'unmeasured';

/**
 * ⭐ `waitForRenderSettling` 의 «상태 ⊕ 길이» 를 위 다섯 값으로 옮긴다.
 * ⛔ 이 함수가 «스크립트 안»에 인라인으로 있으면 시험이 못 문다 — 그래서 여기 둔다.
 * ⛔ ***「안 자랐다」를 「못 끝냈다」로 접지 않는다.*** 갈림은 «본문 길이»가 낸다.
 */
export function classifyCaptureSettling(
  status: 'settled' | 'capped' | 'never-grew',
  finalLength: number,
): CaptureSettling {
  if (status === 'settled') return 'settled';
  if (status === 'never-grew') return finalLength > 0 ? 'already-complete' : 'blank';
  return 'timed-out';
}

/** 이미지 전체에서 계산한 정규화된 회색조 밝기 분포다. */
export interface CapturePixelStats {
  readonly meanLuminance: number;
  readonly luminanceStdDev: number;
  /** 회색조 히스토그램 엔트로피(0~1). 균일·희소 화면은 낮다. */
  readonly luminanceEntropy: number;
}

/**
 * ⛔⭐⭐⭐ 캡처가 「거의 비었나」. 2026-09-11 — ***이 자가 「비었나」가 아니라 «다른 축»을 재고 있었다.***
 *
 * 🩸 옛 계약은 **히스토그램 엔트로피 ≤ 0.15** 를 빈 화면 신호로 썼고, 주석은
 *    *"엔트로피만으로는 밝기 단계가 많은 저대비 그라데이션을 «놓친다»"* 고 말했다.
 *    📏 실측으로 그 전제가 **거짓**임이 드러났다 — ***저대비 그라디언트의 엔트로피는 «최대»(1.00)다.***
 *    `%[entropy]` 는 「비었나」가 아니라 ***「밝기 분포가 얼마나 «균등»한가」***를 잰다.
 *    ⇒ ***흰 배경이 넓은 «모든» 웹페이지가 낮게 나온다.***
 *
 * 📏 ⭐ 전수 실측(11 대상 · 양성 대조 3 ⊕ 음성 대조 8 · 2026-09-11 · `magick -colorspace Gray`):
 * ```
 * 대상            mean     sd       entropy   옛 판정        참
 * 빈 흰 화면      1.0000   0.0000   0.0002    near-blank    빈 것   ✅
 * 빈 검은 화면    0.0667   0.0000   0.0002    near-blank    빈 것   ✅
 * 저대비 그라디언트 0.9667  0.0193   1.0000    near-blank    빈 것   ✅(편차가 잡았다·엔트로피가 «아니라»)
 * plasma 사진     0.4187   0.2266   0.9756    ok            그려짐  ✅
 * 내 사이트 8812  0.9285   0.1960   0.1301    near-blank    그려짐  ⛔ 오판
 * 내 사이트 8814  0.9626   0.1316   0.1265    near-blank    그려짐  ⛔ 오판
 * 내 사이트 8816  0.9487   0.1101   0.1164    near-blank    그려짐  ⛔ 오판
 * airbnb          0.9614   0.0862   0.1603    ok            그려짐  ⚠️ «우연»(임계 0.15 와 1.07배)
 * netflix(다크)   0.0902   0.1411   0.7821    ok            그려짐  ✅
 * slack           0.8982   0.2683   0.1878    ok            그려짐  ✅
 * youtube         0.4320   0.2768   0.7862    ok            그려짐  ✅
 * ```
 * 🚨 ***내 사이트 3/3 이 전부 오판***이었다 — 그래서 ***클론 13개의 픽셀 축이 통째로 죽어 있었다.***
 *
 * ✅ 그래서 ***편차(`luminanceStdDev`) «하나»로 간다***:
 *    최악의 양성(그라디언트 0.0193) ↔ 최악의 음성(airbnb 0.0862) 사이 여유가 **4.5배**다
 *    (엔트로피는 1.07배 — 갈림이 아니라 «우연»이다). 11/11 이 맞는다.
 * ⛔ `luminanceEntropy` 는 ***판정에서 뺐다 — 관측값으로만 남긴다***(사진 많은 페이지를 가르는 데엔 쓸모가 있다:
 *    netflix .78 · youtube .79 ↔ 미니멀 .12).  ⚠️ 다시 판정에 쓰려면 «위 표를 다시 재고» 넣어라.
 * ⛔ 파일 크기나 두 캡처 «사이»의 차이는 쓰지 않는다(그것은 「같나」이지 「비었나」가 아니다).
 */
export function classifyNearBlankCapture(
  stats: CapturePixelStats | null,
  maxLuminanceStdDev = 0.04,
): NearBlankCapture {
  if (stats === null
    || !Number.isFinite(stats.meanLuminance)
    || !Number.isFinite(stats.luminanceStdDev)
    || !Number.isFinite(stats.luminanceEntropy)
    || stats.meanLuminance < 0 || stats.meanLuminance > 1
    || stats.luminanceStdDev < 0 || stats.luminanceStdDev > 1
    || stats.luminanceEntropy < 0 || stats.luminanceEntropy > 1
    || !Number.isFinite(maxLuminanceStdDev) || maxLuminanceStdDev < 0 || maxLuminanceStdDev > 1) return 'unmeasured';
  // 빈 단색면(sd=0) ⊕ 저대비 그라디언트(sd=0.019) 를 «같이» 잡고, 그려진 페이지(sd≥0.086)는 놓아준다.
  const flatSurface = stats.luminanceStdDev <= maxLuminanceStdDev;
  // 어두운 화면은 편차가 구조적으로 작다 — 그쪽만 문턱을 조금 연다(netflix sd=0.141 은 여전히 통과한다).
  const sparseDarkContent = stats.meanLuminance <= 0.2 && stats.luminanceStdDev <= 0.05;
  return flatSurface || sparseDarkContent ? 'near-blank' : 'not-near-blank';
}

/** 원본과 미러 모두에 같은 픽셀-유래 near-blank 계약을 적용한다. */
export function classifyNearBlankCaptures(
  originalPixelStats: CapturePixelStats | null,
  mirrorPixelStats: CapturePixelStats | null,
): { readonly original: NearBlankCapture; readonly mirror: NearBlankCapture } {
  return {
    original: classifyNearBlankCapture(originalPixelStats),
    mirror: classifyNearBlankCapture(mirrorPixelStats),
  };
}

/**
 * ⭐⭐ **이 실험의 독립변수** — 「본문을 «누가» 그렸나」.
 *
 * `raw` = JS 없이 서버가 준 HTML 의 본문 · `rendered` = 브라우저가 JS 를 돌린 뒤의 DOM 텍스트.
 * ⛔ 프레임워크 «이름»으로 가르지 않는다 — Next.js 도 CSR 로 쓸 수 있고 Vite 도 SSR 이 된다.
 *    그 혼동이 「React/Next 면 미러가 안 된다」는 통설을 만들었다.
 */
/**
 * ⛔⭐⭐⭐ ***렌더가 원문보다 «적으면» 그것은 「서버 렌더」가 아니라 «측정 실패»의 신호다.***
 *
 * 🩸 2026-09-11 실측 — `airbnb`:
 * ```
 *   원문(curl)      5098자
 *   렌더(브라우저)    232자     ← 원문의 1/22
 *   미러            2941자     ⇒ 「미러 본문 1267.7%」라는 «불가능한 수»가 나왔다
 * ```
 * 🚨 그리고 `classifyRenderLocation(5098, 232)` 은 `ratio 21.98 ≥ 0.8` 이라
 *    ***「server」라고 «자신 있게» 말했다.*** 분모가 거짓인데 자가 그것을 «안 말했다».
 *
 * ⛔ 브라우저가 JS 를 돌리면 본문은 보통 «줄지 않는다» — 줄어도 조금이다
 *    (쿠키 배너가 사라지거나 로딩 문구가 교체되는 정도).
 *    ⇒ ***원문보다 «뚜렷이» 적으면 그 판의 렌더 probe 를 못 믿는다.***
 * ⚠️ 문턱 `1.5` 의 근거: 정상 표본이 `netflix 0.45`·`spotify 0.12`,
 *    이상 표본이 `airbnb 21.98` 이다. ⛔ ***그 사이에 표본이 «없다»*** — 만나면 다시 재라.
 * ⛔ 이 자는 «판정을 바꾸지 않는다» — 「의심스럽다」를 «값으로» 낼 뿐이다.
 */
export const RENDER_PROBE_SUSPECT_RATIO = 1.5;

export function isRenderProbeSuspect(
  raw: number | null,
  rendered: number | null,
  suspectRatio: number = RENDER_PROBE_SUSPECT_RATIO,
): boolean {
  // ⛔ 못 쟀으면 「의심스럽다」가 «아니다» — 안 잰 것이다.
  if (raw === null || rendered === null) return false;
  if (!Number.isFinite(raw) || !Number.isFinite(rendered) || raw < 0 || rendered < 0) return false;
  // ⛔ 원문이 «비었으면» 비율이 의미를 잃는다(0으로 나눈다) — 의심하지 않는다.
  if (rendered === 0) return raw > 0;
  return raw / rendered >= suspectRatio;
}

export function classifyRenderLocation(raw: number | null, rendered: number | null): RenderLocation {
  if (raw === null || rendered === null || rendered <= 0) return 'unmeasured';
  const ratio = raw / rendered;
  if (ratio >= 0.8) return 'server';
  if (ratio <= 0.3) return 'client';
  return 'mixed';
}

export type MirrorCompletion = 'completed' | 'timed-out' | 'failed';

export interface FidelityInput {
  /** 실제로 비교한 캡처 범위. 범위를 모른 채 판정하지 않는다. */
  readonly captureScope: CaptureScope;
  /** wget이 링크 변환까지 완료했는가. 생략한 기존 호출자는 completed로 보존한다. */
  readonly mirrorCompletion?: MirrorCompletion;
  /** JS 없이 받은 원문 본문 글자수 */
  readonly rawTextChars: number | null;
  /** 원문을 준 HTTP 상태. null은 상태를 얻지 못했음을 뜻하며 기존 렌더 판정을 막지 않는다. */
  readonly rawHttpStatus: number | null;
  /** 브라우저가 JS 를 돌린 뒤 DOM 텍스트 글자수 — ⭐ ①의 «분모»는 이것이다 */
  readonly renderedTextChars: number | null;
  /** 미러가 재현한 본문 글자수 */
  readonly mirrorTextChars: number | null;
  /** 원본 ↔ 미러 픽셀 RMSE (0~1). 못 쟀으면 null */
  readonly pixelRmse: number | null;
  /** 다른 픽셀 비율 (0~1) */
  readonly pixelDiffRatio: number | null;
  /** 원본 캡처에서 계산한 밝기 분포. */
  readonly originPixelStats?: CapturePixelStats | null;
  /** 미러 캡처에서 계산한 밝기 분포. */
  readonly mirrorPixelStats?: CapturePixelStats | null;
  /** ⭐ 실측 레이아웃 뷰포트 높이. ⛔ 창 크기가 아니다 */
  readonly measuredViewportHeight: number | null;
  /** 캡처가 이 높이로 잘렸나. false 면 픽셀 수치를 «믿으면 안 된다» */
  readonly croppedToViewport: boolean;
  /** 전체 페이지에서 원본·미러 이미지 높이를 정렬하며 버린 픽셀 수. 뷰포트 범위에는 해당하지 않는다. */
  readonly discardedHeightDifference: number | null;
  /**
   * ⛔⭐ 캡처가 «정착한 뒤에» 찍혔나. `'timed-out'` 이면 ***안 그려진 화면을 찍었을 수 있다***.
   *
   * 🩸 왜 생겼나(2026-09-11): about.instagram 「원본」이 1048바이트 백지로 찍혔고,
   *    그 수가 픽셀 A/B 표로 «그대로» 흘러들어 「render 가 더 나쁘다」로 읽혔다.
   *    ⛔ 실제로는 ***백지끼리 비교***한 값이었다. 가설 다섯을 세워 전부 반증한 끝에 원인은 «부하»였는데,
   *    ⭐ 그 과정에서 ***자가 정착 결과를 «버리고» 있었다***는 것이 드러났다.
   * ⚠️ `'unmeasured'` 는 「정착했다」가 «아니다» — 안 준 것이다. 그래서 신뢰로 세지 않는다.
   */
  readonly originCaptureSettling?: CaptureSettling;
  readonly mirrorCaptureSettling?: CaptureSettling;
}

export interface FidelityVerdict {
  /** 실제로 비교한 캡처 범위 */
  readonly captureScope: CaptureScope;
  readonly renderLocation: RenderLocation;
  /** 미러 본문 / 렌더된 본문. 못 재면 null */
  readonly mirrorTextRatio: number | null;
  readonly pixelRmse: number | null;
  /** 원본 캡처의 픽셀-유래 near-blank 분류. */
  readonly originalNearBlankCapture: NearBlankCapture;
  /** 미러 캡처의 픽셀-유래 near-blank 분류. */
  readonly mirrorNearBlankCapture: NearBlankCapture;
  /** 양쪽 near-blank 분류가 이미지 통계로 측정됐고 뷰포트 픽셀 비교도 신뢰되는가. */
  readonly nearBlankClassificationReliable: boolean;
  /** wget의 링크 변환까지 완료했는지의 기계 판정. */
  readonly mirrorCompletion: MirrorCompletion;
  /** ⛔ 픽셀 수치를 신뢰할 수 있나 — 뷰포트로 안 잘랐거나 미러가 미완주면 false */
  readonly pixelTrustworthy: boolean;
  /** 캡처가 «정착 전»에 찍혔나. true 면 픽셀은 «중간 상태»를 잰 것이다. */
  readonly captureSettlingTimedOut: boolean;
  /** 사람이 읽는 한 줄. ⛔ 「못 쟀다」를 숨기지 않는다 */
  readonly summary: string;
  /** 못 잰 축의 «이름». 빈 배열이 「완전하다」를 뜻하지 않는다 */
  readonly unmeasured: readonly string[];
}

export function judgeFidelity(input: FidelityInput): FidelityVerdict {
  const captureScope = input.captureScope;
  const mirrorCompletion = input.mirrorCompletion ?? 'completed';
  const unmeasured: string[] = [];
  if (mirrorCompletion !== 'completed') unmeasured.push(`mirror-${mirrorCompletion}`);
  if (input.rawTextChars === null) unmeasured.push('raw-text');
  const rawHttpStatusFailed = input.rawHttpStatus !== null
    && (input.rawHttpStatus < 200 || input.rawHttpStatus >= 300);
  if (rawHttpStatusFailed) unmeasured.push('raw-http-status');
  if (input.renderedTextChars === null) unmeasured.push('rendered-text');
  if (input.mirrorTextChars === null) unmeasured.push('mirror-text');
  if (input.pixelRmse === null) unmeasured.push('pixel');
  const nearBlankCaptures = classifyNearBlankCaptures(
    input.originPixelStats ?? null,
    input.mirrorPixelStats ?? null,
  );
  if (nearBlankCaptures.original === 'unmeasured') unmeasured.push('original-near-blank');
  if (nearBlankCaptures.mirror === 'unmeasured') unmeasured.push('mirror-near-blank');
  if (input.measuredViewportHeight === null) unmeasured.push('viewport-height');
  if (captureScope === 'full-page' && input.discardedHeightDifference === null) unmeasured.push('full-page-height-alignment');

  const renderLocation = rawHttpStatusFailed
    ? 'unmeasured'
    : classifyRenderLocation(input.rawTextChars, input.renderedTextChars);
  const mirrorTextRatio =
    input.mirrorTextChars !== null && input.renderedTextChars !== null && input.renderedTextChars > 0
      ? input.mirrorTextChars / input.renderedTextChars
      : null;

  // ⛔ 픽셀 신뢰는 실제로 잰 뷰포트를 잘랐을 때만 성립한다. 전체 페이지 정렬은 이를 대체하지 않는다.
  // ⛔ 회수 병합(🅕 53차): 초안은 이 조건을 «기반»으로 이름을 바꿔 근접공백을 얹었고,
  //    main 은 그 사이 `mirrorCompletion === 'completed'` 를 «더했다». 둘 다 살린다.
  const viewportPixelTrustworthy = mirrorCompletion === 'completed'
    && captureScope === 'viewport'
    && input.croppedToViewport
    && input.measuredViewportHeight !== null;
  const nearBlankMeasurementsAvailable = nearBlankCaptures.original !== 'unmeasured'
    && nearBlankCaptures.mirror !== 'unmeasured';
  const nearBlankClassificationReliable = viewportPixelTrustworthy && nearBlankMeasurementsAvailable;
  const hasNearBlankCapture = nearBlankCaptures.original === 'near-blank'
    || nearBlankCaptures.mirror === 'near-blank';
  // ⛔⭐ 정착 «전»에 찍힌 캡처는 그림이 아니라 «중간 상태»다 — 픽셀 수치를 믿으면 안 된다.
  //    ⚠️ `unmeasured` 는 통과시킨다(옛 호출자·심이 이 값을 안 준다 — 「없다」를 「나쁘다」로 접지 않는다).
  // ⛔ 못 믿을 정착은 «둘»이다 — 「상한에 걸렸다」 ⊕ 「처음부터 비었다」.
  //    ⭐ `already-complete` 는 «믿는다» — 서버 렌더가 다 그려 놓은 «정상»이다.
  const untrustedSettling = (v: CaptureSettling | undefined) => v === 'timed-out' || v === 'blank';
  const captureSettlingTimedOut = untrustedSettling(input.originCaptureSettling)
    || untrustedSettling(input.mirrorCaptureSettling);
  const pixelTrustworthy = nearBlankClassificationReliable && !hasNearBlankCapture && !captureSettlingTimedOut;

  const parts: string[] = [`범위=${captureScope}`, `렌더=${renderLocation}`];
  if (mirrorCompletion === 'timed-out') parts.push('미러=시간 상한으로 미완주하여 링크 변환이 완료되지 않았을 수 있어 픽셀 품질을 읽을 수 없음');
  else if (mirrorCompletion === 'failed') parts.push('미러=실패로 미완주하여 링크 변환이 완료되지 않았을 수 있어 픽셀 품질을 읽을 수 없음');
  if (rawHttpStatusFailed) parts.push(`원문HTTP=${input.rawHttpStatus} 응답이라 못잼`);
  parts.push(mirrorTextRatio === null ? '본문=못잼' : `본문=${(mirrorTextRatio * 100).toFixed(1)}%`);
  if (input.pixelRmse === null) parts.push('픽셀=못잼');
  else parts.push(`픽셀RMSE=${(input.pixelRmse * 100).toFixed(2)}%${pixelTrustworthy ? '' : ' ⚠️미신뢰'}`);
  // ⛔ 「왜」 미신뢰인지 «이름»을 댄다 — 안 그러면 near-blank 와 구분이 안 된다.
  if (captureSettlingTimedOut) {
    // ⛔ 사유가 «둘»이다 — 접지 않는다. 「중간 상태를 잰 것」과 「아예 안 그려진 것」은 다른 고장이다.
    const blank = input.originCaptureSettling === 'blank' || input.mirrorCaptureSettling === 'blank';
    parts.push(blank
      ? '캡처 본문이 «비어 있다»(끝까지 0자) — 빈 그림끼리 비교하면 RMSE 가 «좋아진다»'
      : '캡처가 «정착 전»에 찍혔다(부하·느린 페이지) — 픽셀은 중간 상태를 잰 것이다');
  }
  parts.push(`근접공백=원본:${nearBlankCaptures.original}/미러:${nearBlankCaptures.mirror}${nearBlankClassificationReliable ? '' : ' ⚠️미신뢰'}`);
  if (hasNearBlankCapture) parts.push('캡처가 거의 비어 픽셀 차이 미신뢰');

  return {
    captureScope,
    renderLocation,
    mirrorTextRatio,
    pixelRmse: input.pixelRmse,
    originalNearBlankCapture: nearBlankCaptures.original,
    mirrorNearBlankCapture: nearBlankCaptures.mirror,
    nearBlankClassificationReliable,
    mirrorCompletion,
    pixelTrustworthy,
    captureSettlingTimedOut,
    summary: parts.join(' · '),
    unmeasured,
  };
}

/**
 * 가설 검정 — ***렌더 위치가 미러 충실성을 정하는가***.
 *
 * ⛔ 「역전」이 이 검정의 전부다: 서버 렌더인데 본문이 낮거나, 클라이언트 렌더인데 본문이 높은 표본.
 *    역전이 없으면 단조(monotonic)이고, 가설이 산다.
 * ⚠️ `mixed` 는 «양쪽 다 아니다» — 역전 판정에서 **뺀다**(경계라 어느 쪽으로도 못 센다).
 */
export interface HypothesisSample {
  readonly label: string;
  readonly renderLocation: RenderLocation;
  readonly mirrorTextRatio: number | null;
}

export interface HypothesisResult {
  readonly serverSamples: number;
  readonly clientSamples: number;
  readonly mixedSamples: number;
  readonly unmeasuredSamples: number;
  /** 서버인데 낮거나 · 클라이언트인데 높은 표본 */
  readonly inversions: readonly string[];
  /** ⛔ 표본이 적으면 «판정 안 한다» */
  readonly verdict: 'supported' | 'inverted' | 'insufficient';
}

export function testRenderLocationHypothesis(
  samples: readonly HypothesisSample[],
  serverFloor = 0.8,
  clientCeiling = 0.3,
): HypothesisResult {
  const inversions: string[] = [];
  let server = 0, client = 0, mixed = 0, un = 0;
  for (const s of samples) {
    if (s.renderLocation === 'unmeasured' || s.mirrorTextRatio === null) { un += 1; continue; }
    if (s.renderLocation === 'mixed') { mixed += 1; continue; }
    if (s.renderLocation === 'server') {
      server += 1;
      if (s.mirrorTextRatio < serverFloor) inversions.push(`${s.label}: server 인데 본문 ${(s.mirrorTextRatio * 100).toFixed(0)}%`);
    } else {
      client += 1;
      if (s.mirrorTextRatio > clientCeiling) inversions.push(`${s.label}: client 인데 본문 ${(s.mirrorTextRatio * 100).toFixed(0)}%`);
    }
  }
  // ⛔ 한쪽만 있으면 «대조»가 없다 — 가설은 두 무리의 «차이»를 주장하기 때문이다.
  const verdict: HypothesisResult['verdict'] =
    server < 2 || client < 2 ? 'insufficient' : inversions.length === 0 ? 'supported' : 'inverted';
  return { serverSamples: server, clientSamples: client, mixedSamples: mixed, unmeasuredSamples: un, inversions, verdict };
}
