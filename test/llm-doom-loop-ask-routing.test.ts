// Doom-loop → AskUserQuestion routing — unit tests.
//
// Covers `routeDoomLoopToAskUser` + the two pure helpers it delegates
// to. Verifies that:
//   - missing sessionId routes to the legacy chat-text fallback,
//   - each AskUserQuestion answer label maps to the correct outcome,
//   - free-form "Other" text rides through as guidance,
//   - cancel + bridge throw both fall back safely.

import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { clearSnapshots } from '../src/undo-turn/index.js';
import { undoTurnRuntime } from '../src/tool-runtime/undo-turn-runtime.js';
import {
  setAskUserQuestionDeps,
  setAskUserQuestionResolver,
  _clearQuestionResultListenersForTesting,
  type AskUserQuestionResolver,
} from '../src/ask-user-question/index.js';
import {
  buildDoomLoopAskRequest,
  interpretDoomLoopAskResult,
  classifyDoomLoopIntervention,
  normalizeDoomLoopInterventionClass,
  routeDoomLoopToAskUser,
  streamLLMWithTools,
  type LLMProvider,
  type LLMStreamEvent,
} from '../src/llm.js';

afterEach(() => {
  setAskUserQuestionResolver(null);
  setAskUserQuestionDeps(null);
  _clearQuestionResultListenersForTesting();
  debug.clear();
  debug.disable();
});

function scriptedProvider(turns: LLMStreamEvent[][]): LLMProvider {
  let call = 0;
  return {
    name: 'scripted', defaultModel: 'd', available: () => true,
    async *streamChat() {
      for (const event of turns[call++] ?? []) yield event;
    },
    async *chat() {},
  };
}

describe('classifyDoomLoopIntervention', () => {
  test.each([
    ['missing credentials for the provider', 'credentials'],
    ['irreversible external action: publish to production', 'irreversible-external-action'],
    ['consequential product decision cannot be safely inferred because it is high-impact', 'consequential-product-decision'],
    ['no credentials, no irreversible external action, and no consequential product decision', 'credentials'],
    ['credentials are not required; irreversible external action is not required; consequential product decision is not required', 'none'],
    ['empty directory search found no files', 'unknown'],
    ['failed to start subagent', 'unknown'],
    ['API key is valid', 'unknown'],
    ['external action is pending', 'unknown'],
    ['irreversible local cache cleanup', 'unknown'],
    ['opaque tool failure', 'unknown'],
  ] as const)('classifies %s as %s', (detail, expected) => {
    expect(classifyDoomLoopIntervention({ detail, doomWindow: [] })).toBe(expected);
  });

  test('preserves only valid explicit classes and keeps absent evidence unknown', () => {
    expect(normalizeDoomLoopInterventionClass('none')).toBe('none');
    expect(normalizeDoomLoopInterventionClass(undefined)).toBe('unknown');
    expect(normalizeDoomLoopInterventionClass('empty-directory-search-failure')).toBe('unknown');
  });
});

