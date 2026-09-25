/**
 * `surface.kind === 'llm-direct'` adapter.
 *
 * Executes the task's prompt against an LLM model (direct — no
 * subagent wrapping). Captures text output + token usage + cost.
 *
 * Design:
 *   - We **inject** the LLM callable (`LlmDirectCallable`) rather
 *     than hard-import `streamLLM` — this keeps the adapter pure and
 *     mock-friendly in tests, and lets production boot wire the real
 *     `src/llm.ts` implementation once (in `src/index.ts` or equiv).
 *   - Model selection: `task.surface.model` wins; otherwise falls
 *     back to context.modelHint (typically RouteToModel from PFC-S5).
 *     Callable itself resolves default if both are absent.
 *   - AbortSignal: forwarded to the callable; the callable is
 *     expected to propagate into its provider's stream.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

/** Minimal LLM callable — injected. */
export interface LlmDirectCallable {
  (input: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    tokenUsage?: { input: number; output: number };
    costUsd?: number;
    modelId?: string;
  }>;
}

export interface LlmDirectAdapterOptions {
  callable: LlmDirectCallable;
  /** Now override — tests. */
  now?: () => number;
}

export function createLlmDirectAdapter(opts: LlmDirectAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchLlmDirect(
    task: Task,
    ctx: DispatchContext
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'llm-direct') {
      throw new Error(`llm-direct adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const model = surface.model ?? ctx.modelHint;
    const exec = createExecution(task, { now: now(), modelId: model });

    const promise = (async (): Promise<TaskExecution> => {
      try {
        const res = await opts.callable({
          prompt: surface.prompt,
          systemPrompt: surface.systemPrompt,
          model,
          signal: ctx.signal,
        });
        const end = now();
        return {
          ...exec,
          endedAt: end,
          durationMs: end - exec.startedAt,
          status: 'completed',
          output: res.text.slice(0, 4096),
          tokenUsage: res.tokenUsage,
          costUsd: res.costUsd,
          modelId: res.modelId ?? model,
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
                code: 'LLM_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
        };
      }
    })();

    return {
      executionId: exec.id,
      surfaceAddress: model ? `llm:${model}` : undefined,
      promise,
    };
  };
}
