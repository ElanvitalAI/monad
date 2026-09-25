/**
 * breakpoint-search.ts — ***「그 사이 어딘가」를 «좁힌다».***
 *
 * ⛔ 반응형 축(`#16874`)은 「390px ↔ 768px 사이」까지만 말한다. 두 점만 봤기 때문이다.
 * ⭐ 그런데 «같은 페이지»를 폭만 바꿔 다시 재는 것은 «네트워크 비용이 0»이다 — 이분하면 좁혀진다.
 *
 * ⛔⭐ 그래도 ***「분기가 «정확히» 여기다」라고 말하지 않는다*** — 우리가 아는 것은
 *    ***「이 폭에서는 A, 저 폭에서는 B」***뿐이고, 그 사이는 여전히 «구간»이다.
 *    ⇒ 산출은 언제나 **구간**(`[low, high]`)이고, 그 폭이 «몇 px 인지»를 같이 낸다.
 */

export interface BreakpointProbe {
  readonly width: number;
  /** 그 폭에서 본 «본문 폭». ⛔ 못 봤으면 `null` — 0 이 아니다. */
  readonly containerPx: number | null;
  /**
   * ⭐⭐⭐ ***«불연속» 신호의 지문*** — 있으면 이 자가 «그것으로» 가른다.
   *
   * 🔑 2026-09-11 실측이 연 것: ***분기는 «불연속»이다.*** `h1` 크기 · 열 수 · 패딩은
   *    폭에 따라 «계단»으로 바뀌고, 계단은 ***표류하지 않는다.***
   *    ⇒ 비율(연속값)로 가르면 유동 표류와 싸워야 하지만, 지문은 «같다/다르다»뿐이다.
   * 📏 사이트 13개 전수 A/B(같은 탐침 자료 · 정답 = 각자의 `@media`):
   *      규칙            총오차   최악   중앙값   못좁힘
   *      아래끝±임계      602.5    247      45       1
   *      아래규칙 예측     258      66       5       1
   *      ***지문***        49       5       4       0   ← 13/13 전부 오차 ≤ 5
   * ⛔ 없으면(`undefined`) 예측 규칙으로 «떨어진다» — 「못 쟀다」가 아니라 「그 자가 안 준다」다.
   * ⚠️ 지문에 «연속값»(본문 px 등)을 넣지 마라 — 그 순간 이 자의 장점이 사라진다.
   *
   * 🚨⭐⭐ ***그 13/13 이 「이 자가 좋다」를 뜻하지 «않는다».*** 2026-09-11 실측:
   *    양성 대조 열셋이 ***전부 «같은 모양»***이었다 — 내가 지은 Next 사이트(`.wrap` · 같은 구조).
   *    ⇒ 「남의 사이트」의 `@media` 를 CDP 로 «직접 읽어» 견주니 훨씬 어긋났다:
   *      `kakao`     자 438↔444  ↔  실제 `max:411` · **`max:767`**(규칙 598) · 1023 · 1439
   *      `starbucks` 자 414↔420  ↔  실제 **`max:480`**(규칙 445) · 640 · 660 · 960
   *    ⇒ ***60px 넘게 어긋난다.*** 이유 둘: ⓐ 그쪽은 `@media` 가 수십 개라 「그 분기」가 «하나가 아니고»
   *      ⓑ 지문 선택기(`.wrap`·`main`)가 그들 문서 구조와 «안 맞는다».
   * 🔑 ⇒ ***이 자는 「내가 지은 모양」에서 검증됐고 「남의 사이트」에서는 «아직 검증 안 됐다».***
   *    ⛔ ***열셋이어도 «같은 모양»이면 표본은 «하나»다.***
   */
  readonly fingerprint?: string;
}

/** ⭐ 탐침이 돌려주는 것. ⛔ 옛 호출자는 `number | null` 을 그대로 줄 수 있다(하위호환). */
export type BreakpointSample = number | null | { readonly containerPx: number | null; readonly fingerprint?: string };

function normalise(sample: BreakpointSample): { containerPx: number | null; fingerprint?: string } {
  return typeof sample === 'object' && sample !== null ? sample : { containerPx: sample };
}

