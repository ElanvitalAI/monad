import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { ChannelBus } from '../terminal-matrix/channel-bus.js';
import { snapshotRunLifecycle, validateLifecycleRecord } from '../signal/lifecycle-record.js';
import { appendRunLedgerEntry, loadRunLedger, queryInterruptedRunLedgers, runLedgerDir } from '../self-implement/run-ledger.js';
import { _resetForTesting, _setGoalTransitionLedgerWriterForTesting, clearGoal, evaluateBudget, evaluateGoalBudget, getCurrentGoal, hydrateGoalFromSnapshot, requireGoalResumeFromFollowUp, setStatus, startGoal } from './registry.js';
import { publishGoalLifecycle, shouldContinueAfterAssistantTurn } from './loop.js';
import { resumeGoalFromUserFollowUp, runGoalLoopHook } from './chat-loop-bridge.js';
import type { JudgeResult } from './judge.js';

const originalRunId = process.env.ELANOUS_RUN_ID;
const originalPtyId = process.env.ELANOUS_PTY_ID;
const originalNestDepth = process.env.ELANOUS_NEST_DEPTH;
const originalStateDir = process.env.ELANOUS_STATE_DIR;
let isolatedStateDir = '';

function setLifecycleIdentity(runId = 'run-goals-lifecycle', ptyId = 'pty-goals-lifecycle', depth = '2'): void {
  process.env.ELANOUS_RUN_ID = runId;
  process.env.ELANOUS_PTY_ID = ptyId;
  process.env.ELANOUS_NEST_DEPTH = depth;
}

