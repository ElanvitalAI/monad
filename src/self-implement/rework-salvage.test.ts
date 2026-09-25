import { describe, expect, test } from 'bun:test';
import { decideReworkSalvage } from './rework-salvage.js';

describe('decideReworkSalvage', () => {
  test('clean committed file-backed hard-cap output launches exactly its first salvage', () => {
    expect(decideReworkSalvage({ hardCapBlockedExtend: true, goalFile: 'docs/goals/GOAL.txt', evidence: { clean: true, aheadCommits: 2 } }))
      .toEqual({ action: 'launch', evidence: { clean: true, aheadCommits: 2 } });
  });

  test.each(['quota-exhausted', 'credential-failure', 'provider-error'] as const)(
    'launches an eligible %s environment interruption with its classification in the reason',
    (abandonedClassification) => {
      expect(decideReworkSalvage({
        hardCapBlockedExtend: false,
        abandonedClassification,
      })).toEqual({
        action: 'launch',
        reason: `environment-${abandonedClassification}`,
      });
    },
  );

  test('accepts gate-passing review-budget exhaustion and retains every named follow-up finding', () => {
    expect(decideReworkSalvage({
      hardCapBlockedExtend: false,
      reviewBudgetExhausted: true,
      gatePassed: true,
      unresolvedMustFix: ['add negative test', 'record the observation'],
      hasNonReviewResidualWork: false,
    })).toEqual({
      action: 'accept',
      reason: 'review-budget-gate-passed',
      unresolvedMustFix: ['add negative test', 'record the observation'],
    });
  });

  test.each([
    [{ hardCapBlockedExtend: false, reviewBudgetExhausted: true, gatePassed: undefined, unresolvedMustFix: ['finding'] }, 'review-budget-gate-unavailable'],
    [{ hardCapBlockedExtend: false, reviewBudgetExhausted: true, gatePassed: false, unresolvedMustFix: ['finding'] }, 'review-budget-gate-failed'],
    [{ hardCapBlockedExtend: false, reviewBudgetExhausted: true, gatePassed: true, unresolvedMustFix: [] }, 'review-budget-no-must-fix'],
    [{ hardCapBlockedExtend: false, reviewBudgetExhausted: true, gatePassed: true, unresolvedMustFix: ['finding'], hasNonReviewResidualWork: true }, 'review-budget-non-review-work-remains'],
    [{ hardCapBlockedExtend: false, abandonedClassification: 'implementation-deficit', goalFile: 'docs/goals/GOAL.txt', evidence: { clean: true, aheadCommits: 2 } }, 'not-hard-cap-extend'],
    [{ hardCapBlockedExtend: false, goalFile: 'docs/goals/GOAL.txt', evidence: { clean: true, aheadCommits: 2 } }, 'not-hard-cap-extend'],
    [{ hardCapBlockedExtend: true, goalFile: 'docs/goals/GOAL.txt', salvageAttempt: 1, evidence: { clean: true, aheadCommits: 2 } }, 'already-salvaged'],
    [{ hardCapBlockedExtend: false, abandonedClassification: 'provider-error', salvageAttempt: 1 }, 'already-salvaged'],
    [{ hardCapBlockedExtend: true, evidence: { clean: true, aheadCommits: 2 } }, 'no-goal-file'],
    [{ hardCapBlockedExtend: true, goalFile: 'docs/goals/GOAL.txt', evidence: { clean: false, aheadCommits: 2 } }, 'dirty-worktree'],
    [{ hardCapBlockedExtend: true, goalFile: 'docs/goals/GOAL.txt', evidence: { clean: true, aheadCommits: 0 } }, 'no-ahead-commits'],
  ] as const)('parks %o because %s', (input, reason) => {
    expect(decideReworkSalvage(input)).toMatchObject({ action: 'parked', reason });
  });
});
