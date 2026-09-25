/**
 * `surface.kind === 'vw-slot'` adapter.
 *
 * A virtual-window slot is a UI-driven surface — the task stays
 * `running` until the UI (user interaction, kanban drop, etc.) signals
 * completion via the callable's `done` promise. Mirrors the
 * chat-prompt pattern except the "address" is a pane/slot handle
 * rather than a modal id.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface VwSlotCallable {
  (input: {
    windowId: string;
    slotId: string;
    task: Task;
    signal?: AbortSignal;
  }): Promise<{
    address: string;
    done: Promise<{
      status: 'completed' | 'failed' | 'cancelled';
      output?: string;
      durationMs: number;
    }>;
  }>;
}

export interface VwSlotAdapterOptions {
  callable: VwSlotCallable;
  now?: () => number;
}

export function createVwSlotAdapter(opts: VwSlotAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchVwSlot(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'vw-slot') {
      throw new Error(`vw-slot adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });

    let address: string | undefined;
    let donePromise:
      | Promise<{
          status: 'completed' | 'failed' | 'cancelled';
          output?: string;
          durationMs: number;
        }>
      | null = null;
    let mountError: unknown = null;
    try {
      const res = await opts.callable({
        windowId: surface.windowId,
        slotId: surface.slotId,
        task,
        signal: ctx.signal,
      });
      address = res.address;
      donePromise = res.done;
    } catch (err) {
      mountError = err;
    }

    const promise = (async (): Promise<TaskExecution> => {
      if (mountError) {
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
                code: 'VW_SLOT_MOUNT_FAILED',
                message: mountError instanceof Error ? mountError.message : String(mountError),
              },
          surfaceAddress: address,
        };
      }
      try {
        const r = await donePromise!;
        const end = now();
        if (r.status === 'cancelled' || ctx.signal?.aborted) {
          return {
            ...exec,
            endedAt: end,
            durationMs: r.durationMs,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'cancelled by caller' },
            output: r.output?.slice(-4096),
            surfaceAddress: address,
          };
        }
        return {
          ...exec,
          endedAt: end,
          durationMs: r.durationMs,
          status: r.status,
          output: r.output?.slice(-4096),
          error:
            r.status === 'failed'
              ? { code: 'VW_SLOT_FAILED', message: 'vw-slot reported failure' }
              : undefined,
          surfaceAddress: address,
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
                code: 'VW_SLOT_DONE_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
          surfaceAddress: address,
        };
      }
    })();

    return { executionId: exec.id, surfaceAddress: address, promise };
  };
}
