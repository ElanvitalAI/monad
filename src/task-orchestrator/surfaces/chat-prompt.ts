/**
 * `surface.kind === 'chat-prompt'` adapter.
 *
 * Pops an AskUserQuestion-compatible modal on the dashboard, waits
 * for the user's answer, and records the answer as the execution's
 * output. This is the human-in-the-loop (HITL) gate.
 *
 * The adapter **injects** the actual AskUserQuestion runtime so
 * tests can drive answers synchronously without spinning up the
 * dashboard modal stack.
 */
import {
  createExecution,
  type Task,
  type TaskExecution,
} from '../types.js';
import type { DispatchContext, DispatchResult } from '../surface-registry.js';
import type { ChatPromptSpec } from '../types.js';

/** Matches monad's existing AskUserQuestion runtime shape (loose). */
export interface ChatPromptCallable {
  (input: {
    question: ChatPromptSpec;
    signal?: AbortSignal;
  }): Promise<{
    answers: Record<string, string | string[]>;
    otherText?: string;
    cancelled?: boolean;
  }>;
}

export interface ChatPromptAdapterOptions {
  callable: ChatPromptCallable;
  now?: () => number;
}

export function createChatPromptAdapter(opts: ChatPromptAdapterOptions) {
  const now = opts.now ?? Date.now;

  return async function dispatchChatPrompt(
    task: Task,
    ctx: DispatchContext
  ): Promise<DispatchResult> {
    if (task.surface.kind !== 'chat-prompt') {
      throw new Error(`chat-prompt adapter received wrong kind: ${task.surface.kind}`);
    }
    const surface = task.surface;
    const exec = createExecution(task, { now: now() });

    const promise = (async (): Promise<TaskExecution> => {
      try {
        const res = await opts.callable({
          question: surface.question,
          signal: ctx.signal,
        });
        const end = now();
        if (res.cancelled) {
          return {
            ...exec,
            endedAt: end,
            durationMs: end - exec.startedAt,
            status: 'cancelled',
            error: { code: 'USER_CANCELLED', message: 'user dismissed prompt' },
          };
        }
        return {
          ...exec,
          endedAt: end,
          durationMs: end - exec.startedAt,
          status: 'completed',
          output: JSON.stringify(res.answers) + (res.otherText ? `\nother: ${res.otherText}` : ''),
          surfaceAddress: 'chat-prompt',
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
                code: 'CHAT_PROMPT_FAILED',
                message: err instanceof Error ? err.message : String(err),
              },
        };
      }
    })();

    return {
      executionId: exec.id,
      surfaceAddress: 'chat-prompt',
      promise,
    };
  };
}
