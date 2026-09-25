import { describe, expect, test } from 'bun:test';

import {
  contrastRatio, isLargeText, judgeWebContrast, relativeLuminance, renderWebContrast, requiredRatio,
  WEB_CONTRAST_BLIND_SPOTS, type ContrastSample,
} from './web-contrast.js';

const black = { r: 0, g: 0, b: 0 };
const white = { r: 255, g: 255, b: 255 };

describe('contrastRatio — WCAG 2.x 정의 그대로', () => {
  test('⭐ 검정↔흰색이 «21:1» 이다 — 정의의 상한', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
  });

  test('같은 색은 «1:1» 이다 — 정의의 하한', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  test('⛔ 순서를 «안 가린다» — 밝은 쪽이 분자다', () => {
    expect(contrastRatio(black, white)).toBe(contrastRatio(white, black));
  });

  test('상대 휘도 — 흰색 1 · 검정 0', () => {
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
  });
});

describe('isLargeText / requiredRatio — 문턱이 «둘»이다', () => {
  test('24px 이상이면 큰 글자다(굵기 무관)', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(requiredRatio(24, 400)).toBe(3);
  });

  test('18.66px 이상 ⊕ 굵기 700 이상이면 큰 글자다', () => {
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 600)).toBe(false);
  });

  test('그 밖은 4.5 를 요구한다', () => {
    expect(requiredRatio(16, 400)).toBe(4.5);
    expect(requiredRatio(23.9, 400)).toBe(4.5);
  });
});

describe('judgeWebContrast — 「실패 0」과 「못 쟀음」을 가른다', () => {
  const s = (ratio: number, size = 16, weight = 400): ContrastSample =>
    ({ ratio, fontSizePx: size, fontWeight: weight, detail: `r=${ratio}` });

  test('⛔ 잰 자리가 «하나도» 없으면 못 쟀음(null)이다 — 「실패 0」이 아니다', () => {
    expect(judgeWebContrast([])).toBeNull();
    expect(renderWebContrast(null)).toContain('실패 0」이 아니다');
  });

  test('⭐ 실측 bilryo-dongne — 58곳 중 31곳이 «안 읽힌다»', () => {
    const samples = [...Array(31).fill(s(3.0)), ...Array(27).fill(s(7.0))];
    const r = judgeWebContrast(samples)!;
    expect(r.measured).toBe(58);
    expect(r.failures.length).toBe(31);
    expect(r.failureRatio).toBeCloseTo(31 / 58, 5);
  });

  test('⭐ 실측 airbnb — 78곳이 «전부» 읽힌다', () => {
    const r = judgeWebContrast(Array(78).fill(s(7.0)))!;
    expect(r.failures).toEqual([]);
    expect(renderWebContrast(r)).toContain('전부» 읽힌다');
  });

  test('⭐ 실측 netflix — 64px 큰 글자는 문턱이 «3» 이라 1.54 가 실패다', () => {
    const r = judgeWebContrast([s(1.54, 64, 400)])!;
    expect(r.failures.length).toBe(1);
  });

  test('⛔ 큰 글자는 3 을 넘으면 «통과»한다 — 작은 글자였다면 실패였다', () => {
    expect(judgeWebContrast([s(3.5, 64, 400)])!.failures).toEqual([]);
    expect(judgeWebContrast([s(3.5, 16, 400)])!.failures.length).toBe(1);
  });

  test('⭐ 나쁜 것부터 낸다 — 고칠 순서가 곧 그 순서다', () => {
    const r = judgeWebContrast([s(4.0), s(2.0), s(3.0)])!;
    expect(r.failures.map((f) => f.ratio)).toEqual([2.0, 3.0, 4.0]);
  });
});

describe('blindSpots — 자가 «자기 사각»을 낸다', () => {
  test('⛔ 「글자 뒤가 이미지면 못 고른다」를 «명시»한다', () => {
    expect(WEB_CONTRAST_BLIND_SPOTS.join(' ')).toContain('image-behind-text');
  });

  test('⛔ 「WCAG 기준이 옳은가는 안 묻는다」를 «명시»한다', () => {
    expect(WEB_CONTRAST_BLIND_SPOTS.join(' ')).toContain('wcag-only');
  });
});

// ⛔⭐⭐ 🩸 「가장 나쁜 다섯」만 내니 ***수리가 «수렴하지 않았다»*** — 고칠 때마다 «다음 다섯»이 나왔다.
describe('failingPairs — 「자리」가 아니라 «쌍»으로 접는다', () => {
  const s = (ratio: number, detail: string): ContrastSample =>
    ({ ratio, fontSizePx: 14, fontWeight: 400, detail });

  test('⭐ 같은 «색↔바탕» 쌍은 «한 줄»로 접고 «횟수»를 센다', () => {
    const r = judgeWebContrast([
      s(2.1, 'rgb(1,1,1) on rgb(255,255,255) 2.10 @14px'),
      s(2.1, 'rgb(1,1,1) on rgb(255,255,255) 2.10 @13px'),
      s(3.0, 'rgb(2,2,2) on rgb(255,255,255) 3.00 @14px'),
    ])!;
    expect(r.failingPairs.length).toBe(2);
    expect(r.failingPairs[0]!.count).toBe(2);
    expect(r.failingPairs[0]!.worstRatio).toBeCloseTo(2.1, 5);
  });

  test('⛔ 나쁜 쌍부터 — 고칠 순서가 그것이다', () => {
    const r = judgeWebContrast([
      s(4.0, 'rgb(9,9,9) on rgb(255,255,255) 4.00 @14px'),
      s(2.0, 'rgb(1,1,1) on rgb(255,255,255) 2.00 @14px'),
    ])!;
    expect(r.failingPairs.map((p) => p.worstRatio)).toEqual([2, 4]);
  });

  test('⛔ 서식이 쌍을 «전부» 낸다 — 일부만 보이면 수리가 수렴하지 않는다', () => {
    const line = renderWebContrast(judgeWebContrast([
      s(2.0, 'rgb(1,1,1) on rgb(255,255,255) 2.00 @14px'),
      s(3.0, 'rgb(2,2,2) on rgb(0,0,0) 3.00 @14px'),
    ])!);
    expect(line).toContain('쌍 2');
    // ⛔ 「색 on 바탕」이 «둘 다» 보여야 고칠 수 있다 — 바탕을 잃으면 어디서 나쁜지 모른다.
    expect(line).toContain('rgb(1,1,1) on rgb(255,255,255)');
    expect(line).toContain('rgb(2,2,2) on rgb(0,0,0)');
  });

  test('실패가 없으면 쌍도 «비어» 있다', () => {
    expect(judgeWebContrast([s(9, 'x on y 9 @14px')])!.failingPairs).toEqual([]);
  });
})
