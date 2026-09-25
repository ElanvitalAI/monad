// 세션별 턴-중 대기 발화 — ⛔ 「비우면서 낸다」와 「원본 큐도 같이 비운다」가 계약이다.
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  enqueuePendingUserInput, drainPendingUserInput, pendingUserInputCount, clearPendingUserInput,
} from './pending-input.js';

describe('pending-input — 턴 «안»으로 들어갈 발화', () => {
  beforeEach(() => { clearPendingUserInput('s1'); clearPendingUserInput('s2'); });

  test('쌓고 세고 비운다', () => {
    enqueuePendingUserInput('s1', '첫째');
    enqueuePendingUserInput('s1', '둘째');
    expect(pendingUserInputCount('s1')).toBe(2);
    expect(drainPendingUserInput('s1')).toEqual(['첫째', '둘째']);
    expect(pendingUserInputCount('s1')).toBe(0);
  });

  test('⛔ 배수는 «비우면서» 낸다 — 안 비우면 매 바퀴 같은 발화가 다시 들어간다', () => {
    enqueuePendingUserInput('s1', 'x');
    expect(drainPendingUserInput('s1')).toEqual(['x']);
    expect(drainPendingUserInput('s1')).toEqual([]);
  });

  test('세션이 «갈린다» — 남의 턴에 안 들어간다', () => {
    enqueuePendingUserInput('s1', 'a');
    enqueuePendingUserInput('s2', 'b');
    expect(drainPendingUserInput('s1')).toEqual(['a']);
    expect(drainPendingUserInput('s2')).toEqual(['b']);
  });

  test('⭐⭐ 배수되면 «원본 큐»도 비우라고 알린다 — 중복 전송 방지의 핵심', () => {
    const seen: string[][] = [];
    enqueuePendingUserInput('s1', '하나', (d) => seen.push([...d]));
    enqueuePendingUserInput('s1', '둘', (d) => seen.push([...d]));
    drainPendingUserInput('s1');
    expect(seen).toEqual([['하나', '둘']]);
  });

  test('빈 문자열·공백·빈 세션은 안 쌓는다', () => {
    enqueuePendingUserInput('s1', '   ');
    enqueuePendingUserInput('', 'x');
    expect(pendingUserInputCount('s1')).toBe(0);
  });

  test('통지 실패가 배수를 막지 않는다', () => {
    enqueuePendingUserInput('s1', 'x', () => { throw new Error('boom'); });
    expect(drainPendingUserInput('s1')).toEqual(['x']);
  });

  test('세션을 버리면 유령 발화가 안 남는다', () => {
    enqueuePendingUserInput('s1', 'x');
    clearPendingUserInput('s1');
    expect(drainPendingUserInput('s1')).toEqual([]);
  });

  test('승격된 발화 문자열 하나만 지우고 중복·다른 대기 발화·컨트롤 메모는 남긴다', () => {
    const seen: string[][] = [];
    enqueuePendingUserInput('s1', '승격됨', (d) => seen.push([...d]));
    enqueuePendingUserInput('s1', 'control memo: 목표 루프 제어 메모');
    enqueuePendingUserInput('s1', '승격됨');
    enqueuePendingUserInput('s1', '다른 대기 발화');

    clearPendingUserInput('s1', '승격됨');

    expect(seen).toEqual([]);
    expect(pendingUserInputCount('s1')).toBe(3);
    expect(drainPendingUserInput('s1')).toEqual([
      'control memo: 목표 루프 제어 메모',
      '승격됨',
      '다른 대기 발화',
    ]);
    expect(seen).toEqual([[
      'control memo: 목표 루프 제어 메모',
      '승격됨',
      '다른 대기 발화',
    ]]);
  });

  test('승격 문자열이 없으면 부분 삭제는 조용한 no-op 이고 bucket 과 onDrained 를 보존한다', () => {
    const seen: string[][] = [];
    enqueuePendingUserInput('s1', '남을 발화', (d) => seen.push([...d]));

    clearPendingUserInput('s1', '없는 발화');

    expect(seen).toEqual([]);
    expect(pendingUserInputCount('s1')).toBe(1);
    expect(drainPendingUserInput('s1')).toEqual(['남을 발화']);
    expect(seen).toEqual([['남을 발화']]);
  });
});
