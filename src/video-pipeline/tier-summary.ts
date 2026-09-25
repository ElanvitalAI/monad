import type { Tier } from './capabilities.js';

/**
 * ⛔⭐ 티어 요약은 «한 자리»에서만 계산한다.
 *   2026-09-22 실측: 사람 화면이 `every(tier==='free')` 를 재면서 라벨은
 *   「무료만으로 채워지는 능력」이라 적고 있었다. 읽는 사람은 그것을 `some`
 *   (무료로 «될 수 있다»)으로 읽는다 — 두 해석의 수가 ***3 대 16*** 이었다.
 *   그리고 정작 결정을 가르는 「과금이 «강제»되는 능력」은 ***한 줄도 안 찍혔다.***
 *
 *   🔑 라벨과 계산이 갈라지는 기전은 ***술어를 두 벌 쓰는 것***이다.
 *      그래서 사람 화면과 JSON 이 «이 한 벌»만 쓴다.
 *   📏 이름이 곧 술어다 — freeReachable=some · freeOnly=every · paidOnly=none · dead=구현 없음.
 */
export function summarizeTiers<T extends { cap: string; found: readonly { tier: Tier }[] }>(
  rows: readonly T[],
): { freeReachable: string[]; freeOnly: string[]; paidOnly: string[]; dead: string[] } {
  const live = rows.filter((r) => r.found.length > 0);
  return {
    freeReachable: live.filter((r) => r.found.some((i) => i.tier === 'free')).map((r) => r.cap),
    freeOnly: live.filter((r) => r.found.every((i) => i.tier === 'free')).map((r) => r.cap),
    paidOnly: live.filter((r) => !r.found.some((i) => i.tier === 'free')).map((r) => r.cap),
    dead: rows.filter((r) => r.found.length === 0).map((r) => r.cap),
  };
}
