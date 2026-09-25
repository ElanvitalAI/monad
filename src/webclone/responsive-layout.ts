/**
 * responsive-layout.ts — ***한 폭에서만 재면 「반응형 분기」가 안 보인다.***
 *
 * ⛔ `layout-tokens.ts` 의 첫 번째 사각이 `one-viewport` 였다. 이 자가 그 칸을 연다.
 *
 * ⭐ 무엇을 답하나 — 「이 값은 폭이 바뀌어도 «그대로»인가, 아니면 «따라 변하나»」.
 *    ⇒ 그대로면 **토큰**(디자인 결정)이고, 따라 변하면 **유동**(계산 결과)이다.
 *    ⛔ 둘을 섞으면 씨앗이 「그 폭에서만 참인 수」를 «디자인 의도»처럼 담는다.
 *
 * ⛔⭐ 이 자는 «폭»만 바꾼다 — 기기·터치·픽셀비는 «다른 축»이고 안 건드린다.
 */

import type { LayoutReport } from './layout-tokens.js';

export interface ViewportSample {
  readonly width: number;
  readonly report: LayoutReport;
}

export interface ResponsiveSpacing {
  readonly px: number;
  /** 이 값이 «나타난» 폭들 */
  readonly widths: readonly number[];
  /** 전 폭에 나타났나 */
  readonly stable: boolean;
}

export interface ResponsiveContainer {
  readonly width: number;
  /** 그 폭에서 «가장 흔한» 본문 폭. ⛔ null 은 「못 봤다」 — 0 이 아니다. */
  readonly containerPx: number | null;
  readonly ratio: number | null;
}

export interface ResponsiveReport {
  readonly widths: readonly number[];
  /** 전 폭에 나타난 간격 — «토큰»으로 볼 만한 것 */
  readonly stableSpacing: readonly ResponsiveSpacing[];
  /** 일부 폭에만 나타난 간격 — «유동»이거나 «그 폭 전용» */
  readonly fluidSpacing: readonly ResponsiveSpacing[];
  readonly containers: readonly ResponsiveContainer[];
  /**
   * ⭐ 분기 «후보» — 이웃한 두 폭 사이에서 본문 폭 «비율»이 크게 튄 자리.
   * ⛔ 「분기가 여기다」가 «아니다» — 그 사이 어딘가라는 뜻이다(우리는 두 점만 봤다).
   */
  readonly breakpointHints: readonly {
    readonly between: readonly [number, number];
    readonly ratioJump: number;
    /** ⭐ 본문 «px» 도 같이 바뀌었나. `false` 면 분기가 아니라 «상한(max-width)»이다. */
    readonly containerPxChanged: boolean;
  }[];
  /** ⭐ 폭이 커져도 본문 px 가 «안 변한» 자리 — `max-width` 상한의 증거 */
  readonly cappedAt: number | null;
  /** ⭐⭐ 이웃한 두 폭 사이에서 «눈금 자체가 비례해 커졌나». 빈 배열은 「안 비례한다」거나 「못 봤다」 */
  readonly proportionalScales: readonly ProportionalScale[];
  /** ⛔ 표본이 하나뿐이면 위 판정이 «성립하지 않는다» */
  readonly sufficient: boolean;
  readonly note: string;
}

/** 비율이 이만큼 튀면 「분기 후보」로 본다. ⛔ 임계는 «값으로» 나간다. */
export const BREAKPOINT_RATIO_JUMP = 0.15;

/**
 * ⛔⭐ 본문 px 변화가 «분기»인지 «연속 드리프트»인지 가르는 값.
 * 자기 크기의 이 비율보다 작게 변했으면 ***분기가 아니다*** —
 * `clamp()`·`vw`·`%` 는 폭을 따라 «조금씩» 움직인다.
 * ⛔ 임계를 «값으로» 낸다 — 왜 통과·탈락했는지 읽는 쪽이 다시 잴 수 있게.
 */
export const CONTAINER_STEP_RATIO = 0.02;

