import { afterEach, describe, expect, test } from 'bun:test';
import {
  subscribeQuestionResult,
  publishQuestionResult,
  _clearQuestionResultListenersForTesting,
  type AskUserQuestionResult,
} from '../../src/ask-user-question/index.js';

afterEach(() => _clearQuestionResultListenersForTesting());

const fake: AskUserQuestionResult = { answers: { auth: 'OAuth' } };

describe('subscribeQuestionResult / publishQuestionResult', () => {
  test('subscriber sees the result + questionIds', () => {
    const seen: Array<{ answers: unknown; questionIds: string[] }> = [];
    subscribeQuestionResult((r) => seen.push({ answers: r.answers, questionIds: r.questionIds }));
    publishQuestionResult(fake, ['auth']);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.questionIds).toEqual(['auth']);
  });

  test('dispose removes only that listener', () => {
    const a: number[] = [];
    const b: number[] = [];
    const disposeA = subscribeQuestionResult(() => a.push(1));
    subscribeQuestionResult(() => b.push(1));
    publishQuestionResult(fake, ['x']);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    disposeA();
    publishQuestionResult(fake, ['x']);
    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
  });

  test('a throwing subscriber does not break the others', () => {
    const ok: number[] = [];
    subscribeQuestionResult(() => { throw new Error('boom'); });
    subscribeQuestionResult(() => ok.push(1));
    expect(() => publishQuestionResult(fake, [])).not.toThrow();
    expect(ok).toEqual([1]);
  });

  test('_clear drops everything', () => {
    const seen: number[] = [];
    subscribeQuestionResult(() => seen.push(1));
    _clearQuestionResultListenersForTesting();
    publishQuestionResult(fake, []);
    expect(seen).toEqual([]);
  });
});
