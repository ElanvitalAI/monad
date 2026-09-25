// Wave P4a-2 (presentation) · A3-1 follow-up — attention state aggregator.
//
// Reads three background sources (agent / shell / workflow) plus two
// user-interaction surfaces (plan-mode / AskUserQuestion) and returns a
// small typed flag bag the typed-pill runtime uses to decide whether
// to surface the `· ↓ to view` accent CTA. Pure + stateless — call on
// every pill refresh; the inputs are cheap.
//
// Surface-unification v2.2 V2.2-5 (2026-05-11) — `scheduledJobs` input
// retired (scheduler view 폐기). Recurring work now surfaces as workflow
// runs, so the `workflows` slot already covers it.
//
// Triggers (per PLAN §2 A3-1):
//   needs_input — agent surface attention.level === 'needs-input',
//                 OR an AskUserQuestion modal is open.
//   plan_ready  — plan-mode is active AND the user has authored steps.
//                 (Surfacing the CTA prompts the operator that an
//                 ExitPlanMode decision is waiting.)
//   error       — any shell that exited non-zero / agent attention
//                 level === 'error' / workflow status in {aborted,
//                 error}.

import type { AgentSurfaceState } from '../display/agent-surface.js';
import type { WorkflowRunState } from '../plugin-workflows/types.js';

export interface ShellAttentionLike {
  status: string;
  exitCode?: number | null;
}

export interface BackgroundAttentionInputs {
  /** AgentSurfaceStore.list() snapshot. Empty array when no agents. */
  agents: ReadonlyArray<Pick<AgentSurfaceState, 'attention' | 'status'>>;
  /** ShellRegistry.list() snapshot — only shells that have settled
   *  in a way that signals error are inspected. */
  shells: ReadonlyArray<ShellAttentionLike>;
  /** WorkflowRunner.listRuns() snapshot. */
  workflows: ReadonlyArray<Pick<WorkflowRunState, 'status'>>;
  /** Plan-mode signals — when active + user authored steps the CTA
   *  nudges them to ExitPlanMode. */
  planMode?: { active: boolean; stepCount: number };
  /** Whether the AskUserQuestion modal currently demands input. */
  askUserActive?: boolean;
}

export interface AttentionFlags {
  needsInput: boolean;
  planReady: boolean;
  hasError: boolean;
  /** Convenience — true when any of the three flags fires. The pill
   *  runtime maps this directly to its `attention` option. */
  any: boolean;
}

export function computeBackgroundAttention(
  inputs: BackgroundAttentionInputs,
): AttentionFlags {
  let needsInput = inputs.askUserActive === true;
  let hasError = false;

  for (const a of inputs.agents) {
    if (a.attention?.level === 'needs-input') needsInput = true;
    if (a.attention?.level === 'error') hasError = true;
    if (a.status === 'error') hasError = true;
  }

  for (const s of inputs.shells) {
    if (s.status === 'completed' && typeof s.exitCode === 'number' && s.exitCode !== 0) {
      hasError = true;
    }
    // Killed shells are user-driven; not treated as attention-worthy.
  }

  for (const w of inputs.workflows) {
    if (w.status === 'aborted' || w.status === 'error') hasError = true;
  }

  const planReady = inputs.planMode?.active === true
    && (inputs.planMode?.stepCount ?? 0) > 0;

  const any = needsInput || hasError || planReady;
  return { needsInput, planReady, hasError, any };
}