/** 눈금이 «비례해» 커졌다고 부르려면 이만큼은 맞아야 한다. ⛔ 임계는 «값으로» 나간다. */
export const PROPORTIONAL_MATCH_RATIO = 0.6;
/** ⛔ 비율에는 «최소 개수»도 건다 — 다섯 중 셋은 «우연»히 맞을 수 있다(실측으로 그랬다). */
export const MIN_PROPORTIONAL_MATCHES = 4;

/**
 * ⛔⭐⭐ 오차 «모형»이 둘로 갈린다 — 하나로 두면 둘 중 하나가 반드시 틀린다.
 *   ⓐ **반올림** — 실제 눈금은 정수 px 로 «떨어진다»(rem 뿌리 ×1.125 → 13px 이 14px 로 앉는다).
 *      그래서 ±0.5px 는 «비례해도 반드시 생기는» 오차다. 이걸 빼면 진짜 비례가 «탈락»한다.
 *   ⓑ **상대** — 값이 클수록 허용도 커야 한다.
 * 📏 2026-09-10 실측이 «양쪽»을 다 잡았다:
 *   · 바닥이 0.75px 이었을 때 ⇒ 목표 2px 의 허용이 ±37% ⇒ ***무작위 잡음의 80% 가 「비례」로 판정***.
 *   · 상대 4% «만» 뒀을 때 ⇒ crates.io 의 «진짜» 13→14(오차 4.3%)가 «탈락»했다.
 * ⇒ 허용 = 0.5px(반올림) + 목표×2%. ⛔ 임계는 값으로 나간다.
 */
export const PROPORTIONAL_TOLERANCE = 0.02;
export const PROPORTIONAL_ROUNDING_PX = 0.5;
/** 두 비율이 이보다 가까우면 «같은 비율»로 본다(후보 중복 제거·모호성 판정에 쓴다). */
export const PROPORTIONAL_RATIO_EPSILON = 0.02;
/**
 * ⛔⭐ 비율 «후보»를 뽑을 때 기준으로 삼는 상위(=가장 흔한) 간격의 수.
 * 가설: ***눈금이 비례해 움직이면 가장 많이 쓰인 간격이 «반드시» 따라 움직인다.***
 * ⛔ 값으로 내보낸다 — 늘리면 후보가 늘고 우연 적중이 «다시» 오른다.
 */
export const PROPORTIONAL_ANCHOR_COUNT = 3;

export interface ProportionalScale {
  readonly from: number;
  readonly to: number;
  /** `to` 의 값 ≈ `from` 의 값 × ratio */
  readonly ratio: number;
  readonly matched: number;
  readonly total: number;
  /**
   * ⛔⭐ ***`ratio === 1` 은 「비례한다」가 «아니라» 「안 바뀐다」다*** — 영가설이다.
   * 그것을 「눈금이 비례해 커진다 ⭐⭐」로 쓰면 ***참인데 아무 말도 안 하는 수***가 된다.
   */
  readonly kind: 'grows' | 'shrinks' | 'unchanged';
}

/** ⛔ 비율을 «방향»과 함께 읽는다 — 0.5 를 「커진다」라고 쓴 판이 있었다(apple 실측). */
export function describeScale(p: ProportionalScale): string {
  if (p.kind === 'unchanged') {
    return `눈금이 «안 바뀐다»: ${p.from}px → ${p.to}px 에서 ×1 (상위 ${p.total}종 중 ${p.matched}종이 그대로) — ⛔ 「비례」가 아니라 «영가설»이다`;
  }
  const word = p.kind === 'grows' ? '커진다' : '작아진다';
  return `***눈금이 «비례해» ${word}***: ${p.from}px → ${p.to}px 에서 **×${p.ratio}** (상위 ${p.total}종 중 ${p.matched}종이 맞는다)`;
}

