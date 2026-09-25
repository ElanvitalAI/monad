import { describe, expect, test } from 'bun:test';
import { askGoalTypeDeclaration } from './goal-author.js';

/** ⛔ 원장의 `goalTypeSource` 는 저작된 GOAL 문서를 읽어 «항상» declared 다(실측 7/7).
 *  이 축은 그것이 못 답하는 질문 — 「사람이 ask 에 썼나」 — 에 답한다. */
describe('askGoalTypeDeclaration — ask 가 골 종류를 어떻게 다뤘나', () => {
  test('올바로 선언하면 그 종류를 낸다', () => {
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n- GoalType: research\n')).toBe('research');
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n- GoalType: operate\n')).toBe('operate');
  });

  test('안 쓰면 absent 다 — 「없다」를 값으로 낸다', () => {
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n본문뿐이다.')).toBe('absent');
  });

  test('⛔ 잘못 쓴 것은 «absent 가 아니라» malformed 다 — 처방이 다르다(쓰라 ↔ 고치라)', () => {
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n- GoalType: nonsense\n')).toBe('malformed');
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n- GoalType: nonsense\n')).not.toBe('absent');
  });

  test('⛔ 둘 이상 쓰면 malformed 다 — 「선언했다」가 곧 「하나로 정해졌다」는 아니다', () => {
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n- GoalType: research\n- GoalType: document\n')).toBe('malformed');
  });

  test('머리말 «밖»의 줄은 선언이 아니다 — 본문에 적은 것을 선언으로 읽지 않는다', () => {
    expect(askGoalTypeDeclaration('대상 경로: a.ts\n\n## 본문\n- GoalType: research\n')).toBe('absent');
  });
});
