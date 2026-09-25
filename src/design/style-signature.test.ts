/**
 * style-signature.test.ts — ⛔ 위험한 축:
 *    ⓐ ***「못 쟀다」를 「같다」로*** 내는 것 (한쪽이 비었을 때)
 *    ⓑ 칸이 둘뿐인데 「분포가 같다/다르다」를 말하는 것
 *    ⓒ ***「보기에 같나」를 답한 것처럼 «보이게» 하는 것*** — 사각이 그것을 «먼저» 말해야 한다
 */
import { describe, expect, test } from 'bun:test';
import {
  judgeStyleSignature, renderStyleSignature,
  DISTRIBUTION_DISTANCE_DIFFERENT, SIGNATURE_MIN_RUNGS, STYLE_SIGNATURE_BLIND_SPOTS,
} from './style-signature.js';

// 📏 실측 — ③ 대조 ①(연표)과 그 원본(jongi-jip)의 활자 칸 쓰임.
const ORIGIN = [{ value: 14, count: 42 }, { value: 15, count: 2 }, { value: 17, count: 8 },
  { value: 20, count: 2 }, { value: 26, count: 1 }];
const CONCEPT = [{ value: 14, count: 22 }, { value: 15, count: 10 }, { value: 17, count: 6 },
  { value: 20, count: 8 }, { value: 26, count: 1 }];

describe('judgeStyleSignature', () => {
  test('🩸⭐⭐ 실측 재현 — ***「같은 사다리 · 다른 분포」***', () => {
    const r = judgeStyleSignature(ORIGIN, CONCEPT)!;
    expect(r.ladderVerdict).toBe('same-ladder');
    expect(r.sharedRungs).toBe(5);
    expect(r.useVerdict).toBe('different-use');
  });

  // 🩸⭐⭐⭐ ***대조가 내 문장을 무너뜨렸다*** — 같은 사이트의 두 장도 그만큼 멀다.
  const DETAIL = [{ value: 14, count: 11 }, { value: 15, count: 6 }, { value: 17, count: 2 },
    { value: 20, count: 1 }, { value: 26, count: 1 }];

  test('⛔⭐⭐ ***「거리」로 «컨셉»을 가르지 못한다*** — 같은 사이트 목록↔상세가 «거의 같은 거리»다', () => {
    const crossConcept = judgeStyleSignature(ORIGIN, CONCEPT)!.distributionDistance;   // 0.313
    const sameSite = judgeStyleSignature(ORIGIN, DETAIL)!.distributionDistance;        // 0.29
    expect(Math.abs(crossConcept - sameSite)).toBeLessThan(0.05);   // ⛔ ***안 갈린다***
  });

  test('⛔ 그래서 문면이 ***「다른 컨셉이다」라고 «말하지 않는다»***', () => {
    const line = renderStyleSignature(judgeStyleSignature(ORIGIN, CONCEPT));
    expect(line).not.toContain('다른 컨셉」의');
    expect(line).toContain('「거리」로 «컨셉»을 가르지 마라');
  });

  test('✅ 그러나 ***「사다리가 같은가」는 «잘» 가른다***', () => {
    expect(judgeStyleSignature(ORIGIN, CONCEPT)!.ladderOverlap).toBe(1);
    const other = judgeStyleSignature(ORIGIN, [{ value: 15, count: 45 }, { value: 24, count: 10 },
      { value: 32, count: 1 }, { value: 60, count: 1 }])!;
    expect(other.ladderOverlap).toBeLessThan(0.2);
  });

  test('자기 자신과 대면 ***같은 분포***다 — 거리 0', () => {
    const r = judgeStyleSignature(ORIGIN, ORIGIN)!;
    expect(r.distributionDistance).toBe(0);
    expect(r.useVerdict).toBe('same-use');
  });

  test('⛔ 사다리가 «겹치지 않으면» 다른 사다리다', () => {
    const r = judgeStyleSignature([{ value: 10, count: 1 }, { value: 20, count: 1 }, { value: 30, count: 1 }],
      [{ value: 11, count: 1 }, { value: 21, count: 1 }, { value: 31, count: 1 }])!;
    expect(r.ladderVerdict).toBe('different-ladder');
    expect(r.sharedRungs).toBe(0);
  });

  test('⛔⭐ 한쪽이 «비면» null — 「같다」도 「다르다」도 아니다', () => {
    expect(judgeStyleSignature([], ORIGIN)).toBeNull();
    expect(judgeStyleSignature(ORIGIN, [{ value: 14, count: 0 }])).toBeNull();
  });

  test('⛔ 칸이 셋 미만이면 «변별하지 않는다»', () => {
    const r = judgeStyleSignature([{ value: 14, count: 5 }, { value: 26, count: 1 }],
      [{ value: 14, count: 1 }, { value: 26, count: 5 }])!;
    expect(r.discriminating).toBe(false);
    expect(renderStyleSignature(r)).toContain('분포»라 부를 것이 없다');
  });

  test('⭐ 눈 안이면 «같은 칸»이다 — 15 와 15.0001', () => {
    const r = judgeStyleSignature(
      [{ value: 15, count: 1 }, { value: 20, count: 1 }, { value: 26, count: 1 }],
      [{ value: 15.0001, count: 1 }, { value: 20, count: 1 }, { value: 26, count: 1 }])!;
    expect(r.ladderVerdict).toBe('same-ladder');
  });

  test('문턱이 «값으로» 꺼내져 있다 — 논증에서 나온 수다', () => {
    expect(DISTRIBUTION_DISTANCE_DIFFERENT).toBeGreaterThan(0);
    expect(SIGNATURE_MIN_RUNGS).toBe(3);
  });
});

