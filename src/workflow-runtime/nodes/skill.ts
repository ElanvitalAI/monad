// Archon-port T2.1 (2026-05-08) — skill node executor.
//
// Delegates to the elanous skill registry via `deps.runSkill(slug, args)`.
// MVP: returns the skill's display string as the node's output. The
// skill executes inside its own `executeSkill` envelope (T1.1 ensures
// its tool roster is filtered by skill manifest's allow/deny).

import type { NodeExecContext, NodeOutput, SkillNode, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executeSkillNode(
  node: SkillNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  if (!deps.runSkill) {
    return {
      ok: false,
      output: '',
      error: 'skill node requires `deps.runSkill` (not wired in this runtime)',
      durationMs: Date.now() - startedAt,
    };
  }
  const args = node.arguments
    ? interpolate(node.arguments, {
        arguments: ctx.arguments,
        artifactsDir: ctx.artifactsDir,
        outputs: ctx.outputs,
      }).text
    : ctx.arguments;
  try {
    const display = await deps.runSkill(node.skill, args);
    return { ok: true, output: display, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
