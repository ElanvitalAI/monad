/**
 * style-signature.ts — ***「같은 사다리를 쓰되 «다르게» 쓰나」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-12 🅕) — ***이 창이 남기는 가장 큰 ⚪ 가 「보기에 그 스타일인가」***였다.
 *    지금까지의 ③ 자 넷은 전부 ***「자기 규칙을 지켰나」***만 본다 — ***두 화면을 «대 보지» 않는다.***
 *
 * 📏 그런데 ③ 대조에서 ***수로 된 신호가 하나 나왔다***:
 * ```
 *   원본(카드 목록)  14×42 · 15×2  · 17×8 · 20×2 · 26×1     보조 글자가 «지배»한다
 *   연표(다른 컨셉)  14×22 · 15×10 · 17×6 · 20×8 · 26×1     본문·제목이 «올라온다»
 * ```
 * 🔑 첫 판은 그것을 ***「같은 스타일 · 다른 컨셉」의 «수로 된 모양»***이라 불렀다.
 *
 * ⛔⭐⭐⭐ 🩸 ***그 문장은 «대조»가 무너뜨렸다*** (2026-09-12 실측 · 같은 날):
 * ```
 *   원본 ↔ 다른 컨셉(연표)              거리 0.313   ← 「다른 컨셉」
 *   ***같은 사이트의 목록 ↔ 상세***      거리 ***0.29***   ← ***같은 컨셉인데 «거의 같은 거리»***
 *   원본 ↔ 다른 사이트(moksori)         거리 0.964 · 사다리 1/8
 * ```
 * ⇒ 🔑 ***「사다리가 같은가」는 «잘» 가른다***(5/5 ↔ 1/8).
 *    ⛔ ***그러나 「분포 거리」는 «컨셉»을 «못» 가른다*** — 같은 사이트의 다른 장도 그만큼 멀다.
 * ⇒ ✅ 그래서 이 자는 ***거리를 «내되» 「다른 컨셉이다」라고 «말하지 않는다».***
 *
 * ⛔⭐⭐ 이 자가 답하지 «않는» 것: ***「그것이 «아름다운가»」·「사람 눈에 같아 보이나」.***
 *    ⇒ ***여전히 「보기에」는 «아무도» 안 묻는다.*** 이 자는 그 물음의 ***«대용»이지 답이 아니다.***
 *
 * ⛔ 이 파일은 브라우저도 파일도 «안 읽는다» — 값을 «받는다».
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const STYLE_SIGNATURE_BLIND_SPOTS: readonly string[] = [
  'not-perception: ***「보기에 같나」를 «안» 묻는다*** — 쓰임의 «구조»만 본다. 이 자는 «대용»이다',
  'distance-is-not-concept: 🩸 ***「분포 거리」로 «컨셉»을 가르지 «못한다»*** — 같은 사이트의 목록↔상세가 0.29, 다른 컨셉이 0.313 이었다(2026-09-12 실측)',
  'one-axis-at-a-time: 한 축(활자·간격·색)씩 본다 — 축들이 «함께» 만드는 인상은 못 본다',
  'order-blind: 화면 «어디에» 놓였는지는 안 본다 — 수와 분포만 본다',
  'one-page: 한 장씩 댄다 — 사이트 전체의 리듬은 다른 축이다',
  'needs-three-rungs: 칸이 셋 미만이면 «분포」라 부를 것이 없다 — 「변별 안 함」을 낸다',
  'narrow-dynamic-range: 🩸 ***이 자의 «변별 구간»이 «사다리 왜곡 1~6%» 안에 다 들어 있다*** (2026-09-12 합성 사다리 실측 · A↔B 를 왜곡 k 로 밀어 가며 잼): 왜곡 1%→거리 ***0.000***(겹침 10/10) · 3%→0.109 · ***6%→0.745*** · 10%→0.791 · 140%→0.982. ⇒ ⛔ ***6% 를 넘으면 왜곡이 «23배» 커져도 거리는 0.745→0.982 밖에 안 움직인다.*** 🔑 기전: `distributionDistance` 는 사실상 `ladderOverlap` 의 «재진술»이다 — 표본 30(합성 27 ⊕ 실측 3)에서 ***r = -0.983***. ⇒ ***0.75 를 넘은 거리끼리는 «서로 대지 마라»*** — 「조금 틀렸다」와 「아예 다르다」가 거기서 붙는다 (실측 2026-09-12: 클론을 «시도해» 멀어진 산출 0.744 ↔ «시도조차 안 한» 산출 0.756 — 차이 0.012). ⚠️ 왜곡↔거리 곡선은 ***합성 표본족***에서 얻었다 — 실제 사이트에서 같은 모양인지는 «안 쟀다»',
  'coverage-and-containment-can-oppose: 🩸 ***「덮었나」와 「벗어났나」가 같은 쌍을 «반대로» 순위 매긴다*** — `ladderOverlap`(원본의 칸을 얼마나 «썼나»)이 높은 산출이 `bOnlyRungs`(원본에 «없는» 칸을 얼마나 만들었나)도 높을 수 있다. ⛔ 그리고 ***`distributionDistance` 는 «전자만» 반영한다***. 2026-09-12 실측(색 축 · 같은 원본): 산출ⓐ 겹침 ***0.520*** / 이탈 ***16*** / 거리 0.327 ↔ 산출ⓑ 겹침 0.316 / 이탈 ***4*** / 거리 0.439 — ***거리로는 ⓐ 가 낫고 이탈로는 ⓑ 가 낫다.*** ⇒ ⛔ ***「어느 쪽이 나은가」를 «한 수»로 쓰지 마라*** — 클론은 「덮고」 «그리고» 「안 벗어나야」 한다',
  'non-use-is-not-deviation: 🩸 ***「칸을 안 썼다」는 «이탈이 아니다»*** — 2026-09-12 실측의 「겹치는 사다리」 두 칸이 ***둘 다 부분집합***이었다(이탈 0). ⇒ `containment` 를 «같이» 읽어라',
];

export const SIGNATURE_MIN_RUNGS = 3;
/** ⛔ 「분포가 다르다」의 문턱. 실측이 아니라 «논증»에서 나왔다 — 반증되면 바꾼다. */
export const DISTRIBUTION_DISTANCE_DIFFERENT = 0.25;

