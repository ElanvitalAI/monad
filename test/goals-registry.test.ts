// Goal registry unit tests — Plan-Mode UX P1.1.
//
// Real-wiring per CLAUDE.md isolation rule — no mock.module(). Only
// imports the registry directly, exercises state transitions, asserts
// pub/sub fanout. No LLM, no fs.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  _resetForTesting,
  clearGoal,
  getCurrentGoal,
  isGoalActive,
  isOverBudget,
  recordTurn,
  setBudget,
  setStatus,
  startGoal,
  subscribeGoal,
} from '../src/goals/index.js';

afterEach(() => {
  _resetForTesting();
});

describe('goals/registry', () => {
  test('startGoal creates active goal with default budget', () => {
    const r = startGoal({ objective: 'write tests' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.goal.objective).toBe('write tests');
    expect(r.goal.status).toBe('active');
    expect(r.goal.mode).toBe('judge');
    expect(r.goal.budget.maxTurns).toBe(20);
    expect(r.goal.usage.turnsUsed).toBe(0);
    expect(isGoalActive()).toBe(true);
  });

  test('startGoal rejects when another goal active', () => {
    startGoal({ objective: 'first' });
    const r = startGoal({ objective: 'second' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.code).toBe('GoalAlreadyActive');
  });

  test('startGoal allowed after clearGoal', () => {
    startGoal({ objective: 'first' });
    clearGoal();
    const r = startGoal({ objective: 'second' });
    expect(r.ok).toBe(true);
  });

  test('setStatus transitions active → paused → active', () => {
    startGoal({ objective: 'x' });
    expect(setStatus('paused', 'user-pause').ok).toBe(true);
    expect(getCurrentGoal()?.status).toBe('paused');
    expect(isGoalActive()).toBe(false);
    expect(setStatus('active', 'user-resume').ok).toBe(true);
    expect(isGoalActive()).toBe(true);
  });

  test('setStatus errors when no goal', () => {
    const r = setStatus('paused');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.code).toBe('GoalNotFound');
  });

  test('recordTurn increments turnsUsed + tokensUsed + remembers verdict', () => {
    startGoal({ objective: 'x' });
    recordTurn({ tokens: 100, verdict: 'continue', summary: 'still working' });
    recordTurn({ tokens: 150, verdict: 'partial', summary: 'almost there' });
    const g = getCurrentGoal()!;
    expect(g.usage.turnsUsed).toBe(2);
    expect(g.usage.tokensUsed).toBe(250);
    expect(g.lastVerdict).toBe('partial');
    expect(g.lastSummary).toBe('almost there');
  });

  test('isOverBudget true when turnsUsed >= maxTurns', () => {
    startGoal({ objective: 'x', budget: { maxTurns: 3 } });
    expect(isOverBudget()).toBe(false);
    recordTurn({});
    recordTurn({});
    expect(isOverBudget()).toBe(false);
    recordTurn({});
    expect(isOverBudget()).toBe(true);
  });

  test('isOverBudget true when tokensUsed >= tokenBudget', () => {
    startGoal({ objective: 'x', budget: { tokenBudget: 500 } });
    recordTurn({ tokens: 200 });
    expect(isOverBudget()).toBe(false);
    recordTurn({ tokens: 400 });
    expect(isOverBudget()).toBe(true);
  });

  test('isOverBudget false when tokenBudget=0 (no cap)', () => {
    startGoal({ objective: 'x', budget: { tokenBudget: 0, maxTurns: 100 } });
    recordTurn({ tokens: 1_000_000 });
    expect(isOverBudget()).toBe(false);
  });

  test('setBudget updates current goal', () => {
    startGoal({ objective: 'x', budget: { maxTurns: 10 } });
    const r = setBudget({ maxTurns: 50 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.goal.budget.maxTurns).toBe(50);
  });

  test('clearGoal returns prev goal + emits null to listeners', () => {
    let listenerCalls = 0;
    let lastNext: unknown = undefined;
    let lastPrev: unknown = undefined;
    const unsub = subscribeGoal((next, prev) => {
      listenerCalls += 1;
      lastNext = next;
      lastPrev = prev;
    });

    const created = startGoal({ objective: 'x' });
    expect(listenerCalls).toBe(1);
    expect(lastPrev).toBeNull();

    const cleared = clearGoal();
    expect(cleared?.id).toBe(created.ok ? created.goal.id : '');
    expect(lastNext).toBeNull();
    expect(listenerCalls).toBe(2);

    unsub();
  });

  test('subscribe returns unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeGoal(() => { calls += 1; });
    startGoal({ objective: 'x' });
    expect(calls).toBe(1);
    unsub();
    setStatus('paused');
    expect(calls).toBe(1); // no change after unsub
  });

  test('mode override accepted', () => {
    const r = startGoal({ objective: 'x', mode: 'spec' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.goal.mode).toBe('spec');
  });

  test('linkedTaskId preserved through transitions', () => {
    startGoal({ objective: 'x', linkedTaskId: 'tox-123' });
    setStatus('paused');
    expect(getCurrentGoal()?.linkedTaskId).toBe('tox-123');
  });

  test('elapsedMs grows on read', async () => {
    startGoal({ objective: 'x' });
    const a = getCurrentGoal()!.usage.elapsedMs;
    await new Promise((r) => setTimeout(r, 5));
    const b = getCurrentGoal()!.usage.elapsedMs;
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