describe('streamLLMWithTools doom-loop wiring', () => {
  test.each([
    ['missing credentials for the provider', 'credentials', 'Retry once more', 'doom-loop-ask-retry'],
    ['irreversible external action: publish to production', 'irreversible-external-action', 'Different approach', 'doom-loop-ask-guidance'],
    ['consequential product decision cannot be safely inferred because it is high-impact', 'consequential-product-decision', 'Stop here', 'doom-loop-ask-stop'],
    ['no credentials, no irreversible external action, and no consequential product decision', 'credentials', 'Stop here', 'doom-loop-ask-stop'],
    ['credentials are not required; irreversible external action is not required; consequential product decision is not required', 'none', 'Stop here', 'doom-loop-ask-stop'],
    ['failed to start subagent', 'unknown', 'Stop here', 'doom-loop-ask-stop'],
  ] as const)('propagates %s as %s through actual repeated failures and %s', async (detail, interventionClass, answer, eventName) => {
    const logSpy = spyOn(debug, 'log');
    setAskUserQuestionResolver(async () => ({
      answers: { doom_loop_next_step: answer },
      otherText: { doom_loop_next_step: 'Use a safer approach' },
    }));
    const args = { query: detail };
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: '1', name: 'Search', args }],
      [{ type: 'tool_call', id: '2', name: 'Search', args }],
      [{ type: 'tool_call', id: '3', name: 'Search', args }],
    ]);
    try {
      await streamLLMWithTools(
        [{ role: 'user', content: 'inspect the failure' }],
        {
          onText: () => {}, onToolResult: () => {},
          dispatchTool: async () => { throw new Error(detail); },
        },
        {
          provider, model: 'claude-sonnet-5', sessionId: 'sess-doom-live',
          tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 5,
        },
      );
      const event = logSpy.mock.calls.find((call) => call[0] === 'llm.tool-loop.retry' && call[1] === eventName);
      expect(event?.[2]).toMatchObject({ reason: 'no-undo-available', interventionClass });
    } finally {
      logSpy.mockRestore();
    }
  });

  test('survives cyclic BigInt errors when the doom-causing failure is serialized', async () => {
    const logSpy = spyOn(debug, 'log');
    setAskUserQuestionResolver(async () => ({ answers: { doom_loop_next_step: 'Stop here' } }));
    const args = { query: 'same' };
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: '1', name: 'Search', args }],
      [{ type: 'tool_call', id: '2', name: 'Search', args }],
      [{ type: 'tool_call', id: '3', name: 'Search', args }],
    ]);
    const cyclic: { message: string; count: bigint; self?: unknown } = {
      message: 'missing credentials for the provider', count: 1n,
    };
    cyclic.self = cyclic;
    try {
      await streamLLMWithTools(
        [{ role: 'user', content: 'inspect failures' }],
        {
          onText: () => {}, onToolResult: () => {},
          dispatchTool: async () => { throw cyclic; },
        },
        {
          provider, model: 'claude-sonnet-5', sessionId: 'sess-doom-source',
          tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 5,
        },
      );
      const event = logSpy.mock.calls.find((call) => call[0] === 'llm.tool-loop.retry' && call[1] === 'doom-loop-ask-stop');
      expect(event?.[2]).toMatchObject({ reason: 'no-undo-available', interventionClass: 'credentials' });
    } finally {
      logSpy.mockRestore();
    }
  });

  test('processes failure and success results in call order within one turn', async () => {
    let attempts = 0;
    const provider = scriptedProvider([
      [
        { type: 'tool_call', id: '1', name: 'Search', args: { sequence: 1 } },
        { type: 'tool_call', id: '2', name: 'Search', args: { sequence: 2 } },
        { type: 'tool_call', id: '3', name: 'Search', args: { sequence: 3 } },
      ],
      [{ type: 'tool_call', id: '4', name: 'Search', args: { sequence: 4 } }],
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'ordered retry sequence' }],
      {
        onText: () => {}, onToolResult: () => {},
        dispatchTool: async () => {
          attempts += 1;
          if (attempts === 2) return 'success';
          throw new Error('intermittent failure');
        },
      },
      { provider, model: 'claude-sonnet-5', tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 3 },
    );
    expect(debug.events().some((entry) => entry.event === 'doom-loop-detected')).toBe(false);
  });

  test('success at the end of a mixed-result turn clears preceding failures', async () => {
    let attempts = 0;
    const provider = scriptedProvider([
      [
        { type: 'tool_call', id: '1', name: 'Search', args: { sequence: 1 } },
        { type: 'tool_call', id: '2', name: 'Search', args: { sequence: 2 } },
      ],
      [{ type: 'tool_call', id: '3', name: 'Search', args: { sequence: 3 } }],
      [{ type: 'tool_call', id: '4', name: 'Search', args: { sequence: 4 } }],
    ]);
    await streamLLMWithTools(
      [{ role: 'user', content: 'success-separated retry sequence' }],
      {
        onText: () => {}, onToolResult: () => {},
        dispatchTool: async () => {
          attempts += 1;
          if (attempts === 2) return 'success';
          throw new Error('intermittent failure');
        },
      },
      { provider, model: 'claude-sonnet-5', tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 4 },
    );
    expect(debug.events().some((entry) => entry.event === 'doom-loop-detected')).toBe(false);
  });

  test('logs the detected tool and window before routing to the user', async () => {
    clearSnapshots();
    const logSpy = spyOn(debug, 'log');
    setAskUserQuestionResolver(async () => ({ answers: { doom_loop_next_step: 'Stop here' } }));
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: '1', name: 'Search', args: {} }],
      [{ type: 'tool_call', id: '2', name: 'Search', args: {} }],
      [{ type: 'tool_call', id: '3', name: 'Search', args: {} }],
    ]);
    try {
      await streamLLMWithTools(
        [{ role: 'user', content: 'detect now' }],
        { onText: () => {}, onToolResult: () => {}, dispatchTool: async () => { throw new Error('repeat failure'); } },
        { provider, model: 'claude-sonnet-5', sessionId: 'sess-detect', tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
      );
      const detectionIndex = logSpy.mock.calls.findIndex((call) => call[1] === 'doom-loop-detected');
      const routedIndex = logSpy.mock.calls.findIndex((call) => call[1] === 'doom-loop-ask-stop');
      expect(detectionIndex).toBeGreaterThanOrEqual(0);
      expect(detectionIndex).toBeLessThan(routedIndex);
      expect(logSpy.mock.calls[detectionIndex]?.[2]).toMatchObject({ tool: 'Search', window: expect.any(Array) });
    } finally {
      logSpy.mockRestore();
    }
  });

  test('does not invoke undo when no snapshot is available and records a distinct reason', async () => {
    clearSnapshots();
    const runSpy = spyOn(undoTurnRuntime, 'run');
    setAskUserQuestionResolver(async () => ({ answers: { doom_loop_next_step: 'Stop here' } }));
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: '1', name: 'Search', args: {} }],
      [{ type: 'tool_call', id: '2', name: 'Search', args: {} }],
      [{ type: 'tool_call', id: '3', name: 'Search', args: {} }],
    ]);
    try {
      await streamLLMWithTools(
        [{ role: 'user', content: 'no undo target' }],
        { onText: () => {}, onToolResult: () => {}, dispatchTool: async () => { throw new Error('repeat failure'); } },
        { provider, model: 'claude-sonnet-5', sessionId: 'sess-no-undo', tools: [{ name: 'Search', description: 'd', parameters: { type: 'object' } }], maxTurns: 5 },
      );
      expect(runSpy).not.toHaveBeenCalled();
      const event = debug.events().find((entry) => entry.event === 'doom-loop-ask-stop');
      expect(event?.data).toMatchObject({ reason: 'no-undo-available' });
    } finally {
      runSpy.mockRestore();
    }
  });
});