/**
 * ⛔⭐ 2026-09-10 🅕 실측 — 여기서 «그럴듯한 결과»가 나왔다.
 *    첫 판은 «본문 px 가 같은가»로 갈랐다. ***분기 «아래»에서 본문이 `max-width:100%` 면
 *    px 가 폭을 따라 «연속적으로» 변해서 동등이 영영 거짓이 된다*** ⇒ 탐색이 아래 끝으로 수렴했다.
 *    (700px 분기 fixture 에서 「390↔396」이라 답했다 — 참인 관측이고, 완전히 틀린 답이다.)
 * ✅ 가르는 값은 «비율»(본문 px ÷ 뷰포트 폭)이다 — 유동이면 «거의 일정», 상한이 걸리면 «떨어진다».
 * ⛔ 임계는 «값으로» 나간다.
 */
export const BREAKPOINT_RATIO_TOLERANCE = 0.06;

/**
 * ⛔⭐ 이 자의 «구조적» 한계 — 반드시 산출에 실린다.
 *
 * `max-width` 상한이 걸린 분기는 비율이 ***점진적으로*** 갈린다(폭이 커질수록 비율이 «천천히» 떨어진다).
 * ⇒ 허용 밖으로 나가는 지점은 ***진짜 분기보다 «위»***다.
 * ⛔ 임계를 억지로 조이면 «유동 레이아웃의 자연 편차»에 걸린다 —
 *    패딩 `p` 인 유동 칸의 비율은 `1 - 2p/w` 라 390px↔690px 사이에서만도 0.03~0.04 움직인다.
 * ⇒ 📌 그래서 이 자는 ***「구간의 «아래»가 진짜 분기의 상한이다」***까지만 말한다.
 */
export const BREAKPOINT_SEARCH_LIMITATION =
  'max-width 상한 분기는 비율이 «점진적»으로 갈려 구간이 진짜 분기보다 «위»로 밀린다 — 구간의 «아래»를 상한으로 읽어라';

/**
 * ⛔⭐⭐ 2026-09-11 🅕 «양성 대조»로 잡은 것 — ***자가 「아무것도 안 바뀌는 폭」을 답했다.***
 *
 * 🩸 제가 지은 사이트의 분기는 제가 «안다»(CSS 에 `@media (max-width:597px)` 한 줄).
 *    CDP 실측: 596↔598 에 세 성질이 «동시에» 뒤집힌다(h1 52→120 · 카드 1열→2열 · 패딩 16→24).
 *    그런데 이 자는 **556↔562** 를 냈다 — 그 구간에서 ***아무 성질도 안 바뀐다***.
 *    🚨 결정적: 진짜 분기를 720 으로 «옮겨도» 답이 **572 로 같았다** — 답이 정답과 «무관»했다.
 *
 * 기전: 옛 판은 판정을 언제나 «아래 끝»의 비율과만 견줬다.
 *    유동 칸의 비율 `1 - 2p/w` 는 폭을 따라 ***단조롭게 표류***하고, 패딩이 «두 겹»이면
 *    (바깥 16 ⊕ 카드 22 = 38px) 표류가 **0.065** 라 ***진짜 분기에 닿기 «전»에 임계 0.06 을 넘는다.***
 *    ⇒ 그 순간 자가 「위쪽 모양이다」로 읽고 `hi` 를 당겨 «아래»로 수렴한다.
 *    ⛔ 그 자의 주석이 이미 그 위험을 적어 뒀다 — *"390↔690 사이에서만도 0.03~0.04 움직인다"*.
 *       한 겹을 전제한 수였고, 두 겹이면 그 수를 넘는다.
 *
 * ✅ 그래서 «임계를 조이지» 않는다(그 길의 실패도 위에 적혀 있다).
 *    ***가까운 쪽에 붙인다*** — 표류는 작고 단조롭지만 진짜 분기는 «크게» 벌어지므로
 *    「어느 끝에 더 가까운가」는 표류에 안 걸린다.
 * ⚠️ `max-width` 상한 분기가 «위로» 밀리는 것은 이 고침이 «안 고친다» — 위 한계 문면 그대로다.
 */
