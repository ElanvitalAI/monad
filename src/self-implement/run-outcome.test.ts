import { describe, expect, test } from 'bun:test';
import { REWORK_BUDGET_VERDICTS, resolveRunOutcome, type ReworkBudgetVerdict } from './run-outcome.js';

describe('resolveRunOutcome', () => {
  test('successful output is completed without supervisor continuation state', () => {
    expect(resolveRunOutcome({ termination: 'completed' })).toEqual({ outcome: 'completed' });
  });

  test('an applied UNCONVERGEABLE verdict with confirmed merge evidence is merged', () => {
    expect(resolveRunOutcome({ termination: 'supervisor-abandoned', verdict: 'UNCONVERGEABLE', applied: true, merged: true }))
      .toEqual({ outcome: 'merged' });
  });

  test('an applied UNCONVERGEABLE verdict without merge evidence remains abandoned', () => {
    expect(resolveRunOutcome({ termination: 'supervisor-abandoned', verdict: 'UNCONVERGEABLE', applied: true }))
      .toEqual({ outcome: 'abandoned' });
  });

  test('a hard-cap termination is budget-exhausted and preserves an EXTEND disagreement', () => {
    expect(resolveRunOutcome({ termination: 'budget-exhausted', lastVerdict: 'EXTEND' }))
      .toEqual({ outcome: 'budget-exhausted', supervisorWantedContinue: true });
  });

  test('a missing current-round verdict does not manufacture supervisorWantedContinue after an earlier EXTEND', () => {
    const outcome = resolveRunOutcome({ termination: 'budget-exhausted' });
    expect(outcome).toEqual({ outcome: 'budget-exhausted' });
    expect(outcome).not.toHaveProperty('supervisorWantedContinue');
  });

  test('a non-EXTEND final verdict does not manufacture supervisorWantedContinue', () => {
    const outcome = resolveRunOutcome({ termination: 'budget-exhausted', lastVerdict: 'UNCONVERGEABLE' });
    expect(outcome).toEqual({ outcome: 'budget-exhausted' });
    expect(outcome).not.toHaveProperty('supervisorWantedContinue');
  });

  test('other normal terminal failures remain structurally abandoned', () => {
    expect(resolveRunOutcome({ termination: 'abandoned' })).toEqual({ outcome: 'abandoned' });
  });
});

describe('REWORK_BUDGET_VERDICTS', () => {
  test('keeps the four current canonical literals and derives ReworkBudgetVerdict from them', () => {
    expect([...REWORK_BUDGET_VERDICTS]).toEqual([
      'EXTEND',
      'SUFFICIENT',
      'UNCONVERGEABLE',
      'CONTRACT-CONFLICT',
    ]);
    const derived: ReworkBudgetVerdict = REWORK_BUDGET_VERDICTS[0];
    expect(derived).toBe('EXTEND');
    expect(REWORK_BUDGET_VERDICTS).toHaveLength(4);
  });
});
