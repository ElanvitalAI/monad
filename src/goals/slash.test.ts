import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../debug/log.js';
import {
  _resetForTesting,
  getCurrentGoal,
  recordTurn,
  setStatus,
  startGoal,
} from './registry.js';
import { executeGoalSlash } from './slash.js';

const input = (rest: string[]) => ({ subcommand: 'budget', rest, defaultMode: 'judge' as const });

afterEach(() => {
  _resetForTesting();
});

describe('/goal resume', () => {
  test('sets a paused goal active without starting a turn and tells the user to send a message', () => {
    const started = startGoal({ objective: 'continue this goal' });
    if (!started.ok) throw new Error('expected goal to start');
    recordTurn({ tokens: 42, verdict: 'partial', summary: 'wait for input' });
    setStatus('paused', 'user-pause');
    const before = getCurrentGoal()!;

    expect(executeGoalSlash({ subcommand: 'resume', rest: [], defaultMode: 'judge' })).toEqual({
      kind: 'resumed',
      lines: ['  ▶  Goal set to active (🎯 active · 1/20 turns · 0s · 42 tok · last:partial). Send a message to start the next turn.'],
    });
    expect(getCurrentGoal()).toMatchObject({
      id: before.id,
      status: 'active',
      usage: { turnsUsed: 1, tokensUsed: 42 },
      lastVerdict: 'partial',
      lastSummary: 'wait for input',
    });
  });

  test('resumes a budget-limited goal after increasing the budget with the user-resume transition', () => {
    const started = startGoal({ objective: 'continue this goal', budget: { maxTurns: 1 } });
    if (!started.ok) throw new Error('expected goal to start');
    recordTurn({ tokens: 42, verdict: 'partial', summary: 'increase the budget' });
    setStatus('budget-limited');
    const statusLog = spyOn(debug, 'log');

    expect(executeGoalSlash(input(['2']))).toEqual({ kind: 'message', lines: ['  budget turns → 2'] });
    expect(executeGoalSlash({ subcommand: 'resume', rest: [], defaultMode: 'judge' })).toEqual({
      kind: 'resumed',
      lines: ['  ▶  Goal set to active (🎯 active · 1/2 turns · 0s · 42 tok · last:partial). Send a message to start the next turn.'],
    });
    expect(getCurrentGoal()).toMatchObject({
      status: 'active',
      budget: { maxTurns: 2 },
      usage: { turnsUsed: 1, tokensUsed: 42 },
    });
    expect(statusLog).toHaveBeenCalledWith('goal', 'status', expect.objectContaining({
      from: 'budget-limited', to: 'active', reason: 'user-resume',
    }));
    statusLog.mockRestore();
  });

  test('rejects resumes for missing, active, complete, and over-budget goals', () => {
    const resume = () => executeGoalSlash({ subcommand: 'resume', rest: [], defaultMode: 'judge' });

    expect(resume()).toEqual({ kind: 'error', lines: ['  /goal resume — no goal to resume.'] });

    startGoal({ objective: 'x' });
    expect(resume()).toEqual({ kind: 'message', lines: ['  Goal already active. 🎯 active · 0/20 turns · 0s'] });

    setStatus('complete');
    expect(resume()).toEqual({
      kind: 'error', lines: ['  /goal resume — current goal is already complete. /goal clear first.'],
    });

    _resetForTesting();
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });
    recordTurn({});
    setStatus('budget-limited');
    expect(resume()).toEqual({ kind: 'error', lines: ['  /goal resume — over budget. Increase budget first.'] });
  });
});

describe('/goal budget', () => {
  test('updates wall-clock seconds without recreating the goal or clearing its history', () => {
    const started = startGoal({ objective: 'continue this goal', budget: { wallClockMaxMs: 100 } });
    if (!started.ok) throw new Error('expected goal to start');
    recordTurn({ tokens: 42, verdict: 'partial', summary: 'keep prior verdict' });
    setStatus('budget-limited');
    const before = getCurrentGoal()!;

    const result = executeGoalSlash(input(['wall=3600s']));
    const goal = getCurrentGoal()!;

    expect(result).toEqual({ kind: 'message', lines: ['  budget wall-clock → 3600s'] });
    expect(goal).toMatchObject({
      id: before.id,
      status: 'budget-limited',
      budget: { wallClockMaxMs: 3_600_000 },
      usage: { turnsUsed: 1, tokensUsed: 42 },
      lastVerdict: 'partial',
      lastSummary: 'keep prior verdict',
    });
  });

  test('preserves existing turn and token budget forms', () => {
    startGoal({ objective: 'x' });

    expect(executeGoalSlash(input(['60']))).toEqual({ kind: 'message', lines: ['  budget turns → 60'] });
    expect(executeGoalSlash(input(['tokens=500000']))).toEqual({ kind: 'message', lines: ['  budget tokens → 500,000'] });
    expect(getCurrentGoal()?.budget).toMatchObject({
      maxTurns: 60,
      tokenBudget: 500_000,
      wallClockMaxMs: 1_800_000,
    });
  });

  test('rejects malformed, unsupported, and mixed wall-clock inputs with a reason', () => {
    startGoal({ objective: 'x' });

    expect(executeGoalSlash(input(['wall=0s']))).toEqual({
      kind: 'error', lines: ['  ✗ invalid wall-clock budget: wall=0s'],
    });
    expect(executeGoalSlash(input(['wall=not-a-number']))).toEqual({
      kind: 'error', lines: ['  ✗ invalid wall-clock budget: wall=not-a-number'],
    });
    expect(executeGoalSlash(input(['wall=3600']))).toEqual({
      kind: 'error', lines: ['  ✗ invalid wall-clock budget: wall=3600'],
    });
    expect(executeGoalSlash(input(['wallMs=3600000']))).toEqual({
      kind: 'error', lines: ['  ✗ invalid turn budget: wallMs=3600000'],
    });
    expect(executeGoalSlash(input(['wall=3600s', 'tokens=500000']))).toEqual({
      kind: 'error', lines: ['  ✗ /goal budget accepts exactly one value.'],
    });
  });

  test('reports missing active goal before parsing a wall-clock input', () => {
    expect(executeGoalSlash(input(['wall=3600s']))).toEqual({
      kind: 'error', lines: ['  /goal budget — no active goal.'],
    });
  });

  test('lists the seconds-form wall-clock input in budget and command help', () => {
    startGoal({ objective: 'x' });

    expect(executeGoalSlash(input([])).lines.join('\n')).toContain('/goal budget wall=<N>s');
    expect(executeGoalSlash({ subcommand: 'help', rest: [], defaultMode: 'judge' }).lines.join('\n'))
      .toContain('wall=<N>s');
  });
});
