/**
 * layout-tokens.test.ts — 간격 축이 «0」과 「못 쟀음」을 가르는가.
 * ⛔ 표현식이 브라우저에서 무엇을 집는지는 여기서 못 답한다 — 그건 실물 실행의 몫이다.
 */
import { describe, expect, test } from 'bun:test';

import {
  buildLayoutExpression,
  clusterContainers,
  LAYOUT_BLIND_SPOTS,
  parseLayout,
  pickBaseUnit,
  renderLayoutSection,
  type SpacingStep,
} from './layout-tokens.js';

const step = (px: number, count = 1): SpacingStep => ({ px, count, kinds: ['padding'] });

describe('⭐ 기본 단위 — 「가장 흔한 값」이 아니라 «나누는 수»', () => {
  test('8px 격자를 8 로 고른다', () => {
    const r = pickBaseUnit([step(16, 40), step(24, 30), step(8, 20), step(32, 10)]);
    expect(r.unit).toBe(8);
    expect(r.reason).toContain('배수');
  });

  test('⛔ 「가장 흔한 값」을 그대로 내지 «않는다» — 16 이 1위여도 단위는 8 이다', () => {
    expect(pickBaseUnit([step(16, 99), step(24, 5), step(40, 3)]).unit).toBe(8);
  });

  test('5px 눈금도 «찾는다» (8pt 격자가 아닌 사이트가 있다)', () => {
    expect(pickBaseUnit([step(10, 9), step(15, 8), step(25, 7), step(5, 6)]).unit).toBe(5);
  });

  test('⛔ 표본이 모자라면 «찍지» 않고 null 을 낸다', () => {
    const r = pickBaseUnit([step(13), step(17)]);
    expect(r.unit).toBeNull();
    expect(r.reason).toContain('근거가 없다');
  });

  test('⛔ 눈금이 «없으면» null 이다 — 4 로 몰지 않는다', () => {
    const r = pickBaseUnit([step(7), step(11), step(13), step(17), step(19)]);
    expect(r.unit).toBeNull();
    expect(r.reason).toContain('못 찾았다');
  });

  test('0 은 «간격이 아니다» — 후보에서 뺀다', () => {
    expect(pickBaseUnit([step(0, 99), step(16), step(24), step(8)]).unit).toBe(8);
  });
});

describe('⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다', () => {
  test('JSON 이 아니면 null', () => {
    expect(parseLayout('nope')).toBeNull();
  });
  test('sampled 가 없으면 null — 「0개 훑었다」와 「안 훑었다」는 다른 값이다', () => {
    expect(parseLayout(JSON.stringify({ url: 'https://x.test/', spacing: [] }))).toBeNull();
  });
  test('문자열이 아니면 null (CDP 가 객체를 돌려줬을 때)', () => {
    expect(parseLayout({ url: 'x', sampled: 1 })).toBeNull();
  });
  test('배열이어야 할 칸이 아니면 «빈 배열»로 두되 결과는 낸다', () => {
    const r = parseLayout(JSON.stringify({ url: 'https://x.test/', sampled: 3, spacing: 'nope' }));
    expect(r).not.toBeNull();
    expect(r!.spacing).toEqual([]);
  });
});

describe('⛔ 「0」과 「못 쟀음」을 가른다', () => {
  const of = (sampled: number, spacing: SpacingStep[] = []) =>
    parseLayout(JSON.stringify({ url: 'https://x.test/', viewport: { w: 1280, h: 900 }, sampled, spacing }))!;

  test('훑은 요소가 0 이면 산출이 «그렇게 말한다»', () => {
    expect(renderLayoutSection(of(0)).join('\n')).toContain('«못 쟀음»이다');
  });

  test('훑었는데 간격이 0 종이면 «훑은 수를 읽으라»고 한다', () => {
    expect(renderLayoutSection(of(120)).join('\n')).toContain('훑은 요소');
  });

  test('추출 자체가 실패하면 「간격이 없다가 아니다」라고 «말한다»', () => {
    expect(renderLayoutSection(null).join('\n')).toContain('「간격이 없다」가 «아니다»');
  });

  test('사각을 «항상» 싣는다', () => {
    expect(of(10).blindSpots).toEqual([...LAYOUT_BLIND_SPOTS]);
    expect(renderLayoutSection(of(10)).join('\n')).toContain('one-viewport');
  });
});

describe('산출 — 사람이 읽는다', () => {
  const report = parseLayout(JSON.stringify({
    url: 'https://x.test/', viewport: { w: 1280, h: 900 }, sampled: 240,
    spacing: [{ px: 16, count: 40, kinds: ['padding', 'gap'] }, { px: 24, count: 22, kinds: ['margin'] }, { px: 8, count: 12, kinds: ['gap'] }],
    containers: [{ px: 720, count: 9, ratio: 0.563 }],
    verticalRhythm: [{ px: 24, count: 14, kinds: ['sibling'] }],
  }))!;

  test('간격을 «어디서 나왔는지»와 함께 낸다', () => {
    expect(renderLayoutSection(report).join('\n')).toContain('16px — 40회 (gap·padding)');
  });

  test('본문 폭을 «뷰포트 비율»과 함께 낸다', () => {
    expect(renderLayoutSection(report).join('\n')).toContain('720px — 9회 (뷰포트의 56%)');
  });

  test('기본 단위와 «그 근거»를 같이 낸다', () => {
    const text = renderLayoutSection(report).join('\n');
    expect(text).toContain('기본 단위: **8px**');
    expect(text).toContain('배수');
  });
});

