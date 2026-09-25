/**
 * seed-responsive.ts — ***씨앗의 「반응형」을 «되읽는다».***
 *
 * ⛔⭐ 왜 별도인가 — 이 축은 다른 다섯과 «비용»이 다르다.
 *    색·활자·간격·전환·움직임은 ***한 번 방문***이면 잰다.
 *    반응형은 ***폭마다 다시 방문***해야 하고, 분기 구간은 이분 탐색이라 «여섯 번 더»다.
 *    ⇒ 그래서 부르는 쪽이 «폭을 명시»할 때만 잰다. 안 주면 ***「못 쟀음」이지 「반응형이 아니다」가 아니다.***
 */

export interface SeedBreakpoint {
  /** 구간의 «아래» — ⭐ `max-width` 상한은 여기를 상한으로 읽는다(구간이 위로 밀린다). */
  readonly lowPx: number;
  readonly highPx: number;
}

/**
 * `분기가 **462px ↔ 468px** 사이에 있다` 를 읽는다.
 * ⛔ 절이 없거나 문면이 다르면 `null` — 「분기가 없다」와 다른 값이다.
 */
export function readSeedBreakpoint(seed: string): SeedBreakpoint | null {
  const m = /분기가\s*\**\s*(\d+)px\s*↔\s*(\d+)px\s*\**\s*사이/.exec(seed);
  if (m === null) return null;
  const lowPx = Number(m[1]);
  const highPx = Number(m[2]);
  // ⛔ 뒤집힌 구간을 «조용히 고치지» 않는다 — 씨앗이 이상하면 못 읽은 것으로 낸다.
  if (!Number.isFinite(lowPx) || !Number.isFinite(highPx) || highPx < lowPx) return null;
  return { lowPx, highPx };
}

/** 두 구간이 «겹치나». ⛔ 「같은 수인가」가 아니다 — 구간은 구간과 견준다. */
export function rangesOverlap(a: SeedBreakpoint, b: SeedBreakpoint): boolean {
  return a.lowPx <= b.highPx && b.lowPx <= a.highPx;
}

/**
 * 비례 눈금이 «같은 비율»인가.
 * ⛔ 기본 허용 ±0.05 — 임계를 «값으로» 낸다(왜 통과·탈락했는지 읽는 쪽이 다시 잴 수 있게).
 * 🔑 그리고 이 축은 ***「같은 값들인가」가 아니라 「같은 «비율»인가」***를 묻는다 —
 *    다시 지은 화면은 값이 달라도 «같은 규칙»으로 커지면 그 스타일을 재현한 것이다.
 */
export const PROPORTIONAL_TOLERANCE = 0.05;

export function ratiosAgree(seedRatio: number, pageRatio: number, tolerance = PROPORTIONAL_TOLERANCE): boolean {
  // ⛔⭐ 부동소수 — `|1.0 - 1.05|` 가 `0.05000000000000004` 다.
  //    임계에 «정확히» 앉은 값이 탈락한다. 경계 시험이 그것을 잡았다(2026-09-10).
  //    ⇒ 표현 오차만큼만 열어 준다. ⛔ 임계 자체를 키우지 «않는다».
  return Math.abs(seedRatio - pageRatio) - tolerance <= 1e-9;
}
