/**
 * 🕰️⭐ **정기 전수 — 「아무도 안 건드리는 구석」의 시험을 세고, «어제 값»과 나란히 놓는다.**
 *
 * 📌 왜 있나 — 게이트는 **변경 파일 범위**다. 그래서 «아무도 안 바꾼» 시험이 빨개지는 갈래
 *   (달력 부패 · 환경 변화)를 ***원리상*** 못 본다.
 *   📄 근거 = 내부 문서 `FINDING-a-test-can-rot-by-the-calendar-not-by-drift-2026-08-25`
 *
 * 📌 그리고 이 산출은 «목록»이 아니라 ***「수 ⊕ 그 수의 어제 값」***이다(🅣 정책 `A2` §3).
 *   목록만 매일 뱉으면 「매일 넷을 보고하는 노이즈」가 되고 ***늘어난 것을 못 본다.***
 *
 * ⛔⭐ 이 파일의 «넘버원» 계약: **못 잰 것을 「없다」로 접지 않는다.**
 *   · 어제 값이 없으면 `absent` — ⛔ `0` 이 아니다(그러면 「어제 0 → 오늘 4」라는 거짓 급증이 된다)
 *   · 행(hang)은 `timeout` — ⛔ `red` 도 `green` 도 아니다
 *   · 색인을 못 만들면 `indexUnavailable` — ⛔ 「고아 0」이 아니다
 */

/** 고아 시험을 «게이트가 이름은 아는 것»과 «아예 어두운 것»으로 가른다.
 *
 *  🔑 이 둘은 ***처방이 다르다*** —
 *   · `gateNamed`  게이트가 그 소스 변경 때 이름을 «댄다». ⇒ 유도를 넓히면(ⓑ) 돈다
 *   · `dark`       어떤 변경으로도 안 닿는다. ⇒ ***정기 전수(ⓒ)로만*** 잡힌다 */
export interface OrphanTestPartition {
  /** 게이트의 관례 유도가 실제로 닿는 시험 수(분모를 읽는 자리). */
  readonly reachable: number;
  readonly gateNamed: readonly string[];
  readonly dark: readonly string[];
}

/** ⛔ 색인이 없을 때 «빈 목록»으로 물러나지 않는다 — 그것이 이 저장소가 반복해 데인 「못 잰 0」이다. */
export type OrphanPartitionResult = OrphanTestPartition | { readonly indexUnavailable: string };

export function partitionOrphanTests(
  allTests: readonly string[],
  derivedReachable: readonly string[],
  importerNamedTests: readonly string[] | null,
): OrphanPartitionResult {
  if (importerNamedTests === null) return { indexUnavailable: 'importer test index could not be built' };
  const reachable = new Set(derivedReachable);
  const named = new Set(importerNamedTests);
  const gateNamed: string[] = [];
  const dark: string[] = [];
  for (const test of allTests) {
    if (reachable.has(test)) continue;
    (named.has(test) ? gateNamed : dark).push(test);
  }
  return { reachable: reachable.size, gateNamed, dark };
}

/** ⛔ `timeout` 이 «따로» 있는 이유: 행은 「빨갛다」가 아니라 ***「못 쟀다」***다.
 *  `unrun` 은 전수가 «도중에 끊겼을» 때 — 그것도 초록이 아니다. */
export type SweepVerdict = 'green' | 'red' | 'timeout' | 'unrun';

export interface SweepCounts {
  readonly green: number;
  readonly red: number;
  readonly timeout: number;
  readonly unrun: number;
}

export function tallySweep(verdicts: readonly SweepVerdict[]): SweepCounts {
  const counts = { green: 0, red: 0, timeout: 0, unrun: 0 };
  for (const verdict of verdicts) counts[verdict] += 1;
  return counts;
}

export interface SweepSnapshot {
  /** ISO 8601(UTC). ⛔ 사람 표기로 저장하지 않는다 — 표면마다 시간대가 갈린다. */
  readonly at: string;
  /** 그날의 어두운 시험 «전체» 수. `counts` 의 합과 같아야 한다. */
  readonly dark: number;
  readonly counts: SweepCounts;
  /** ⛔⭐ 1분 로드 애버리지. **`timeout` 이 무엇을 «셌는지»를 가르는 유일한 값이다.**
   *
   *  📏 2026-08-25 실측: 같은 저장소를 로드 **13.7** 에서 한 번, **57.4** 에서 한 번 돌렸다.
   *  ⛔ 뒤엣것의 `timeout` 은 「그 시험이 느리다」가 아니라 ***「그때 기계가 바빴다」***다.
   *  ⇒ 그 값을 안 남기면 ***내일의 「어제 값」이 «다른 것을 잰 수»와 비교된다.***
   *  ⛔ `undefined` = 「부하 0」이 아니라 ***「못 읽었다」***다. */
  readonly loadAverage?: number;
}

/** 두 판이 «비교할 만한가». ⛔ 부하가 크게 다르면 `timeout` 차이는 시험이 아니라 기계다. */
export function loadIsComparable(current?: number, previous?: number, tolerance = 2): boolean {
  if (current === undefined || previous === undefined) return false;
  return Math.abs(current - previous) <= tolerance;
}

/** ⛔⭐ 「어제 값」의 부재는 ***값이다***. `0` 으로 접으면 첫 관측이 「급증」으로 읽힌다. */
export type PreviousSweep =
  | { readonly kind: 'present'; readonly snapshot: SweepSnapshot }
  | { readonly kind: 'absent'; readonly reason: 'no-history' | 'unreadable' };