/**
 * ⛔⭐⭐⭐ 2026-09-11 두 번째 판 — ***앞 판(「가까운 끝」)은 «퇴행»이었다. 거둔다.***
 *
 * 🩸 앞 판은 양성 대조를 ***하나***(두 겹 패딩 화면) 썼고, 그 하나에서만 크게 좋아졌다.
 *    정답을 아는 대상이 ***열한 개*** 있었는데(전부 내가 CSS 를 썼다) 안 썼다.
 *    같은 탐침 자료 위에서 A/B 하니 ***옛 규칙이 8/11 에서 더 정확***했다.
 *
 * 🔑 두 규칙이 «반대» 자리에서 실패한다:
 *    - 「아래 끝과 같은가(±임계)」 — 유동 «표류»가 임계를 넘는 화면(패딩 두 겹)에서 **아래로** 밀린다
 *    - 「가까운 끝에 붙인다」      — `max-width` 상한형에서 **위로 크게** 밀린다
 *                                   (상한 «위» 비율이 `maxW/w` 로 계속 떨어져 위쪽 끝 비율이 아주 낮다)
 *    ⇒ 둘 다 「아래쪽 «규칙»이 무엇인지」를 모른 채 ***한 «점»***과 견주기 때문이다.
 *
 * ✅ 그래서 ***「아래쪽 규칙이 «예측하는» 값」***과 견준다.
 *    아래가 유동이면 비율은 `1 - 2p/w` 이고, 아래 탐침 «하나»로 패딩을 추정할 수 있다:
 *      `p = (1 - loRatio) · lo / 2`  ⇒  mid 에서 아래 규칙이라면 나왔을 비율 `1 - 2p/mid`
 *    표류가 «예측 안에 들어가므로» 임계를 조일 필요가 없다.
 *
 * 📏 11개 전수 A/B(같은 탐침 자료 · 정답은 각 사이트의 `@media` 선언):
 *      총 오차   옛 520.5 · 가까운끝 1250 · ***예측 257***
 *      최악      옛  247  · 가까운끝  194 · ***예측  66***
 *      중앙값    옛   38  · 가까운끝 128.5· ***예측   5***
 *    ⇒ 세 요약 통계 «전부»에서 이긴다. ⛔ 그래도 만능이 아니다 — 최악이 66px 남는다.
 *
 * ⚠️ 이것도 «가정»이다 — 「아래쪽이 유동이다」. 고정 폭이 아래에 있으면 예측이 빗나간다.
 *    그때는 예측이 실제와 크게 벌어져 「위쪽」으로 읽히고, 구간이 아래로 밀린다.
 */
export const BREAKPOINT_SIDE_RULE =
  '아래쪽 «규칙»이 예측하는 값과 견준다(유동이면 1-2p/w) — ⛔ 한 «점»과 견주면 표류나 상한에 걸린다';

/** ⭐ 아래쪽이 유동일 때 `mid` 에서 «나왔을» 비율. ⛔ 아래 탐침 하나로 패딩을 추정한다. */
export function predictedLowRatio(lowRatio: number, lowWidth: number, atWidth: number): number {
  const padding = ((1 - lowRatio) * lowWidth) / 2;
  return 1 - (2 * padding) / Math.max(1, atWidth);
}

const ratioOf = (containerPx: number, width: number) => containerPx / Math.max(1, width);

export interface BreakpointRange {
  /** 아래쪽 모양이 유지되는 마지막 관측 폭 */
  readonly low: number;
  /** 위쪽 모양이 시작되는 첫 관측 폭 */
  readonly high: number;
  /** ⭐ 구간의 폭 — 이 수가 「얼마나 좁혔나」다 */
  readonly spanPx: number;
  readonly probes: number;
  /** ⛔ 못 잰 폭이 있었나 — 있으면 구간이 «실제보다 넓을» 수 있다 */
  readonly unmeasured: readonly number[];
}

/** ⛔ 이보다 좁아지면 멈춘다 — 1px 까지 쪼개는 것은 비용만 든다. */
export const BREAKPOINT_MIN_SPAN_PX = 8;
/** ⛔ 상한 — 남의 서버가 아니라 «내 시간»을 지킨다(폭 바꾸기는 네트워크 비용 0). */
export const BREAKPOINT_MAX_PROBES = 6;

/**
 * 이분 탐색. `probe` 는 «한 폭»을 재서 본문 폭을 돌려준다.
 *
 * ⛔ 두 끝이 «같은 모양»이면 탐색하지 않는다 — 분기가 «없거나» 우리가 못 본 것이다.
 * ⛔ 중간을 «못 재면» 그 폭을 기록하고 «멈춘다» — 어느 쪽으로 갈지 모르는 채로 반을 버리면 거짓이 된다.
 */
