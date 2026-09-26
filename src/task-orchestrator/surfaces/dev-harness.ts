/**
 * `surface.kind === 'dev-harness'` adapter — parallel execution line.
 *
 * Each task = one `elanous harness run-detached <payload>` **subprocess**
 * (staged dev-harness P→E→R→D, or a `--domain` executor: web publish /
 * invest research). Mirrors surfaces/self-implement.ts exactly — the only
 * differences are the spawn target (`harness run-detached` vs `self
 * implement`) and the surface fields (objective/domain/target/autoDrive).
 *
 * Why a subprocess: the child derives its harness-space from process.env
 * (`ELANOUS_HARNESS_SPACE_ID`), so N in-process jobs would clobber each
 * other's space marker. A subprocess gets its own env → own space → own
 * screen/log buffer, letting the dispatcher fan out safely.
 *
 * Reuses `dispatchRunDevHarnessDetached`'s proven infra via
 * `encodeDetachedPayload` (zero new subprocess-encoding code). Tests inject
 * a fake spawn so no real subprocess/worktree/deploy side effects occur.
 *
 * Cf. MANUAL-execution-harness-usage-2026-07-22 · dispatch-detached.ts (#24).
 */
import { resolveSpawnElanousBin } from './self-implement.js';
import { createExecution, type Task, type TaskExecution } from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

/** Result of one dev-harness subprocess. */
export interface DevHarnessJobDone {
  /** Process exit code (null when killed by signal). 0 = clean. */
  exitCode: number | null;
  /** Tail of stdout+stderr (kept small for the execution record). */
  output: string;
  /** Structured error for non-zero exits / spawn failure. */
  error?: { code: string; message: string };
}

/** Launch seam. Production wires a `harness run-detached` subprocess (see
 *  `defaultDevHarnessSpawn`); tests inject a fake. Returns immediately with
 *  an `address` + a `done` promise that resolves when the child exits. */
export interface DevHarnessJobSpawn {
  (input: {
    objective: string;
    domain?: string;
    target?: string;
    autoDrive?: string;
    /** ★ G9 P2 — auto-review 라벨 부착 인텐트(rawArgs.auto_review 로 자식에 전파). */
    autoReview?: boolean;
    /** Distinct-per-job harness-space id → own screen/log buffer. */
    spaceId: string;
    signal?: AbortSignal;
  }): {
    /** `dev-harness:<spaceId>` — keyed for `elanous logs --space` / metrics. */
    address: string;
    done: Promise<DevHarnessJobDone>;
  };
}

export interface DevHarnessAdapterOptions {
  spawn: DevHarnessJobSpawn;
  now?: () => number;
}

const OUTPUT_TAIL_BYTES = 4096;

/** Normalise a task id into a filesystem/env-safe space id fragment. */
export function spaceIdForDevHarnessTask(task: Task): string {
  return task.id.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'dev-harness';
}

