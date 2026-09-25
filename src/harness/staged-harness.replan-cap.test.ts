// self-dev replan cap(2026-07-25) — 상수 기본값(2) + opts 검증. 값 해석 계약: 1..20 안전정수만 채택, 그 외 기본 2.
import { describe, expect, test } from 'bun:test';
import { resolveMaxReplans } from './staged-harness.js';

describe('resolveMaxReplans — replan cap 값 해석', () => {
  test('양의 정수는 그대로 채택', () => {
    expect(resolveMaxReplans(1)).toBe(1);
    expect(resolveMaxReplans(2)).toBe(2);
    expect(resolveMaxReplans(5)).toBe(5);
  });

  test('config 미설정(undefined) → 기본 2', () => {
    expect(resolveMaxReplans(undefined)).toBe(2);
    expect(resolveMaxReplans(null)).toBe(2);
  });

  test('소수는 거부 → 기본 2 (0.5→0 채택하던 버그 회귀 방지)', () => {
    expect(resolveMaxReplans(0.5)).toBe(2);
    expect(resolveMaxReplans(2.5)).toBe(2);
    expect(resolveMaxReplans(1.9)).toBe(2);
  });

  test('0·음수·NaN·비숫자는 거부 → 기본 2', () => {
    expect(resolveMaxReplans(0)).toBe(2);
    expect(resolveMaxReplans(-1)).toBe(2);
    expect(resolveMaxReplans(Number.NaN)).toBe(2);
    expect(resolveMaxReplans(Number.POSITIVE_INFINITY)).toBe(2);
    expect(resolveMaxReplans('3')).toBe(2);
    expect(resolveMaxReplans({})).toBe(2);
  });

  test('상한(20) 초과는 오설정으로 보고 기본 2 (과도 반복 방어·review)', () => {
    expect(resolveMaxReplans(20)).toBe(20); // 경계 채택
    expect(resolveMaxReplans(21)).toBe(2);  // 초과 거부
    expect(resolveMaxReplans(1000)).toBe(2);
    expect(resolveMaxReplans(Number.MAX_SAFE_INTEGER)).toBe(2);
  });
});