function restoreEnvironment(): void {
  if (originalRunId === undefined) delete process.env.ELANOUS_RUN_ID;
  else process.env.ELANOUS_RUN_ID = originalRunId;
  if (originalPtyId === undefined) delete process.env.ELANOUS_PTY_ID;
  else process.env.ELANOUS_PTY_ID = originalPtyId;
  if (originalNestDepth === undefined) delete process.env.ELANOUS_NEST_DEPTH;
  else process.env.ELANOUS_NEST_DEPTH = originalNestDepth;
  if (originalStateDir === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = originalStateDir;
}

beforeEach(() => {
  isolatedStateDir = mkdtempSync(join(tmpdir(), 'elanous-goals-lifecycle-'));
  process.env.ELANOUS_STATE_DIR = isolatedStateDir;
});

const continueJudge = async (): Promise<JudgeResult> => ({
  verdict: 'continue', summary: 'keep going', confidence: 0.9,
});

afterEach(() => {
  _resetForTesting();
  restoreEnvironment();
  if (isolatedStateDir) rmSync(isolatedStateDir, { recursive: true, force: true });
  isolatedStateDir = '';
});

describe('goal status transition ledger', () => {
  test('records one isolated goal-status line with goal-self run provenance, producer, transition, and reason without changing interruption counts', () => {
    const ledgerDirectory = runLedgerDir();
    appendRunLedgerEntry({
      timestamp: '2026-08-17T00:00:00.000Z',
      runId: 'run-12345678-1234-1234-1234-123456789abc',
      event: 'run-status',
      data: { runStatus: 'failed' },
    }, ledgerDirectory);
    const before = queryInterruptedRunLedgers({ dir: ledgerDirectory });

    const started = startGoal({ objective: 'persist one transition' });
    if (!started.ok) throw new Error('expected goal start');
    expect(setStatus('paused', 'waiting for operator')).toMatchObject({ ok: true });

    expect(loadRunLedger(started.goal.id, ledgerDirectory)).toEqual([
      expect.objectContaining({
        runId: started.goal.id,
        goalId: started.goal.id,
        event: 'goal-status',
        data: {
          producer: 'goal-loop',
          runIdSource: 'goal-self',
          from: 'active',
          to: 'paused',
          reason: 'waiting for operator',
        },
      }),
    ]);
    expect(queryInterruptedRunLedgers({ dir: ledgerDirectory })).toEqual(before);
  });

  test('preserves the status transition when its injected ledger writer fails', () => {
    process.env.ELANOUS_RUN_ID = 'run-goal-transition-writer-failure';
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    _setGoalTransitionLedgerWriterForTesting(() => { throw new Error('ledger unavailable'); });
    try {
      const started = startGoal({ objective: 'persist despite writer failure' });
      if (!started.ok) throw new Error('expected goal start');
      expect(setStatus('paused', 'writer failed')).toMatchObject({ ok: true, goal: { status: 'paused' } });
      expect(log.mock.calls).toContainEqual([
        'goal',
        'status-ledger',
        { id: started.goal.id, outcome: 'write-failed', error: 'ledger unavailable' },
        { level: 'warn' },
      ]);
    } finally {
      _setGoalTransitionLedgerWriterForTesting();
      log.mockRestore();
    }
  });

  test('records the goal-self fallback when no enclosing run identity exists', () => {
    delete process.env.ELANOUS_RUN_ID;
    const started = startGoal({ objective: 'use goal self as the fallback run identity' });
    if (!started.ok) throw new Error('expected goal start');
    expect(setStatus('paused', 'missing enclosing run identity')).toMatchObject({ ok: true });

    expect(loadRunLedger(started.goal.id, runLedgerDir())).toEqual([
      expect.objectContaining({
        runId: started.goal.id,
        goalId: started.goal.id,
        event: 'goal-status',
        data: expect.objectContaining({ producer: 'goal-loop', runIdSource: 'goal-self' }),
      }),
    ]);
  });

  test('writes the default transition ledger only beneath the isolated state directory', () => {
    const started = startGoal({ objective: 'persist to isolated state' });
    if (!started.ok) throw new Error('expected goal start');
    setStatus('paused', 'isolated write');

    const ledgerDirectory = runLedgerDir();
    expect(ledgerDirectory.startsWith(isolatedStateDir)).toBe(true);
    expect(loadRunLedger(started.goal.id, ledgerDirectory)).toEqual([
      expect.objectContaining({
        runId: started.goal.id,
        goalId: started.goal.id,
        event: 'goal-status',
        data: {
          producer: 'goal-loop',
          runIdSource: 'goal-self',
          from: 'active',
          to: 'paused',
          reason: 'isolated write',
        },
      }),
    ]);
    expect(existsSync(isolatedStateDir)).toBe(true);
    expect(readdirSync(isolatedStateDir).length).toBeGreaterThan(0);
  });
});

describe('GoalLoop budget diagnostics', () => {
  test('evaluates one snapshot with canonical axes and matches the state adapter at the same instant', () => {
    const start = 1_000;
    const date = spyOn(Date, 'now').mockReturnValue(start);
    try {
      startGoal({ objective: 'x', budget: { maxTurns: 2, tokenBudget: 10, wallClockMaxMs: 100 } });
      const goal = getCurrentGoal()!;
      const beforeLimit = evaluateGoalBudget(goal, start + 99);
      expect(beforeLimit).toEqual({ isOverBudget: false, exceededAxes: [], tokenMeasurement: 'measured' });
      expect(evaluateBudget()).toEqual(beforeLimit);

      const atAllLimits = evaluateGoalBudget(
        { ...goal, usage: { ...goal.usage, turnsUsed: 2, tokensUsed: 10, elapsedMs: 100 } },
        start + 100,
      );
      expect(atAllLimits).toEqual({
        isOverBudget: true,
        tokenMeasurement: 'measured',
        exceededAxes: [
          { axis: 'maxTurns', used: 2, limit: 2 },
          { axis: 'tokenBudget', used: 10, limit: 10 },
          { axis: 'wallClockMaxMs', used: 100, limit: 100 },
        ],
      });
      expect(evaluateGoalBudget({ ...goal, usage: { ...goal.usage, elapsedMs: 100 } }, start + 50))
        .toMatchObject({ exceededAxes: [{ axis: 'wallClockMaxMs', used: 100, limit: 100 }] });
    } finally {
      date.mockRestore();
    }
  });

  test('reports no active goal and preserves unmeasured token state', () => {
    expect(evaluateBudget()).toEqual({ isOverBudget: false, exceededAxes: [], tokenMeasurement: 'unmeasured' });
    const started = startGoal({ objective: 'x', budget: { maxTurns: 2, tokenBudget: 10, wallClockMaxMs: 100 } });
    if (!started.ok) throw new Error('expected goal to start');
    const goal = started.goal;
    expect(evaluateGoalBudget({ ...goal, usage: { ...goal.usage, tokensMeasured: false } }, goal.createdAt)).toMatchObject({
      isOverBudget: false,
      tokenMeasurement: 'unmeasured',
      exceededAxes: [],
    });
  });

  test('records a wall-clock-only exhaustion with preserved fields and unknown token measurement', async () => {
    const start = 1_000;
    const date = spyOn(Date, 'now').mockReturnValue(start);
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      startGoal({ objective: 'x', budget: { maxTurns: 2, tokenBudget: 10, wallClockMaxMs: 100 } });
      date.mockReturnValue(start + 100);
      const result = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'one turn' }, { judgeFn: continueJudge });
      expect(result).toMatchObject({
        kind: 'stop', reason: 'budget-limited',
        budget: {
          isOverBudget: true,
          tokenMeasurement: 'unmeasured',
          exceededAxes: [{ axis: 'wallClockMaxMs', used: 100, limit: 100 }],
        },
      });
      expect(getCurrentGoal()).toMatchObject({ status: 'budget-limited', usage: { turnsUsed: 1, tokensUsed: 0, tokensMeasured: false } });
      const budgetLog = log.mock.calls.find(([category, event]) => category === 'goal' && event === 'loop.budget-exhausted');
      expect(budgetLog?.[2]).toEqual({
        id: getCurrentGoal()!.id,
        tokenMeasurement: 'unmeasured',
        exceededAxes: [{ axis: 'wallClockMaxMs', used: 100, limit: 100 }],
      });
    } finally {
      log.mockRestore();
      date.mockRestore();
    }
  });

  test('stops for turn-only and token-only budgets through the loop path', async () => {
    const date = spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      startGoal({ objective: 'turn', budget: { maxTurns: 1, tokenBudget: 10, wallClockMaxMs: 100 } });
      const turn = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'one turn', tokensUsed: 0 }, { judgeFn: continueJudge });
      expect(turn).toMatchObject({ kind: 'stop', budget: { exceededAxes: [{ axis: 'maxTurns', used: 1, limit: 1 }], tokenMeasurement: 'measured' } });
      clearGoal();
      startGoal({ objective: 'token', budget: { maxTurns: 2, tokenBudget: 1, wallClockMaxMs: 100 } });
      const token = await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'one turn', tokensUsed: 1 }, { judgeFn: continueJudge });
      expect(token).toMatchObject({ kind: 'stop', budget: { exceededAxes: [{ axis: 'tokenBudget', used: 1, limit: 1 }], tokenMeasurement: 'measured' } });
    } finally {
      date.mockRestore();
    }
  });

  test('renders combined exhaustion without implying a wall-clock remedy exists', async () => {
    const start = 1_000;
    const date = spyOn(Date, 'now').mockReturnValue(start);
    try {
      startGoal({ objective: 'combined', budget: { maxTurns: 1, tokenBudget: 1, wallClockMaxMs: 100 } });
      date.mockReturnValue(start + 100);
      const action = await runGoalLoopHook({
        history: [{ role: 'assistant', content: 'one turn' }],
        tokensUsed: 1,
        loopOpts: { judgeFn: continueJudge },
      });
      expect(action).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
      if (action.kind !== 'stop') throw new Error('expected stop');
      expect(action.toastLines).toEqual([
        '  ⚠ Goal paused — turn + token + wall-clock budget exhausted (turns 1/1; tokens 1/1; wall-clock 100/100ms).',
        '     /goal budget <N> extends turns; /goal budget tokens=<N> extends tokens; /goal budget wall=<N>s extends wall-clock. Increase every exhausted axis before /goal resume.',
      ]);
    } finally {
      date.mockRestore();
    }
  });

  test('renders wall-clock-only exhaustion without a false turn-budget remedy', async () => {
    const start = 1_000;
    const date = spyOn(Date, 'now').mockReturnValue(start);
    try {
      startGoal({ objective: 'wall clock', budget: { maxTurns: 2, tokenBudget: 10, wallClockMaxMs: 100 } });
      date.mockReturnValue(start + 100);
      const action = await runGoalLoopHook({
        history: [{ role: 'assistant', content: 'one turn' }],
        loopOpts: { judgeFn: continueJudge },
      });
      expect(action).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
      if (action.kind !== 'stop') throw new Error('expected stop');
      expect(action.toastLines).toEqual([
        '  ⚠ Goal paused — wall-clock budget exhausted (wall-clock 100/100ms).',
        '     /goal budget wall=<N>s extends wall-clock. Increase every exhausted axis before /goal resume.',
      ]);
      const budgetEvents = debug.events().filter((event) => event.category === 'goal' && event.event === 'loop.budget-exhausted');
      expect(budgetEvents[budgetEvents.length - 1]?.data).toMatchObject({
        tokenMeasurement: 'unmeasured',
        exceededAxes: [{ axis: 'wallClockMaxMs', used: 100, limit: 100 }],
      });
    } finally {
      date.mockRestore();
    }
  });
});

