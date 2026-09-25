import type { AbandonedClassificationResult } from './abandoned-classification.js';

export interface ReworkSalvageEvidence {
  clean: boolean;
  aheadCommits: number;
}

type EnvironmentInterruption = Extract<AbandonedClassificationResult['classification'],
  'quota-exhausted' | 'credential-failure' | 'provider-error'>;

type ReworkSalvageDecision =
  | { action: 'launch'; evidence: ReworkSalvageEvidence }
  | { action: 'launch'; reason: `environment-${EnvironmentInterruption}` }
  | { action: 'accept'; reason: 'review-budget-gate-passed'; unresolvedMustFix: readonly string[] }
  | {
    action: 'parked';
    reason: 'not-hard-cap-extend' | 'already-salvaged' | 'no-goal-file' | 'dirty-worktree' | 'no-ahead-commits'
      | 'review-budget-gate-unavailable' | 'review-budget-gate-failed' | 'review-budget-no-must-fix'
      | 'review-budget-non-review-work-remains';
    evidence?: ReworkSalvageEvidence;
  };

/**
 * The post-cap salvage policy is deliberately narrower than rework-budget: only a
 * hard-cap exhaustion that the supervisor still wanted to continue may create one
 * follow-up run. The follow-up carries attempt=1, which turns any later cap into
 * a parked terminal state rather than a chain.
 *
 * A separately signalled review-budget exhaustion may accept a gate-passing
 * artifact while recording its remaining must-fix findings as follow-up work.
 */
export function decideReworkSalvage(input: {
  hardCapBlockedExtend: boolean;
  goalFile?: string;
  salvageAttempt?: number;
  evidence?: ReworkSalvageEvidence;
  reviewBudgetExhausted?: boolean;
  gatePassed?: boolean;
  unresolvedMustFix?: readonly string[];
  hasNonReviewResidualWork?: boolean;
  abandonedClassification?: AbandonedClassificationResult['classification'];
}): ReworkSalvageDecision {
  if (input.reviewBudgetExhausted) {
    if (input.gatePassed === undefined) return { action: 'parked', reason: 'review-budget-gate-unavailable' };
    if (!input.gatePassed) return { action: 'parked', reason: 'review-budget-gate-failed' };
    if (!input.unresolvedMustFix?.length) return { action: 'parked', reason: 'review-budget-no-must-fix' };
    if (input.hasNonReviewResidualWork) return { action: 'parked', reason: 'review-budget-non-review-work-remains' };
    return { action: 'accept', reason: 'review-budget-gate-passed', unresolvedMustFix: input.unresolvedMustFix };
  }
  const environmentInterruption: EnvironmentInterruption | undefined = input.abandonedClassification === 'quota-exhausted'
    || input.abandonedClassification === 'credential-failure'
    || input.abandonedClassification === 'provider-error'
    ? input.abandonedClassification
    : undefined;
  if (!input.hardCapBlockedExtend && !environmentInterruption) return { action: 'parked', reason: 'not-hard-cap-extend' };
  if ((input.salvageAttempt ?? 0) >= 1) return { action: 'parked', reason: 'already-salvaged' };
  if (environmentInterruption) return { action: 'launch', reason: `environment-${environmentInterruption}` };
  if (!input.goalFile) return { action: 'parked', reason: 'no-goal-file' };
  if (!input.evidence?.clean) return { action: 'parked', reason: 'dirty-worktree', ...(input.evidence ? { evidence: input.evidence } : {}) };
  if (input.evidence.aheadCommits < 1) return { action: 'parked', reason: 'no-ahead-commits', evidence: input.evidence };
  return { action: 'launch', evidence: input.evidence };
}
