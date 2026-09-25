// GoalLoop integration tests — Plan-Mode UX P1.3.
//
// Real-wiring with an injected judgeFn (test seam) — no mock.module.
// Exercises the full state machine: judge → action → registry mutation.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  _resetForTesting,
  clearGoal,
  getCurrentGoal,
  startGoal,
} from '../src/goals/index.js';
import {
  pauseLoop,
  shouldContinueAfterAssistantTurn,
  shouldIssueAutoTurn,
} from '../src/goals/loop.js';
import type { JudgeResult } from '../src/goals/judge.js';
import { debug } from '../src/debug/log.js';
import { ChannelBus } from '../src/terminal-matrix/channel-bus.js';
import { snapshotRunLifecycle, validateLifecycleRecord } from '../src/signal/lifecycle-record.js';

const originalRunId = process.env.MONAD_RUN_ID;
const originalPtyId = process.env.MONAD_PTY_ID;
const originalNestDepth = process.env.MONAD_NEST_DEPTH;

function setLifecycleIdentity(runId = 'run-goals-test', ptyId = 'pty-goals-test', depth = '2'): void {
  process.env.MONAD_RUN_ID = runId;
  process.env.MONAD_PTY_ID = ptyId;
  process.env.MONAD_NEST_DEPTH = depth;
}

afterEach(() => {
  _resetForTesting();
  if (originalRunId === undefined) delete process.env.MONAD_RUN_ID;
  else process.env.MONAD_RUN_ID = originalRunId;
  if (originalPtyId === undefined) delete process.env.MONAD_PTY_ID;
  else process.env.MONAD_PTY_ID = originalPtyId;
  if (originalNestDepth === undefined) delete process.env.MONAD_NEST_DEPTH;
  else process.env.MONAD_NEST_DEPTH = originalNestDepth;
});

function fakeJudge(result: JudgeResult | null): (typeof shouldContinueAfterAssistantTurn) extends (...a: infer A) => infer R ? Parameters<typeof shouldContinueAfterAssistantTurn>[1] extends infer O ? (O extends { judgeFn?: infer F } ? F : never) : never : never {
  // Simple async stub — TypeScript dance to match the inferred type.
  return async () => result;
}