describe('GoalLoop lifecycle publication', () => {
  test('publishes one started and a valid budget-exhausted failed record with monotonic sequence', async () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });

    const result = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'one turn' },
      { judgeFn: continueJudge, lifecycleBus: bus },
    );

    expect(result).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
    const records = snapshotRunLifecycle(bus, 'run-goals-lifecycle');
    expect(records.map((record) => record.name)).toEqual(['started', 'failed']);
    expect(records[1].seq).toBe(records[0].seq + 1);
    expect(records[1]).toMatchObject({
      payload: { reason: 'budget-exhausted' },
      truncated: false,
      ptyId: 'pty-goals-lifecycle',
      subjectPtyId: 'pty-goals-lifecycle',
      depth: 2,
      role: 'child',
    });
    expect(records.every((record) => validateLifecycleRecord(record) === null)).toBe(true);
  });

  test('logs every exhausted budget axis with actual usage and token measurement state', async () => {
    const now = spyOn(Date, 'now').mockReturnValue(0);
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const bus = new ChannelBus();

    async function exhaust(
      budget: { maxTurns: number; wallClockMaxMs: number; tokenBudget: number },
      tokensUsed: number | undefined,
      elapsedMs: number,
    ): Promise<Record<string, unknown>> {
      startGoal({ objective: 'x', budget });
      now.mockReturnValue(elapsedMs);
      const result = await shouldContinueAfterAssistantTurn(
        { lastAssistantTurn: 'one turn', tokensUsed },
        { judgeFn: continueJudge, lifecycleBus: bus },
      );
      expect(result).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
      if (result.kind !== 'stop') throw new Error('expected budget-limited stop');
      expect(result.reason).toBe('budget-limited');
      expect(clearGoal()?.status).toBe('budget-limited');
      const exhausted = log.mock.calls.filter(([category, event]) => category === 'goal' && event === 'loop.budget-exhausted').at(-1);
      if (!exhausted) throw new Error('expected budget-exhausted observation');
      return exhausted[2] as Record<string, unknown>;
    }

    try {
      expect(await exhaust({ maxTurns: 1, wallClockMaxMs: 1_000, tokenBudget: 10 }, 0, 0)).toMatchObject({
        tokenMeasurement: 'measured',
        exceededAxes: [{ axis: 'maxTurns', used: 1, limit: 1 }],
      });
      now.mockReturnValue(0);
      expect(await exhaust({ maxTurns: 2, wallClockMaxMs: 100, tokenBudget: 10 }, undefined, 100)).toMatchObject({
        tokenMeasurement: 'unmeasured',
        exceededAxes: [{ axis: 'wallClockMaxMs', used: 100, limit: 100 }],
      });
      now.mockReturnValue(0);
      expect(await exhaust({ maxTurns: 2, wallClockMaxMs: 1_000, tokenBudget: 5 }, 5, 0)).toMatchObject({
        exceededAxes: [{ axis: 'tokenBudget', used: 5, limit: 5 }],
      });
      now.mockReturnValue(0);
      expect(await exhaust({ maxTurns: 1, wallClockMaxMs: 100, tokenBudget: 5 }, 5, 100)).toMatchObject({
        exceededAxes: [
          { axis: 'maxTurns', used: 1, limit: 1 },
          { axis: 'tokenBudget', used: 5, limit: 5 },
          { axis: 'wallClockMaxMs', used: 100, limit: 100 },
        ],
      });
    } finally {
      now.mockRestore();
      log.mockRestore();
    }
  });

  test('does not publish complete when the judge completes a goal', async () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    startGoal({ objective: 'x' });

    const result = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'done' },
      {
        judgeFn: async () => ({ verdict: 'done', summary: 'completed', confidence: 0.9 }),
        lifecycleBus: bus,
      },
    );

    expect(result).toMatchObject({ kind: 'stop', reason: 'done' });
    expect(snapshotRunLifecycle(bus, 'run-goals-lifecycle').map((record) => record.name)).toEqual(['started']);
  });

  test('publishes started once per private goal execution state', async () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    startGoal({ objective: 'first', budget: { maxTurns: 3 } });

    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'first' }, { judgeFn: continueJudge, lifecycleBus: bus });
    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'second' }, { judgeFn: continueJudge, lifecycleBus: bus });
    expect(snapshotRunLifecycle(bus, 'run-goals-lifecycle').map((record) => record.name)).toEqual(['started']);

    clearGoal();
    startGoal({ objective: 'second' });
    await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'new execution' }, { judgeFn: continueJudge, lifecycleBus: bus });
    expect(snapshotRunLifecycle(bus, 'run-goals-lifecycle').map((record) => record.name)).toEqual(['started', 'started']);
  });

  test('skips records and observes missing identity', async () => {
    delete process.env.ELANOUS_RUN_ID;
    delete process.env.ELANOUS_PTY_ID;
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const bus = new ChannelBus();
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });

    try {
      await shouldContinueAfterAssistantTurn({ lastAssistantTurn: 'one turn' }, { judgeFn: continueJudge, lifecycleBus: bus });
      expect(bus.channels()).toEqual([]);
      expect(log.mock.calls.filter(([category, event]) => category === 'signal' && event === 'lifecycle.skip-no-identity'))
        .toEqual([
          ['signal', 'lifecycle.skip-no-identity', { missing: ['runId', 'ptyId'] }],
          ['signal', 'lifecycle.skip-no-identity', { missing: ['runId', 'ptyId'] }],
        ]);
    } finally {
      log.mockRestore();
    }
  });

  test('truncates an oversized failed reason in the published record', () => {
    setLifecycleIdentity();
    const bus = new ChannelBus();
    const reason = 'r'.repeat(241);

    publishGoalLifecycle(bus, 'failed', reason);

    const [record] = snapshotRunLifecycle(bus, 'run-goals-lifecycle');
    expect(record).toMatchObject({
      name: 'failed',
      truncated: true,
      truncatedFields: ['reason'],
    });
    if (record.name !== 'failed') throw new Error('expected failed lifecycle record');
    expect(record.payload.reason).toHaveLength(240);
    expect(record.payload.reason).toContain('… [');
    expect(record.payload.reason).not.toBe(reason);
    expect(validateLifecycleRecord(record)).toBeNull();
  });

  test('preserves the loop result when publication fails', async () => {
    setLifecycleIdentity();
    const bus = { publish: () => { throw new Error('bus unavailable'); } } as unknown as ChannelBus;
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });

    const result = await shouldContinueAfterAssistantTurn(
      { lastAssistantTurn: 'one turn' },
      { judgeFn: continueJudge, lifecycleBus: bus },
    );

    expect(result).toMatchObject({ kind: 'stop', reason: 'budget-limited' });
  });
});

