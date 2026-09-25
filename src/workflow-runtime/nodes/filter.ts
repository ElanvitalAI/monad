// Node-catalog N3.2 (2026-05-11) — array filter.
//
// Resolves `items` through the same JSON-or-newline-split surface as
// Iteration (N1.3), then keeps only the elements where `condition`
// evaluates true. The condition is handed to `evaluateWhen` with the
// per-element `item` + `index` in context, so authors can filter on
// element content:
//
//   filter: { items: "$collect.output", condition: "$item == 'ok'" }
//   filter: { items: "[1,2,3,4]",       condition: "$index != 0"   }
//   filter: { items: "$users.output",   condition: "$item.role == 'admin'" }
//
// Output is the filtered array (same element types as items).

import type { FilterNode, NodeExecContext, NodeOutput, WorkflowDeps } from '../types.js';
import { evaluateWhen, interpolate } from '../variables.js';
import { resolveIterationItems } from './iteration.js';

export async function executeFilterNode(
  node: FilterNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const interp = interpolate(node.filter.items, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  const items = resolveIterationItems(interp.text);
  if (items.length === 0) {
    return {
      ok: true,
      output: [],
      durationMs: Date.now() - startedAt,
    };
  }
  const kept: unknown[] = [];
  for (let i = 0; i < items.length; i++) {
    const keep = evaluateWhen(node.filter.condition, {
      arguments: ctx.arguments,
      artifactsDir: ctx.artifactsDir,
      outputs: ctx.outputs,
      item: items[i],
      index: i,
    });
    if (keep) kept.push(items[i]);
  }
  return {
    ok: true,
    output: kept,
    durationMs: Date.now() - startedAt,
  };
}
