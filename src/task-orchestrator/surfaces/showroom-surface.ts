// W4 Z3 · `surface.kind === 'showroom'` adapter.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §4 Z3.
//
// Multi-model cascade (plan → build → review → reflect):
//   - mode='sequential' (default): lane[i].output is appended to lane[i+1] prompt.
//   - mode='parallel'             : every lane runs concurrently against its
//     own model; transcript joins outputs in lane declaration order.
//
// Output convention (single string surfaced to TaskExecution.output):
//   `## <role> · <model>\n<text>\n\n## <role> · <model>\n<text>...`
// Token usage + cost are summed across lanes; modelId is set to the last
// lane's modelId (sequential) or first (parallel) for board attribution.

import {
  createExecution,
  type ShowroomLaneSpec,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface ShowroomLaneInput {
  role: ShowroomLaneSpec['role'];
  model: string;
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface ShowroomLaneOutput {
  text: string;
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  modelId?: string;
}

export interface ShowroomLaneCallable {
  (input: ShowroomLaneInput): Promise<ShowroomLaneOutput>;
}

export interface ShowroomAdapterOptions {
  callable: ShowroomLaneCallable;
  now?: () => number;
  /** Output cap per lane before joining. Default 4096. */
  laneOutputMax?: number;
}

interface LaneRun {
  spec: ShowroomLaneSpec;
  result: ShowroomLaneOutput;
}

function joinTranscript(runs: LaneRun[], cap: number): string {
  return runs
    .map((r) => {
      const head = `## ${r.spec.role} · ${r.result.modelId ?? r.spec.model}`;
      const body = r.result.text.slice(0, cap);
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

function sumUsage(runs: LaneRun[]): { input: number; output: number } | undefined {
  let input = 0;
  let output = 0;
  let saw = false;
  for (const r of runs) {
    if (r.result.tokenUsage) {
      input += r.result.tokenUsage.input;
      output += r.result.tokenUsage.output;
      saw = true;
    }
  }
  return saw ? { input, output } : undefined;
}

function sumCost(runs: LaneRun[]): number | undefined {
  let cost = 0;
  let saw = false;
  for (const r of runs) {
    if (typeof r.result.costUsd === 'number') {
      cost += r.result.costUsd;
      saw = true;
    }
  }
  return saw ? cost : undefined;
}

export function createShowroomAdapter(opts: ShowroomAdapterOptions) {
  const now = opts.now ?? Date.now;
  const laneMax = opts.laneOutputMax ?? 4096;

  return async function dispatchShowroom(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'showroom') {
      throw new Error(`showroom adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const mode = surface.mode ?? 'sequential';
    const headModel = surface.lanes[0]?.model;
    const exec = createExecution(task, { now: now(), modelId: headModel });

    const promise = (async (): Promise<TaskExecution> => {
      try {
        const runs: LaneRun[] = [];
        if (mode === 'sequential') {
          let priorOutput = '';
          for (const lane of surface.lanes) {
            if (ctx.signal?.aborted) throw new Error('aborted');
            const prompt = priorOutput
              ? `${lane.prompt ?? ''}\n\n---\nPrior lane output:\n${priorOutput}`.trim()
              : (lane.prompt ?? surface.title);
            const out = await opts.callable({
              role: lane.role,
              model: lane.model,
              prompt,
              ...(surface.preamble ? { systemPrompt: surface.preamble } : {}),
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            });
            runs.push({ spec: lane, result: out });
            priorOutput = out.text;
          }
        } else {
          const results = await Promise.all(
            surface.lanes.map((lane) => opts.callable({
              role: lane.role,
              model: lane.model,
              prompt: lane.prompt ?? surface.title,
              ...(surface.preamble ? { systemPrompt: surface.preamble } : {}),
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            })),
          );
          for (let i = 0; i < surface.lanes.length; i++) {
            runs.push({ spec: surface.lanes[i]!, result: results[i]! });
          }
        }

        const transcript = joinTranscript(runs, laneMax);
        const finalLane = runs[mode === 'sequential' ? runs.length - 1 : 0];
        const end = now();
        const usage = sumUsage(runs);
        const cost = sumCost(runs);
        return {
          ...exec,
          endedAt: end,
          durationMs: end - exec.startedAt,
          status: 'completed',
          output: transcript.slice(0, 16384),
          ...(usage ? { tokenUsage: usage } : {}),
          ...(typeof cost === 'number' ? { costUsd: cost } : {}),
          modelId: finalLane?.result.modelId ?? finalLane?.spec.model,
        };
      } catch (err) {
        const end = now();
        const aborted = ctx.signal?.aborted;
        return {
          ...exec,
          endedAt: end,
          durationMs: end - exec.startedAt,
          status: aborted ? 'cancelled' : 'failed',
          error: aborted
            ? { code: 'ABORTED', message: 'cancelled by caller' }
            : {
                code: 'SHOWROOM_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
        };
      }
    })();

    return {
      executionId: exec.id,
      surfaceAddress: `showroom:${surface.lanes.length}×${mode}`,
      promise,
    };
  };
}
