// ── PFC-S2 generalization: analysis adapter ──
//
// Proposes a Skill subprocess invocation (stochastic-consensus · omni-llm
// · etc.) when a proposer is injected; otherwise returns the legacy
// hint stub. Caller owns the actual subprocess spawn — adapter stays
// side-effect-free.

import type { Adapter, AdapterResult } from '../types.js';

export const analysisAdapter: Adapter = async (ctx) => {
  const proposer = ctx.proposers?.proposeSkillInvocation;
  if (proposer) {
    try {
      const proposed = await proposer(ctx);
      if (proposed) {
        const result: AdapterResult = {
          kind: 'analysis',
          status: 'proposed',
          adapter: 'analysis-skill',
          proposed,
          hint:
            `analysis kind → Skill subprocess proposal (${String(proposed.input.skillName ?? proposed.tool)}). `
            + `결과는 Analysis/${ctx.goalSlug}.md 에 저장 권장.`,
          extra: {
            suggestedSkills: [
              'stochastic-multi-agent-consensus',
              'omni-llm',
            ],
          },
        };
        return result;
      }
    } catch (err) {
      return analysisStub(
        ctx,
        `proposer threw: ${String((err as Error).message ?? err)}`,
      );
    }
  }
  return analysisStub(ctx);
};

function analysisStub(
  ctx: Parameters<Adapter>[0],
  proposerError?: string,
): AdapterResult {
  return {
    kind: 'analysis',
    status: 'stub',
    adapter: 'analysis-stub',
    pendingTracks: ['Skill'],
    hint:
      'analysis 는 Skill subprocess 로 권장: Bash 로 '
      + '`~/.claude/skills/stochastic-multi-agent-consensus` 호출 또는 '
      + '`/omni-llm` / `/research` 로 결과 저장 — '
      + `Analysis/${ctx.goalSlug}.md 에 recommendation + alternatives + trade-offs.`,
    extra: {
      suggestedSkills: [
        'stochastic-multi-agent-consensus',
        'omni-llm',
      ],
      ...(proposerError ? { proposerError } : {}),
    },
  };
}