describe('automatic follow-up routing', () => {
  test('does not treat an unrelated new request as a goal correction', () => {
    const started = startGoal({ objective: 'Find the macroeconomics assignment 2 report.' });
    if (!started.ok) throw new Error('expected goal start');
    expect(setStatus('paused', 'user-preempt')).toMatchObject({ ok: true });

    expect(resumeGoalFromUserFollowUp('오늘 날씨 알려줘').kind).toBe('no-loop');
    expect(getCurrentGoal()).toMatchObject({ status: 'paused' });
  });

  test('hydrates a paused goal after restart and resumes it from a bco correction', () => {
    const started = startGoal({ objective: 'Find the macroeconomics assignment 2 report.' });
    if (!started.ok) throw new Error('expected goal start');
    expect(setStatus('paused', 'user-preempt')).toMatchObject({ ok: true });

    _resetForTesting(); // simulate process restart without deleting ELANOUS_STATE_DIR
    expect(hydrateGoalFromSnapshot()).toMatchObject({ id: started.goal.id, status: 'paused' });
    expect(resumeGoalFromUserFollowUp('거시 경제는 bco로 시작하는 디렉토리입니다.').kind).toBe('continue');
    expect(getCurrentGoal()).toMatchObject({ id: started.goal.id, status: 'active' });
  });

  test('turns a bco correction after interruption into an active execution prompt', () => {
    const started = startGoal({ objective: 'Find the macroeconomics assignment 2 report.' });
    if (!started.ok) throw new Error('expected goal start');
    expect(setStatus('paused', 'user-preempt')).toMatchObject({ ok: true });

    const action = resumeGoalFromUserFollowUp('거시 경제는 bco로 시작하는 디렉토리입니다.');

    expect(action.kind).toBe('continue');
    if (action.kind !== 'continue') throw new Error('expected follow-up continuation');
    expect(action.nextUserText.includes('bco로 시작하는 디렉토리')).toBe(true);
    expect(action.nextUserText.includes('Do not only explain the correction')).toBe(true);
    expect(getCurrentGoal()).toMatchObject({ status: 'active' });
  });
});

