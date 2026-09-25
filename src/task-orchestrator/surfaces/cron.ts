/**
 * `surface.kind === 'cron'` adapter.
 *
 * TOX delegates cron to the existing `src/scheduler/` (Layer A
 * confederate — see ARCHITECTURE-4-tracks.md). The adapter merely
 * *registers* a scheduled job via an injected callable; the registration
 * itself is the task's work, so the execution completes as soon as the
 * scheduler acknowledges.
 *
 * Subsequent firings of the cron job are not TOX tasks — the scheduler
 * will emit fresh TOX tasks via the cron→TOX bridge (future phase).
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface CronCallable {
  (input: {
    scheduleText: string;
    taskId: string;
    signal?: AbortSignal;
  }): Promise<{
    jobRef: string;
    registered: Promise<{ jobRef: string; durationMs: number }>;
  }>;
}

export interface CronAdapterOptions {
  callable: CronCallable;
  now?: () => number;
}

export function createCronAdapter(opts: CronAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchCron(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'cron') {
      throw new Error(`cron adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });

    let jobRef: string | undefined;
    let registeredPromise: Promise<{ jobRef: string; durationMs: number }> | null = null;
    let callError: unknown = null;
    try {
      const res = await opts.callable({
        scheduleText: surface.scheduleText,
        taskId: task.id,
        signal: ctx.signal,
      });
      jobRef = res.jobRef;
      registeredPromise = res.registered;
    } catch (err) {
      callError = err;
    }

    const promise = (async (): Promise<TaskExecution> => {
      if (callError) {
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
                code: 'CRON_REGISTER_FAILED',
                message: callError instanceof Error ? callError.message : String(callError),
              },
          surfaceAddress: jobRef ? `cron:${jobRef}` : undefined,
        };
      }
      try {
        const r = await registeredPromise!;
        const end = now();
        const aborted = ctx.signal?.aborted;
        if (aborted) {
          return {
            ...exec,
            endedAt: end,
            durationMs: r.durationMs,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'cancelled by caller' },
            surfaceAddress: `cron:${r.jobRef}`,
          };
        }
        return {
          ...exec,
          endedAt: end,
          durationMs: r.durationMs,
          status: 'completed',
          output: `registered jobRef=${r.jobRef} schedule="${surface.scheduleText}"`,
          surfaceAddress: `cron:${r.jobRef}`,
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
                code: 'CRON_REGISTER_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
          surfaceAddress: jobRef ? `cron:${jobRef}` : undefined,
        };
      }
    })();

    return {
      executionId: exec.id,
      surfaceAddress: jobRef ? `cron:${jobRef}` : undefined,
      promise,
    };
  };
}