describe('GoalLoop — shouldContinueAfterAssistantTurn', () => {
  test('returns no-goal when registry empty', async () => {
    const r = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'hi' });
    expect(r.kind).toBe('no-goal');
  });

  test('returns no-goal when goal paused', async () => {
    startGoal({ objective: 'x' });
    pauseLoop('test');
    const r = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'hi' });
    expect(r.kind).toBe('no-goal');
  });

  test('continue verdict → continuation prompt + turnsUsed++', async () => {
    startGoal({ objective: 'write tests' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'I wrote 1 test' },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'one of five', confidence: 0.7 }) },
    );
    expect(r.kind).toBe('continue');
    if (r.kind !== 'continue') throw new Error('unreachable');
    expect(r.continuationPrompt).toContain('write tests');
    expect(r.continuationPrompt).toContain('one of five');
    expect(getCurrentGoal()?.usage.turnsUsed).toBe(1);
    expect(getCurrentGoal()?.lastVerdict).toBe('continue');
  });

  test('done verdict → stop + status=complete', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'all done' },
      { judgeFn: fakeJudge({ verdict: 'done', summary: 'completed', confidence: 0.95 }) },
    );
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('done');
    expect(getCurrentGoal()?.status).toBe('complete');
  });

  test('low-confidence done is downgraded to partial → continue', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'maybe done' },
      { judgeFn: fakeJudge({ verdict: 'done', summary: 'unsure', confidence: 0.3 }) },
    );
    expect(r.kind).toBe('continue');
    if (r.kind !== 'continue') throw new Error('unreachable');
    expect(r.continuationPrompt).toContain('Wrap up'); // partial hint
    expect(getCurrentGoal()?.status).toBe('active');
  });

  test('partial verdict → continue with wrap-up hint', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'almost' },
      { judgeFn: fakeJudge({ verdict: 'partial', summary: 'almost done', confidence: 0.8 }) },
    );
    expect(r.kind).toBe('continue');
    if (r.kind !== 'continue') throw new Error('unreachable');
    expect(r.continuationPrompt).toContain('Wrap up');
  });

  test('empty verdict → pause-ask, status=paused', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'um' },
      { judgeFn: fakeJudge({ verdict: 'empty', summary: 'no progress', confidence: 0.5 }) },
    );
    expect(r.kind).toBe('pause-ask');
    expect(getCurrentGoal()?.status).toBe('paused');
  });

  test('judge returns null → pause-ask (D6 fail-safe)', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'x' },
      { judgeFn: fakeJudge(null) },
    );
    expect(r.kind).toBe('pause-ask');
    if (r.kind !== 'pause-ask') throw new Error('unreachable');
    expect(r.reason).toBe('judge-empty');
    expect(getCurrentGoal()?.status).toBe('paused');
  });

  test('judge throws → pause-ask + status=paused', async () => {
    startGoal({ objective: 'x' });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'x' },
      { judgeFn: async () => { throw new Error('network down'); } },
    );
    expect(r.kind).toBe('pause-ask');
    if (r.kind !== 'pause-ask') throw new Error('unreachable');
    expect(r.reason).toBe('judge-failed');
    expect(getCurrentGoal()?.status).toBe('paused');
  });

  test('publishes started and budget-exhausted failed records with valid, monotonic envelopes', async () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'one turn' },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'never reached', confidence: 0.9 }), lifecycleBus: bus },
    );
    expect(r.kind).toBe('stop');
    if (r.kind !== 'stop') throw new Error('unreachable');
    expect(r.reason).toBe('budget-limited');
    expect(getCurrentGoal()?.status).toBe('budget-limited');

    const records = snapshotRunLifecycle(bus, 'run-goals-test');
    expect(records.map(({ name }) => name)).toEqual(['started', 'failed']);
    expect(records[1].seq).toBe(records[0].seq + 1);
    expect(records.every((record) => validateLifecycleRecord(record) === null)).toBe(true);
    expect(records[0]).toMatchObject({ ptyId: 'pty-goals-test', depth: 2, role: 'child', class: 'progress', truncated: false });
    expect(records[1]).toMatchObject({ payload: { reason: 'budget-exhausted' }, truncated: false });
  });

  test('publishes started once across continue turns and once again for a new goal execution', async () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    const continueJudge = fakeJudge({ verdict: 'continue', summary: 'keep going', confidence: 0.9 });
    startGoal({ objective: 'first', budget: { maxTurns: 3 } });

    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'first turn' }, { judgeFn: continueJudge, lifecycleBus: bus });
    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'second turn' }, { judgeFn: continueJudge, lifecycleBus: bus });
    const exhausted = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'third turn' }, { judgeFn: continueJudge, lifecycleBus: bus });

    expect(exhausted).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
    expect(snapshotRunLifecycle(bus, 'run-goals-test').map((record) => record.name)).toEqual(['started', 'failed']);

    clearGoal();
    startGoal({ objective: 'second' });
    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'new execution' }, { judgeFn: continueJudge, lifecycleBus: bus });

    const records = snapshotRunLifecycle(bus, 'run-goals-test');
    expect(records.map((record) => record.name)).toEqual(['started', 'failed', 'started']);
    expect(records.map((record) => record.seq)).toEqual([records[0].seq, records[0].seq + 1, records[0].seq + 2]);
    expect(records.every((record) => validateLifecycleRecord(record) === null)).toBe(true);
  });

  test.each([
    ['runId only', undefined, 'pty-goals-test', ['runId']],
    ['ptyId only', 'run-goals-test', undefined, ['ptyId']],
    ['both identities', undefined, undefined, ['runId', 'ptyId']],
  ])('skips lifecycle publication and observes missing %s identity', async (_caseName, runId, ptyId, missing) => {
    if (runId === undefined) delete process.env.MONAD_RUN_ID;
    else process.env.MONAD_RUN_ID = runId;
    if (ptyId === undefined) delete process.env.MONAD_PTY_ID;
    else process.env.MONAD_PTY_ID = ptyId;
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const bus = new ChannelBus();
    try {
      startGoal({ objective: 'x', budget: { maxTurns: 1 } });
      const r = await shouldContinueAfterAssistantTurn(
        { lastAssistantTurn: 'one turn' },
        { judgeFn: fakeJudge({ verdict: 'continue', summary: 'never reached', confidence: 0.9 }), lifecycleBus: bus },
      );
      expect(r).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
      expect(bus.channels()).toEqual([]);
      const skipCalls = log.mock.calls.filter(([category, event]) => (
        category === 'signal' && event === 'lifecycle.skip-no-identity'
      ));
      expect(skipCalls).toEqual([
        ['signal', 'lifecycle.skip-no-identity', { missing }],
        ['signal', 'lifecycle.skip-no-identity', { missing }],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  test('bus publication failure does not change the budget-limited result', async () => {
    setLifecycleIdentity();
    const bus = { publish: () => { throw new Error('bus unavailable'); } } as unknown as ChannelBus;
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'one turn' },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'never reached', confidence: 0.9 }), lifecycleBus: bus },
    );
    expect(r).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
    expect(getCurrentGoal()?.status).toBe('budget-limited');
  });

  test('token budget exhausted → stop budget-limited', async () => {
    startGoal({ objective: 'x', budget: { tokenBudget: 100, maxTurns: 100 } });
    const r = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'long' },
      {
        judgeFn: fakeJudge({ verdict: 'continue', summary: 'x', confidence: 0.8 }),
      },
    );
    // Account 200 tokens this turn (above 100 budget) by passing tokensUsed
    // No — we need to pass tokens via the turn. Re-do.
    const _ = r; // discard first call; budget hasn't fired yet
    void _;
    const r2 = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'long', tokensUsed: 200 },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'x', confidence: 0.8 }) },
    );
    expect(r2.kind).toBe('stop');
    if (r2.kind !== 'stop') throw new Error('unreachable');
    expect(r2.reason).toBe('budget-limited');
  });

  test('shouldIssueAutoTurn true only when active', () => {
    expect(shouldIssueAutoTurn()).toBe(false);
    startGoal({ objective: 'x' });
    expect(shouldIssueAutoTurn()).toBe(true);
    pauseLoop('test');
    expect(shouldIssueAutoTurn()).toBe(false);
  });

  test('pauseLoop is idempotent on already-paused', () => {
    startGoal({ objective: 'x' });
    pauseLoop('a');
    pauseLoop('b');
    expect(getCurrentGoal()?.status).toBe('paused');
  });

  test('pauseLoop on no-goal is benign', () => {
    pauseLoop('a');
    expect(getCurrentGoal()).toBeNull();
  });

  test('continuation prompt threads judge summary on next turn', async () => {
    startGoal({ objective: 'add docs' });
    const r1 = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'added 1 doc' },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'one of three', confidence: 0.7 }) },
    );
    expect(r1.kind).toBe('continue');
    const r2 = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'added 2 docs' },
      { judgeFn: fakeJudge({ verdict: 'continue', summary: 'two of three', confidence: 0.7 }) },
    );
    expect(r2.kind).toBe('continue');
    if (r2.kind !== 'continue') throw new Error('unreachable');
    expect(r2.continuationPrompt).toContain('two of three');
    // r1 = turnsUsed→1 (prompt for upcoming turn 2). r2 = turnsUsed→2
    // (prompt for upcoming turn 3). The continuation prompt is always
    // "auto-turn (turnsUsed + 1)/budget".
    expect(r2.continuationPrompt).toContain('auto-turn 3');
  });
});
