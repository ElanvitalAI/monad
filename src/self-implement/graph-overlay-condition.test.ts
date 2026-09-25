import { describe, expect, test } from 'bun:test';
import { evaluateOverlayCondition, parseOverlayCondition } from './graph-overlay-condition.js';

describe('RFC §5 4단계 — applies_when 을 «코드»가 판정한다', () => {
  test('수 비교 — 참·거짓이 갈린다', () => {
    expect(evaluateOverlayCondition('heal_attempts >= 2', { heal_attempts: 2 })).toEqual({ kind: 'applies' });
    expect(evaluateOverlayCondition('heal_attempts >= 2', { heal_attempts: 1 })).toEqual({ kind: 'does-not-apply' });
  });

  test('낱말 비교 — == 와 != 만 읽는다', () => {
    expect(evaluateOverlayCondition('goal_type == research', { goal_type: 'research' })).toEqual({ kind: 'applies' });
    expect(evaluateOverlayCondition('goal_type != research', { goal_type: 'implement' })).toEqual({ kind: 'applies' });
  });

  test('🔑 ⛔ 「그 키가 «없다»」는 「거짓」과 «다른 값»이다 — 계측 결손을 정상으로 접지 않는다', () => {
    expect(evaluateOverlayCondition('heal_attempts >= 2', {}))
      .toEqual({ kind: 'key-absent', key: 'heal_attempts' });
    // 값이 «수가 아니면» 비교 불가다 — 거짓으로 접으면 「비교했는데 안 맞았다」로 읽힌다.
    expect(evaluateOverlayCondition('heal_attempts >= 2', { heal_attempts: 'many' }))
      .toEqual({ kind: 'key-absent', key: 'heal_attempts' });
  });

  test('🔑 ⛔ «못 읽는» 조건은 조용히 참이 되지 않는다 — 얹지 않고 그 사실을 말한다', () => {
    expect(evaluateOverlayCondition('heal_attempts && rm -rf /', { heal_attempts: 9 }).kind).toBe('unparseable');
    // ⛔ 문자열에 대소 비교를 쓰면 «사전순»으로 몰래 답하지 않는다.
    expect(evaluateOverlayCondition('goal_type > research', { goal_type: 'x' }).kind).toBe('unparseable');
  });

  test('⛔ 표현식 엔진이 «아니다» — 문법은 「키 연산자 값」 하나뿐이다', () => {
    for (const bad of ['a >= 1 && b >= 2', '(a >= 1)', 'a.b >= 1', 'a >= 1;', '!a']) {
      expect({ source: bad, ok: parseOverlayCondition(bad).ok }).toEqual({ source: bad, ok: false });
    }
  });

  test('조건이 «없는» 오버레이는 항상 후보다', () => {
    expect(evaluateOverlayCondition(undefined, {})).toEqual({ kind: 'applies' });
  });
});
