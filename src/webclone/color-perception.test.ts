/**
 * color-perception.test.ts — 「접는다」는 위험하다. 잘못 접으면 «다른 색»이 사라진다.
 * ⛔ 그래서 이 시험은 ⓐ 접혀야 할 것이 접히나 ⓑ ***안 접혀야 할 것이 안 접히나*** ⓒ 접은 것을 «말하나» 를 문다.
 */
import { describe, expect, test } from 'bun:test';

import {
  compositeOver,
  countUncomposited,
  DEFAULT_DELTA_E,
  deltaE,
  formatMergedColor,
  mergePerceptualDuplicates,
  parseRgb,
  toLab,
} from './color-perception.js';

describe('⭐ 배경 위 알파 합성 — 「CSS 문면」과 「눈이 보는 값」을 잇는다', () => {
  test('불투명한 색은 «그대로» 지난다', () => {
    expect(compositeOver('#264323', 'rgb(255,255,255)')).toBe('rgb(38, 67, 35)');
  });

  test('50% 검정이 흰 배경 위면 중간 회색이다', () => {
    expect(compositeOver('rgba(0,0,0,0.5)', 'rgb(255,255,255)')).toBe('rgb(128, 128, 128)');
  });

  test('⭐ 같은 알파라도 «배경이 다르면» 다른 색이 된다 — 그래서 배경이 필요하다', () => {
    expect(compositeOver('rgba(0,0,0,0.5)', 'rgb(0,0,0)')).toBe('rgb(0, 0, 0)');
    expect(compositeOver('rgba(0,0,0,0.5)', 'rgb(255,255,255)')).toBe('rgb(128, 128, 128)');
  });

  test('⛔ 배경이 «투명하면» 못 합성한다 — 흰색으로 «몰지» 않는다', () => {
    expect(compositeOver('rgba(0,0,0,0.5)', 'rgba(255,255,255,0.5)')).toBeNull();
  });

  test('⛔ 못 읽는 문면은 `null` — 「거리 0」이 아니다', () => {
    expect(compositeOver('var(--x)', 'rgb(255,255,255)')).toBeNull();
    expect(compositeOver('rgba(0,0,0,0.5)', 'currentColor')).toBeNull();
  });
});

