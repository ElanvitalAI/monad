// Goal-loop continuation prompt — Plan-Mode UX P1.2.
//
// After the judge returns `continue` or `partial`, the GoalLoop
// injects a synthetic *user-turn* into the message history with this
// text. From the model's perspective the user just asked again — so
// prompt cache + role alternation invariants are preserved (Hermes
// ralph design choice — see PR #18262).
//
// Keep this short — the model already has the original objective in
// the conversation history. The continuation only nudges + threads
// the judge's verdict so the model can react.

import type { Goal } from './types.js';

export interface ContinuationInput {
  goal: Goal;
  /** Last judge summary — surfaced so the model knows what the judge
   *  saw. Optional (first turn has no prior judge yet). */
  judgeSummary?: string;
  /** "continue" vs "partial" — partial gets a stronger "wrap up"
   *  hint. */
  hint: 'continue' | 'partial';
}

export function buildContinuationPrompt(input: ContinuationInput): string {
  const { goal, judgeSummary, hint } = input;
  const turn = goal.usage.turnsUsed + 1;
  const budget = goal.budget.maxTurns;

  const judgeLine = judgeSummary
    ? `Judge said about your last turn: "${judgeSummary}"`
    : '(first auto-turn — no prior judge feedback)';

  const hintLine = hint === 'partial'
    ? 'You appear close to done. Wrap up the remaining work and report a clear status.'
    : 'Continue making progress on the goal.';

  return `[goal-loop · auto-turn ${turn}/${budget}]
Goal: ${goal.objective}

${judgeLine}

${hintLine} If the goal is already complete, say so explicitly — the
loop will detect "done" and stop. Use Esc or any user input to
preempt at any time.`;
}

/** Status line surfaced in `/goal status` and the status pill. */
export function buildGoalStatusSummary(goal: Goal): string {
  const elapsed = Math.round(goal.usage.elapsedMs / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.round(elapsed / 60)}m`;
  const tokenStr = goal.usage.tokensUsed > 0 ? ` · ${goal.usage.tokensUsed.toLocaleString()} tok` : '';
  const budgetCap = goal.budget.maxTurns;
  const verdictStr = goal.lastVerdict ? ` · last:${goal.lastVerdict}` : '';
  return `🎯 ${goal.status} · ${goal.usage.turnsUsed}/${budgetCap} turns · ${elapsedStr}${tokenStr}${verdictStr}`;
}