// ⛔⭐⭐ 2026-09-12(🅕) — ***「칸이 «얼마나» 가까운가」*** 축. `ladderOverlap` 이 0 쪽으로 무너진 뒤에도
//    「밀렸다」와 「아예 다르다」를 가른다. ⛔ 판정에는 «안» 쓴다(관측).
describe('medianRelativeGap — 「칸이 얼마나 가까운가」', () => {
  const mk = (v: readonly number[]) => v.map((x) => ({ value: x, count: 10 }));
  const A = [12, 14, 16, 18, 22, 28, 36, 46.8, 64];

  test('같은 사다리면 0', () => {
    expect(judgeStyleSignature(mk(A), mk(A))!.medianRelativeGap).toBe(0);
  });

  test('⭐ 「통째로 밀렸다」를 «밀린 비율»로 읽어 낸다', () => {
    const shifted = (f: number) => mk(A.map((x) => Math.round(x * f * 100) / 100));
    const r3 = judgeStyleSignature(mk(A), shifted(1.03))!;
    const r10 = judgeStyleSignature(mk(A), shifted(1.10))!;
    expect(r3.medianRelativeGap).toBeCloseTo(0.029, 2);
    expect(r10.medianRelativeGap).toBeCloseTo(0.091, 2);
  });

  test('⛔⭐ ***`ladderOverlap` 이 무너진 뒤에도 가른다*** — 이것이 이 축의 존재 이유다', () => {
    const shifted10 = judgeStyleSignature(mk(A), mk(A.map((x) => Math.round(x * 1.1 * 100) / 100)))!;
    const different = judgeStyleSignature(mk(A), mk([7, 9, 11, 25, 33, 55, 88, 120, 200]))!;
    // 옛 축은 둘을 «거의 같은 0»으로 낸다
    expect(shifted10.ladderOverlap).toBeLessThan(0.1);
    expect(different.ladderOverlap).toBe(0);
    // ⭐ 새 축은 «갈라 낸다»
    expect(different.medianRelativeGap!).toBeGreaterThan(shifted10.medianRelativeGap! * 2);
  });

  test('⛔ 「못 쟀다」를 「0」(=같다)으로 쓰지 않는다 — 그 둘은 반대말이다', () => {
    const r = judgeStyleSignature(mk([0, 0, 0]), mk(A));
    expect(r === null || r.medianRelativeGap === null).toBe(true);
  });

  test('⛔ 판정은 «안» 바뀐다 — 이 축은 관측이다', () => {
    const r = judgeStyleSignature(mk(A), mk(A))!;
    expect(r.ladderVerdict).toBe('same-ladder');
    expect(r.sharedRungs).toBe(A.length);
  });

  test('⭐ 사람이 읽을 줄에 «제 줄»로 나온다', () => {
    const line = renderStyleSignature(judgeStyleSignature(
      mk(A), mk(A.map((x) => Math.round(x * 1.03 * 100) / 100))));
    expect(line).toContain('칸 «가까움»');
    expect(line).toContain('통째로');
    expect(line.split('\n').length).toBeGreaterThan(1);
  });
});

