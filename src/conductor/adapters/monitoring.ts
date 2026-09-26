// ── PFC-S2 generalization: monitoring adapter ──
//
// Proposes a workflow-runtime Schedule-Trigger workflow when a
// proposer is injected; otherwise returns the workflow-synth stub
// hint. The adapter never registers a workflow directly — the caller
// owns side-effects.
//
// Scheduler-retirement R1 (2026-05-11): replaced `scheduler_create`
// recommendations with `workflow.synth_from_intent` (R3) +
// `elanous wf` flow. The `proposeScheduledJob` proposer hook name is
// retained for backward compatibility, but emits a workflow proposal.

import type { Adapter, AdapterResult } from '../types.js';

export const monitoringAdapter: Adapter = async (ctx) => {
  const proposer = ctx.proposers?.proposeScheduledJob;
  if (proposer) {
    try {
      const proposed = await proposer(ctx);
      if (proposed) {
        const result: AdapterResult = {
          kind: 'monitoring',
          status: 'proposed',
          adapter: 'monitoring-workflow-synth',
          proposed,
          hint:
            `monitoring kind → workflow-runtime synth proposal. `
            + `호출자가 workflow.synth_from_intent({intent: '...'}) 또는 \`elanous wf register\` 로 실제 등록.`,
          extra: { suggestedTool: 'workflow.synth_from_intent' },
        };
        return result;
      }
    } catch (err) {
      return monitoringStub(
        ctx,
        `proposer threw: ${String((err as Error).message ?? err)}`,
      );
    }
  }
  return monitoringStub(ctx);
};

function monitoringStub(
  ctx: Parameters<Adapter>[0],
  proposerError?: string,
): AdapterResult {
  return {
    kind: 'monitoring',
    status: 'stub',
    adapter: 'monitoring-stub',
    pendingTracks: ['workflow-runtime'],
    hint:
      'monitoring kind: workflow-runtime Schedule Trigger 로 등록 권장. '
      + `예: workflow.synth_from_intent({intent: '매일 9시에 ${ctx.goalSlug} 점검'}) 또는 \`elanous wf register <file>\`. `
      + 'Conductor ↔ workflow-runtime 자동 연동은 R3 자연어 합성 land 후.',
    extra: {
      suggestedTool: 'workflow.synth_from_intent',
      ...(proposerError ? { proposerError } : {}),
    },
  };
}
