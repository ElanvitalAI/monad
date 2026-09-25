import { describe, test, expect } from 'bun:test';
import {
  buildInterjectionMessage, capInterjectionText, wrapUserQuery,
  INTERJECTION_NOTE, INTERRUPT_NOTE, UNFINISHED_TASKS_REMINDER,
} from './interjection.js';

describe('buildInterjectionMessage — 턴 «안»으로 들어가는 발화의 문면', () => {
  test('빈 목록은 «없음»이다 — 빈 문자열로 꾸미지 않는다', () => {
    expect(buildInterjectionMessage([])).toBeNull();
    expect(buildInterjectionMessage(['', '   '])).toBeNull();
  });

  test('⭐ 머리말 ⊕ 봉투 ⊕ «미완 작업 리마인더» 셋을 모두 갖는다', () => {
    const msg = buildInterjectionMessage(['그리고 의병 활동도'])!;
    expect(msg.startsWith(INTERJECTION_NOTE)).toBe(true);
    expect(msg).toContain(wrapUserQuery('그리고 의병 활동도'));
    expect(msg.endsWith(UNFINISHED_TASKS_REMINDER)).toBe(true);
  });

  test('⭐ 여러 건은 «순서를 보존해 한 덩어리»로 — 리마인더는 «한 번»만', () => {
    const msg = buildInterjectionMessage(['첫째', '둘째'])!;
    expect(msg.indexOf('첫째')).toBeLessThan(msg.indexOf('둘째'));
    expect(msg.split(UNFINISHED_TASKS_REMINDER).length - 1).toBe(1);
  });

  test('중단 뒤의 첫 발화는 «다른 머리말»을 쓴다', () => {
    expect(buildInterjectionMessage(['x'], 'after-interrupt')!.startsWith(INTERRUPT_NOTE)).toBe(true);
  });

  test('⛔ 너무 길면 자르되 «잘렸음»을 숨기지 않는다', () => {
    const capped = capInterjectionText('가'.repeat(20), 10);
    expect(capped).toContain('생략됨');
    expect(capped.startsWith('가'.repeat(10))).toBe(true);
  });

  test('예산 안이면 원문 그대로', () => {
    expect(capInterjectionText('짧다', 100)).toBe('짧다');
  });
});