describe('buildDoomLoopAskRequest', () => {
  test('emits a single question with three pre-defined options + Other escape', () => {
    const req = buildDoomLoopAskRequest({
      reason: 'undo-failed',
      detail: 'UndoTurn: no snapshots available',
      doomWindow: ['tool=Write|class=object|msg=foo'],
    });
    expect(req).toEqual(expect.objectContaining({
      questions: expect.arrayContaining([
        expect.objectContaining({
          id: 'doom_loop_next_step',
          header: 'Loop blocked',
          includeOther: true,
        }),
      ]),
    }));
    expect(req.interventionClass).toBe('unknown');
    const q = (req.questions as Array<{ options: Array<{ label: string }> }>)[0]!;
    const labels = q.options.map((o) => o.label);
    expect(labels).toEqual(['Retry once more', 'Different approach', 'Stop here']);
  });

  test('threads the detail string into the question body', () => {
    const req = buildDoomLoopAskRequest({
      reason: 'undo-failed',
      detail: 'UndoTurn: no snapshots available',
      doomWindow: ['fp-1', 'fp-2', 'fp-3-with-payload'],
    });
    const q = (req.questions as Array<{ question: string }>)[0]!;
    expect(q.question).toContain('UndoTurn: no snapshots available');
    expect(q.question).toContain('fp-3-with-payload');
  });

  test('plan-mode reason mentions plan mode in the question body', () => {
    const req = buildDoomLoopAskRequest({
      reason: 'plan-mode',
      doomWindow: ['fp'],
    });
    const q = (req.questions as Array<{ question: string }>)[0]!;
    expect(q.question).toContain('plan mode');
  });

  test('carries an explicit intervention class without changing the user options', () => {
    const req = buildDoomLoopAskRequest({
      reason: 'policy',
      interventionClass: 'credentials',
      doomWindow: ['fp'],
    });
    expect(req.interventionClass).toBe('credentials');
    const q = (req.questions as Array<{ options: Array<{ label: string }> }>)[0]!;
    expect(q.options.map((option) => option.label)).toEqual([
      'Retry once more', 'Different approach', 'Stop here',
    ]);
  });
});

