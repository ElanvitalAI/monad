/**
 * `surface.kind === 'terminal-pane'` adapter.
 *
 * Spawns a terminal pane via an injected callable (production wires
 * `src/terminal-matrix/*.spawn`). Exit code → task status:
 *   - 0          → completed
 *   - non-zero   → failed (`error.code = 'EXIT_<N>'`)
 *   - abort      → cancelled
 *
 * The callable returns immediately with `{address, exit}` so the
 * dispatcher can record the pane address promptly; the full exit
 * payload arrives via `exit` when the pane exits. Stdout tail is
 * kept under 4 KB to match the other adapters.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
  type TerminalSpawnLite,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface TerminalPaneCallable {
  (input: {
    spec: TerminalSpawnLite;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<{
    address: string;
    exit: Promise<{ exitCode: number; stdoutTail: string; durationMs: number }>;
  }>;
}

export interface TerminalPaneAdapterOptions {
  callable: TerminalPaneCallable;
  now?: () => number;
}

export function createTerminalPaneAdapter(opts: TerminalPaneAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchTerminalPane(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'terminal-pane') {
      throw new Error(`terminal-pane adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });

    let address: string | undefined;
    let exitPromise: Promise<{ exitCode: number; stdoutTail: string; durationMs: number }> | null = null;
    let spawnError: unknown = null;
    try {
      const res = await opts.callable({
        spec: surface.spec,
        cwd: ctx.cwd,
        signal: ctx.signal,
      });
      address = res.address;
      exitPromise = res.exit;
    } catch (err) {
      spawnError = err;
    }

    const promise = (async (): Promise<TaskExecution> => {
      if (spawnError) {
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
                code: 'TERMINAL_SPAWN_FAILED',
                message: spawnError instanceof Error ? spawnError.message : String(spawnError),
              },
          surfaceAddress: address,
        };
      }
      try {
        const r = await exitPromise!;
        const end = now();
        const aborted = ctx.signal?.aborted;
        if (aborted) {
          return {
            ...exec,
            endedAt: end,
            durationMs: r.durationMs,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'cancelled by caller' },
            output: r.stdoutTail.slice(-4096),
            surfaceAddress: address,
          };
        }
        const ok = r.exitCode === 0;
        return {
          ...exec,
          endedAt: end,
          durationMs: r.durationMs,
          status: ok ? 'completed' : 'failed',
          output: r.stdoutTail.slice(-4096),
          error: ok
            ? undefined
            : { code: `EXIT_${r.exitCode}`, message: `terminal exited ${r.exitCode}` },
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
                code: 'TERMINAL_EXIT_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
          surfaceAddress: address,
        };
      }
    })();

    return { executionId: exec.id, surfaceAddress: address, promise };
  };
}
