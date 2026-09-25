/**
 * motion-tokens.ts — ***「화면이 «움직이는» 값이 «선언한 토큰»에서 왔나」***.
 *
 * ⛔⭐⭐ ③ 칸(다른 컨셉으로 재생성)의 ***넷째이자 마지막 축***이다.
 *    색(`token-adherence`·`token-pair-validity`) · 활자(`type-ladder`) · 간격(`space-ladder`) 다음이다.
 *    ⛔ 씨앗과 «안» 댄다 — 대면 ②재현이 된다.
 *
 * ⛔⭐⭐⭐ 🩸 ***이 축에는 「0 처럼 보이는 거짓」이 «하나 더» 있다*** (2026-09-12 실측):
 * ```
 *   www.nike.com   durations: [{ value: '1e-05s', count: 2791 }]   ← ***전부 «거의 0»***
 *                  browserForcedReducedMotion: true
 * ```
 *    ***헤드리스 브라우저가 `prefers-reduced-motion` 을 «강제»하면 지속시간이 「0에 가깝게」 보인다.***
 *    ⇒ 그것을 「이 사이트는 애니메이션이 없다」로 읽으면 ***틀린다.***
 * ⇒ ✅ 그래서 ***지속시간 축은 「잴 수 있었나」를 «먼저» 판정***한다(`durationMeasurable`).
 * ⭐ ***가속 곡선은 그 강제에 «안 지워진다»*** — 그래서 이 자의 «주 축»은 곡선이다.
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const MOTION_TOKEN_BLIND_SPOTS: readonly string[] = [
  'reduced-motion-forced: 브라우저가 `prefers-reduced-motion` 을 강제하면 ***지속시간이 «거의 0»으로 보인다*** — 「애니메이션이 없다」가 아니다',
  'declared-only: 토큰은 «준 파일»에서만 읽는다 — 다른 곳에 선언된 곡선은 「밖」으로 센다',
  'transition-only: `transition-*` 만 본다 — `@keyframes` 안의 곡선·지속은 «다른 축»이다',
  'one-moment: 「지금 붙어 있는」 값만 본다 — 클릭·가리킴 «뒤»에 바뀌는 모션은 안 본다',
  'no-taste: 「그 곡선이 «좋은가»」는 안 묻는다 — 「선언한 것에서 왔나」만 묻는다',
  'ease-is-default: `ease` 는 CSS «기본값»이라 «안 센다» — 선언 안 한 자리가 전부 이탈로 보인다',
  'no-duration-tokens: 지속 토큰을 «하나도» 선언 안 했으면 그 축은 «안 잰다» — 「이탈 0」도 「이탈 N」도 아니다',
];

/** 브라우저 기본값 — ⛔ 「토큰 밖」으로 세면 ***선언 안 한 모든 자리가 이탈***이 된다. */
export const DEFAULT_EASINGS: readonly string[] = ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out'];

/** ⛔ 이 밑이면 「지속시간을 «못 쟀다»」로 본다(강제 reduced-motion 의 자국). */
export const NEAR_ZERO_SECONDS = 0.001;

export interface MotionUse {
  readonly value: string;
  readonly count: number;
}

export interface MotionTokens {
  /** 화면이 쓴 «구별되는» 곡선 수(기본값을 뺀 뒤). ⛔ 이것이 분모다 */
  readonly easingsUsed: number;
  /** 그중 토큰 «밖» */
  readonly offTokenEasings: readonly MotionUse[];
  /** ⛔⭐ 지속시간을 «잴 수 있었나» — 거짓이면 아래 두 칸을 «읽지 마라» */
  readonly durationMeasurable: boolean;
  readonly durationsUsed: number;
  readonly offTokenDurations: readonly MotionUse[];
  /** ⛔ 곡선 후보가 셋 미만이면 이 축은 «변별하지 않는다» */
  readonly discriminating: boolean;
}

/** `0.2s` · `200ms` → 초. ⛔ 못 풀면 `null`. */
export function parseSeconds(value: string): number | null {
  const v = value.trim().toLowerCase();
  const ms = /^(-?[\d.]+(?:e-?\d+)?)\s*ms$/.exec(v);
  if (ms !== null) { const n = Number(ms[1]); return Number.isFinite(n) ? n / 1000 : null; }
  const s = /^(-?[\d.]+(?:e-?\d+)?)\s*s$/.exec(v);
  if (s !== null) { const n = Number(s[1]); return Number.isFinite(n) ? n : null; }
  return null;
}

