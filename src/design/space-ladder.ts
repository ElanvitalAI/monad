/**
 * space-ladder.ts — ***「화면이 «띄운» 간격이 «선언한 눈금»에서 왔나」***.
 *
 * ⛔⭐⭐ 왜 있나(2026-09-12 🅕) — ***③ 칸(다른 컨셉으로 재생성)의 «셋째» 축***이다.
 *    지금까지 ③ 를 재는 것은 ***색(`token-adherence`·`token-pair-validity`)과 활자(`type-ladder`)뿐***이었다.
 *    📏 그런데 「연표」와 「색인」을 지어 보니 ***가장 많이 만진 것이 «간격»***이었다.
 *
 * ⛔ 이 자도 ***씨앗과 «안» 댄다*** — 씨앗과 대면 ②재현이다.
 *    ***「자기가 선언한 눈금」 ↔ 「자기가 띄운 간격」***이라 ***컨셉이 달라도 성립한다.***
 *
 * ⭐ `type-ladder`(활자)의 «간격» 쌍둥이다. ⛔ 그러나 ***사각이 다르다*** —
 *    간격은 ***`calc()`·`clamp()`·`gap` 으로 «파생»***되고, 활자는 대개 «직접» 쓰인다.
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

import { onLadder, parsePx } from './type-ladder.js';

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const SPACE_LADDER_BLIND_SPOTS: readonly string[] = [
  'declared-only: 눈금은 «준 값»에서만 읽는다 — 다른 곳에 선언된 간격은 「밖」으로 센다',
  'derived-values: `calc(var(--u) * 3)` 의 «결과»는 눈금 «밖»으로 보인다 — 배수 눈금은 부르는 쪽이 펴서 줘야 한다',
  'gap-vs-margin: `gap`·`margin`·`padding` 을 «구별하지 않는다» — 같은 수면 같은 칸으로 센다',
  'one-moment-one-viewport: «한 시점·한 폭»만 본다 — 반응형 분기의 간격은 안 본다',
  'no-rhythm: 「간격이 «리듬»을 이루나」는 안 묻는다 — 「눈금에서 왔나」만 묻는다',
  'needs-three-steps: 띄운 간격이 셋 미만이면 «변별하지 않는다» — 「이탈 0」이 거의 언제나 참이 된다',
  'zero-is-not-a-rung: `0` 은 «칸이 아니다» — 선언한 `0` 도 띄운 `0` 도 «양쪽에서» 버린다. 「간격이 없다」는 «간격의 선택»이 아니기 때문이다(⛔ 그래서 `--space-0: 0` 을 선언해도 이 자는 «안 본다»)',
];

/** ⛔ `type-ladder` 와 «같은 계급»의 수다. 실측이 아니라 «논증»에서 나왔다. */
export const DISCRIMINATING_STEP_COUNT = 3;

/** 한 간격이 «몇 자리»에 쓰였나. */
export interface StepUse {
  readonly px: number;
  readonly count: number;
}

export interface SpaceLadder {
  /** 화면이 띄운 «구별되는» 간격 수. ⛔ 이것이 분모다 */
  readonly used: number;
  /** 선언된 눈금의 칸 수(배수를 편 «뒤») */
  readonly declared: number;
  /** 눈금 «밖». ⛔ 수가 아니라 «값»으로 낸다 */
  readonly offLadder: readonly StepUse[];
  readonly offLadderHits: number;
  /** 0~1 */
  readonly ratio: number;
  /** 선언했는데 이 장에서 «안 쓴» 칸 — ⛔ 경고가 아니라 «관측»이다 */
  readonly unusedSteps: readonly number[];
  /** ⛔⭐ 분모가 모자라면 이 축은 «변별하지 않는다» */
  readonly discriminating: boolean;
  /**
   * ⛔⭐ ***버린 `0`*** — 선언 눈금 쪽 / 띄운 간격 쪽.
   * 「0 이 안 보인다」가 ***「깨끗」인지 「이 자가 «안 본다»」인지***를 가르는 유일한 값이다.
   */
  readonly zeroRungsDropped: number;
  readonly zeroStepsDropped: number;
}

/**
 * ⭐⭐ ***`calc(var(--u) * N)` 을 «펴서» 눈금으로 만든다.***
 *
 * 🩸 왜 필요한가(2026-09-12 실측): 자작 사이트의 절반이 간격을 ***`--s1: calc(var(--u) * 1)`*** 처럼 쓴다.
 *    ***그 문면에는 px 가 «한 자도 없다».*** 그대로 읽으면 ***눈금이 «0칸»***이 되고,
 *    그러면 이 자는 ***「못 쟀다」를 내야 하는데 그것은 «옳지만 쓸모없다».***
 * ⇒ ✅ 뿌리(`--u` 류)가 px 로 풀리면 ***배수를 곱해 눈금을 «편다»***.
 * ⛔ 뿌리가 `clamp()` 처럼 «폭에 따라 변하면» ***펴지 않는다*** — 지어내지 않는다.
 */
