// Node-catalog N3.1 (2026-05-11) — Set / Variable Assigner.
//
// Resolves each field's expression through the standard variable
// surface and emits a JSON object. Output is a `Record<string,
// string>` — downstream nodes read fields via `$set.output.field`.
// Useful for collecting derived values into a single record without
// writing bash + jq.

import type { NodeExecContext, NodeOutput, SetNode, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executeSetNode(
  node: SetNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const result: Record<string, string> = {};
  try {
    for (const [name, expr] of Object.entries(node.set.fields)) {
      const { text } = interpolate(expr, {
        arguments: ctx.arguments,
        artifactsDir: ctx.artifactsDir,
        outputs: ctx.outputs,
      });
      result[name] = text;
    }
    return {
      ok: true,
      output: result,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      output: result,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
