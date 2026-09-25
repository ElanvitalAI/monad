/**
 * `surface.kind === 'skill'` adapter.
 *
 * Runs an external skill (claude-skills style subprocess) with the
 * task's args. Captures stdout as execution output; non-zero exit →
 * failed.
 *
 * Design: same injection pattern as `llm-direct.ts` — the actual
 * `~/.claude/skills/<name>/SKILL.md` dispatch is provided by a
 * callable so the adapter stays pure / testable.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface SkillCallable {
  (input: {
    skillName: string;
    args?: Record<string, unknown>;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<{
    stdout: string;
    exitCode: number;
    durationMs: number;
  }>;
}

export interface SkillAdapterOptions {
  callable: SkillCallable;
  now?: () => number;
}

export function createSkillAdapter(opts: SkillAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchSkill(
    task: Task,
    ctx: DispatchContext
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'skill') {
      throw new Error(`skill adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });

    const promise = (async (): Promise<TaskExecution> => {
      try {
        const res = await opts.callable({
          skillName: surface.skillName,
          args: surface.args,
          cwd: ctx.cwd,
          signal: ctx.signal,
        });
        const end = now();
        return {
          ...exec,
          endedAt: end,
          durationMs: res.durationMs,
          status: res.exitCode === 0 ? 'completed' : 'failed',
          output: res.stdout.slice(-4096),
          error:
            res.exitCode === 0
              ? undefined
              : { code: `EXIT_${res.exitCode}`, message: `skill exited ${res.exitCode}` },
          surfaceAddress: `skill:${surface.skillName}`,
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
                code: 'SKILL_SPAWN_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
        };
      }
    })();

    return {
      executionId: exec.id,
      surfaceAddress: `skill:${surface.skillName}`,
      promise,
    };
  };
}