/**
 * ⭐⭐ ***「유동 22종」이 아니라 「한 눈금, 세 크기」일 수 있다.***
 *
 * 📏 2026-09-10 🅕 실측(crates.io): 폭별 «가장 흔한» 간격이 `7 / 8 / 9`(390/768/1280)이고
 *    `14/16/18` · `21/24/27` · `48/54` 도 «같은 비율»이었다 ⇒ ***root font-size 가 폭에 따라 커지는 rem 눈금***.
 * ⛔ 그것을 「폭마다 다른 값 22개」로 적으면 ***다시 지을 수가 없다***. 비율을 알면 «한 줄»로 짓는다.
 *
 * ⛔ 못 찾으면 `null` — 「비례하지 않는다」와 「내가 못 봤다」를 문면으로 가른다(부르는 쪽에서).
 */
export function detectProportionalScale(
  from: { width: number; spacing: readonly number[] },
  to: { width: number; spacing: readonly number[] },
  minMatchRatio = PROPORTIONAL_MATCH_RATIO,
): ProportionalScale | null {
  // ⛔⭐ 「상위」는 «가장 흔한» 것이다 — 들어오는 배열이 이미 빈도순이다.
  //    오름차순으로 다시 정렬하면 ***가장 «작은» 12종***을 집는데, 작은 값은 아무 비율에나 맞는다.
  //    📏 2026-09-10 실측: 그 정렬 한 줄이 무작위 대조군 적중률을 끌어올린 축 중 하나였다.
  const a = [...new Set(from.spacing.filter((v) => v > 0))].slice(0, 12);
  const b = new Set(to.spacing.filter((v) => v > 0));
  if (a.length < 3 || b.size < 3) return null;

  // ⛔ 비율을 «임의로 훑지» 않는다 — 실제로 관측된 두 값의 «몫»만 후보로 쓴다.
  //    그래야 「어디서 온 비율인가」를 말할 수 있다.
  // ⛔⭐⭐ 후보를 «모든 쌍»에서 뽑으면 168개가 나오고, 그중 하나는 «반드시» 맞는다.
  //    🔑 눈금이 정말 비례해 움직이면 ***가장 «많이 쓰인» 간격이 «반드시» 따라 움직인다*** —
  //    그래서 후보를 「상위 세 종의 몫」으로 좁힌다. 이것은 임계가 아니라 «가설»이다.
  const anchors = a.slice(0, PROPORTIONAL_ANCHOR_COUNT);
  const candidates = new Set<number>();
  for (const x of anchors) for (const y of b) {
    const r = y / x;
    if (r >= 0.5 && r <= 2) candidates.add(Math.round(r * 1000) / 1000);
  }
  const bs = [...b].sort((x, y) => x - y);
  // ⛔⭐ 오차를 «절대 ±1px» 로 두면 «가짜 비율»이 통과한다 — 2026-09-10 실측:
  //    ratio 0.585 에서 `7→4.1`(정답 8) 이 「1px 차이」로 맞다고 세어져 3/5 가 나왔다.
  //    4px 짜리에 1px 은 «25% 오차»다. ⇒ 허용을 «상대값»으로 조인다.
  // ⭐ 그리고 「몇 %」만이 아니라 «최소 개수»도 건다 — 다섯 중 셋은 우연히 맞을 수 있다.
  const fits = (v: number, ratio: number) => {
    const target = v * ratio;
    const nearest = bs.reduce((p, q) => (Math.abs(q - target) < Math.abs(p - target) ? q : p), bs[0]);
    return Math.abs(nearest - target) <= PROPORTIONAL_ROUNDING_PX + target * PROPORTIONAL_TOLERANCE;
  };

  // ⛔⭐⭐⭐ ***영가설을 «먼저» 기각한다.*** 「안 바뀐다」가 참이면 비율 탐색은 «할 필요가 없고»,
  //    하면 «자기 닮음» 사다리(4·8·16…)에서 ×1 과 ×2 가 둘 다 맞아 모호로 샌다.
  //    ⇒ 상위 세 종이 «그대로» 있으면 그것이 답이다 — 그리고 그것은 「비례」가 «아니다».
  if (anchors.every((v) => fits(v, 1))) {
    const matched = a.filter((v) => fits(v, 1)).length;
    return { from: from.width, to: to.width, ratio: 1, matched, total: a.length, kind: 'unchanged' };
  }

  const passing: { ratio: number; matched: number }[] = [];
  for (const ratio of candidates) {
    // ⛔ 영가설은 위에서 이미 봤다 — 여기서 다시 세면 「안 바뀐다」가 「비례한다」로 «둔갑»한다.
    if (Math.abs(ratio - 1) <= PROPORTIONAL_RATIO_EPSILON) continue;
    // ⛔⭐ 가설을 «그대로» 관문으로 쓴다 — 눈금이 비례하면 ***상위 세 종이 «전부» 따라간다***.
    //    하나라도 안 따라가면 그 비율은 「눈금」이 아니라 「우연히 맞은 몇 개」다.
    if (!anchors.every((v) => fits(v, ratio))) continue;
    const matched = a.filter((v) => fits(v, ratio)).length;
    if (matched < MIN_PROPORTIONAL_MATCHES) continue;
    if (matched / a.length < minMatchRatio) continue;
    passing.push({ ratio, matched });
  }
  if (passing.length === 0) return null;

  // ⛔⭐⭐ ***두 «다른» 비율이 둘 다 상위 세 종을 설명하면 그것은 「비례한다」가 아니라 「모호하다」다.***
  //    후보를 관측된 몫에서 뽑으므로 후보가 수십 개 나오고, 그중 하나는 «쉽게» 맞는다.
  //    📏 2026-09-10 실측: 이 관문들이 없을 때 무작위 잡음의 **80%** 가 「비례」로 판정됐다.
  //    ⛔ 「가장 잘 맞는 것을 고른다」로는 못 막는다 — 잡음도 «가장 잘 맞는 것»을 가진다.
  const sorted = [...passing].sort((x, y) => y.matched - x.matched || x.ratio - y.ratio);
  const winner = sorted[0]!;
  // ⛔⭐⭐ 「가장 잘 맞는 것을 고른다」로는 못 막는다 — ***잡음도 «가장 잘 맞는 것»을 가진다.***
  //    ⛔ 같은 비율의 반올림 이웃(1.125 ↔ 1.126)은 «한 식구»라 경쟁자가 아니다.
  //    ⇒ ***다른 식구가 «하나라도» 관문을 통과하면 그것은 「비례」가 아니라 「모호」다.***
  //    📏 2026-09-10 실측이 양쪽에서 이 선을 못 박았다:
  //      · 이 관문이 «없을» 때 무작위 잡음의 80% 가 「비례」로 판정됐다.
  //      · ⚠️ 대가가 있다 — crates.io 를 8종으로 «자르면» 1.077 과 1.125 가 둘 다 5종을 설명해
  //        이 자는 「모호」로 «물러선다»(옛 자는 느슨한 허용 덕에 1.125 를 냈고, 그 답은 맞았다).
  //        ⇒ 사다리 «전체»(9종)를 주면 1.125 하나만 남아 다시 잡힌다. 잘린 표본에서 물러서는 것이
  //        ***잡음의 80% 에 「비례」를 붙이는 것보다 싸다*** — 그것이 이 맞바꿈의 근거다.
  const rival = sorted.find((t) => Math.abs(t.ratio - winner.ratio) / winner.ratio > PROPORTIONAL_RATIO_EPSILON);
  if (rival !== undefined) return null;

  const ratio = winner.ratio;
  const top = winner.matched;
  // ⚪ 여기까지 왔으면 ratio 는 1 이 아니다(위에서 걸렀다) — 남은 것은 «방향»뿐이다.
  const kind: ProportionalScale['kind'] = ratio > 1 ? 'grows' : 'shrinks';
  return { from: from.width, to: to.width, ratio, matched: top, total: a.length, kind };
}

