/**
 * ⛔⭐ 이 시험이 무는 것은 ***「잉크가 어디에 몰렸나가 갈리나」***이지 「보기에 같나」가 아니다.
 *    ⊕ ***합으로 정규화한다***는 것을 빼먹으면 「더 진한 화면」이 「배치가 다르다」로 읽힌다.
 */
import { describe, expect, test } from 'bun:test';

import {
  LAYOUT_BLIND_SPOTS, judgeLayoutGap, layoutDistance, renderLayoutGap,
} from './layout-signature.js';

describe('layoutDistance — 총변동 거리', () => {
  test('같은 벡터는 0', () => {
    expect(layoutDistance([1, 2, 3, 4], [1, 2, 3, 4])).toBe(0);
  });

  test('⛔⭐ ***합으로 정규화한다*** — 통째로 진해진 화면은 「같은 배치」다', () => {
    // 🩸 이 줄이 없으면 「전체가 2배 진한 화면」이 「배치가 다르다」로 나온다 — 그건 밝기 축의 물음이다.
    expect(layoutDistance([1, 2, 3, 4], [2, 4, 6, 8])).toBe(0);
  });

  test('잉크가 «자리를 옮기면» 커진다', () => {
    // 왼쪽 끝에 몰린 것 ↔ 오른쪽 끝에 몰린 것 = «완전히» 다른 분포
    expect(layoutDistance([1, 0, 0, 0], [0, 0, 0, 1])).toBe(1);
    // 절반만 옮기면 절반
    expect(layoutDistance([1, 1, 0, 0], [0, 0, 1, 1])).toBe(1);
    expect(layoutDistance([2, 0], [1, 1])).toBe(0.5);
  });

  test('⛔ 길이가 다르면 «못 쟀다» — 0 이 아니다', () => {
    expect(layoutDistance([1, 2, 3], [1, 2])).toBeNull();
    expect(layoutDistance([], [])).toBeNull();
  });

  test('⛔⭐ ***가장자리가 «하나도» 없는 화면***은 분포가 정의되지 않는다', () => {
    // 순백·순흑 화면은 타일 편차가 전부 0 이라 «나눌 수가 없다».
    expect(layoutDistance([0, 0, 0], [1, 2, 3])).toBeNull();
    expect(layoutDistance([1, 2, 3], [0, 0, 0])).toBeNull();
  });

  test('⛔ 유한하지 않은 값은 «못 쟀다»', () => {
    expect(layoutDistance([1, Number.NaN], [1, 2])).toBeNull();
    expect(layoutDistance([1, 2], [Number.POSITIVE_INFINITY, 2])).toBeNull();
  });
});

describe('judgeLayoutGap · renderLayoutGap', () => {
  test('타일 수를 «같이» 낸다 — 분모가 없으면 거리를 못 읽는다', () => {
    expect(judgeLayoutGap([1, 1, 2, 4], [1, 1, 2, 4])).toEqual({ distance: 0, tiles: 4 });
    expect(judgeLayoutGap([1], [1, 2])).toBeNull();
  });

  test('⛔⭐⭐ ***「같다/다르다」를 «안» 판정한다*** — 그 줄이 산출에 «있어야» 한다', () => {
    const line = renderLayoutGap(judgeLayoutGap([1, 0, 0, 0], [0, 0, 0, 1]));
    expect(line).toContain('거리 1');
    expect(line).toContain('«안» 판정한다');
    // 📏 임계 대신 ***「내가 본 것」***을 나란히 싣는다.
    expect(line).toContain('같은 사이트');
    expect(line).toContain('다른 사이트');
  });

  test('⛔ 못 쟀으면 «못 쟀다»라고 쓴다 — 「같다」로 접지 않는다', () => {
    const line = renderLayoutGap(null);
    expect(line).toContain('못 쟀다');
    expect(line).not.toContain('같은 배치');
  });

  test('⛔⭐ 사각에 ***임계를 안 둔 이유***가 값으로 적혀 있다', () => {
    const joined = LAYOUT_BLIND_SPOTS.join(' ');
    expect(joined).toContain('no-threshold');
    expect(joined).toContain('내 표본');
    expect(joined).toContain('flat-page-undefined');
  });
});
