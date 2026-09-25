export type RunOutcome = 'completed' | 'merged' | 'abandoned' | 'budget-exhausted';

/** Canonical rework-budget verdicts. ReworkBudgetVerdict is derived from this array so a new literal cannot exist only on the type. */
export const REWORK_BUDGET_VERDICTS = ['EXTEND', 'SUFFICIENT', 'UNCONVERGEABLE', 'CONTRACT-CONFLICT'] as const;
export type ReworkBudgetVerdict = (typeof REWORK_BUDGET_VERDICTS)[number];

export type RunOutcomeInput =
  | { readonly termination: 'completed' }
  | { readonly termination: 'supervisor-abandoned'; readonly verdict: 'UNCONVERGEABLE'; readonly applied: true; readonly merged?: boolean }
  | { readonly termination: 'abandoned' }
  | { readonly termination: 'budget-exhausted'; readonly lastVerdict?: ReworkBudgetVerdict };

export type RunOutcomeResolution =
  | { readonly outcome: 'completed' }
  | { readonly outcome: 'merged' }
  | { readonly outcome: 'abandoned' }
  | { readonly outcome: 'budget-exhausted'; readonly supervisorWantedContinue?: true };

/** Resolves the run's terminal disposition from structured loop state, never diagnostic text. */
export function resolveRunOutcome(input: RunOutcomeInput): RunOutcomeResolution {
  switch (input.termination) {
    case 'completed':
      return { outcome: 'completed' };
    case 'supervisor-abandoned':
      return input.merged ? { outcome: 'merged' } : { outcome: 'abandoned' };
    case 'abandoned':
      return { outcome: 'abandoned' };
    case 'budget-exhausted':
      return input.lastVerdict === 'EXTEND'
        ? { outcome: 'budget-exhausted', supervisorWantedContinue: true }
        : { outcome: 'budget-exhausted' };
  }
}
