// Archon-port T2.1 (2026-05-08) — approval (HITL) node executor.
//
// Pauses the workflow until `deps.requestApproval(message)` resolves.
// When `capture_response: true`, the resolved string becomes the
// node's output; otherwise output is the literal `'approved'`.
//
// The approval delegate decides UX (PWA modal, telegram bot, CLI
// readline prompt, etc.). When `deps.requestApproval` is undefined,
// the node fails fast — there's no safe default for "skip the human
// gate" in a generic runtime.

import type { ApprovalNode, NodeExecContext, NodeOutput, WorkflowDeps } from '../types.js';
import { interpolate } from '../variables.js';

export async function executeApprovalNode(
  node: ApprovalNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  if (!deps.requestApproval) {
    return {
      ok: false,
      output: '',
      error: 'approval node requires `deps.requestApproval` (not wired in this runtime)',
      durationMs: Date.now() - startedAt,
    };
  }
  const message = interpolate(node.approval.message, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  }).text;
  try {
    // BACKLOG #4 (2026-05-11) — forward the per-node delivery
    // preference so the Nexus runtime can filter HITL channels (PWA
    // modal vs Pushcut vs Telegram). Defaults to 'all' (race every
    // registered channel · existing behaviour pre-#4).
    const opts: Parameters<NonNullable<typeof deps.requestApproval>>[1] =
      node.approval.delivery !== undefined ? { delivery: node.approval.delivery } : {};
    const response = await deps.requestApproval(message, opts);
    const captured = node.approval.capture_response === true;
    return {
      ok: true,
      output: captured && typeof response === 'string' ? response : 'approved',
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