describe('goal lifecycle — a successful publish must be observable', () => {
  afterEach(() => { _resetForTesting(); });

  test('emits lifecycle.published so a federated query can tell publish from no-op', () => {
    process.env.ELANOUS_RUN_ID = 'run-obs';
    process.env.ELANOUS_PTY_ID = 'self_0badc0de';
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      const bus = new ChannelBus();
      publishGoalLifecycle(bus, 'started');
      publishGoalLifecycle(bus, 'failed', 'budget-exhausted');

      const published = log.mock.calls.filter((c) => c[1] === 'lifecycle.published');
      expect(published.map((c) => (c[2] as { name: string }).name)).toEqual(['started', 'failed']);
      // The observation must carry the join keys, otherwise a consumer cannot
      // correlate it with the record that actually rode the bus.
      for (const call of published) {
        const data = call[2] as Record<string, unknown>;
        expect(data.runId).toBe('run-obs');
        expect(data.ptyId).toBe('self_0badc0de');
        expect(typeof data.seq).toBe('number');
      }
      // …and the bus really received them (observation ≠ the thing observed).
      expect(snapshotRunLifecycle(bus, 'run-obs')).toHaveLength(2);
    } finally {
      log.mockRestore();
      delete process.env.ELANOUS_RUN_ID;
      delete process.env.ELANOUS_PTY_ID;
    }
  });
});
