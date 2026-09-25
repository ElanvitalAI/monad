// Plan-mode system prompt — Phase WF5.
//
// Injected into every LLM turn while plan mode is active. Redundant
// with the write-gate (gate still blocks non-plan-file edits even
// when the model hasn't read this text), but the prompt keeps the
// model cooperating with the policy instead of repeatedly tripping
// the gate and surfacing errors.
//
// Template variables:
//   {PLAN_FILE_PATH}  — absolute path of the session's plan file

import type { PlanModeState } from './types.js';

const TEMPLATE = `# Plan mode is ACTIVE

The user is currently in plan mode. You MUST NOT make any edits except
to the plan file ({PLAN_FILE_PATH}), run any non-readonly tools, or
otherwise modify the system. This supercedes any other instructions.

## Phase discipline

1. **Explore** — use Read / Grep / Glob to map the relevant code.
   Ask questions ONLY for things the code cannot answer.
2. **Intent** — use AskUserQuestion to clarify goals, scope,
   constraints, and tradeoffs. Prefer one question with 2-4 options
   to a wall of open-ended questions.
3. **Design** — draft the plan by editing {PLAN_FILE_PATH} (only that
   file is writable). Structure:
     • Goal — what the user is trying to achieve
     • Approach — high-level strategy
     • Steps — ordered bullet list (3+ items; else skip plan mode)
     • Risks — edge cases and rollback strategy
     • Test plan — how we verify the change works
4. **Finalize** — call ExitPlanMode when the plan is decision-complete.
   The user sees your plan text and picks:
     (I) implement immediately — you leave plan mode and start edits
     (N) save + fresh session — the plan artifact persists on disk and
         a new session starts with it pre-loaded
     (C) cancel — plan stays active

## Hard rules

- Do NOT call update_plan while in plan mode (that is a progress
  checklist for execution phase; it will be rejected).
- Do NOT ask "should I proceed?" — use ExitPlanMode to hand off.
- Do NOT plan for trivial single-step tasks — exit plan mode and
  just do them.
- Do NOT emit a stale plan; revise as you learn.
- Every answer from AskUserQuestion changes your plan meaningfully —
  if it wouldn't, don't ask it.
`;

export function buildPlanModeSystemPrompt(state: PlanModeState): string {
  if (!state.active) return '';
  return TEMPLATE.replace(/\{PLAN_FILE_PATH\}/g, state.planFilePath);
}

/** Convenience — returns a ready-to-inject LLMMessage[] (0 or 1
 *  entry). Dashboard calls this each turn; when plan mode is
 *  inactive the array is empty so nothing gets prepended. */
export function buildPlanModeSystemMessages(): Array<{ role: 'system'; content: string }> {
  // Dynamic import guard — session module is tiny, no cost to
  // re-load; kept local to avoid a TDZ cycle with system-prompt
  // being imported at module-init time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPlanModeState } = require('./session.js') as typeof import('./session.js');
  const s = getPlanModeState();
  const prompt = buildPlanModeSystemPrompt(s);
  if (!prompt) return [];
  return [{ role: 'system', content: prompt }];
}
