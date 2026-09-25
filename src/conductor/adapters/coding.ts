// ── PFC-S2 generalization: coding adapter ──
//
// Routes to TOX TaskDecompose when a proposer is injected; otherwise
// falls back to the legacy stub response (manual feat-branch hint).
// The adapter itself never invokes side-effecting tools — it returns
// a ready-to-run ProposedToolCall and lets the caller (EnterAutoMode
// · ClassifyGoal tool · CLI) own the actual dispatch.

import type { Adapter, AdapterResult } from '../types.js';

export const codingAdapter: Adapter = async (ctx) => {
  const proposer = ctx.proposers?.proposeTaskDecompose;
  if (proposer) {
    try {
      const proposed = await proposer(ctx);
      if (proposed) {
        const result: AdapterResult = {
          kind: 'coding',
          status: 'proposed',
          adapter: 'coding-task-decompose',
          proposed,
          hint:
            `coding kind → TOX TaskDecompose proposal (apply via TaskDecomposeApply). `
            + `feat/${ctx.goalSlug} 브랜치에 각 task 단위로 landing 권장.`,
          extra: { confidence: ctx.classify.confidence },
        };
        return result;
      }
    } catch (err) {
      // proposer throw 시 stub 으로 fallback — notice 로 상위에 전달
      return codingStub(ctx, `proposer threw: ${String((err as Error).message ?? err)}`);
    }
  }
  return codingStub(ctx);
};

function codingStub(
  ctx: Parameters<Adapter>[0],
  proposerError?: string,
): AdapterResult {
  return {
    kind: 'coding',
    status: 'stub',
    adapter: 'coding-stub',
    pendingTracks: ['TOX-2', 'AXON-P1'],
    hint:
      'coding kind 의 자동 실행은 TOX TaskDecompose + AXON P1 AcpSession 랜드 후 가능. '
      + `지금은 수동으로 feat/${ctx.goalSlug} 브랜치 만들고 작업 권장.`,
    extra: {
      confidence: ctx.classify.confidence,
      ...(proposerError ? { proposerError } : {}),
    },
  };
}