export function compareLayoutAcrossViewports(samples: readonly ViewportSample[]): ResponsiveReport {
  const widths = samples.map((s) => s.width).sort((a, b) => a - b);
  if (samples.length < 2) {
    return {
      widths,
      stableSpacing: [],
      fluidSpacing: [],
      containers: [],
      breakpointHints: [],
      cappedAt: null,
      proportionalScales: [],
      sufficient: false,
      // ⛔ 「분기가 없다」가 아니라 「한 폭만 봤다」다 — 그 둘은 다른 값이다
      note: `표본이 ${samples.length}개뿐 — ⚪ 「반응형 분기가 없다」가 «아니라» «못 쟀다»`,
    };
  }

  const byPx = new Map<number, number[]>();
  for (const sample of samples) {
    for (const step of sample.report.spacing) {
      byPx.set(step.px, [...(byPx.get(step.px) ?? []), sample.width]);
    }
  }
  const all: ResponsiveSpacing[] = [...byPx.entries()]
    .map(([px, ws]) => ({ px, widths: [...new Set(ws)].sort((a, b) => a - b), stable: new Set(ws).size === samples.length }))
    .sort((a, b) => b.widths.length - a.widths.length || a.px - b.px);

  const containers: ResponsiveContainer[] = [...samples]
    .sort((a, b) => a.width - b.width)
    .map((s) => {
      const top = s.report.containers[0] ?? null;
      return { width: s.width, containerPx: top ? top.px : null, ratio: top ? top.ratio : null };
    });

  // ⛔ 읽기 전용 타입에 push 할 수 없다 — 만드는 동안은 «가변», 내보낼 때 «읽기 전용»
  const hints: { between: [number, number]; ratioJump: number; containerPxChanged: boolean }[] = [];
  for (let i = 1; i < containers.length; i += 1) {
    const a = containers[i - 1];
    const b = containers[i];
    // ⛔ 한쪽이라도 «못 봤으면» 분기를 «말하지 않는다» — 0 으로 몰면 거짓 분기가 생긴다
    if (a.ratio === null || b.ratio === null) continue;
    const jump = Math.abs(b.ratio - a.ratio);
    if (jump < BREAKPOINT_RATIO_JUMP) continue;
    // ⛔⭐ 2026-09-10 🅕 실측 — 「분기」와 「상한」을 «가른다».
    //    본문 폭이 `max-width` 로 «고정»이면, 뷰포트가 커질수록 «비율»만 떨어진다.
    //    그것은 ***분기가 아니다*** — 비율만 보고 「여기 분기가 있다」로 읽으면 «그럴듯한 거짓»이다.
    //    ✅ 가르는 값: 본문 «px» 도 같이 바뀌었나.
    // ⛔⭐⭐ 2026-09-10 «두 번째» 실측 — ***「달라졌다」로는 부족하다.***
    //    📏 다시 지은 화면에서 본문이 600~1140px 내내 **530px 고정**이었는데
    //       1280px 에서 **522px** 이 됐다. 분기가 아니라 ***`--u: clamp(8px, .703vw, 9px)` 가
    //       8→9 로 «미끄러져» 안쪽 여백이 8px 자란 것***이다.
    //    ⇒ 그 1.5% 드리프트를 「분기」로 읽자 이분 탐색이 ***없는 분기(840↔848)를 «자신 있게»*** 답했다.
    //    ✅ 가르는 값: 변화가 «자기 크기에 비해 큰가». 연속 드리프트는 «작다».
    const containerPxChanged = a.containerPx !== null && b.containerPx !== null
      && Math.abs(a.containerPx - b.containerPx) / Math.max(1, a.containerPx, b.containerPx) > CONTAINER_STEP_RATIO;
    hints.push({ between: [a.width, b.width], ratioJump: Math.round(jump * 1000) / 1000, containerPxChanged });
  }

  // 폭이 커졌는데 본문 px 가 «그대로»인 첫 자리 = 상한
  let cappedAt: number | null = null;
  for (let i = 1; i < containers.length; i += 1) {
    const a = containers[i - 1];
    const b = containers[i];
    if (a.containerPx !== null && b.containerPx !== null && a.containerPx === b.containerPx) {
      cappedAt = a.containerPx;
      break;
    }
  }

  // ⭐ 이웃한 두 폭 사이에서 «눈금이 비례해 커졌나» — 「유동 N종」을 「한 눈금, 여러 크기」로 접는다
  const ordered = [...samples].sort((a, b) => a.width - b.width);
  const proportionalScales: ProportionalScale[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const found = detectProportionalScale(
      { width: ordered[i - 1].width, spacing: ordered[i - 1].report.spacing.map((x) => x.px) },
      { width: ordered[i].width, spacing: ordered[i].report.spacing.map((x) => x.px) },
    );
    if (found) proportionalScales.push(found);
  }

  return {
    widths,
    proportionalScales,
    stableSpacing: all.filter((s) => s.stable),
    fluidSpacing: all.filter((s) => !s.stable),
    containers,
    breakpointHints: hints,
    cappedAt,
    sufficient: true,
    note: `폭 ${widths.join('·')} 에서 쟀다 — ⛔ 그 «사이»는 안 봤다`,
  };
}

