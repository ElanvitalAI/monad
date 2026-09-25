// Goal-loop chat-bridge tests — FU-1.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  _resetForTesting,
  startGoal,
  setStatus,
  getCurrentGoal,
} from '../src/goals/index.js';
import {
  goalLoopActionForActiveGoal,
  runGoalLoopHook,
} from '../src/goals/chat-loop-bridge.js';
import { executeGoalSlash, renderGoalSlashOutcomeLines } from '../src/goals/slash.js';
import type { LLMMessage } from '../src/llm.js';
import type { JudgeResult } from '../src/goals/judge.js';

afterEach(() => {
  _resetForTesting();
});

const fakeJudge = (result: JudgeResult | null) => async () => result;

const HISTORY: LLMMessage[] = [
  { role: 'user', content: 'fix it' },
  { role: 'assistant', content: 'I made progress.' },
];

describe('runGoalLoopHook', () => {
  test('returns no-loop when no goal active', async () => {
    const r = await runGoalLoopHook({ history: HISTORY });
    expect(r.kind).toBe('no-loop');
  });

  test('returns no-loop when goal paused', async () => {
    startGoal({ objective: 'x' });
    setStatus('paused');
    const r = await runGoalLoopHook({ history: HISTORY });
    expect(r.kind).toBe('no-loop');
  });

  test('aborted turn → stop paused (never silent-continue)', async () => {
    startGoal({ objective: 'x' });
    const r = await runGoalLoopHook({ history: HISTORY, wasAborted: true });
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('paused');
    expect(getCurrentGoal()?.status).toBe('paused');
    expect(r.toastLines.join('\n')).toContain('interrupted');
  });

  test('started dashboard output derives its continuation notice from the action the hook can continue with', async () => {
    const started = executeGoalSlash({
      subcommand: 'fix',
      rest: ['bug'],
      defaultMode: 'judge',
    });
    expect(started.kind).toBe('started');
    if (started.kind !== 'started') throw new Error('unreachable');

    const hookAction = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'continue', summary: 'good progress', confidence: 0.7 }) },
    });
    expect(hookAction.kind).toBe(started.goalLoopAction);

    const rendered = renderGoalSlashOutcomeLines(started);
    expect(rendered).toHaveLength(started.lines.length + 1);
    expect(rendered.at(-1)).toContain(started.goalLoopAction);
  });

  test('non-continuation action omits the started continuation notice', () => {
    const rendered = renderGoalSlashOutcomeLines({
      kind: 'started',
      lines: ['  🎯 Goal active — "x"'],
      objective: 'x',
      mode: 'judge',
      goalLoopAction: goalLoopActionForActiveGoal(false),
    });
    expect(rendered).toEqual(['  🎯 Goal active — "x"']);
  });

  test('paused active-goal guard disarms continuation and keeps the hook no-loop', async () => {
    startGoal({ objective: 'x' });
    setStatus('paused');
    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'continue', summary: 'ignored', confidence: 0.7 }) },
    });
    expect(r.kind).toBe('no-loop');
  });

  test('active started goal stops rather than continuing when the judge stops', async () => {
    const started = executeGoalSlash({
      subcommand: 'fix',
      rest: ['bug'],
      defaultMode: 'judge',
    });
    expect(started.kind).toBe('started');
    if (started.kind !== 'started') throw new Error('unreachable');
    expect(started.goalLoopAction).toBe('continue');

    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'done', summary: 'complete', confidence: 0.9 }) },
    });
    expect(r.kind).toBe('stop');
  });

  test('judge continue → continue action with header + nextUserText', async () => {
    startGoal({ objective: 'fix bug' });
    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'continue', summary: 'good progress', confidence: 0.7 }) },
    });
    expect(r.kind).toBe('continue');
    if (r.kind !== 'continue') throw new Error('unreachable');
    expect(r.nextUserText).toContain('fix bug');
    expect(r.headerLines.some((l) => l.includes('auto-turn'))).toBe(true);
    expect(r.headerLines.some((l) => l.includes('good progress'))).toBe(true);
  });

  test('judge done → stop with ✅ toast', async () => {
    startGoal({ objective: 'x' });
    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'done', summary: 'all set', confidence: 0.95 }) },
    });
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('done');
    expect(r.toastLines.join('\n')).toContain('✅');
    expect(r.toastLines.join('\n')).toContain('all set');
    expect(getCurrentGoal()?.status).toBe('complete');
  });

  test('budget exhausted → ⚠ toast with extend hint', async () => {
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });
    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'continue', summary: 'never reached', confidence: 0.9 }) },
    });
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('budget-limited');
    expect(r.toastLines.join('\n')).toContain('budget exhausted');
    expect(r.toastLines.join('\n')).toContain('/goal budget');
  });

  test('judge null → pause-ask', async () => {
    startGoal({ objective: 'x' });
    const r = await runGoalLoopHook({
      history: HISTORY,
      loopOpts: { judgeFn: fakeJudge(null) },
    });
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('judge-empty');
    expect(getCurrentGoal()?.status).toBe('paused');
  });

  test('empty history → no-loop (defensive)', async () => {
    startGoal({ objective: 'x' });
    const r = await runGoalLoopHook({ history: [] });
    expect(r.kind).toBe('no-loop');
  });

  test('history with only user → no-loop', async () => {
    startGoal({ objective: 'x' });
    const r = await runGoalLoopHook({
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(r.kind).toBe('no-loop');
  });

  test('extracts text from ContentBlock[] assistant turns', async () => {
    startGoal({ objective: 'x' });
    const blockHistory: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      // multimodal-style assistant: [text block, image block]
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'first part' },
          { type: 'image', source: 'data:image/png;base64,...' } as unknown as { type: 'text'; text: string },
          { type: 'text', text: 'second part' },
        ],
      },
    ];
    const r = await runGoalLoopHook({
      history: blockHistory,
      loopOpts: { judgeFn: fakeJudge({ verdict: 'continue', summary: 'ok', confidence: 0.7 }) },
    });
    expect(r.kind).toBe('continue');
    // Text was extracted (otherwise would have been no-loop)
  });

  test('plan body threading reaches judge (provided in deps)', async () => {
    startGoal({ objective: 'x' });
    const captured: { planBody?: string } = {};
    await runGoalLoopHook({
      history: HISTORY,
      planBody: 'Step 1: A\nStep 2: B',
      loopOpts: {
        judgeFn: async (input) => {
          captured.planBody = input.planBody;
          return { verdict: 'done', summary: 'k', confidence: 0.9 };
        },
      },
    });
    expect(captured.planBody).toContain('Step 1');
  });
});
