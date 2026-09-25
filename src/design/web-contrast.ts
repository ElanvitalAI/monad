/**
 * web-contrast.ts — ***「화면의 글자가 «읽히나»」***(WCAG 대비).
 *
 * ⛔⭐⭐ 왜 있나(2026-09-12 🅕): 이 저장소의 `screen-contrast.ts` 는 ***TUI(ANSI) 화면***을 잰다.
 *    ***웹 화면의 대비를 재는 자가 «없었다».***
 *
 * 📏 배선 «전»에 실측해 변별력을 확인했다(사다리 ①):
 * ```
 *   대상               잰 것   읽기 실패        최악
 *   bilryo-dongne       58     31 (53%) 🚨   2.10 < 4.5 @13px
 *   dongne-hanbaqui    109     11 (10%)      4.15 < 4.5 @14px
 *   netflix             95     10 (11%)      1.54 < 3   @64px
 *   jongi-jip           55      1 ( 2%)      3.76 < 4.5
 *   airbnb              78      0 ( 0%) ✅   —
 * ```
 * ⇒ ***0% ~ 53% 로 «넓게» 갈린다*** ⊕ ***상용도 «0을 낼 수 있다»***(airbnb) ⊕
 *    ***상용도 «실패한다»***(netflix 11%) — 「자작만 벌하는」 자가 아니다.
 *
 * ⛔ 이 파일은 브라우저를 «안 띄운다» — 값을 «받는다».
 * ⛔ 대비 «계산»은 WCAG 2.x 정의 그대로다. ⚠️ 그 기준이 «옳은가»는 이 자가 답하지 않는다.
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들 — 「0건」을 「없다」로 읽지 않게 «값으로» 낸다. */
export const WEB_CONTRAST_BLIND_SPOTS: readonly string[] = [
  'image-behind-text: 글자 «뒤»가 이미지·그라디언트면 바탕색을 «못 고른다» — 가장 가까운 «불투명» 조상 배경을 쓴다',
  'alpha-text: 반투명 글자색의 «합성 결과»가 아니라 «선언값»으로 잰다',
  'one-state: 가리킴·누름 상태의 색은 «안 본다»',
  'own-text-only: «자기 텍스트 노드»를 가진 요소만 잰다 — 자식이 담은 글자는 «그 자식»이 잰다',
  'wcag-only: WCAG 2.x 문턱(4.5 · 큰 글자 3)만 본다 — 그 기준이 «옳은가»는 안 묻는다',
];

/** 0~255 세 칸. */
export interface Rgb255 { readonly r: number; readonly g: number; readonly b: number }

/** ⭐ 상대 휘도(WCAG 2.x). ⛔ 재발명이 아니라 «웹 표준 정의» 그대로다. */
export function relativeLuminance({ r, g, b }: Rgb255): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** ⭐ 대비비(1~21). ⛔ 순서를 안 가린다 — 밝은 쪽이 분자다. */
export function contrastRatio(a: Rgb255, b: Rgb255): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * ⭐ 「큰 글자」인가 — WCAG 는 큰 글자에 낮은 문턱(3)을 준다.
 * ⛔ 기준은 ***24px 이상*** 또는 ***18.66px 이상이면서 굵기 700 이상***이다.
 */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  if (!Number.isFinite(fontSizePx) || !Number.isFinite(fontWeight)) return false;
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

/** 필요한 문턱. */
export function requiredRatio(fontSizePx: number, fontWeight: number): number {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}

/** 한 자리의 관측. */
export interface ContrastSample {
  readonly ratio: number;
  readonly fontSizePx: number;
  readonly fontWeight: number;
  /** 사람이 읽을 한 줄 — ⛔ 「수」만 내면 고칠 수 없다 */
  readonly detail: string;
}

/** 실패한 «색 ↔ 바탕» 쌍 하나. ⭐ 고치는 단위는 «자리»가 아니라 «쌍»이다. */
export interface FailingPair {
  /** `detail` 에서 뽑은 대표 문면 */
  readonly detail: string;
  /** 이 쌍이 «몇 자리»에서 나왔나 */
  readonly count: number;
  /** 가장 나쁜 대비 */
  readonly worstRatio: number;
}

export interface WebContrastReport {
  /** 잰 «자리» 수. ⛔ 이것이 분모다 */
  readonly measured: number;
  readonly failures: readonly ContrastSample[];
  /** 0~1 */
  readonly failureRatio: number;
  /**
   * ⛔⭐⭐ 🩸 ***「가장 나쁜 다섯」만 내니 수리가 «수렴하지 않았다»*** (2026-09-12 실측):
   *    고칠 때마다 «다음 다섯»이 나와 세 판을 돌고도 안 끝났다.
   * ⇒ ***실패한 «쌍»을 «전부» 낸다*** — 자리는 수백이어도 «쌍»은 몇 개다.
   */
  readonly failingPairs: readonly FailingPair[];
}

/**
 * 관측된 자리들에서 «읽히지 않는» 것을 고른다.
 * ⛔ 잰 자리가 «하나도» 없으면 `null` — ***「실패 0」이 «아니다»***.
 */
export function judgeWebContrast(samples: readonly ContrastSample[]): WebContrastReport | null {
  if (samples.length === 0) return null;
  const failures = samples
    .filter((s) => s.ratio < requiredRatio(s.fontSizePx, s.fontWeight))
    // ⭐ 나쁜 것부터 — 고칠 순서가 곧 그 순서다.
    .sort((a, b) => a.ratio - b.ratio);
  // ⭐ 「자리」가 아니라 «쌍»으로 접는다 — 고치는 단위가 그것이다.
  const byPair = new Map<string, { count: number; worstRatio: number }>();
  for (const f of failures) {
    // ⛔ 「색 on 바탕」까지가 쌍이다 — 끝의 «비율»과 «@px» 둘만 뗀다.
    //    🩸 첫 판은 `split(') ')[0]` 로 잘라 ***바탕을 잃었다***(색만 남아 어디서 나쁜지 몰랐다).
    const words = f.detail.split(' ');
    const key = words.length > 2 ? words.slice(0, -2).join(' ') : f.detail;
    const prev = byPair.get(key);
    byPair.set(key, {
      count: (prev?.count ?? 0) + 1,
      worstRatio: prev === undefined ? f.ratio : Math.min(prev.worstRatio, f.ratio),
    });
  }
  const failingPairs = [...byPair]
    .map(([detail, v]) => ({ detail, count: v.count, worstRatio: v.worstRatio }))
    .sort((a, b) => a.worstRatio - b.worstRatio);
  return { measured: samples.length, failures, failureRatio: failures.length / samples.length, failingPairs };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderWebContrast(report: WebContrastReport | null): string {
  if (report === null) return '⚪ 못 쟀다 — 글자를 담은 자리를 «하나도» 못 읽었다(「실패 0」이 아니다)';
  if (report.failures.length === 0) return `✅ 잰 자리 ${report.measured}곳이 «전부» 읽힌다(WCAG)`;
  // ⛔ 「쌍」을 «전부» 낸다 — 일부만 보이면 수리가 수렴하지 않는다.
  const pairs = report.failingPairs.map((p) => `${p.detail} ${p.worstRatio.toFixed(2)}×${p.count}`).join(' · ');
  return `⚠️ 잰 자리 ${report.measured}곳 중 ${report.failures.length}곳(${(report.failureRatio * 100).toFixed(0)}%)이 «안 읽힌다» — 쌍 ${report.failingPairs.length}: ${pairs}`;
}