/** DESIGN.md 의 `### 반응형` 절. ⛔ 「없다」와 「못 쟀다」를 가른다. */
export function renderResponsiveSection(report: ResponsiveReport): string[] {
  const L = ['### 반응형 — 폭이 바뀌면 무엇이 «따라 변하나»', ''];
  if (!report.sufficient) {
    L.push(`⚪ ${report.note}`);
    return L;
  }
  L.push(`> ${report.note}`);
  L.push('');
  // ⭐⭐ 비례가 잡히면 «먼저» 말한다 — 그것이 「유동 N종」의 «뜻»이다
  if (report.proportionalScales.length) {
    for (const p of report.proportionalScales) {
      L.push(`- ${p.kind === 'unchanged' ? '⚪' : '⭐⭐'} ${describeScale(p)}`);
    }
    L.push('> 🔑 그러면 아래 「유동」은 «다른 값들»이 아니라 ***같은 눈금의 다른 크기***다 —');
    L.push('> ⭐ 다시 지을 때 «값을 나열»하지 말고 «비율 한 줄»로 짓는다(rem 뿌리를 폭에 따라 키우는 식).');
    L.push('');
  }
  L.push(`- 전 폭에 나타난 간격(«토큰» 후보): ${report.stableSpacing.length ? report.stableSpacing.map((s) => `${s.px}px`).join(' · ') : '⚪ 없다'}`);
  L.push(`- 일부 폭에만 나타난 간격(«유동»): ${report.fluidSpacing.length ? report.fluidSpacing.map((s) => `${s.px}px(${s.widths.join(',')})`).join(' · ') : '없다'}`);
  L.push('');
  if (report.cappedAt !== null) {
    L.push(`- ⭐ 본문 «상한»: **${report.cappedAt}px** — 폭이 더 커져도 본문은 «안 넓어진다»`);
    L.push('');
  }
  L.push('| 뷰포트 폭 | 본문 폭 | 비율 |');
  L.push('|---|---|---|');
  for (const c of report.containers) {
    L.push(`| ${c.width}px | ${c.containerPx === null ? '⚪ 못 봤다' : `${c.containerPx}px`} | ${c.ratio === null ? '⚪' : `${(c.ratio * 100).toFixed(0)}%`} |`);
  }
  L.push('');
  if (report.breakpointHints.length) {
    for (const h of report.breakpointHints) {
      L.push(h.containerPxChanged
        ? `- ⭐ 분기 «후보»: ${h.between[0]}px ↔ ${h.between[1]}px 사이 — 본문 «px 도» 바뀐다 (비율 ${(h.ratioJump * 100).toFixed(0)}%p)`
        : `- ⚪ 분기 «아님»: ${h.between[0]}px ↔ ${h.between[1]}px — 본문 px 가 «그대로»고 비율만 ${(h.ratioJump * 100).toFixed(0)}%p 떨어진다 ⇒ «상한(max-width)»이다`);
    }
    L.push('> ⛔ 「분기가 여기다」가 «아니다» — 그 «사이» 어딘가라는 뜻이다(우리는 두 점만 봤다).');
  } else {
    L.push(`- 분기 후보: 없다 (임계 ${(BREAKPOINT_RATIO_JUMP * 100).toFixed(0)}%p) — ⛔ 「반응형이 아니다」가 «아니다»`);
  }
  return L;
}
