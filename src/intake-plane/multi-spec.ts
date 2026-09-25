/**
 * `workflow-synth.multi` — Phase 1 / I5 / RESEARCH §4.6 + §6.3.
 *
 * For every task with `workflowEligible === true` (per the I3
 * categorize output), synthesise one workflow YAML in **preview mode**.
 * The pipeline returns a `MultiWorkflowSynthResult` keyed by `taskKey`
 * so I7 preview cards can render N workflows side-by-side and I8
 * register_all can register them in one transaction.
 *
 * Builds on R3 (`src/workflow-synth/index.ts` · #2279). The actual
 * `synthWorkflowFromIntent` call is injected so this module stays
 * hermetic under test. Production wiring passes the real synth callable
 * + `callLLM` dep through `MultiSynthDeps`.
 *
 * D4 skeleton fallback — when synth fails or times out, attach a
 * `skeleton: true` placeholder YAML so the user sees something useful
 * in the preview and can edit / approve. Strict mode opts in to
 * propagating the failure instead.
 */
import type { CategorizeResult, TaskCategorization } from './categorize.js';
import type {
  EnrichedDecomposition,
  EnrichedMission,
  EnrichedTask,
} from './enrich.js';
import { summariseContext } from './enrich.js';
import type { GoalAlignResult, TaskAlignment } from './goal-align.js';
import { taskKey } from './categorize.js';

// ──────────────────── Public shapes ────────────────────────────────────

export interface SingleSynthInput {
  taskKey: string;
  intent: string;
  context: string;
  categorization: TaskCategorization;
  alignment: TaskAlignment;
}

export interface SingleSynthOk {
  ok: true;
  taskKey: string;
  yaml: string;
  workflowName?: string;
  triggerSummary?: string;
  repaired?: boolean;
  skeleton?: false;
}

export interface SingleSynthFallback {
  ok: true;
  taskKey: string;
  yaml: string;
  workflowName: string;
  triggerSummary: 'manual';
  skeleton: true;
  reason: string;
}

export interface SingleSynthFail {
  ok: false;
  taskKey: string;
  error: string;
}

export type SingleSynthResult = SingleSynthOk | SingleSynthFallback | SingleSynthFail;

export interface MultiSynthResult {
  /** All tasks that were workflow-eligible. Index by taskKey to find
   *  the per-task outcome. */
  perTask: Record<string, SingleSynthResult>;
  /** Convenience: count breakdown for the preview banner. */
  counts: { ok: number; skeleton: number; failed: number; skipped: number };
}

export interface SingleSynthCallable {
  (input: SingleSynthInput, opts?: { signal?: AbortSignal }): Promise<
    | { ok: true; yaml: string; workflowName?: string; triggerSummary?: string; repaired?: boolean }
    | { ok: false; error: string }
  >;
}

export interface MultiSynthOptions {
  callable: SingleSynthCallable;
  signal?: AbortSignal;
  /** Max in-flight synthesis calls. Default 3 (workflows are slow). */
  maxConcurrency?: number;
  /** When true, return SingleSynthFail instead of the skeleton fallback
   *  on synth failure. Default false (D4 enabled per HANDOFF §1.2). */
  strict?: boolean;
}

// ──────────────────── Intent assembly ─────────────────────────────────

/** Compose a synthesise-friendly intent for one task. Pure. */
export function buildSingleIntent(
  task: EnrichedTask,
  mission: { id: string; title: string },
  categorization: TaskCategorization,
): { intent: string; context: string } {
  const intent = task.intent || task.title;
  const ctxParts: string[] = [`mission: ${mission.title}`, `category: ${categorization.category}`];
  if (categorization.workflowSkeletonHint) {
    ctxParts.push(`skeletonHint: ${categorization.workflowSkeletonHint}`);
  }
  const enrich = summariseContext(task, 400);
  if (enrich) ctxParts.push('context:\n' + enrich);
  return { intent, context: ctxParts.join('\n') };
}

// ──────────────────── Skeleton fallback (D4) ──────────────────────────

const SKELETON_TEMPLATE = (slug: string, title: string, intent: string) =>
  [
    `# Skeleton fallback — synth failed, edit before approving`,
    `name: ${slug}`,
    `description: "${title.replace(/"/g, '\\"')}"`,
    `nodes:`,
    `  - id: manual-trigger`,
    `    manualTrigger: {}`,
    `  - id: placeholder`,
    `    after: [manual-trigger]`,
    `    note: |`,
    `      ${intent.replace(/\n/g, ' ')}`,
  ].join('\n');