function delta(current: number, previous: number): string {
  const difference = current - previous;
  if (difference === 0) return '=';
  return difference > 0 ? `+${difference}` : `${difference}`;
}

/**
 * 🅣 계약 — 산출은 「목록」이 아니라 「수 ⊕ 어제 값」이다.
 *
 * 예)
 *   `orphan sweep: dark=86 red=4 (어제 red=4 =) timeout=0 unrun=0`
 *   `orphan sweep: dark=86 red=4 (어제 값 없음 — 첫 관측) timeout=0 unrun=0`
 */
export function formatSweepReport(current: SweepSnapshot, previous: PreviousSweep): string {
  const comparison = previous.kind === 'present'
    ? `어제 red=${previous.snapshot.counts.red} ${delta(current.counts.red, previous.snapshot.counts.red)}`
    : previous.reason === 'no-history'
      ? '어제 값 없음 — 첫 관측'
      // ⛔ 「못 읽었다」를 「없다」와 같은 문면으로 쓰지 않는다 — 사람이 고칠 대상이 다르다.
      : '어제 값 «못 읽음» — 이력을 확인하라';
  // ⛔⭐ `red` 만 비교하면 ***새로 «생긴» 어둠이 안 보인다*** — dark 86→120 인데 red 가 그대로면
  //   「어제와 같다」로 읽히지만, 실제로는 34개가 새로 게이트 밖으로 나간 것이다.
  //   ⇒ 분모가 움직였을 때만 말한다(안 움직이면 줄이 조용해야 신호가 산다).
  const darkDelta = previous.kind === 'present' && previous.snapshot.dark !== current.dark
    ? ` (어제 dark=${previous.snapshot.dark} ${delta(current.dark, previous.snapshot.dark)})`
    : '';
  // ⛔⭐ 행이 «있는데» 두 판의 부하가 다르면, 그 수를 「어제보다 늘었다」로 읽으면 안 된다.
  //   ⇒ 도구가 «스스로» 그 경고를 낸다. 사람이 로드를 따로 기억할 리 없다.
  const load = current.loadAverage === undefined
    ? ' load=«못 읽음»'
    : ` load=${current.loadAverage.toFixed(1)}`;
  const timeoutCaveat = current.counts.timeout > 0
    && previous.kind === 'present'
    && !loadIsComparable(current.loadAverage, previous.snapshot.loadAverage)
    ? ' ⚠️ 부하가 어제와 «비교 불가» — timeout 을 추세로 읽지 마라'
    : '';
  const parts = [
    `orphan sweep: dark=${current.dark}${darkDelta}`,
    `red=${current.counts.red} (${comparison})`,
    `timeout=${current.counts.timeout}`,
    `unrun=${current.counts.unrun}${load}${timeoutCaveat}`,
  ];
  return parts.join(' ');
}

/** 전수를 «안 돌렸을» 때의 문면. ⛔ `dark=N red=0` 으로 쓰지 않는다 — 0 이 아니라 «미측정»이다.
 *
 *  ⛔⭐ 여기 적는 플래그 이름은 ***실제로 등록된 것***이어야 한다 — 라이브 1판이 `--sweep-run` 을
 *  안내했는데 등록된 것은 `--run` 이었다. 「이름이 있다」와 「그 이름이 무엇을 가리키나」는 다른 값이다. */
export const SWEEP_RUN_FLAG = '--run';
export function formatSweepNotRun(dark: number): string {
  return `orphan sweep: dark=${dark} red=«미측정»(전수를 안 돌렸다) — 돌리려면 ${SWEEP_RUN_FLAG}`;
}

/** ⛔⭐⭐ 이 줄은 «세 수»를 내는데, ***이 자가 도는 것은 `dark` «하나»뿐이다.***
 *  🚨 그런데 종전 문면은 셋을 «나란히» 냈고, 읽는 사람은 ***셋 다 훑은 것으로 읽는다***
 *     (2026-08-26 30차 실측: 내가 «내 자»를 그렇게 읽고 「관문 사이에 빈 칸이 있다」는
 *      «과한» 결론을 냈다가 거뒀다 — CLAUDE.md 가 이미 못 박은 «설계»였다).
 *  ⇒ 🩹 그래서 ***「무엇을 도는가」와 「무엇을 «안» 보는가」를 «문면»에 적는다.***
 *     📌 이 저장소의 규율 그대로다 — ***자가 「자기가 무엇을 못 보는지」를 스스로 말한다.***
 *  ⚠️ ⛔ 「안 본다」가 「아무도 안 본다」는 «아니다» — gate-named·reachable 은
 *     `elanous self gate`(변경 파일 범위)와 사람 게이트(전 스위트)의 몫이다. 그 둘을 이름으로 댄다. */
export function formatPartitionSummary(result: OrphanPartitionResult): string {
  if ('indexUnavailable' in result) return `orphan tests: lookup failed (${result.indexUnavailable})`;
  return `orphan tests: dark=${result.dark.length}(이 자가 «돈다») `
    + `gate-named=${result.gateNamed.length} reachable=${result.reachable}`
    + ` — ⛔ 뒤 둘은 «이 자가 안 본다»(self gate=변경 범위 · 사람 게이트=전 스위트의 몫)`;
}