/** ⛔ 공백만 지운다 — `cubic-bezier(0.25, 0.1, …)` 와 `cubic-bezier(0.25,0.1,…)` 는 «같은 값»이다. */
export function normaliseEasing(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * ⛔ 쓴 곡선이 «하나도» 없으면 `null` — ***「이탈 0」이 «아니다»***.
 * ⛔ 기본 곡선(`ease` 등)은 ***분자에도 분모에도 «안 넣는다»***.
 */
export function judgeMotionTokens(
  usedEasings: readonly MotionUse[],
  usedDurations: readonly MotionUse[],
  declaredEasings: readonly string[],
  declaredDurations: readonly string[],
  reducedMotionForced: boolean,
): MotionTokens | null {
  const defaults = new Set(DEFAULT_EASINGS.map(normaliseEasing));
  const easings = usedEasings.filter((e) => !defaults.has(normaliseEasing(e.value)));
  if (easings.length === 0) return null;
  const declaredE = new Set(declaredEasings.map(normaliseEasing));
  const offTokenEasings = easings
    .filter((e) => !declaredE.has(normaliseEasing(e.value)))
    .sort((a, b) => b.count - a.count);

  // ⛔⭐ 지속시간은 ***「잴 수 있었나」를 «먼저»*** 묻는다.
  const seconds = usedDurations
    .map((d) => ({ ...d, s: parseSeconds(d.value) }))
    .filter((d): d is MotionUse & { s: number } => d.s !== null && d.s > 0);
  const allNearZero = seconds.length > 0 && seconds.every((d) => d.s <= NEAR_ZERO_SECONDS);
  const declaredD = new Set(declaredDurations.map((d) => parseSeconds(d)).filter((n): n is number => n !== null));
  // ⛔⭐⭐ 🩸 2026-09-12 실물에서 잡았다 — ***지속 토큰을 «하나도» 선언 안 한 사이트에
  //    「지속 1종이 토큰 밖」이라고 냈다.*** 그것은 ***분모가 0인데 이탈을 낸 것***이다.
  //    (`judgeTypeLadder` 가 「사다리 0칸 ⇒ null」로 이미 막아 둔 것과 «같은 계급»이다.)
  // ⇒ ✅ 선언이 «없으면» 그 축은 ***「안 잰다»***. 「이탈 0」도 「이탈 N」도 아니다.
  const durationMeasurable = seconds.length > 0
    && declaredD.size > 0
    && !(reducedMotionForced && allNearZero);
  const offTokenDurations = !durationMeasurable
    ? []
    : seconds.filter((d) => ![...declaredD].some((n) => Math.abs(n - d.s) < 1e-6))
        .map(({ value, count }) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

  return {
    easingsUsed: easings.length,
    offTokenEasings,
    durationMeasurable,
    durationsUsed: durationMeasurable ? seconds.length : 0,
    offTokenDurations,
    discriminating: easings.length >= 3,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderMotionTokens(report: MotionTokens | null): string {
  if (report === null) {
    return '⚪ 못 쟀다 — «기본이 아닌» 가속 곡선을 하나도 못 봤다(「이탈 0」이 아니다)';
  }
  const parts: string[] = [];
  parts.push(report.offTokenEasings.length === 0
    ? `✅ 쓴 곡선 ${report.easingsUsed}종이 «전부» 토큰에서 왔다`
    : `⚠️ 쓴 곡선 ${report.easingsUsed}종 중 ${report.offTokenEasings.length}종이 «토큰 밖» — `
      + report.offTokenEasings.slice(0, 3).map((e) => `${e.value}×${e.count}`).join(' · '));
  parts.push(report.durationMeasurable
    ? (report.offTokenDurations.length === 0
        ? `✅ 지속 ${report.durationsUsed}종도 «전부» 토큰에서 왔다`
        : `⚠️ 지속 ${report.offTokenDurations.length}종이 «토큰 밖» — `
          + report.offTokenDurations.slice(0, 3).map((d) => `${d.value}×${d.count}`).join(' · '))
    : '⚪ 지속시간은 «못 쟀다» — 지속 토큰이 «없거나» 브라우저가 `prefers-reduced-motion` 을 강제했다');
  if (!report.discriminating) {
    parts.push(`⚪ 곡선이 ${report.easingsUsed}종뿐이라 이 축은 «약하다»(3종 이상이라야 한다)`);
  }
  return parts.join(' · ');
}
