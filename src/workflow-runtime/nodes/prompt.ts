// Archon-port T2.1 (2026-05-08) — prompt node executor.
//
// Calls the injected `callLLM`, optionally enforces an output_format
// JSON shape (the LLM's text response is JSON-parsed and returned as
// the node's output for downstream `$node.output.field` access).
//
// Tool roster filtering (T1.1 contract) is not applied here — this
// node currently runs as a "pure prompt" with no tools by design,
// matching Archon's classification-node pattern (allowed_tools: []).
// When workflow nodes later need to expose tools, the policy will be
// passed through `callLLM` via deps. For now the simplification keeps
// the executor stateless.

import type { NodeExecContext, NodeOutput, PromptNode, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executePromptNode(
  node: PromptNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const interpolated = interpolate(node.prompt, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  try {
    const text = await deps.callLLM({
      prompt: interpolated.text,
      ...(ctx.resolvedModel !== undefined ? { model: ctx.resolvedModel } : {}),
      ...(ctx.resolvedProvider !== undefined ? { provider: ctx.resolvedProvider } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      // V2.2-1 (2026-05-12) — forward each partial chunk to the executor's
      // nodeId-bound token sink. When `output_format` is set we still
      // surface the chunks so the consumer can render a typewriter feed
      // even though the final parsed value is JSON.
      ...(ctx.onTokenChunk !== undefined ? { onPartialChunk: ctx.onTokenChunk } : {}),
    });
    // output_format → parse JSON, surface failure as ok=false.
    if (node.output_format) {
      try {
        const parsed = parseJsonLoose(text);
        return { ok: true, output: parsed, durationMs: Date.now() - startedAt };
      } catch (parseErr) {
        return {
          ok: false,
          output: text,
          error: `output_format JSON parse failed: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    return { ok: true, output: text, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

/** LLMs sometimes wrap JSON in code fences. Strip ```json …``` /
 *  ```…``` if present, then JSON.parse. */
function parseJsonLoose(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(s);
}