export function expandLadder(declared: Readonly<Record<string, string>>): number[] {
  const out = new Set<number>();
  const direct = new Map<string, number>();
  for (const [name, raw] of Object.entries(declared)) {
    const px = parsePx(raw);
    if (px !== null) { direct.set(name, px); out.add(px); }
  }
  for (const raw of Object.values(declared)) {
    // `calc(var(--u) * 3)` · `calc(var(--u)*3)` — ⛔ 나눗셈·덧셈은 «안» 편다(모호하다).
    const m = /^calc\(\s*var\(\s*(--[A-Za-z0-9_-]+)\s*\)\s*\*\s*([\d.]+)\s*\)$/.exec(raw.trim());
    if (m === null) continue;
    const root = direct.get(m[1]!);
    const mult = Number(m[2]);
    if (root === undefined || !Number.isFinite(mult) || mult <= 0) continue;
    out.add(Math.round(root * mult * 1000) / 1000);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 「선언한 눈금」과 「띄운 간격」을 댄다.
 * ⛔ 어느 한쪽이 비면 `null` — ***「이탈 0」이 «아니라» 「잴 수 없다」***다.
 */
export function judgeSpaceLadder(
  painted: readonly StepUse[],
  declaredLadder: readonly number[],
  epsilon = 0.5,
): SpaceLadder | null {
  // ⛔⭐ ***버리기 «전»에 센다*** — 안 세면 「0 이 없다」와 「0 을 버렸다」가 같은 화면이 된다.
  const zeroRungsDropped = declaredLadder.filter((n) => Number.isFinite(n) && n === 0).length;
  const zeroStepsDropped = painted.filter((u) => Number.isFinite(u.px) && u.px === 0).length;
  const ladder = [...new Set(declaredLadder.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (ladder.length === 0) return null;
  const uses = painted.filter((u) => Number.isFinite(u.px) && u.px > 0);
  if (uses.length === 0) return null;
  const offLadder = uses
    .filter((u) => !onLadder(u.px, ladder, epsilon))
    .sort((a, b) => b.count - a.count || a.px - b.px);
  return {
    used: uses.length,
    declared: ladder.length,
    offLadder,
    offLadderHits: offLadder.reduce((s, u) => s + u.count, 0),
    ratio: offLadder.length / uses.length,
    unusedSteps: ladder.filter((r) => !uses.some((u) => Math.abs(u.px - r) <= epsilon)),
    discriminating: uses.length >= DISCRIMINATING_STEP_COUNT,
    zeroRungsDropped,
    zeroStepsDropped,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderSpaceLadder(report: SpaceLadder | null): string {
  if (report === null) {
    return '⚪ 못 쟀다 — «선언된 간격 눈금»이 없거나 띄운 간격을 못 읽었다(「이탈 0」이 아니다)';
  }
  if (!report.discriminating) {
    return `⚪ 띄운 간격이 ${report.used}종뿐이라 이 축은 «변별하지 않는다»`
      + `(${DISCRIMINATING_STEP_COUNT}종 이상이라야 한다) — 「이탈 ${report.offLadder.length}」을 «성과로 읽지 마라»`;
  }
  const head = report.offLadder.length === 0
    ? `✅ 띄운 간격 ${report.used}종이 «전부» 선언된 눈금(${report.declared}칸) 안이다`
    : `⚠️ 띄운 간격 ${report.used}종 중 ${report.offLadder.length}종(${(report.ratio * 100).toFixed(0)}%)이 눈금 «밖» — `
      + report.offLadder.slice(0, 6).map((u) => `${u.px}px×${u.count}`).join(' · ');
  // ⛔⭐⭐ 🩸 2026-09-12([S] 지적) — ***판정 줄 «안»에 붙이면 「통과」의 옷을 입는다.***
  //    이 관측은 ***판정과 «다른 축»***이다(「밖을 밟았나」 ↔ 「칸을 안 썼나」 — `containment` 와 같은 갈림).
  //    ⇒ ***제 줄***로 내고, ***무엇을 하라는지***까지 담는다.
  const tail = report.unusedSteps.length === 0 ? ''
    : `\n      ⚪ 이 장에서 «안 쓴» 칸: ${report.unusedSteps.join('px · ')}px`
      + ' — ⛔ «이탈이 아니다». 이 장이 안 쓴 것뿐이니 «다른 장»을 재거나 사다리를 줄여라';
  // ⛔⭐⭐ 🩸 2026-09-12(🅕 ⚪D) — ***버린 `0` 을 «말한다».***
  //    이 자는 `0` 을 «양쪽에서» 버리는데, 그 사실이 화면에 «한 줄도» 없었다.
  //    ⇒ `--space-0: 0` 을 선언한 사람은 ***자기가 «칸을 하나 놓았다»고 믿는다.*** 그 믿음이 조용히 틀린다.
  //    ⛔ 이것도 «판정이 아니라 관측»이다 — 제 줄로 낸다(위 `unusedSteps` 와 같은 계급).
  const zeros = report.zeroRungsDropped === 0 && report.zeroStepsDropped === 0 ? ''
    : `\n      ⚪ 버린 «0»: 선언 눈금 ${report.zeroRungsDropped}칸 · 띄운 간격 ${report.zeroStepsDropped}종`
      + ' — ⛔ 「0 이 눈금 안이다」가 «아니라» 이 자가 «안 본다»(`0` 은 간격의 «선택»이 아니라 «부재»다).'
      + ' 칸을 세고 싶으면 «양수»로 선언하라';
  return head + tail + zeros;
}