export interface RungUse {
  readonly value: number;
  readonly count: number;
}

export type LadderVerdict = 'same-ladder' | 'overlapping' | 'different-ladder';
export type UseVerdict = 'same-use' | 'different-use';
/**
 * ⭐⭐ 「겹친다」의 «방향». ⛔ 이것이 없으면 자가 아래 둘을 «같은 수»로 낸다:
 *    ⓐ B 가 A 의 사다리 «밖»을 밟았다        ← 이탈이다
 *    ⓑ B 가 A 의 칸 하나를 «안 썼다»          ← 이탈이 «아니다»
 * 🩸 실측(2026-09-12): jongi-jip ↔ 연표의 「겹치는 사다리」 두 칸이 ***둘 다 ⓑ***였다 —
 *    간격 4/5 도 색 8/10 도 ***이탈이 «0»***인데 자는 결손처럼 생긴 수를 냈다.
 */
export type Containment = 'same' | 'a-contains-b' | 'b-contains-a' | 'crossing' | 'disjoint';

export interface StyleSignature {
  /** 두 쪽이 «함께» 쓴 칸 수 */
  readonly sharedRungs: number;
  /** 합집합 칸 수. ⛔ 이것이 분모다 */
  readonly totalRungs: number;
  /** 0~1 — 1 이면 «같은 사다리» */
  readonly ladderOverlap: number;
  readonly ladderVerdict: LadderVerdict;
  /**
   * ⭐ 두 «분포»의 거리(0~1) — 공유 칸의 «비중»이 얼마나 다른가.
   * ⛔ 총 변동 거리(total variation)다: 각 칸 비중 차이의 절반 합.
   */
  readonly distributionDistance: number;
  readonly useVerdict: UseVerdict;
  /** A 만 쓴 칸 수 */
  readonly aOnlyRungs: number;
  /** B 만 쓴 칸 수 */
  readonly bOnlyRungs: number;
  /**
   * ⛔⭐⭐ ***「칸이 «얼마나» 가까운가」*** — `ladderOverlap`(칸이 «같나»)과 ***다른 축***이다.
   *
   * 🩸 왜 필요한가(2026-09-12 🅕 실측): 위 `epsilon` 은 ***«절대» px*** 이라
   *    ***같은 변화를 칸 크기에 따라 다르게 판정한다*** — 사다리를 «통째로» 3% 키우면
   *    12·14·16px 은 「같다」인데 18px 부터는 「다르다」가 된다.
   *    ⊕ 그래서 `ladderOverlap` 이 «0 쪽으로» 무너지면 ***「밀렸다」와 「아예 다르다」가 붙는다.***
   *
   * 🔑 이 값은 ***B 의 칸마다 A 의 «가장 가까운» 칸까지의 «상대» 거리***의 중앙값이다.
   *    ***`0.03` 이면 「사다리가 통째로 3% 밀렸다」***이고, ***`0.4` 면 「다른 사다리」***다.
   *    ⛔ `ladderOverlap` 은 둘을 «같은 0»으로 낸다 — 이 값이 그 둘을 가른다.
   *
   * ⛔ 판정에 «안» 쓴다 — ***관측***이다(`ladderVerdict` 는 종전 그대로).
   * ⛔ 어느 쪽도 «0 이 아닌» 칸이 없으면 `null`(「가깝다」가 아니라 「못 쟀다」).
   */
  readonly medianRelativeGap: number | null;
  /** ⭐ 겹침의 «방향». ⛔ `ladderOverlap` 하나로는 못 가른다 */
  readonly containment: Containment;
  /** ⛔ 칸이 모자라면 이 축은 «변별하지 않는다» */
  readonly discriminating: boolean;
}