describe('사각', () => {
  test('⛔⭐⭐ ***「보기에 같나」를 «안» 묻는다***고 «첫 줄»이 말한다', () => {
    expect(STYLE_SIGNATURE_BLIND_SPOTS[0]).toContain('not-perception');
    expect(STYLE_SIGNATURE_BLIND_SPOTS[0]).toContain('대용');
    expect(STYLE_SIGNATURE_BLIND_SPOTS.join(' ')).toContain('distance-is-not-concept');
  });
  test('⛔ 「못 쟀음」을 「같다」로 쓰지 않는다', () => {
    expect(renderStyleSignature(null)).toContain('못 쟀다');
    expect(renderStyleSignature(null)).toContain('「같다」도 「다르다」도 아니다');
  });

  // ⛔⭐⭐ 🩸 2026-09-12(🅕 58차) — ***양성·음성 대조 쌍이 «우연히» 생겼고 자가 거기서 떨어졌다.***
  //    「클론을 시도해 실패」(terra) ↔ 「클론을 시도조차 안 함」(aside · 다른 브랜드 창작)이
  //    ***0.012/0.010/0.000 차이***로 붙었다. ⇒ 이 자는 ***멀어지면 변별을 멈춘다***.
  //    ⛔ 그 사실이 사각에 «없으면» 읽는 사람이 0.744 와 0.756 을 «다른 값»으로 읽는다.
  // ⛔⭐⭐ 🩸 2026-09-12(🅕 58차 · 2판) — ***앞 판의 기전을 «내가» 반증했다.***
  //    「0.7 위쪽에서 «포화»한다」고 썼는데, 왜곡을 «내가 정한» 합성 사다리로 재 보니
  //    ***「포화」가 아니라 «변별 구간 자체가 1~6% 안에 있다»***였다. 그리고 그 기전은
  //    ***거리 = 겹침의 재진술***(r = -0.983)이다. ⇒ 수를 «곡선»으로 적는다.
  // ⛔⭐⭐ 🩸 2026-09-12(🅕) — 실측에서 ***두 축이 «반대» 순위***를 냈다.
  //    한 수(거리)로 「어느 쪽이 나은가」를 쓰면 «틀린 쪽»을 고른다.
  test('⛔⭐ 「덮었나」와 「벗어났나」가 «반대로» 순위 매길 수 있다고 말한다', () => {
    const all = STYLE_SIGNATURE_BLIND_SPOTS.join(' ');
    expect(all).toContain('coverage-and-containment-can-oppose');
    // ⛔ 「반대일 수 있다」만 적으면 다음 사람이 못 쓴다 — 실측 쌍의 «수»가 있어야 한다
    expect(all).toContain('0.520');
    expect(all).toContain('0.316');
    expect(all).toContain('bOnlyRungs');
  });

  test('⛔⭐ 「변별 구간이 좁다」를 «곡선의 수»로 말한다', () => {
    const all = STYLE_SIGNATURE_BLIND_SPOTS.join(' ');
    expect(all).toContain('narrow-dynamic-range');
    // ⛔ 곡선의 «양 끝»이 둘 다 있어야 한다 — 한쪽만 적으면 「어디까지 믿나」를 못 읽는다
    expect(all).toContain('1%');
    expect(all).toContain('6%');
    expect(all).toContain('0.745');
    // ⭐ 기전(겹침의 재진술)과 그 상관계수 — 이게 없으면 「왜 그런가」를 다음 사람이 다시 판다
    expect(all).toContain('ladderOverlap');
    expect(all).toContain('-0.983');
    // ⛔ 합성 표본이라는 «경계»를 같이 말해야 한다 — 안 그러면 실제 사이트 수로 읽힌다
    expect(all).toContain('합성');
  });
});

// ── 축이 셋이 되면서 — ⛔ ***색은 «수»가 아니라 «문면»이다*** ────────────────────
describe('축이 여럿일 때의 불변식', () => {
  test('⛔ 「한쪽이 빈」 축은 «그 축만» null 이다 — 다른 축을 못 쓰게 만들지 않는다', () => {
    const good = judgeStyleSignature(ORIGIN, CONCEPT);
    const empty = judgeStyleSignature([], CONCEPT);
    expect(good).not.toBeNull();
    expect(empty).toBeNull();
  });

  test('⭐ 칸 «번호»가 무엇이든 판정은 «분포»만 본다 — 색을 번호로 바꿔도 성립한다', () => {
    const asIs = judgeStyleSignature(
      [{ value: 1, count: 10 }, { value: 2, count: 5 }, { value: 3, count: 1 }],
      [{ value: 1, count: 1 }, { value: 2, count: 5 }, { value: 3, count: 10 }])!;
    expect(asIs.ladderVerdict).toBe('same-ladder');
    expect(asIs.useVerdict).toBe('different-use');
  });
});

