// codex native structured-question routing — `item/tool/requestUserInput`
// ↔ monad's generic AcpQuestion (which the surface HITL QuestionChannel
// backs). Tests the pure mappers that carry the logic.

import { describe, expect, test } from 'bun:test';
import {
  mapUserInputToQuestionRequest,
  mapQuestionResponseToUserInput,
} from '../src/acp/codex-app-server-agent';

describe('mapUserInputToQuestionRequest', () => {
  test('maps codex questions → AcpQuestionRequest (isOther → includeOther)', () => {
    const params = {
      threadId: 't1',
      questions: [
        {
          id: 'framework',
          header: 'Framework',
          question: 'Which test framework?',
          isOther: true,
          options: [
            { label: 'bun', description: 'built-in' },
            { label: 'vitest', description: 'fast' },
          ],
        },
      ],
    };
    const req = mapUserInputToQuestionRequest(params, 'sess-1');
    expect(req.backendId).toBe('codex-app-server');
    expect(req.sessionId).toBe('sess-1');
    expect(req.questions).toHaveLength(1);
    expect(req.questions[0]).toEqual({
      id: 'framework',
      header: 'Framework',
      question: 'Which test framework?',
      options: [
        { label: 'bun', description: 'built-in' },
        { label: 'vitest', description: 'fast' },
      ],
      multiSelect: false,
      includeOther: true,
    });
  });

  test('isOther absent → includeOther false; header capped at 12 chars; missing options → []', () => {
    const req = mapUserInputToQuestionRequest(
      { questions: [{ id: 'q', header: 'ThisHeaderIsWayTooLong', question: 'Q?' }] },
      's',
    );
    expect(req.questions[0]!.includeOther).toBe(false);
    expect(req.questions[0]!.header).toBe('ThisHeaderIs'); // 12 chars
    expect(req.questions[0]!.options).toEqual([]);
  });

  test('no questions → empty', () => {
    expect(mapUserInputToQuestionRequest({}, 's').questions).toEqual([]);
  });
});

describe('mapQuestionResponseToUserInput', () => {
  const params = { questions: [{ id: 'a', header: 'A', question: 'A?' }, { id: 'b', header: 'B', question: 'B?' }] };

  test('single-select label → {answers:[label]}', () => {
    const out = mapQuestionResponseToUserInput(params, { answers: { a: 'X', b: 'Y' } });
    expect(out).toEqual({ answers: { a: { answers: ['X'] }, b: { answers: ['Y'] } } });
  });

  test('multiSelect array → {answers:[...]}', () => {
    const out = mapQuestionResponseToUserInput(
      { questions: [{ id: 'a', header: 'A', question: 'A?' }] },
      { answers: { a: ['X', 'Z'] } },
    );
    expect(out).toEqual({ answers: { a: { answers: ['X', 'Z'] } } });
  });

  test('Other selection substituted with otherText', () => {
    const out = mapQuestionResponseToUserInput(
      { questions: [{ id: 'a', header: 'A', question: 'A?' }] },
      { answers: { a: 'Other' }, otherText: { a: 'my custom value' } },
    );
    expect(out).toEqual({ answers: { a: { answers: ['my custom value'] } } });
  });

  test('unanswered question → empty list (codex may auto-resolve)', () => {
    const out = mapQuestionResponseToUserInput(params, { answers: { a: 'X' } });
    expect(out).toEqual({ answers: { a: { answers: ['X'] }, b: { answers: [] } } });
  });

  test('cancelled (empty answers) → all empty lists', () => {
    const out = mapQuestionResponseToUserInput(params, { answers: {}, cancelled: true });
    expect(out).toEqual({ answers: { a: { answers: [] }, b: { answers: [] } } });
  });
});
