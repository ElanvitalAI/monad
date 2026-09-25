// Node-catalog N2.1 (2026-05-11) — LLM-driven classification.
//
// Wraps `callLLM` with a fixed prompt that asks the model to pick
// exactly one class label out of the supplied list. We post-process
// the response with `pickClass` so a chatty model ("I think it's
// 'class-a'") still resolves to the bare class string. If no class
// can be inferred from the response, the node emits `'unknown'` and
// stays ok=true so downstream `when:` branches can opt into a
// fallback path.

import type {
  ClassifyNode,
  NodeExecContext,
  NodeOutput,
  WorkflowDeps,
} from '../types.js';
import { interpolate } from '../variables.js';

/** Pure: extract the picked class label from a (possibly chatty) LLM
 *  response. Match is case-insensitive substring + word-boundary check
 *  on either the bare class string or a quoted version. Returns
 *  `'unknown'` when nothing matches. Exposed for unit tests. */
export function pickClass(response: string, classes: string[]): string {
  if (!response) return 'unknown';
  const lower = response.toLowerCase();
  for (const c of classes) {
    const cl = c.toLowerCase();
    // Quoted match wins (clearer signal).
    if (lower.includes(`"${cl}"`) || lower.includes(`'${cl}'`)) return c;
  }
  for (const c of classes) {
    const cl = c.toLowerCase();
    const re = new RegExp(`\\b${cl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(lower)) return c;
  }
  return 'unknown';
}

function buildPrompt(node: ClassifyNode, inputText: string): string {
  const classesList = node.classify.classes.map((c) => `- ${c}`).join('\n');
  const hint = node.classify.hint ? `\n\nContext: ${node.classify.hint}` : '';
  return [
    'You are a classifier. Pick exactly ONE class label from the list.',
    'Reply with the bare class string, no quotes, no commentary.',
    'If none clearly fits, reply with the single word: unknown',
    '',
    'Classes:',
    classesList,
    hint,
    '',
    'Input:',
    inputText,
  ].join('\n');
}

/** Pure: sleep helper. Exposed for tests so a fake clock can wrap it. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

export async function executeClassifyNode(
  node: ClassifyNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const { text: inputText } = interpolate(node.classify.input, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  const prompt = buildPrompt(node, inputText);
  // Node-catalog v2 (2026-05-11) — retry wrap. We retry on either a
  // thrown error or an 'unknown' resolution; both signal the LLM
  // didn't commit to a class. Backoff doubles each iteration starting
  // from `retryDelayMs` (default 250ms).
  const retries = node.classify.retries ?? 0;
  const initialDelay = node.classify.retryDelayMs ?? 250;
  let attempt = 0;
  let lastError: string | undefined;
  while (attempt <= retries) {
    try {
      const response = await deps.callLLM({
        prompt,
        ...(ctx.resolvedModel !== undefined ? { model: ctx.resolvedModel } : {}),
        ...(ctx.resolvedProvider !== undefined ? { provider: ctx.resolvedProvider } : {}),
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      });
      const picked = pickClass(response, node.classify.classes);
      if (picked !== 'unknown' || attempt === retries) {
        return {
          ok: true,
          output: picked,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = `attempt ${attempt + 1}: classification resolved to 'unknown'`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        return {
          ok: false,
          output: 'unknown',
          error: lastError,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    attempt++;
    await sleep(initialDelay * 2 ** (attempt - 1), ctx.signal);
  }
  // Unreachable in practice — defensive fallback.
  return {
    ok: true,
    output: 'unknown',
    ...(lastError ? { error: lastError } : {}),
    durationMs: Date.now() - startedAt,
  };
}
