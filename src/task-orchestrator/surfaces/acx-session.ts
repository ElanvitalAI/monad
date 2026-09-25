/**
 * `surface.kind === 'acx-session'` adapter (AXON P6).
 *
 * Runs a task inside an ACP (AgentClientProtocol) session — either an
 * external agent we drive (claude-code / codex / gemini-cli) or our
 * own server session an IDE has spawned ('monad-self'). The adapter
 * is a thin wrapper around an injected `AcxSessionCallable` that
 * owns the actual DualRoleManager interaction + streaming buffer; the
 * adapter itself handles the dispatcher-level concerns: AbortSignal,
 * model precedence, TaskExecution record shape, error mapping.
 *
 * Pattern mirrors src/task-orchestrator/surfaces/subagent.ts —
 * callable returns { address, done }; adapter records address
 * immediately and awaits `done` for final status + tokens/cost.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
  type AcxAgentBrand,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';

export interface AcxSessionCallable {
  (input: {
    sessionId: string;
    agentBrand: AcxAgentBrand;
    prompt: string;
    model?: string;
    permissionMode?: 'plan' | 'auto' | 'default';
    turn?: number;
    inheritEnv?: boolean;
    signal?: AbortSignal;
  }): Promise<{
    /** `acx:<namespace>:<id>` — e.g. `acx:acp-cli:claude:sess-42` or
     *  `acx:acp-srv:monad-session-7`. Prefix distinguishes the surface
     *  so sidebar / metrics can key off it without re-parsing. */
    address: string;
    done: Promise<{
      status: 'completed' | 'failed' | 'cancelled';
      /** Accumulated text from `agent_message_chunk` updates. */
      output: string;
      /** AcpPromptResult.stopReason as reported by the agent. */
      stopReason?: string;
      tokenUsage?: { input: number; output: number };
      costUsd?: number;
      modelId?: string;
      durationMs: number;
      /** Warp "Last seen by agent at" — from DualRoleManager after
       *  the prompt resolves. Surfaced in execution metadata for the
       *  sidebar. */
      lastSeenAt?: number;
      /** Optional structured error for non-success terminals. Adapter
       *  maps to TaskExecution.error. */
      error?: { code: string; message: string };
    }>;
  }>;
}

export interface AcxSessionAdapterOptions {
  callable: AcxSessionCallable;
  now?: () => number;
}

/**
 * Output tail cap — matches the other surface adapters (subagent /
 * llm-direct / terminal-pane). Long agent turns spill to disk via the
 * DualRoleManager's transcript store (future), but the execution
 * record only keeps the tail to stay queryable.
 */
const OUTPUT_TAIL_BYTES = 4096;

/**
 * Dispatcher adapter factory. Returns a SurfaceAdapter for
 * `kind === 'acx-session'`.
 */
export function createAcxSessionAdapter(opts: AcxSessionAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchAcxSession(
    task: Task,
    ctx: DispatchContext,
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'acx-session') {
      throw new Error(`acx-session adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const model = surface.model ?? ctx.modelHint;
    const exec = createExecution(task, { now: now(), modelId: model });

    let address: string | undefined;
    let donePromise:
      | Promise<{
          status: 'completed' | 'failed' | 'cancelled';
          output: string;
          stopReason?: string;
          tokenUsage?: { input: number; output: number };
          costUsd?: number;
          modelId?: string;
          durationMs: number;
          lastSeenAt?: number;
          error?: { code: string; message: string };
        }>
      | null = null;
    let spawnError: unknown = null;

    try {
      const res = await opts.callable({
        sessionId: surface.sessionId,
        agentBrand: surface.agentBrand,
        prompt: surface.prompt,
        ...(model !== undefined ? { model } : {}),
        ...(surface.permissionMode !== undefined ? { permissionMode: surface.permissionMode } : {}),
        ...(surface.turn !== undefined ? { turn: surface.turn } : {}),
        ...(surface.inheritEnv !== undefined ? { inheritEnv: surface.inheritEnv } : {}),
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
            : {
                code: 'ACX_SPAWN_FAILED',
                message: spawnError instanceof Error ? spawnError.message : String(spawnError),
              },
          ...(address !== undefined ? { surfaceAddress: address } : {}),
          ...(model !== undefined ? { modelId: model } : {}),
        };
      }
      try {
        const r = await donePromise!;
        const end = now();
        const tailedOutput = r.output.slice(-OUTPUT_TAIL_BYTES);
        const effectiveModel = r.modelId ?? model;
        // Abort wins over any self-reported status — the caller asked
        // us to stop. Agent-reported 'cancelled' is also honoured.
        if (r.status === 'cancelled' || ctx.signal?.aborted) {
          return {
            ...exec,
            endedAt: end,
            durationMs: r.durationMs,
            status: 'cancelled',
            error: { code: 'ABORTED', message: 'cancelled by caller' },
            output: tailedOutput,
            ...(address !== undefined ? { surfaceAddress: address } : {}),
            ...(effectiveModel !== undefined ? { modelId: effectiveModel } : {}),
          };
        }
        if (r.status === 'failed') {
          return {
            ...exec,
            endedAt: end,
            durationMs: r.durationMs,
            status: 'failed',
            // Prefer the callable's structured error when supplied
            // (e.g. SERVER_SESSION_NOT_DRIVEABLE / ACX_UNKNOWN_SESSION
            // / ACX_BRAND_MISMATCH / ACX_REENTRANCY / ACX_REFUSAL).
            // Fall back to a generic failure code when omitted.
            error: r.error ?? { code: 'ACX_FAILED', message: 'ACP session reported failure' },
            output: tailedOutput,
            ...(r.tokenUsage !== undefined ? { tokenUsage: r.tokenUsage } : {}),
            ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
            ...(effectiveModel !== undefined ? { modelId: effectiveModel } : {}),
            ...(address !== undefined ? { surfaceAddress: address } : {}),
          };
        }
        return {
          ...exec,
          endedAt: end,
          durationMs: r.durationMs,
          status: 'completed',
          output: tailedOutput,
          ...(r.tokenUsage !== undefined ? { tokenUsage: r.tokenUsage } : {}),
          ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
          ...(effectiveModel !== undefined ? { modelId: effectiveModel } : {}),
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
            : {
                code: 'ACX_PROMPT_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
          ...(address !== undefined ? { surfaceAddress: address } : {}),
          ...(model !== undefined ? { modelId: model } : {}),
        };
      }
    })();

    return { executionId: exec.id, ...(address !== undefined ? { surfaceAddress: address } : {}), promise };
  };
}