describe('표현식', () => {
  test('JSON 문자열을 반환한다 — 깊은 객체를 CDP 로 안 넘긴다', () => {
    expect(buildLayoutExpression()).toContain('JSON.stringify');
  });
  test('상한이 «박힌다» — 거대 페이지에서 안 터진다', () => {
    expect(buildLayoutExpression({ elements: 77, steps: 3 })).toContain('.slice(0, 77)');
    expect(buildLayoutExpression({ elements: 77, steps: 3 })).toContain('top(spacing, 3)');
  });
  test('⛔ 0 과 400 초과를 «간격에서 뺀다»(0 은 간격이 아니고 400 초과는 레이아웃이 아니다)', () => {
    expect(buildLayoutExpression()).toContain('v <= 0 || v > 400');
  });
  test('글자를 «직접» 담은 블록만 폭 후보로 센다 (래퍼를 뺀다)', () => {
    expect(buildLayoutExpression()).toContain('nodeType === 3');
  });
});


describe("⛔ 「그럴듯한 수」를 «안 낸다»", () => {
  // 📏 계기: 저장소 템플릿이 `기본 단위 2px` 를 냈다. 참이지만 «아무것도 말하지 않는다» —
  //    짝수는 거의 다 2 로 나뉜다. 그 템플릿은 clamp() 로 유동 간격을 쓴다(정말로 격자가 없다).
  test("2px 를 «단위로 안 낸다» — 눈금이 없으면 없다고 말한다", () => {
    const r = pickBaseUnit([step(22, 16), step(34, 12), step(10, 10), step(14, 10), step(26, 6)]);
    expect(r.unit).toBeNull();
    // 이 표본은 4 이상 후보가 «둘 이상»을 덮지 못한다 ⇒ 두 번째 문면이 옳다
    expect(r.reason).toContain("격자가 없거나");
    // ⛔ 핵심: 2 를 «단위로 안 낸다»(짝수는 거의 다 2로 나뉜다)
    expect(r.unit).not.toBe(2);
  });

  test("3px 도 후보가 아니다 — 3의 배수뿐이어도 «단위」로 안 낸다", () => {
    expect(pickBaseUnit([step(9, 9), step(21, 8), step(33, 7), step(15, 6)]).unit).toBeNull();
  });

  test("진짜 4px 격자는 «찾는다» (문을 너무 닫지 않았다)", () => {
    expect(pickBaseUnit([step(12, 9), step(20, 8), step(28, 7), step(4, 6)]).unit).toBe(4);
  });
});

describe("본문 폭 — 몇 px 흔들리는 «같은 칸»을 묶는다", () => {
  const w = (px: number, count: number) => ({ px, count, ratio: px / 1280 });

  test("517 과 513 은 «같은 칸»이다", () => {
    const r = clusterContainers([w(517, 3), w(513, 2)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ px: 517, count: 5 });
  });

  test("⛔ 평균을 내지 «않는다» — 「아무 데도 없는 값」이 나온다", () => {
    expect(clusterContainers([w(517, 3), w(513, 2)])[0].px).toBe(517);
  });

  test("멀리 떨어진 폭은 «안 묶는다»", () => {
    expect(clusterContainers([w(1114, 2), w(517, 3)])).toHaveLength(2);
  });

  test("빈 목록은 빈 목록이다 (지어내지 않는다)", () => {
    expect(clusterContainers([])).toEqual([]);
  });
});


describe("⭐ 후보를 «데이터에서» 찾는다 — 내가 아는 값만 찾지 않는다", () => {
  // 📏 계기: crates.io 간격이 9·18·27·36·54(9의 배수)였는데 내 고정 목록엔 «9 가 없었다».
  test("9px 격자를 «찾는다» (고정 목록에 없던 값)", () => {
    const r = pickBaseUnit([step(9, 30), step(18, 20), step(27, 10), step(36, 8)]);
    expect(r.unit).toBe(9);
    expect(r.reason).toContain("100%");
  });

  test("11px 같은 «이상한» 격자도 찾는다", () => {
    expect(pickBaseUnit([step(11, 9), step(22, 8), step(33, 7), step(44, 6)]).unit).toBe(11);
  });

  test("커버리지가 같으면 «큰 쪽»을 낸다 (8 이 4 보다 더 많이 말한다)", () => {
    expect(pickBaseUnit([step(8, 9), step(16, 8), step(24, 7), step(32, 6)]).unit).toBe(8);
  });

  test("⛔ 여러 계열이 섞이면 «단위가 아니다»라고 하되 후보와 비율을 «말한다»", () => {
    // 9 계열 ⊕ 7 계열이 섞인 실제 모양(crates.io)
    const r = pickBaseUnit([step(9, 106), step(14, 46), step(7, 30), step(27, 28), step(5, 27), step(18, 22), step(36, 20), step(54, 3)]);
    expect(r.unit).toBeNull();
    expect(r.reason).toContain("가장 잘 맞는 후보는");
    expect(r.reason).toContain("여러 계열이 섞였거나");
  });
});
