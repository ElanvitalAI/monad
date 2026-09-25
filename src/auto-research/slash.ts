// ── PFC-S4 P6: /research slash dispatcher ──
//
// Pure decision function: takes the parsed /research input and
// returns a tagged-union outcome describing which ToolRuntime calls
// to chain. The dashboard / UI layer consumes the commands[] and
// invokes dispatchToolByName for each in sequence, stopping on the
// first error.
//
// Keeping this pure (no I/O) makes it trivial to unit-test + lets
// slash / popup / chord bindings all share the same branching logic
// (feedback_pure_decision_fn_reuse pattern).

import type { BudgetSpec } from './budget-meter.js';
import type { TerminationRule } from './termination-dsl.js';

export type ResearchSlashAction =
  | 'start'
  | 'status'
  | 'stop'
  | 'tail'
  | 'replan';

export interface ResearchSlashInput {
  action: ResearchSlashAction;
  goal_slug?: string;
  mission?: string;
  budget?: BudgetSpec;
  termination?: TerminationRule;
  max_turns?: number;
  plan?: string;
  summary?: string;
  reason?: 'manual' | 'termination_met' | 'budget_tripped' | 'max_turns' | 'error';
}

export interface ResearchSlashCommand {
  tool: string;
  input: Record<string, unknown>;
}

export interface ResearchSlashOutcome {
  kind: 'dispatch' | 'error' | 'info';
  commands?: ResearchSlashCommand[];
  message: string;
}

export function resolveResearchSlash(input: ResearchSlashInput): ResearchSlashOutcome {
  switch (input.action) {
    case 'start': return resolveStart(input);
    case 'status': return resolveStatus(input);
    case 'stop': return resolveStop(input);
    case 'tail': return resolveTail(input);
    case 'replan': return resolveReplan(input);
    default:
      return { kind: 'error', message: `/research: unknown action '${String(input.action)}'` };
  }
}

function requireSlug(input: ResearchSlashInput): string | ResearchSlashOutcome {
  if (!input.goal_slug || !input.goal_slug.trim()) {
    return { kind: 'error', message: `/research ${input.action}: goal_slug is required` };
  }
  return input.goal_slug;
}

function resolveStart(input: ResearchSlashInput): ResearchSlashOutcome {
  const slugOrErr = requireSlug(input);
  if (typeof slugOrErr !== 'string') return slugOrErr;
  if (!input.mission || !input.mission.trim()) {
    return { kind: 'error', message: '/research start: mission is required' };
  }
  const initInput: Record<string, unknown> = {
    action: 'init',
    goal_slug: slugOrErr,
    mission: input.mission.trim(),
  };
  if (input.budget) initInput.budget = input.budget;
  if (input.termination) initInput.termination = input.termination;

  const enterInput: Record<string, unknown> = {
    goal_slug: slugOrErr,
  };
  if (input.max_turns) enterInput.max_turns = input.max_turns;
  if (input.termination) enterInput.termination_override = input.termination;

  return {
    kind: 'dispatch',
    commands: [
      { tool: 'research_plan', input: initInput },
      { tool: 'budget', input: { action: 'snapshot', goal_slug: slugOrErr } },
      { tool: 'enter_auto_mode', input: enterInput },
    ],
    message: `/research start: initialised '${slugOrErr}' + entering auto-mode (up to ${input.max_turns ?? 20} turns).`,
  };
}

function resolveStatus(input: ResearchSlashInput): ResearchSlashOutcome {
  const slugOrErr = requireSlug(input);
  if (typeof slugOrErr !== 'string') return slugOrErr;
  return {
    kind: 'dispatch',
    commands: [
      { tool: 'research_plan', input: { action: 'read', goal_slug: slugOrErr } },
      { tool: 'budget', input: { action: 'snapshot', goal_slug: slugOrErr } },
      { tool: 'termination_check', input: { goal_slug: slugOrErr } },
    ],
    message: `/research status: reading '${slugOrErr}'.`,
  };
}

function resolveStop(input: ResearchSlashInput): ResearchSlashOutcome {
  const exitInput: Record<string, unknown> = {
    reason: input.reason ?? 'manual',
  };
  if (input.summary) exitInput.summary = input.summary;
  return {
    kind: 'dispatch',
    commands: [{ tool: 'exit_auto_mode', input: exitInput }],
    message: `/research stop: exiting auto-mode (reason=${exitInput.reason}).`,
  };
}

function resolveTail(input: ResearchSlashInput): ResearchSlashOutcome {
  const slugOrErr = requireSlug(input);
  if (typeof slugOrErr !== 'string') return slugOrErr;
  return {
    kind: 'dispatch',
    commands: [{ tool: 'research_plan', input: { action: 'read', goal_slug: slugOrErr } }],
    message: `/research tail: snapshot of '${slugOrErr}'.`,
  };
}

function resolveReplan(input: ResearchSlashInput): ResearchSlashOutcome {
  const slugOrErr = requireSlug(input);
  if (typeof slugOrErr !== 'string') return slugOrErr;
  if (!input.plan || !input.plan.trim()) {
    return { kind: 'error', message: '/research replan: plan body is required' };
  }
  return {
    kind: 'dispatch',
    commands: [
      {
        tool: 'research_plan',
        input: {
          action: 'update_plan',
          goal_slug: slugOrErr,
          plan: input.plan,
        },
      },
    ],
    message: `/research replan: plan.md replaced (${input.plan.length} chars).`,
  };
}