export function skeletonForTask(
  task: EnrichedTask,
  reason: string,
): SingleSynthFallback {
  const slug = task.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'skeleton';
  return {
    ok: true,
    taskKey: '__placeholder__', // filled in by caller
    yaml: SKELETON_TEMPLATE(slug, task.title, task.intent),
    workflowName: slug,
    triggerSummary: 'manual',
    skeleton: true,
    reason,
  };
}

// ──────────────────── Concurrency limiter ─────────────────────────────

function makeLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const q: Array<() => void> = [];
  function next(): void {
    if (active >= max) return;
    const fn = q.shift();
    if (!fn) return;
    active += 1;
    fn();
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };
      q.push(run);
      next();
    });
}

// ──────────────────── Plan ─────────────────────────────────────────────

interface SynthJob {
  taskKey: string;
  task: EnrichedTask;
  mission: EnrichedMission;
  categorization: TaskCategorization;
  alignment: TaskAlignment;
}

export function planMultiSynth(
  decomposition: EnrichedDecomposition,
  categorize: CategorizeResult,
  align: GoalAlignResult,
): { eligible: SynthJob[]; skipped: string[] } {
  const eligible: SynthJob[] = [];
  const skipped: string[] = [];
  for (const mission of decomposition.missions) {
    for (const task of mission.tasks) {
      const key = taskKey(mission.id, task.id);
      const cat = categorize.categorizations[key];
      const al = align.alignments[key];
      if (!cat || !al) {
        skipped.push(key);
        continue;
      }
      if (!cat.workflowEligible) {
        skipped.push(key);
        continue;
      }
      eligible.push({ taskKey: key, task, mission, categorization: cat, alignment: al });
    }
  }
  return { eligible, skipped };
}

// ──────────────────── Public entry ─────────────────────────────────────

export async function synthMultiSpecs(
  decomposition: EnrichedDecomposition,
  categorize: CategorizeResult,
  align: GoalAlignResult,
  opts: MultiSynthOptions,
): Promise<MultiSynthResult> {
  const { eligible, skipped } = planMultiSynth(decomposition, categorize, align);
  const limit = makeLimiter(Math.max(1, opts.maxConcurrency ?? 3));
  const perTask: Record<string, SingleSynthResult> = {};

  await Promise.all(
    eligible.map((job) =>
      limit(async () => {
        const built = buildSingleIntent(job.task, job.mission, job.categorization);
        try {
          const res = await opts.callable(
            {
              taskKey: job.taskKey,
              intent: built.intent,
              context: built.context,
              categorization: job.categorization,
              alignment: job.alignment,
            },
            opts.signal ? { signal: opts.signal } : undefined,
          );
          if (res.ok) {
            const ok: SingleSynthOk = {
              ok: true,
              taskKey: job.taskKey,
              yaml: res.yaml,
              skeleton: false,
            };
            if (res.workflowName !== undefined) ok.workflowName = res.workflowName;
            if (res.triggerSummary !== undefined) ok.triggerSummary = res.triggerSummary;
            if (res.repaired) ok.repaired = true;
            perTask[job.taskKey] = ok;
            return;
          }
          if (opts.strict) {
            perTask[job.taskKey] = { ok: false, taskKey: job.taskKey, error: res.error };
            return;
          }
          const fallback = skeletonForTask(job.task, res.error);
          fallback.taskKey = job.taskKey;
          perTask[job.taskKey] = fallback;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (opts.strict) {
            perTask[job.taskKey] = { ok: false, taskKey: job.taskKey, error: msg };
            return;
          }
          const fallback = skeletonForTask(job.task, msg);
          fallback.taskKey = job.taskKey;
          perTask[job.taskKey] = fallback;
        }
      }),
    ),
  );

  // Counts for the preview banner.
  let okCount = 0;
  let skeletonCount = 0;
  let failedCount = 0;
  for (const row of Object.values(perTask)) {
    if (!row.ok) {
      failedCount += 1;
      continue;
    }
    if (row.skeleton) skeletonCount += 1;
    else okCount += 1;
  }

  return {
    perTask,
    counts: {
      ok: okCount,
      skeleton: skeletonCount,
      failed: failedCount,
      skipped: skipped.length,
    },
  };
}
