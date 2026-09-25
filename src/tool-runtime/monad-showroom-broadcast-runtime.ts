// PLAN-codex-app-server-hermes-parity §5 Phase H1·6a (2026-05-16) —
// `monad_showroom_broadcast` MCP tool. Codex turn calls this with a
// prompt + backend list; the daemon fans the prompt to each backend
// in parallel, accumulates assistant text per backend, and returns
// the synthesised results. Codex can then weigh the differing
// responses (e.g. multi-LLM second-opinion) without leaving its turn.
//
// Backed by `src/showroom/daemon-broadcast.ts`'s `broadcastToBackends`
// which sits on top of `globalAcpAgentManager()`. The MCP tool is a
// thin shape adapter — args parse, default backends, output framing.

import {
  broadcastToBackends,
  type BroadcastInvocation,
  type BroadcastResult,
} from '../showroom/daemon-broadcast.js';
import type { LLMToolSpec } from '../llm.js';
import type { ToolRuntime } from './types.js';

export interface MonadShowroomBroadcastArgs {
  /** Prompt sent to every backend. Required. */
  prompt?: string;
  /** Backend ids. Default `['claude', 'gemini', 'grok']` — three
   *  diverse external LLMs without monad-builtin (which codex itself
   *  effectively is). */
  backends?: ReadonlyArray<string>;
  /** Working directory for each spawned agent. Default daemon cwd. */
  cwd?: string;
  /** Per-backend wall-clock cap (ms). Default 120000. */
  timeoutMs?: number;
}

export type MonadShowroomBroadcastResult = BroadcastResult & {
  /** LLM-facing one-line summary. */
  output: string;
} & Record<string, unknown>;

const DEFAULT_BACKENDS: ReadonlyArray<string> = ['claude', 'gemini', 'grok'];

export function buildMonadShowroomBroadcastTool(): LLMToolSpec {
  return {
    name: 'monad_showroom_broadcast',
    description:
      'Send the same prompt to multiple LLM backends (claude · gemini · grok by default) in parallel and return per-backend responses. Use for multi-LLM second-opinion / synthesis inside a codex turn. Each backend gets its own ACP session; results are isolated (one wedged backend does not poison the others).',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Prompt sent verbatim to every backend.',
        },
        backends: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Backend ids. Default ['claude','gemini','grok']. Valid ids: monad-builtin, codex-app-server, claude, gemini, grok.",
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the spawned agents (default daemon cwd).',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Per-backend wall-clock cap in ms (default 120000).',
          minimum: 1000,
          maximum: 600000,
        },
      },
      additionalProperties: false,
    },
  };
}

/** `opts.broadcaster` lets tests swap the heavy backend-spawning
 *  `broadcastToBackends` for a deterministic stub. Production callers
 *  omit. */
export async function dispatchMonadShowroomBroadcast(
  args: MonadShowroomBroadcastArgs = {},
  opts: {
    broadcaster?: (invocation: BroadcastInvocation) => Promise<BroadcastResult>;
  } = {},
): Promise<MonadShowroomBroadcastResult> {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (prompt.length === 0) {
    return {
      output: '(prompt required)',
      prompt: '',
      targets: [],
      okCount: 0,
      failCount: 0,
    };
  }
  const backends =
    Array.isArray(args.backends) && args.backends.length > 0
      ? args.backends.filter((b) => typeof b === 'string' && b.length > 0)
      : DEFAULT_BACKENDS;
  if (backends.length === 0) {
    return {
      output: '(no valid backends specified)',
      prompt,
      targets: [],
      okCount: 0,
      failCount: 0,
    };
  }
  const broadcaster = opts.broadcaster ?? broadcastToBackends;
  const invocation: BroadcastInvocation = {
    prompt,
    backends,
    ...(typeof args.cwd === 'string' && args.cwd.length > 0 ? { cwd: args.cwd } : {}),
    ...(typeof args.timeoutMs === 'number' && args.timeoutMs > 0
      ? { timeoutMs: args.timeoutMs }
      : {}),
  };
  const result = await broadcaster(invocation);
  const summary =
    result.okCount === result.targets.length
      ? `${result.targets.length}/${result.targets.length} backends responded`
      : `${result.okCount}/${result.targets.length} backends responded (${result.failCount} failed)`;
  return {
    output: summary,
    ...result,
  };
}

export const monadShowroomBroadcastRuntime: ToolRuntime<
  MonadShowroomBroadcastArgs,
  MonadShowroomBroadcastResult
> = {
  id: 'monad_showroom_broadcast',
  spec: buildMonadShowroomBroadcastTool(),
  async run(req) {
    return dispatchMonadShowroomBroadcast(req);
  },
};
