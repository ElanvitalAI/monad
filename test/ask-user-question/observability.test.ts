import { afterEach, describe, expect, test } from 'bun:test';
import {
  ASK_USER_QUESTION_OBSERVABILITY_CATEGORY,
  dispatchAskUserQuestion,
  setAskUserQuestionDeps,
  setAskUserQuestionResolver,
  type AskUserQuestionResolver,
} from '../../src/ask-user-question/index.js';
import { debug } from '../../src/debug/log.js';
import { registerDefaultQuestionChannels } from '../../src/hitl/question.js';

const VALID_REQUEST = {
  questions: [{
    id: 'format',
    header: 'Format',
    question: 'Use Prettier or keep ESLint style?',
    options: [
      { label: 'Prettier', description: 'Auto-format on save' },
      { label: 'ESLint', description: 'Keep existing rules' },
    ],
  }],
};

type LogEntry = [string, string, Record<string, unknown>];

function captureLogs(): { logs: LogEntry[]; restore: () => void } {
  const logs: LogEntry[] = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data: Record<string, unknown>) => {
    logs.push([category, event, data]);
  }) as typeof debug.log;
  return { logs, restore: () => { debug.log = originalLog; } };
}

afterEach(() => {
  setAskUserQuestionDeps(null);
  setAskUserQuestionResolver(null);
  registerDefaultQuestionChannels([]);
});

describe('AskUserQuestion dispatch observability', () => {
  test('records privacy-safe start and answered end records without changing the result', async () => {
    const { logs, restore } = captureLogs();
    const resolver: AskUserQuestionResolver = async () => ({ answers: { format: 'Prettier' } });
    setAskUserQuestionResolver(resolver);
    try {
      const result = await dispatchAskUserQuestion(VALID_REQUEST, { sessionId: 'session-1' });
      expect(result).toEqual({ output: JSON.stringify({ answers: { format: 'Prettier' } }), result: { answers: { format: 'Prettier' } } });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toEqual([
        ASK_USER_QUESTION_OBSERVABILITY_CATEGORY,
        'start',
        {
          sessionId: 'session-1',
          delivery: 'modal',
          questionCount: 1,
          optionCount: 2,
          questionLengths: [VALID_REQUEST.questions[0]!.question.length],
        },
      ]);
      expect(logs[1]![0]).toBe(ASK_USER_QUESTION_OBSERVABILITY_CATEGORY);
      expect(logs[1]![1]).toBe('end');
      expect(logs[1]![2]).toMatchObject({ sessionId: 'session-1', delivery: 'modal', outcome: 'answered' });
      expect(logs[1]![2].elapsedMs).toEqual(expect.any(Number));
      expect(JSON.stringify(logs)).not.toContain(VALID_REQUEST.questions[0]!.question);
    } finally {
      restore();
    }
  });

  test('classifies malformed, unavailable, cancelled, and resolver failures without blocking dispatch', async () => {
    const { logs, restore } = captureLogs();
    try {
      await dispatchAskUserQuestion({ questions: [] });
      const unavailable = await dispatchAskUserQuestion(VALID_REQUEST);
      expect(unavailable.absenceReason).toBe('no-tui-deps-no-resolver');
      setAskUserQuestionResolver(async () => ({ answers: {}, cancelled: true }));
      await dispatchAskUserQuestion(VALID_REQUEST);
      setAskUserQuestionResolver(async () => { throw new Error('host refused'); });
      await dispatchAskUserQuestion(VALID_REQUEST);

      const outcomes = logs.filter(([, event]) => event === 'end').map(([, , data]) => data.outcome);
      expect(outcomes).toEqual(['parse-failed', 'no-resolver', 'cancelled', 'failed']);
    } finally {
      restore();
    }
  });

  test('AskBridgeUnavailable with no SSE channel still records absenceReason no-capable-peer', async () => {
    const { logs, restore } = captureLogs();
    const resolver: AskUserQuestionResolver = async () => {
      const error = new Error('no elanous/ask cap-able peer attached');
      error.name = 'AskBridgeUnavailable';
      throw error;
    };
    setAskUserQuestionResolver(resolver);
    try {
      const result = await dispatchAskUserQuestion(VALID_REQUEST);
      expect(result.absenceReason).toBe('no-capable-peer');
      const end = logs.find(([, event]) => event === 'end');
      expect(end?.[2].outcome).toBe('no-resolver');
    } finally {
      restore();
    }
  });

  test('continues returning the existing result when observability throws', async () => {
    const originalLog = debug.log;
    debug.log = (() => { throw new Error('log sink unavailable'); }) as typeof debug.log;
    setAskUserQuestionResolver(async () => ({ answers: { format: 'Prettier' } }));
    try {
      await expect(dispatchAskUserQuestion(VALID_REQUEST)).resolves.toEqual({
        output: JSON.stringify({ answers: { format: 'Prettier' } }),
        result: { answers: { format: 'Prettier' } },
      });
    } finally {
      debug.log = originalLog;
    }
  });
});
