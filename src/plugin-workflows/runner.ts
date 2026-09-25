// ── PX-4 P4: WorkflowRunner — linear step executor + handoff ──
//
// Each step runs through a dispatcher injected at construction. The
// runner is host-agnostic: in production P5 wires the agent / tool /
// skill / askUser dispatchers to their real implementations; tests
// pass fakes. Output from each step (stringified if needed) is
// written to `.monad/workflows/<workflowId>-<runId>/step-<N>.md` so
// the run artefacts survive restart + are diffable for debugging.
//
// Failure handling (WorkflowStepOnError):
//   retry  — maxRetries attempts then abort
//   skip   — mark step as skipped, continue
//   abort  — stop the run, later steps stay pending (default)
//   ask    — askUserQuestion to decide retry / skip / abort
//
// onError is per-step; the runner default is 'abort' so a plugin
// author must opt into lenient policies explicitly.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  WORKFLOW_DEFAULTS,
  type SkillWorkflow,
  type SkillWorkflowStep,
  type WorkflowStepKind,
  type WorkflowStepOnError,
  type WorkflowRunState,
  type WorkflowStepRunState,
} from './types.js';

// ── Dispatcher injection ───────────────────────────────────────────────

export type WorkflowStepDispatcher = (
  step: SkillWorkflowStep,
  args: Record<string, unknown>,
  runCtx: WorkflowStepRunCtx,
) => Promise<unknown>;

export interface WorkflowStepRunCtx {
  workflowId: string;
  runId: string;
  stepIndex: number;
  abortSignal: AbortSignal;
}

export interface WorkflowRunnerOpts {
  /** Directory under which `.monad/workflows/<wf>-<run>/` sub-dirs
   *  are created. Defaults to `cwd`. Tests pass a tmp dir. */
  workflowsRoot: string;
  dispatchers: Record<WorkflowStepKind, WorkflowStepDispatcher>;
  /** Optional — called after each step finishes (success OR error)
   *  so hosts can persist intermediate state via PluginStateApi. */
  onStepComplete?: (state: WorkflowRunState) => void | Promise<void>;
  /** When askUser is wired to a programmatic handler, provide it here
   *  so dispatchers['askUser'] can delegate. Tests default to skip. */
  onAskUser?: (stepId: string, args: Record<string, unknown>) => Promise<WorkflowStepOnError>;
  pluginId: string;
}

export interface StartRunOpts {
  /** Initial args merged into every step's args (low-precedence;
   *  per-step args override). */
  args?: Record<string, unknown>;
  /** Explicit runId; auto-generated if omitted. */
  runId?: string;
  abortSignal?: AbortSignal;
}

// Wave P4a-1 — runner lifecycle event surface. Hosts subscribe to
// drive real-time UI (typed background pill, manager modal). The
// existing `onStepComplete` callback stays for state persistence
// hosts; `subscribe` is for fan-out observers.
export type WorkflowRunEvent =
  | { type: 'run-start'; state: WorkflowRunState }
  | { type: 'step-complete'; state: WorkflowRunState }
  | { type: 'run-end'; state: WorkflowRunState };

export type WorkflowRunListener = (event: WorkflowRunEvent) => void;

export class WorkflowRunner {
  private runs = new Map<string, {
    state: WorkflowRunState;
    abortCtl: AbortController;
    def: SkillWorkflow;
  }>();
  private listeners = new Set<WorkflowRunListener>();

  constructor(private readonly opts: WorkflowRunnerOpts) {}

