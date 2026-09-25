// ── PFC-S2 generalization: refactor adapter ──
//
// Refactor shares the TaskDecompose proposer path with coding, but
// attaches a baseline-test-preservation constraint so the proposer
// can emit subtasks that each gate on `bun test` passing. Falls back
// to the legacy stub response if no proposer is injected.

import type { Adapter, AdapterResult, ProposedToolCall } from '../types.js';

export const refactorAdapter: Adapter = async (ctx) => {
  const proposer = ctx.proposers?.proposeTaskDecompose;
  if (proposer) {
    try {
      const proposed = await proposer(ctx);
      if (proposed) {
        const enriched: ProposedToolCall = {
          ...proposed,
          input: {
            ...proposed.input,
            constraints: {
              baselineTestsRequired: true,
              maxPrSize: 500,
              ...(proposed.input.constraints as Record<string, unknown> | undefined),
            },
          },
        };
        const result: AdapterResult = {
          kind: 'refactor',
          status: 'proposed',
          adapter: 'refactor-task-decompose',
          proposed: enriched,
          hint:
            `refactor kind → TOX TaskDecompose proposal. `
            + 'baseline-test-preservation 제약이 자동 주입됨 (각 subtask 는 green 유지 필수).',
          extra: { baselineTestsRequired: true, maxPrSize: 500 },
        };
        return result;
      }
    } catch (err) {
      return refactorStub(ctx, `proposer threw: ${String((err as Error).message ?? err)}`);
    }
  }
  return refactorStub(ctx);
};

function refactorStub(
  ctx: Parameters<Adapter>[0],
  proposerError?: string,
): AdapterResult {
  return {
    kind: 'refactor',
    status: 'stub',
    adapter: 'refactor-stub',
    pendingTracks: ['TOX-2', 'AXON-P1'],
    hint:
      'refactor kind: TOX-2 TaskDecompose + AXON P1 랜드 후 완전 자동화. '
      + '지금은 수동 권장: (1) baseline test 기록 · (2) 작은 PR 단위로 '
      + '쪼개기 · (3) 각 PR 마다 green 유지. '
      + `tag 는 feat/${ctx.goalSlug} 권장.`,
    extra: {
      baselineTestsRequired: true,
      maxPrSize: 500,
      ...(proposerError ? { proposerError } : {}),
    },
  };
}
