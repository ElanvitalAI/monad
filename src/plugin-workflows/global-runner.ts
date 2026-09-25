// ── PX-4 P5: process-wide WorkflowRunner singleton ──
//
// Plugin-host wires one WorkflowRunner at bootstrap so LLM tools
// (WorkflowRun / WorkflowStatus / WorkflowList) can reach a single
// runner across the session. Dispatchers are injected lazily via
// setWorkflowRunnerDispatchers() — this lets host code (which knows
// how to call dispatchAgent / the tool runtime / askUser) configure
// the runner without creating an import cycle up into src/agent or
// src/tool-runtime.
//
// Until dispatchers are installed, steps throw "dispatcher not
// wired" which the runner catches and surfaces as an error onto the
// step state — missions + workflows stay host-agnostic for testing.

import { WorkflowRunner, type WorkflowStepDispatcher } from './runner.js';
import type { WorkflowStepKind } from './types.js';

const STUB_DISPATCHER: WorkflowStepDispatcher = async (step) => {
  throw new Error(
    `workflow step kind '${step.kind}' dispatcher not wired — ` +
    `the host must call setWorkflowRunnerDispatchers() at bootstrap`,
  );
};

let globalRunner: WorkflowRunner | null = null;

/** Lazy factory — constructs the runner with stub dispatchers on
 *  first access so tests that read globalWorkflowRunner without host
 *  bootstrap see a working object. */
export function globalWorkflowRunner(): WorkflowRunner {
  if (!globalRunner) {
    globalRunner = new WorkflowRunner({
      workflowsRoot: process.cwd(),
      pluginId: 'core',
      dispatchers: {
        agent: STUB_DISPATCHER,
        skill: STUB_DISPATCHER,
        tool: STUB_DISPATCHER,
        askUser: STUB_DISPATCHER,
      },
    });
  }
  return globalRunner;
}

/** Install real dispatchers. The host calls this once at bootstrap
 *  after the agent / tool / askUser surfaces are available. Subsequent
 *  calls replace the previous mapping (last-writer-wins), letting
 *  tests swap fakes between assertions. */
export function setWorkflowRunnerDispatchers(
  dispatchers: Partial<Record<WorkflowStepKind, WorkflowStepDispatcher>>,
): void {
  const runner = globalWorkflowRunner();
  for (const k of ['agent', 'skill', 'tool', 'askUser'] as WorkflowStepKind[]) {
    const d = dispatchers[k];
    if (d) (runner as any).opts.dispatchers[k] = d;
  }
}

/** Test seam — reset everything. */
export function resetGlobalWorkflowRunner(): void {
  globalRunner = null;
}