/** 비중으로 편다. ⛔ 합이 0이면 빈 map(0 으로 나누지 않는다). */
function share(uses: readonly RungUse[]): Map<number, number> {
  const total = uses.reduce((s, u) => s + (u.count > 0 ? u.count : 0), 0);
  const out = new Map<number, number>();
  if (total <= 0) return out;
  for (const u of uses) if (u.count > 0) out.set(u.value, (out.get(u.value) ?? 0) + u.count / total);
  return out;
}

/**
 * 두 쪽의 「칸 쓰임」을 댄다.
 * ⛔ 어느 한쪽이 «비면» `null` — ***「같다」도 「다르다」도 «아니다»***.
 */
export function judgeStyleSignature(
  a: readonly RungUse[],
  b: readonly RungUse[],
  epsilon = 0.5,
): StyleSignature | null {
  const sa = share(a);
  const sb = share(b);
  if (sa.size === 0 || sb.size === 0) return null;

  // ⛔ 「같은 칸」은 «눈»으로 판정한다 — 15 와 15.0001 은 같은 칸이다.
  const near = (x: number, set: Iterable<number>) => [...set].find((y) => Math.abs(x - y) <= epsilon);
  const union = new Set<number>(sa.keys());
  for (const y of sb.keys()) if (near(y, sa.keys()) === undefined) union.add(y);

  let shared = 0;
  let aOnly = 0;
  let bOnly = 0;
  let distance = 0;
  for (const rung of union) {
    const ka = near(rung, sa.keys());
    const kb = near(rung, sb.keys());
    const pa = ka === undefined ? 0 : (sa.get(ka) ?? 0);
    const pb = kb === undefined ? 0 : (sb.get(kb) ?? 0);
    if (ka !== undefined && kb !== undefined) shared += 1;
    else if (ka !== undefined) aOnly += 1;
    else bOnly += 1;
    distance += Math.abs(pa - pb);
  }
  distance /= 2;   // ⭐ 총 변동 거리

  // ⛔⭐ ***「얼마나 가까운가」를 «따로» 잰다*** — 위 `shared` 는 절대 eps 판정이라 칸 크기에 치우친다.
  //    ⚠️ ***양수 칸만*** 본다(0 은 「가까움」을 말할 분모가 없다).
  const posB = [...sb.keys()].filter((v) => v > 0);
  const posA = [...sa.keys()].filter((v) => v > 0);
  let medianRelativeGap: number | null = null;
  if (posA.length > 0 && posB.length > 0) {
    const gaps = posB
      .map((y) => Math.min(...posA.map((x) => Math.abs(x - y) / Math.max(x, y))))
      .sort((p, q) => p - q);
    const mid = Math.floor(gaps.length / 2);
    const raw = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
    medianRelativeGap = Math.round(raw * 1000) / 1000;
  }

  const totalRungs = union.size;
  const ladderOverlap = totalRungs === 0 ? 0 : shared / totalRungs;
  const ladderVerdict: LadderVerdict = ladderOverlap >= 0.999 ? 'same-ladder'
    : ladderOverlap > 0 ? 'overlapping' : 'different-ladder';
  // ⛔ 「겹친다」를 «방향»으로 다시 읽는다 — 어느 쪽이 밖을 밟았나.
  const containment: Containment = shared === 0 ? 'disjoint'
    : aOnly === 0 && bOnly === 0 ? 'same'
    : bOnly === 0 ? 'a-contains-b'
    : aOnly === 0 ? 'b-contains-a'
    : 'crossing';
  return {
    sharedRungs: shared,
    totalRungs,
    ladderOverlap: Math.round(ladderOverlap * 1000) / 1000,
    medianRelativeGap,
    ladderVerdict,
    aOnlyRungs: aOnly,
    bOnlyRungs: bOnly,
    containment,
    distributionDistance: Math.round(distance * 1000) / 1000,
    useVerdict: distance >= DISTRIBUTION_DISTANCE_DIFFERENT ? 'different-use' : 'same-use',
    discriminating: Math.min(sa.size, sb.size) >= SIGNATURE_MIN_RUNGS,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「같다」로 쓰지 않는다. */
export function renderStyleSignature(report: StyleSignature | null): string {
  if (report === null) return '⚪ 못 쟀다 — 한쪽이 «비었다»(「같다」도 「다르다」도 아니다)';
  if (!report.discriminating) {
    return `⚪ 칸이 ${SIGNATURE_MIN_RUNGS}개 미만이라 «분포»라 부를 것이 없다 — 「같다/다르다」를 말하지 않는다`;
  }
  // ⛔⭐ 「겹친다」를 그대로 쓰면 «안 쓴 칸»이 «이탈»처럼 보인다 — 방향을 «말»로 낸다.
  const ladder = report.ladderVerdict === 'same-ladder' ? '같은 사다리'
    : report.containment === 'b-contains-a'
      ? `A 가 B 의 부분집합(${report.sharedRungs}/${report.totalRungs} · A 의 «이탈» 0 — B 의 칸 ${report.bOnlyRungs}개를 안 썼다)`
    : report.containment === 'a-contains-b'
      ? `B 가 A 의 부분집합(${report.sharedRungs}/${report.totalRungs} · B 의 «이탈» 0 — A 의 칸 ${report.aOnlyRungs}개를 안 썼다)`
    : report.ladderVerdict === 'overlapping'
      ? `엇갈리는 사다리(공유 ${report.sharedRungs}/${report.totalRungs} · A만 ${report.aOnlyRungs} · B만 ${report.bOnlyRungs})`
    : '다른 사다리';
  const use = report.useVerdict === 'different-use' ? '다른 분포' : '같은 분포';
  // ⛔⭐⭐ 🩸 첫 판은 여기서 ***「같은 스타일 · 다른 컨셉」***이라고 «말했다».
  //    대조가 그것을 무너뜨렸다 — ***같은 사이트의 목록↔상세도 그만큼 멀다.***
  //    ⇒ ***거리는 «내되» 컨셉을 «말하지 않는다».***
  // ⛔ 사각은 «거리라는 수 자체»에 붙는다 — 사다리 판정과 무관하게 «항상» 낸다.
  //    🩸 첫 판은 이것을 `same-ladder` 일 때만 냈다: 「겹치는」 줄에는 경고 «없이» 거리가 실렸다.
  const note = '  ⚪ ⛔ 「거리」로 «컨셉»을 가르지 마라 — 같은 사이트의 다른 장도 그만큼 멀다(사각 참조)';
  // ⛔⭐⭐ 🩸 2026-09-12(🅕) — ***「같나」만 내면 「밀렸다」와 「아예 다르다」가 «같은 0»으로 보인다.***
  //    ⇒ ***「얼마나 가까운가」를 «제 줄»로 낸다.*** 판정에는 안 쓴다(관측).
  //    ⛔ 「못 쟀다」(null)를 「0」(=같다)으로 쓰지 않는다 — 그 둘은 반대말이다.
  const gap = report.medianRelativeGap === null
    ? '\n  ⚪ 칸 «가까움»은 못 쟀다 — 양수 칸이 한쪽에 없다(「가깝다」가 «아니다»)'
    : `\n  ⚪ 칸 «가까움»: 중앙 상대거리 ${report.medianRelativeGap}`
      + (report.medianRelativeGap <= 0.12
        ? ` — 🔑 ***사다리가 «다른» 게 아니라 «통째로 약 ${Math.round(report.medianRelativeGap * 100)}% 밀렸다»***`
        : ' — 칸끼리 서로 멀다(밀린 것이 아니라 «다른» 사다리다)');
  return `${ladder} · ${use}(거리 ${report.distributionDistance})${note}${gap}`;
}