// ⛔⭐⭐ 🩸 2026-09-12 — ***「겹친다」에 «방향»이 없었다.***
//    자가 아래 둘을 «같은 수»로 냈다: ⓐ 사다리 «밖»을 밟았다 ⓑ 칸 하나를 «안 썼다».
//    📏 양성 대조는 «둘»이다 — 실측 두 칸(간격·색)이 «둘 다» ⓑ 였다.
describe('containment — ***「안 쓴 칸」을 「이탈」로 내지 않는다***', () => {
  // 📏 실측: jongi-jip ↔ 연표 «간격» 칸. B 가 60px 를 «안 썼다».
  const SPACE_A = [{ value: 10, count: 68 }, { value: 20, count: 63 }, { value: 30, count: 6 },
    { value: 40, count: 6 }, { value: 60, count: 1 }];
  const SPACE_B = [{ value: 10, count: 23 }, { value: 20, count: 43 }, { value: 30, count: 8 },
    { value: 40, count: 11 }];
  // 📏 실측: 같은 두 장의 «색» 칸(합쳐 번호 매긴 값). B 가 두 칸을 «안 썼다».
  const COLOR_A = [{ value: 1, count: 17 }, { value: 2, count: 1 }, { value: 3, count: 3 },
    { value: 4, count: 87 }, { value: 5, count: 3 }, { value: 6, count: 4 },
    { value: 7, count: 22 }, { value: 8, count: 1 }, { value: 9, count: 10 }, { value: 10, count: 23 }];
  const COLOR_B = [{ value: 1, count: 14 }, { value: 3, count: 6 }, { value: 4, count: 17 },
    { value: 5, count: 1 }, { value: 6, count: 1 }, { value: 8, count: 1 },
    { value: 9, count: 11 }, { value: 10, count: 17 }];

  test('🩸 실측 ⓐ 간격 — B 가 부분집합이다(이탈 0)', () => {
    const r = judgeStyleSignature(SPACE_A, SPACE_B)!;
    expect(r.containment).toBe('a-contains-b');
    expect(r.bOnlyRungs).toBe(0);           // ⭐ ***B 는 밖을 «한 칸도» 안 밟았다***
    expect(r.aOnlyRungs).toBe(1);
    expect(renderStyleSignature(r)).toContain('부분집합');
    expect(renderStyleSignature(r)).toContain('«이탈» 0');
  });

  test('🩸 실측 ⓑ 색 — 같은 방향이다(양성 대조가 «둘»)', () => {
    const r = judgeStyleSignature(COLOR_A, COLOR_B)!;
    expect(r.containment).toBe('a-contains-b');
    expect(r.bOnlyRungs).toBe(0);
    expect(r.aOnlyRungs).toBe(2);
  });

  test('⭐ 반대 방향도 «말»이 달라진다 — 대칭이 아니다', () => {
    const r = judgeStyleSignature(SPACE_B, SPACE_A)!;
    expect(r.containment).toBe('b-contains-a');
    expect(renderStyleSignature(r)).toContain('A 가 B 의 부분집합');
  });

  test('⛔⭐ ***진짜 이탈은 「엇갈린다」로 나온다*** — 부분집합과 «갈려야» 한다', () => {
    const crossing = judgeStyleSignature(
      [{ value: 10, count: 5 }, { value: 20, count: 5 }, { value: 30, count: 5 }],
      [{ value: 10, count: 5 }, { value: 20, count: 5 }, { value: 33, count: 5 }])!;
    expect(crossing.containment).toBe('crossing');
    expect(crossing.aOnlyRungs).toBe(1);
    expect(crossing.bOnlyRungs).toBe(1);
    const line = renderStyleSignature(crossing);
    expect(line).toContain('엇갈리는');
    expect(line).not.toContain('부분집합');   // ⛔ 섞이면 이 고침이 «무의미»하다
  });

  test('같은 칸을 쓰면 containment 가 same 이다', () => {
    const r = judgeStyleSignature(ORIGIN, CONCEPT)!;
    expect(r.containment).toBe('same');
    expect(r.ladderVerdict).toBe('same-ladder');
  });

  // ⛔ 사각은 «거리라는 수»에 붙는다 — 사다리 판정과 무관하게 «항상» 나와야 한다.
  test('🩸 첫 판은 「겹치는」 줄에 거리를 «경고 없이» 실었다', () => {
    const partial = renderStyleSignature(judgeStyleSignature(SPACE_A, SPACE_B));
    expect(partial).toContain('거리');
    expect(partial).toContain('컨셉');       // ⭐ ***경고가 «같이» 실린다***
  });
});
