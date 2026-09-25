// ── PX-4 P1: skill-workflow types ──
//
// *Skill workflow* is a linear sequence of steps that the WorkflowRunner
// (P4) executes: tool → agent → skill → askUser. Each step's output
// can hand off to the next through a markdown file under
// `.monad/workflows/<workflowId>-<runId>/step-<N>.md`.
//
// Naming collision notice: `src/scheduler/workflow-*.ts` already
// owns the term "workflow" for general task graphs. This PX-4 surface
// is deliberately in a SEPARATE subdirectory (`src/plugin-workflows/`)
// and uses the `SkillWorkflow*` type prefix to avoid collision. The
// manifest key (`contributes.workflows[]`) stays conventional because
// that's what plugin authors expect.
//
// Activation paths (PX-4 scope — only #2 is implemented; others are
// schema-only for now):
//   1. Keyword trigger     → PX-5 routes picks it up
//   2. LLM tool WorkflowRun → explicit invocation (THIS session)
//   3. Mission onKeepRun   → PX-5 follow-up wiring

/** Plugin capability to register + run skill workflows. See
 *  MISSION_CAPABILITY for the trust-tier pattern. */
export const WORKFLOW_CAPABILITY = 'workflow:run' as const;

export type WorkflowStepKind =
  | 'agent'     // dispatchAgent({ subagent_type, prompt, ... })
  | 'skill'     // skill dispatch — subprocess or plugin-contributed
  | 'tool'      // LLM tool (Bash / Read / Write ...) direct invoke
  | 'askUser';  // askUserQuestion for explicit human-in-the-loop

/** Onerror policy for a single step. Applied by WorkflowRunner when
 *  the step's dispatcher throws or returns a non-zero exit. */
export type WorkflowStepOnError =
  | 'retry'  // re-invoke up to maxRetries (default 1)
  | 'skip'   // mark step as skipped, continue to next
  | 'abort'  // stop the run; later steps stay pending
  | 'ask';   // askUserQuestion to decide retry / skip / abort

export interface SkillWorkflowStep {
  kind: WorkflowStepKind;
  /** Step target id:
   *    kind='agent'  → AgentDefinition.name (subagent_type)
   *    kind='skill'  → skill name (e.g. 'omni-digest')
   *    kind='tool'   → LLM tool name (e.g. 'Bash')
   *    kind='askUser'→ question id (ui-facing label)         */
  id: string;
  args?: Record<string, unknown>;
  handoff?: WorkflowStepHandoff;
  onError?: WorkflowStepOnError;
  /** Only meaningful when onError='retry'. Clamped to [0, 5]. */
  maxRetries?: number;
  description?: string;
}

export interface WorkflowStepHandoff {
  /** Relative filename under .monad/workflows/<wf>-<runId>/
   *  — default is `step-<N>.md` (1-indexed). Plugin authors set this
   *  only when they want a domain-specific name. */
  outputPath?: string;
  /** List of next-step arg keys the step's output string is copied
   *  into. Example: passToNext: ['context'] → next step's args gets
   *  { context: "<previous output>" }. Shallow merge; existing keys
   *  are overwritten. */
  passToNext?: string[];
}

export interface SkillWorkflow {
  id: string;
  name: string;
  /** Reserved — PX-5 routes hook matches these keywords. Parser
   *  accepts the field so manifests stay forward-compatible; the
   *  actual trigger plumbing lands in px-routes-keywords. */
  triggers?: string[];
  /** Short human-readable hint shown in UIs listing available
   *  workflows (e.g. a future `/workflows` slash command). */
  argumentHint?: string;
  steps: SkillWorkflowStep[];
  description?: string;
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'aborted';

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'error';

export interface WorkflowStepRunState {
  index: number;                // 0-based, matches definition.steps
  kind: WorkflowStepKind;
  stepId: string;
  status: WorkflowStepStatus;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  outputPath?: string;
  error?: string;
  retries?: number;             // filled when retry policy fires
}

/** Persisted per-run state. Key under plugin-state:
 *    workflow:<workflowId>:run-<runId>   (scope: project)          */
export interface WorkflowRunState {
  workflowId: string;
  runId: string;
  pluginId: string;
  status: WorkflowRunStatus;
  currentStep: number;          // index of the step currently running
                                // or the last one that finished.
  steps: WorkflowStepRunState[];
  startedAt: number;
  endedAt?: number;
  error?: string;
}

/** Default values applied by the parser so the runtime never sees
 *  undefined. Exposed for tests. */
export const WORKFLOW_DEFAULTS = {
  onError: 'abort' as const,
  maxRetries: 1,
  maxRetriesCeiling: 5,
  maxStepsPerWorkflow: 32,
} as const;