describe('색 문면 읽기 — ⛔ 못 읽으면 «검정으로 몰지» 않는다', () => {
  test('rgb·rgba·hex 3·6·8 자리를 읽는다', () => {
    expect(parseRgb('rgb(60, 60, 60)')).toEqual({ r: 60, g: 60, b: 60, a: 1 });
    expect(parseRgb('rgba(60, 60, 60, 0.33)')).toEqual({ r: 60, g: 60, b: 60, a: 0.33 });
    expect(parseRgb('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseRgb('#0b7261')).toEqual({ r: 11, g: 114, b: 97, a: 1 });
    expect(parseRgb('#0b726180')).toMatchObject({ r: 11, g: 114, b: 97 });
  });

  test('공백 문법(`rgb(0 0 0 / 50%)`)도 읽는다', () => {
    expect(parseRgb('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  test('⛔ 못 읽으면 null — 0 이나 검정이 «아니다»', () => {
    expect(parseRgb('currentColor')).toBeNull();
    expect(parseRgb('var(--x)')).toBeNull();
    expect(parseRgb('')).toBeNull();
  });
});

describe('지각 거리', () => {
  test('같은 색은 0', () => {
    expect(deltaE('#264323', 'rgb(38, 67, 35)')).toBeCloseTo(0, 6);
  });

  test('⛔ 못 읽는 문면이 끼면 null — 「거리 0」이 아니다', () => {
    expect(deltaE('#264323', 'currentColor')).toBeNull();
  });

  test('진녹과 크림은 «멀다»', () => {
    expect(deltaE('#264323', '#f9f7ec')!).toBeGreaterThan(50);
  });

  test('Lab 변환이 흰색·검정을 제자리에 둔다', () => {
    expect(toLab(255, 255, 255).L).toBeCloseTo(100, 1);
    expect(toLab(0, 0, 0).L).toBeCloseTo(0, 6);
  });
});

describe('ⓐ 접혀야 할 것이 접힌다', () => {
  // ⛔⭐⭐ 2026-09-10 정정 — 이 자리에 있던 시험이 ***틀린 규칙을 «못 박고» 있었다***.
  //    「같은 RGB·다른 알파는 접는다」는 CSS 문면으로는 참이지만, 이 모듈의 축은 «눈»이다.
  //    📏 흰 배경 위: .7 → rgb(119,119,119) · .33 → rgb(191,191,191) · ΔE **27.3** (JND 의 11.9배).
  test('⛔ 머리말의 «바로 그 예»는 «안 접힌다» — 눈에는 다른 색이다', () => {
    const pair = [
      { value: 'rgba(60, 60, 60, 0.7)', count: 10 },
      { value: 'rgba(60, 60, 60, 0.33)', count: 4 },
    ];
    // 배경을 모르면 «못 잰다» ⇒ 안 접는다
    expect(mergePerceptualDuplicates(pair)).toHaveLength(2);
    // 배경을 알아도 «멀다» ⇒ 안 접는다
    expect(mergePerceptualDuplicates(pair, DEFAULT_DELTA_E, 'rgb(255,255,255)')).toHaveLength(2);
  });

  test('⭐ 알파가 «거의 같으면» 배경 위에서 접힌다 — 그때 이유는 alpha', () => {
    const r = mergePerceptualDuplicates([
      { value: 'rgba(60, 60, 60, 0.7)', count: 10 },
      { value: 'rgba(60, 60, 60, 0.71)', count: 4 },
    ], DEFAULT_DELTA_E, 'rgb(255,255,255)');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ value: 'rgba(60, 60, 60, 0.7)', count: 14, reason: 'alpha' });
    expect(r[0].composited).toBe('rgb(119, 119, 119)');
  });

  test('⛔ 배경을 모르면 «못 접은 수»를 값으로 낸다 — 조용히 넘어가지 않는다', () => {
    const pair = [{ value: 'rgba(60,60,60,0.7)', count: 1 }, { value: '#264323', count: 1 }];
    expect(countUncomposited(pair)).toBe(1);
    expect(countUncomposited(pair, 'rgb(255,255,255)')).toBe(0);
  });

  test('눈이 못 가르는 «거의 같은» 색도 접는다', () => {
    const r = mergePerceptualDuplicates([{ value: '#264323', count: 9 }, { value: '#264423', count: 2 }]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe('near');
  });

  test('⭐ 대표는 «가장 많이 쓰인» 쪽이다 — 평균을 내지 «않는다»', () => {
    const r = mergePerceptualDuplicates([{ value: '#264423', count: 2 }, { value: '#264323', count: 99 }]);
    expect(r[0].value).toBe('#264323');
  });
});

describe('ⓑ ⛔ 안 접혀야 할 것이 «안 접힌다» (가장 위험한 축)', () => {
  test('crates.io 의 두 초록은 «다른 색»이다', () => {
    const r = mergePerceptualDuplicates([{ value: 'rgb(0, 172, 91)', count: 9 }, { value: 'rgb(26, 156, 93)', count: 5 }]);
    expect(r).toHaveLength(2);
  });

  test('브랜드색과 배경색은 안 접힌다', () => {
    const r = mergePerceptualDuplicates([
      { value: '#264323', count: 9 }, { value: '#f9f7ec', count: 8 }, { value: '#ffc933', count: 7 },
    ]);
    expect(r).toHaveLength(3);
  });

  test('⛔ 못 읽는 문면은 «접지 않고» 그대로 남긴다', () => {
    const r = mergePerceptualDuplicates([{ value: 'currentColor', count: 3 }, { value: '#264323', count: 9 }]);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.value === 'currentColor')).toMatchObject({ reason: 'none', merged: [] });
  });

  test('임계를 0 으로 주면 «전부» 꺼진다 — 알파도 «같은 자»로 재기 때문이다', () => {
    expect(mergePerceptualDuplicates([{ value: '#264323', count: 9 }, { value: '#264423', count: 2 }], 0)).toHaveLength(2);
    // ⛔ 옛 판은 여기서 1 이었다 — 알파를 «임계 밖»의 별도 규칙으로 접었기 때문이다.
    expect(mergePerceptualDuplicates([
      { value: 'rgba(60,60,60,0.7)', count: 9 }, { value: 'rgba(60,60,60,0.1)', count: 2 },
    ], 0, 'rgb(255,255,255)')).toHaveLength(2);
  });

  test('⛔⭐ 알파 색은 «불투명한 이웃»에도 안 붙는다 — 배경을 모르는 채로는', () => {
    // rgb(119,119,119) 는 rgba(60,60,60,.7) 의 흰 배경 합성값이다. 배경을 «모르면» 그것을 알 수 없다.
    expect(mergePerceptualDuplicates([
      { value: 'rgb(119,119,119)', count: 9 }, { value: 'rgba(60,60,60,0.7)', count: 2 },
    ])).toHaveLength(2);
    // ✅ 배경을 주면 «붙는다» — 같은 화면 색이므로
    expect(mergePerceptualDuplicates([
      { value: 'rgb(119,119,119)', count: 9 }, { value: 'rgba(60,60,60,0.7)', count: 2 },
    ], DEFAULT_DELTA_E, 'rgb(255,255,255)')).toHaveLength(1);
  });
});

describe('ⓒ 접은 것을 «말한다»', () => {
  test('대표 줄이 「몇 색을 접었는지」와 «그 목록»을 낸다', () => {
    const [c] = mergePerceptualDuplicates([
      { value: 'rgba(60,60,60,0.7)', count: 10 }, { value: 'rgba(60,60,60,0.71)', count: 4 },
    ], DEFAULT_DELTA_E, 'rgb(255,255,255)');
    const line = formatMergedColor(c, 20);
    // ⛔ 기존 문면을 «지킨다» — 형식을 바꾸면 그 줄을 읽던 것들이 조용히 끊긴다
    expect(line).toContain('14/20개 요소');
    expect(line).toContain('70.0%');
    expect(line).toContain('1색 접음(alpha)');
    expect(line).toContain('rgba(60,60,60,0.71)');
    // ⭐ 그리고 «눈이 보는 값»을 같이 낸다
    expect(line).toContain('rgb(119, 119, 119)(합성)');
  });

  test('안 접힌 색은 «조용하다»(소음 금지)', () => {
    expect(formatMergedColor({ value: '#264323', count: 9, merged: [], reason: 'none' }, 9)).not.toContain('접음');
  });

  test('임계가 «값으로» 나가 있다 — 읽는 쪽이 다시 잴 수 있게', () => {
    expect(DEFAULT_DELTA_E).toBe(2.3);
  });
});
