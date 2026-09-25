// PFC-S3 / W9 Y5 · RetrospectiveCard — KGS shared retro schema.
// Cf. ROADMAP-background-reasoning-patcher-thinker §6 Y5.

import type { ThinkerOutput } from '../background-reasoning/thinker-tasks/types.js';

export type RetrospectiveOutcome = 'success' | 'partial' | 'fail' | 'mixed';

export type RootCauseCategory =
  | 'process'        // process / workflow
  | 'people'         // skill, communication
  | 'technology'     // bug, tooling, infra
  | 'environment'    // outside factor (deps, weather, market)
  | 'unknown';

export interface RetrospectiveAction {
  /** 1-line action description. */
  action: string;
  /** Owner — '@self' for monad to retry, otherwise user/team handle. */
  owner: string;
  /** Optional deadline ISO. */
  due?: string;
}

export interface RetrospectiveCard {
  /** KGS kind v2 = 'retrospective'. */
  kind: 'retrospective';
  /** Stable id (run id · session id · synthesized) used as KGS card id. */
  refId: string;
  /** Where the retro came from. */
  source: 'workflow_run' | 'mission' | 'thinker_synth' | 'manual';
  outcome: RetrospectiveOutcome;
  summary: string;
  lessons: string[];
  improvements: string[];
  rootCause?: { category: RootCauseCategory; note: string };
  actions: RetrospectiveAction[];
  /** Free-form metric tally (`failure_demand_count`, `cycle_time_ms`...). */
  metrics?: Record<string, number>;
  createdAt: number;
  /** Optional cross-reference back to other KGS cards. */
  links?: string[];
}

export interface RetroFromWorkflowInput {
  runId: string;
  workflowName: string;
  ok: boolean;
  summary: string;
  lessons: string[];
  improvements: string[];
  createdAt: number;
}

export function retroCardFromWorkflowRun(input: RetroFromWorkflowInput): RetrospectiveCard {
  return {
    kind: 'retrospective',
    refId: input.runId,
    source: 'workflow_run',
    outcome: input.ok ? 'success' : 'fail',
    summary: input.summary,
    lessons: input.lessons,
    improvements: input.improvements,
    actions: input.improvements.map((imp) => ({ action: imp, owner: '@self' })),
    createdAt: input.createdAt,
    links: [`workflow_run:${input.workflowName}:${input.runId}`],
  };
}

export function retroCardFromThinkerOutput(
  out: Extract<ThinkerOutput, { kind: 'cross_workflow_pattern' | 'prompt_patch' }>,
  refId: string,
  createdAt: number,
): RetrospectiveCard {
  if (out.kind === 'cross_workflow_pattern') {
    return {
      kind: 'retrospective',
      refId,
      source: 'thinker_synth',
      outcome: 'mixed',
      summary: `Cross-workflow pattern across ${out.affected.length} workflow(s)`,
      lessons: [out.suggestion],
      improvements: [out.suggestion],
      actions: out.affected.map((wf) => ({ action: `Apply pattern to '${wf}'`, owner: '@self' })),
      createdAt,
      links: out.affected.map((wf) => `workflow:${wf}`),
    };
  }
  return {
    kind: 'retrospective',
    refId,
    source: 'thinker_synth',
    outcome: 'partial',
    summary: `Prompt patch proposed for ${out.target} '${out.targetName}'`,
    lessons: [out.rationale],
    improvements: [out.patch.slice(0, 256)],
    actions: [{ action: `Review prompt_patch for ${out.target}/${out.targetName}`, owner: '@self' }],
    rootCause: { category: 'process', note: out.rationale.slice(0, 256) },
    createdAt,
    links: [`${out.target}:${out.targetName}`],
  };
}
