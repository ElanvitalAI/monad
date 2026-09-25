// PR #4 — swipe-gesture 의 pure helper.

import { describe, expect, test } from 'bun:test';
import { classifySwipe } from '../apps/pwa/src/lib/swipe-gesture.js';

describe('classifySwipe', () => {
  test('가로 거리 부족 → null', () => {
    expect(classifySwipe({ dx: 50, dy: 5, dt: 100 })).toBeNull();
  });

  test('속도 부족 (천천히 끌기) → null', () => {
    // 100px / 1000ms = 0.1 px/ms < default 0.3
    expect(classifySwipe({ dx: 100, dy: 5, dt: 1000 })).toBeNull();
  });

  test('수직 변위 더 크면 → null (스크롤 우선)', () => {
    expect(classifySwipe({ dx: 100, dy: 110, dt: 100 })).toBeNull();
  });

  test('정상 좌측 swipe → left', () => {
    expect(classifySwipe({ dx: -150, dy: 10, dt: 200 })).toBe('left');
  });

  test('정상 우측 swipe → right', () => {
    expect(classifySwipe({ dx: 200, dy: 30, dt: 300 })).toBe('right');
  });

  test('minDistance / minVelocity override', () => {
    expect(
      classifySwipe({ dx: 60, dy: 5, dt: 100, minDistance: 50, minVelocity: 0.1 }),
    ).toBe('right');
  });

  test('dt=0 안전 처리', () => {
    expect(classifySwipe({ dx: 200, dy: 0, dt: 0 })).toBe('right');
  });
});