  /** Wave P4a-1 — register a lifecycle listener. Returns an
   *  unsubscribe handle. Listener exceptions are swallowed so a
   *  buggy observer can never break the runner's main flow. */
  subscribe(fn: WorkflowRunListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(event: WorkflowRunEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* never break the runner */ }
    }
  }

  async run(def: SkillWorkflow, startOpts: StartRunOpts = {}): Promise<WorkflowRunState> {
    const runId = startOpts.runId ?? randomUUID().slice(0, 8);
    const now = Date.now();
    const state: WorkflowRunState = {
      workflowId: def.id,
      runId,
      pluginId: this.opts.pluginId,
      status: 'running',
      currentStep: 0,
      steps: def.steps.map((s, idx) => ({
        index: idx,
        kind: s.kind,
        stepId: s.id,
        status: 'pending',
      })),
      startedAt: now,
    };
    const abortCtl = new AbortController();
    if (startOpts.abortSignal) {
      startOpts.abortSignal.addEventListener('abort', () => abortCtl.abort(), { once: true });
    }
    this.runs.set(runId, { state, abortCtl, def });
    this.emit({ type: 'run-start', state: structuredClone(state) });

    const runDir = join(this.opts.workflowsRoot, '.monad', 'workflows', `${def.id}-${runId}`);
    ensureDir(runDir);

    const accumulatedArgs: Record<string, unknown> = { ...(startOpts.args ?? {}) };

    for (let i = 0; i < def.steps.length; i++) {
      if (abortCtl.signal.aborted) {
        state.status = 'aborted';
        break;
      }
      state.currentStep = i;
      const step = def.steps[i]!;
      const stepState = state.steps[i]!;
      const stepArgs = { ...accumulatedArgs, ...(step.args ?? {}) };
      const outcome = await this.runStepWithPolicy(step, stepArgs, {
        workflowId: def.id,
        runId,
        stepIndex: i,
        abortSignal: abortCtl.signal,
      }, stepState);
      stepState.endedAt = Date.now();

      if (outcome.status === 'abort') {
        state.status = 'error';
        state.error = outcome.error ?? 'step aborted';
        break;
      }
      if (outcome.status === 'skip') {
        stepState.status = 'skipped';
        await this.opts.onStepComplete?.(state);
        this.emit({ type: 'step-complete', state: structuredClone(state) });
        continue;
      }
      // status = 'done'
      stepState.status = 'done';
      stepState.output = outcome.outputText ?? '';
      if (outcome.outputText !== undefined) {
        const filename = step.handoff?.outputPath ?? `step-${i + 1}.md`;
        const outPath = join(runDir, filename);
        safeWrite(outPath, outcome.outputText);
        stepState.outputPath = outPath;
        if (step.handoff?.passToNext) {
          for (const k of step.handoff.passToNext) {
            accumulatedArgs[k] = outcome.outputText;
          }
        }
      }
      await this.opts.onStepComplete?.(state);
      this.emit({ type: 'step-complete', state: structuredClone(state) });
    }

    state.endedAt = Date.now();
    if (state.status === 'running') state.status = 'done';
    await this.opts.onStepComplete?.(state);
    this.emit({ type: 'run-end', state: structuredClone(state) });
    return structuredClone(state);
  }

  async status(runId: string): Promise<WorkflowRunState | null> {
    const rec = this.runs.get(runId);
    return rec ? structuredClone(rec.state) : null;
  }

  abort(runId: string, reason?: string): void {
    const rec = this.runs.get(runId);
    if (!rec) return;
    rec.abortCtl.abort();
    if (rec.state.status === 'running') {
      rec.state.status = 'aborted';
      if (reason) rec.state.error = reason;
      rec.state.endedAt = Date.now();
      this.emit({ type: 'run-end', state: structuredClone(rec.state) });
    }
  }

  /** Testing helper — list all runs (live + finished). */
  listRuns(): WorkflowRunState[] {
    return [...this.runs.values()].map(r => structuredClone(r.state));
  }

  /** Testing helper — forget everything. */
  clear(): void {
    this.runs.clear();
  }

  private async runStepWithPolicy(
    step: SkillWorkflowStep,
    args: Record<string, unknown>,
    runCtx: WorkflowStepRunCtx,
    stepState: WorkflowStepRunState,
  ): Promise<{ status: 'done' | 'skip' | 'abort'; outputText?: string; error?: string }> {
    const onError = step.onError ?? WORKFLOW_DEFAULTS.onError;
    const maxRetries = step.maxRetries ?? WORKFLOW_DEFAULTS.maxRetries;
    stepState.status = 'running';
    stepState.startedAt = Date.now();

    let attempt = 0;
    let lastError: string | undefined;
    while (attempt <= (onError === 'retry' ? maxRetries : 0)) {
      attempt += 1;
      try {
        const result = await this.dispatch(step, args, runCtx);
        // Success — record retries as (attempt - 1) so a first-try
        // success = 0 retries, second-try = 1, etc. Skip when no
        // retry policy to avoid noise on default 'abort' steps.
        if (onError === 'retry' && attempt > 1) {
          stepState.retries = attempt - 1;
        }
        return { status: 'done', outputText: coerceOutput(result) };
      } catch (err) {
        lastError = (err as Error).message ?? String(err);
        stepState.error = lastError;
        if (onError === 'retry' && attempt <= maxRetries) continue;
        break;
      }
    }
    // Exhausted attempts — set retries = total retry count
    // (attempt - 1 because attempt 1 is the initial try).
    if (onError === 'retry') {
      stepState.retries = Math.max(0, attempt - 1);
    }

    // Failure branch — decide policy action.
    if (onError === 'skip') return { status: 'skip' };
    if (onError === 'ask') {
      const decision = await (this.opts.onAskUser?.(step.id, args) ?? Promise.resolve('abort' as WorkflowStepOnError));
      if (decision === 'skip') return { status: 'skip' };
      if (decision === 'retry') {
        // One extra attempt, then abort.
        try {
          const result = await this.dispatch(step, args, runCtx);
          return { status: 'done', outputText: coerceOutput(result) };
        } catch (err) {
          return { status: 'abort', error: (err as Error).message ?? lastError };
        }
      }
      return { status: 'abort', error: lastError };
    }
    return { status: 'abort', error: lastError };
  }

  private dispatch(
    step: SkillWorkflowStep,
    args: Record<string, unknown>,
    runCtx: WorkflowStepRunCtx,
  ): Promise<unknown> {
    const dispatcher = this.opts.dispatchers[step.kind];
    if (!dispatcher) {
      return Promise.reject(new Error(`no dispatcher registered for kind '${step.kind}'`));
    }
    return dispatcher(step, args, runCtx);
  }
}

function coerceOutput(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

function ensureDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

function safeWrite(path: string, text: string): void {
  try { writeFileSync(path, text, 'utf-8'); } catch { /* swallow — run state still has the output string */ }
}