describe('interpretDoomLoopAskResult', () => {
  test('Retry once more → kind:retry', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Retry once more' },
    });
    expect(r.kind).toBe('retry');
  });

  test('Different approach → kind:guidance with otherText body', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Different approach' },
      otherText: { doom_loop_next_step: 'Try the Bash approach instead' },
    });
    expect(r.kind).toBe('guidance');
    if (r.kind === 'guidance') {
      expect(r.userMessage).toBe('Try the Bash approach instead');
    }
  });

  test('Different approach without otherText → generic guidance fallback', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Different approach' },
    });
    expect(r.kind).toBe('guidance');
    if (r.kind === 'guidance') {
      expect(r.userMessage).toMatch(/different approach/i);
    }
  });

  test('Other label routes the same as Different approach', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Other' },
      otherText: { doom_loop_next_step: 'free-form fix' },
    });
    expect(r.kind).toBe('guidance');
    if (r.kind === 'guidance') expect(r.userMessage).toBe('free-form fix');
  });

  test('Stop here → kind:stop with ASK USER marker preserved', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Stop here' },
    });
    expect(r.kind).toBe('stop');
    if (r.kind === 'stop') {
      expect(r.hardStopText).toContain('[ASK USER]');
    }
  });

  test('cancelled response → kind:stop', () => {
    const r = interpretDoomLoopAskResult({
      answers: {},
      cancelled: true,
    });
    expect(r.kind).toBe('stop');
  });

  test('unrecognized answer → kind:stop with safe fallback message', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: 'Nonsense' },
    });
    expect(r.kind).toBe('stop');
    if (r.kind === 'stop') {
      expect(r.hardStopText).toContain('[ASK USER]');
    }
  });

  test('multiSelect-style array answer (first label wins)', () => {
    const r = interpretDoomLoopAskResult({
      answers: { doom_loop_next_step: ['Retry once more', 'Different approach'] },
    });
    expect(r.kind).toBe('retry');
  });
});