/** Dispatcher adapter factory. Returns a SurfaceAdapter for `kind === 'dev-harness'`. */
export function createDevHarnessAdapter(opts: DevHarnessAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchDevHarness(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'dev-harness') {
      throw new Error(`dev-harness adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });
    const spaceId = spaceIdForDevHarnessTask(task);

    let address: string | undefined;
    let donePromise: Promise<DevHarnessJobDone> | null = null;
    let spawnError: unknown = null;

    try {
      const res = opts.spawn({
        objective: surface.objective,
        ...(surface.domain !== undefined ? { domain: surface.domain } : {}),
        ...(surface.target !== undefined ? { target: surface.target } : {}),
        ...(surface.autoDrive !== undefined ? { autoDrive: surface.autoDrive } : {}),
        ...(surface.autoReview !== undefined ? { autoReview: surface.autoReview } : {}),
        spaceId,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      address = res.address;
      donePromise = res.done;
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
            : { code: 'DEV_HARNESS_SPAWN_FAILED', message: spawnError instanceof Error ? spawnError.message : String(spawnError) },
          ...(address !== undefined ? { surfaceAddress: address } : {}),
        };
      }
      try {
        const r = await donePromise!;
        const end = now();
        const tailedOutput = r.output.slice(-OUTPUT_TAIL_BYTES);
        if (ctx.signal?.aborted) {
          return {
            ...exec,
            endedAt: end,
            durationMs: end - exec.startedAt,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'cancelled by caller' },
            output: tailedOutput,
            ...(address !== undefined ? { surfaceAddress: address } : {}),
          };
        }
        if (r.exitCode === 0) {
          return {
            ...exec,
            endedAt: end,
            durationMs: end - exec.startedAt,
            status: 'completed',
            output: tailedOutput,
            ...(address !== undefined ? { surfaceAddress: address } : {}),
          };
        }
        return {
          ...exec,
          endedAt: end,
          durationMs: end - exec.startedAt,
          status: 'failed',
          error: r.error ?? { code: 'DEV_HARNESS_FAILED', message: `harness run exited with code ${r.exitCode ?? 'null'}` },
          output: tailedOutput,
          ...(address !== undefined ? { surfaceAddress: address } : {}),
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
            : { code: 'DEV_HARNESS_JOB_FAILED', message: err instanceof Error ? err.message : String(err) },
          ...(address !== undefined ? { surfaceAddress: address } : {}),
        };
      }
    })();

    return {
      executionId: exec.id,
      ...(address !== undefined ? { surfaceAddress: address } : {}),
      promise,
    };
  };
}

/**
 * Production launch seam — spawns `bun bin/elanous.mjs harness run-detached
 * <payload>`. Reuses `encodeDetachedPayload` (dispatch-detached.ts) so the
 * child runs the exact same detached path the daemon uses. Each child gets
 * its own `ELANOUS_HARNESS_SPACE_ID` (distinct space → own screen/log) +
 * `childNestEnv()` (fork-bomb guard) + `ELANOUS_HARNESS_DETACHED=1` (recursion
 * guard → the child runs in-process, not re-delegating). Kept out of the
 * adapter so tests never touch a real subprocess.
 *
 * ⚠️ auto_drive default 'safe' non-interactive: the batch is headless, so
 * HITL confirm fail-closes (no relay) — fine for autonomous parallel jobs
 * (web/invest are gate-free; code PR-open stays fail-closed = safe default).
 */
export function defaultDevHarnessSpawn(): DevHarnessJobSpawn {
  return (input) => {
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const { harnessSpaceEnv, executorRoleEnv } = require('../../harness/harness-space.js') as typeof import('../../harness/harness-space.js');
    const { childNestEnv, getNestDepth, getMaxNestDepth } = require('../../agent/nest-depth.js') as typeof import('../../agent/nest-depth.js');
    const { encodeDetachedPayload } = require('../../harness/dispatch-detached.js') as typeof import('../../harness/dispatch-detached.js');
    const { debug } = require('../../debug/log.js') as typeof import('../../debug/log.js');

    const { bin, source: binSource } = resolveSpawnElanousBin();
    // rawArgs for dev-harness front door (run-detached decodes this).
    const rawArgs: Record<string, unknown> = {
      objective: input.objective,
      auto_drive: input.autoDrive ?? 'safe',
    };
    if (input.domain) rawArgs.domain = input.domain;
    if (input.target) rawArgs.target = input.target;
    // ★ G9 P2(2026-07-25) — auto-review 인텐트를 자식 `harness run-detached` 로 전파(run-detached 가
    //   rawArgs.auto_review 를 읽어 deploy 에서 자기판단 통과 시 라벨 부착). 병렬 실행 라인도 무인 리뷰 진입.
    if (input.autoReview) rawArgs.auto_review = true;
    const payload = encodeDetachedPayload(rawArgs);
    const args = [bin, 'harness', 'run-detached', payload];

    const address = `dev-harness:${input.spaceId}`;
    debug.log('self-dev.spawn', 'launch', {
      spaceId: input.spaceId, address, role: 'executor', kind: 'dev-harness',
      nestDepth: getNestDepth() + 1, maxNest: getMaxNestDepth(),
      domain: input.domain ?? 'code', objective: input.objective.slice(0, 80),
      autoReview: !!input.autoReview, bin, binSource, // ★ 제1원칙 — 무인리뷰 전파 여부 관측(병렬 라인 자기인지).
    });
    const done = new Promise<DevHarnessJobDone>((resolve) => {
      let child: import('node:child_process').ChildProcess;
      try {
        child = spawn('bun', args, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ELANOUS_HARNESS_DETACHED: '1',   // recursion guard — child runs in-process
            ...childNestEnv(),
            ...harnessSpaceEnv('dev-harness', input.spaceId),   // distinct space per job
            ...executorRoleEnv(),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        resolve({ exitCode: null, output: '', error: { code: 'DEV_HARNESS_SPAWN_FAILED', message: err instanceof Error ? err.message : String(err) } });
        return;
      }
      let out = '';
      const onAbort = (): void => { try { child.kill('SIGTERM'); } catch { /* fail-soft */ } };
      if (input.signal) {
        if (input.signal.aborted) onAbort();
        else input.signal.addEventListener('abort', onAbort, { once: true });
      }
      child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (e: Error) => {
        input.signal?.removeEventListener('abort', onAbort);
        resolve({ exitCode: null, output: out, error: { code: 'DEV_HARNESS_SPAWN_FAILED', message: String(e?.message ?? e) } });
      });
      child.on('exit', (code: number | null) => {
        input.signal?.removeEventListener('abort', onAbort);
        resolve({ exitCode: code, output: out });
      });
    });
    return { address, done };
  };
}
