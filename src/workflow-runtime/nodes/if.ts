// Node-catalog N1.1 (2026-05-11) — boolean branch executor.
//
// Reuses the `evaluateWhen` parser (variables.ts) so authors get the
// same expression surface they already use in `when:` clauses. The
// node's output is the literal string `'then'` when the condition
// evaluates true, `'else'` otherwise, so downstream nodes branch via:
//
//   when: $route.output == 'then'
//
// We deliberately keep the runtime decoupled from the visual editor's
// dual-handle convention (Tier E1.2 LR + handle 좌우): the editor can
// bind two source handles to the same `if` node by reading the
// condition string and emitting two `when:` clauses on the wired
// downstream nodes — but that's a graph-rendering concern, not a
// runtime one.

import type { IfNode, NodeExecContext, NodeOutput, WorkflowDeps } from '../types.js';
import { evaluateWhen } from '../variables.js';

export async function executeIfNode(
  node: IfNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  try {
    const result = evaluateWhen(node.if.condition, {
      arguments: ctx.arguments,
      artifactsDir: ctx.artifactsDir,
      outputs: ctx.outputs,
    });
    return {
      ok: true,
      output: result ? 'then' : 'else',
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      output: 'else',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
