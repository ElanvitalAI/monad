// Node-catalog N1.2 (2026-05-11) — N-way branch executor.
//
// Interpolates the `value` expression through the shared variable
// surface (`$ARGUMENTS`, `$<id>.output(.field)?`) and matches the
// resolved string against the cases list. First match wins; no match
// falls through to the literal `'default'` string. Downstream nodes
// branch via:
//
//   when: $route.output == 'case-a'   // or == 'default'

import type { NodeExecContext, NodeOutput, SwitchNode, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executeSwitchNode(
  node: SwitchNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  try {
    const { text } = interpolate(node.switch.value, {
      arguments: ctx.arguments,
      artifactsDir: ctx.artifactsDir,
      outputs: ctx.outputs,
    });
    const matched = node.switch.cases.find((c) => c === text);
    return {
      ok: true,
      output: matched ?? 'default',
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      output: 'default',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