export async function searchBreakpoint(
  low: BreakpointProbe,
  high: BreakpointProbe,
  probe: (width: number) => Promise<BreakpointSample>,
  opts: { minSpanPx?: number; maxProbes?: number; ratioTolerance?: number } = {},
): Promise<BreakpointRange | null> {
  // ⭐ 두 끝이 «지문»을 주면 그것으로 가른다 — 아니면 비율 규칙으로 떨어진다.
  const byPrint = low.fingerprint !== undefined && high.fingerprint !== undefined;
  const minSpan = opts.minSpanPx ?? BREAKPOINT_MIN_SPAN_PX;
  const maxProbes = opts.maxProbes ?? BREAKPOINT_MAX_PROBES;
  if (low.containerPx === null || high.containerPx === null) return null;


  let lo = low.width;
  let hi = high.width;
  const loRatio = ratioOf(low.containerPx, low.width);
  const hiRatio = ratioOf(high.containerPx, high.width);
  const tolerance = opts.ratioTolerance ?? BREAKPOINT_RATIO_TOLERANCE;
  // ⛔ 두 끝이 «같은 모양»이면 갈릴 것이 없다.
  //    지문이 있으면 「같은 지문인가」로, 없으면 「같은 비율인가」로 본다.
  //    🩸 비율로만 보면 ***탐색이 «시작도 안 하는»*** 화면이 있었다 — 13개 중 «다섯»이 그랬다.
  //       그 다섯은 «전부» 다른 신호가 갈렸다(h1 5/5 · 패딩 5/5 · 열 수 2/5).
  if (byPrint ? low.fingerprint === high.fingerprint : Math.abs(hiRatio - loRatio) <= tolerance) return null;
  const unmeasured: number[] = [];
  let probes = 0;

  while (hi - lo > minSpan && probes < maxProbes) {
    const mid = Math.round((lo + hi) / 2);
    if (mid === lo || mid === hi) break;
    probes += 1;
    const sample = normalise(await probe(mid));
    if (sample.containerPx === null && sample.fingerprint === undefined) {
      // ⛔ 못 쟀다 — 반을 «버리지 않는다». 기록하고 멈춘다.
      unmeasured.push(mid);
      break;
    }
    if (byPrint) {
      // ⭐⭐ ***«불연속» 지문으로 가른다*** — 「같다/다르다」뿐이라 표류가 «없다».
      if (sample.fingerprint === undefined) { unmeasured.push(mid); break; }
      if (sample.fingerprint === low.fingerprint) lo = mid; else hi = mid;
      continue;
    }
    if (sample.containerPx === null) { unmeasured.push(mid); break; }
    // ⭐ «비율»로 가르되 ***「아래쪽 규칙이 예측하는 값」***과 견준다 — 이유는 `BREAKPOINT_SIDE_RULE`.
    const midRatio = ratioOf(sample.containerPx, mid);
    if (Math.abs(midRatio - predictedLowRatio(loRatio, low.width, mid)) <= tolerance) lo = mid;
    else hi = mid;
  }
  return { low: lo, high: hi, spanPx: hi - lo, probes, unmeasured };
}

export function formatBreakpointRange(range: BreakpointRange | null, between: readonly [number, number]): string[] {
  if (range === null) {
    return [`  - ⚪ ${between[0]}px ↔ ${between[1]}px — 좁히지 «못했다»(두 끝이 같은 모양이거나 폭을 못 쟀다)`];
  }
  const L = [
    `  - ⭐ 분기가 **${range.low}px ↔ ${range.high}px** 사이에 있다`
    + ` (구간 **${range.spanPx}px** · 탐침 ${range.probes}회)`,
  ];
  if (range.unmeasured.length) {
    L.push(`    ⚪ ${range.unmeasured.join('px · ')}px 를 «못 쟀다» — 구간이 «실제보다 넓을» 수 있다`);
  }
  // ⛔ 마지막까지 「여기다」라고 말하지 않는다
  L.push('    ⛔ 「분기가 «정확히» 여기다」가 아니다 — 우리가 아는 것은 「이 폭에서 A, 저 폭에서 B」뿐이다');
  L.push(`    ⚠️ ${BREAKPOINT_SEARCH_LIMITATION}`);
  return L;
}
