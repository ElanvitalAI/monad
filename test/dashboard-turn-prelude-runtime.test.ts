import { describe, expect, test } from 'bun:test';

import { runDashboardTurnPrelude } from '../src/dashboard/turn-prelude-runtime.js';

describe('runDashboardTurnPrelude', () => {
  test('arms undo-turn with a truncated label', () => {
    const calls: string[] = [];
    const result = runDashboardTurnPrelude({
      userText: 'a'.repeat(100),
      startUndoTurn: (label) => { calls.push(label); },
    });
    expect(calls).toEqual(['a'.repeat(80)]);
    expect(result.searchPlannerState.maxAutoNarrowCandidates).toBe(2);
  });

  test('widens planner candidates for structural analysis prompts', () => {
    const result = runDashboardTurnPrelude({
      userText: '구조 분석 해줘',
      startUndoTurn: () => {},
    });
    expect(result.searchPlannerState.maxAutoNarrowCandidates).toBe(3);
  });
});