describe('routeDoomLoopToAskUser', () => {
  test('returns fallback when no sessionId is plumbed', async () => {
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      detail: 'x',
      doomWindow: ['fp'],
    });
    expect(r.kind).toBe('fallback');
    if (r.kind === 'fallback') {
      expect(r.hardStopText).toContain('[ASK USER]');
    }
  });

  test('routes through the installed resolver when sessionId is set', async () => {
    let seenSessionId: string | undefined;
    const resolver: AskUserQuestionResolver = async (_req, ctx) => {
      seenSessionId = ctx?.sessionId;
      return { answers: { doom_loop_next_step: 'Retry once more' } };
    };
    setAskUserQuestionResolver(resolver);
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      detail: 'x',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-1',
    });
    expect(seenSessionId).toBe('sess-doom-1');
    expect(r.kind).toBe('retry');
    expect(r.interventionClass).toBe('unknown');
  });

  test('routes a classified request through resolver and result without changing options', async () => {
    let request: Parameters<AskUserQuestionResolver>[0] | undefined;
    setAskUserQuestionResolver(async (received) => {
      request = received;
      return { answers: { doom_loop_next_step: 'Retry once more' } };
    });
    const interventionClass = classifyDoomLoopIntervention({
      detail: 'missing credentials for the provider', doomWindow: ['fp'],
    });
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      interventionClass,
      detail: 'missing credentials for the provider',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-class',
    });
    const question = (request?.questions as Array<{ options: Array<{ label: string }> }>)[0]!;
    expect(question.options.map((option) => option.label)).toEqual([
      'Retry once more', 'Different approach', 'Stop here',
    ]);
    expect(r).toEqual({ kind: 'retry', interventionClass: 'credentials' });
  });

  test('returns fallback when the bridge throws and logs the classified request with its reason', async () => {
    debug.setLevel('normal');
    setAskUserQuestionResolver(async () => {
      throw new Error('bridge gone');
    });
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      interventionClass: classifyDoomLoopIntervention({
        detail: 'irreversible external action requires confirmation', doomWindow: ['fp'],
      }),
      detail: 'irreversible external action requires confirmation',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-2',
    });
    expect(r).toMatchObject({ kind: 'fallback', interventionClass: 'irreversible-external-action' });
    const event = debug.events().find((entry) => entry.category === 'llm.tool-loop.retry'
      && entry.event === 'doom-loop-ask-route-failed');
    expect(event?.data).toMatchObject({
      reason: 'undo-failed', interventionClass: 'irreversible-external-action',
    });
  });

  test('returns guidance when user supplies free-form otherText', async () => {
    setAskUserQuestionResolver(async () => ({
      answers: { doom_loop_next_step: 'Different approach' },
      otherText: { doom_loop_next_step: 'Use Bash instead of Edit' },
    }));
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      detail: 'x',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-3',
    });
    expect(r.kind).toBe('guidance');
    if (r.kind === 'guidance') expect(r.userMessage).toBe('Use Bash instead of Edit');
  });

  test('returns stop when user picks Stop here', async () => {
    setAskUserQuestionResolver(async () => ({
      answers: { doom_loop_next_step: 'Stop here' },
    }));
    const r = await routeDoomLoopToAskUser({
      reason: 'policy',
      detail: 'not authorized',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-4',
    });
    expect(r.kind).toBe('stop');
  });

  // D (RESEARCH-autonomous-runaway-discipline-2026-07-19 R2) — a resolver that
  // never answers (the autonomous case: no operator) must not hang the run.
  // After timeoutMs the gate falls back instead of awaiting forever (the
  // 16-minute freeze). Uses a tiny timeout so the test itself stays fast.
  test('falls back when the operator never answers (timeout) and records its intervention class', async () => {
    debug.clear();
    debug.setLevel('normal');
    setAskUserQuestionResolver(() => new Promise(() => { /* never resolves */ }));
    const started = Date.now();
    const r = await routeDoomLoopToAskUser({
      reason: 'undo-failed',
      interventionClass: 'credentials',
      detail: 'x',
      doomWindow: ['fp'],
      sessionId: 'sess-doom-timeout',
      timeoutMs: 30,
    });
    expect(r.kind).toBe('fallback');
    if (r.kind === 'fallback') expect(r.hardStopText).toContain('[ASK USER]');
    expect(r.interventionClass).toBe('credentials');
    expect(Date.now() - started).toBeLessThan(2000);
    const event = debug.events().find((entry) => entry.category === 'llm.tool-loop.retry'
      && entry.event === 'doom-loop-ask-timeout');
    expect(event?.data).toMatchObject({
      reason: 'undo-failed',
      interventionClass: 'credentials',
      timeoutMs: 30,
    });
  });
});
