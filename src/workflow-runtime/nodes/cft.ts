// Archon-port T2.1 (2026-05-08) — CFT (Critical Failure Tree)
// adapter node.
//
// Wraps the existing CFT methods (dmaic / pdca / fmea / a3 / quick-kill
// / rca …) as DAG-callable nodes. The runtime delegates to the
// injected `deps.runCft(method, config)` so tests can stub without
// pulling in the entire `src/cft/**` graph.
//
// Each CFT method has its own return shape — surfaced as the node's
// `output` directly so downstream `$node.output.field` paths work.

import type { CftNode, NodeExecContext, NodeOutput, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executeCftNode(
  node: CftNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  if (!deps.runCft) {
    return {
      ok: false,
      output: '',
      error: 'cft node requires `deps.runCft` (not wired in this runtime)',
      durationMs: Date.now() - startedAt,
    };
  }
  // Interpolate string values inside config — leaves nested objects/
  // arrays alone (they pass through to the CFT method as-is).
  const interpolatedConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.config ?? {})) {
    if (typeof v === 'string') {
      interpolatedConfig[k] = interpolate(v, {
        arguments: ctx.arguments,
        artifactsDir: ctx.artifactsDir,
        outputs: ctx.outputs,
      }).text;
    } else {
      interpolatedConfig[k] = v;
    }
  }
  try {
    const result = await deps.runCft(node.cft, interpolatedConfig);
    return { ok: true, output: result, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
