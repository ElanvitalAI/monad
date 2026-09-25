// ── PFC-S2 P2-P4: Conductor adapter proposer paths ──
//
// Verifies that when an AdapterProposers impl is injected via
// RouterDeps.proposers, the 4 stub adapters (coding / refactor /
// monitoring / analysis) return status='proposed' with a concrete
// ProposedToolCall. Stub fallback remains the default (no proposer
// injected) — covered by test/conductor-routing.test.ts.

import { describe, expect, test } from 'bun:test';
import { dispatchGoalKind } from '../src/conductor/dispatch';
import { codingAdapter } from '../src/conductor/adapters/coding';
import { refactorAdapter } from '../src/conductor/adapters/refactor';
import { monitoringAdapter } from '../src/conductor/adapters/monitoring';
import { analysisAdapter } from '../src/conductor/adapters/analysis';
import type {
  AdapterProposers,
  ClassifyResult,
  ProposedToolCall,
  RoutingContext,
} from '../src/conductor/types';

const baseClassify = (kind: ClassifyResult['kind']): ClassifyResult => ({
  kind,
  confidence: 0.9,
  classifier: 'heuristic',
  keywordHits: { research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0 },
  scores: { research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0 },
});

const ctxFor = (
  kind: ClassifyResult['kind'],
  goalSlug = 'test-goal',
  proposers?: AdapterProposers,
): RoutingContext => ({
  goalSlug,
  intake: { raw: 'test intake' },
  classify: baseClassify(kind),
  proposers,
});

const taskDecomposeProposal: ProposedToolCall = {
  tool: 'TaskDecompose',
  input: { objective: 'mock objective', goalSlug: 'test-goal', maxTasks: 5 },
  rationale: 'mock rationale',
};

const schedulerProposal: ProposedToolCall = {
  tool: 'scheduler_create',
  input: { name: 'test-goal', schedule: '0 9 * * *', prompt: 'mock prompt' },
  rationale: 'daily morning run',
};

const skillProposal: ProposedToolCall = {
  tool: 'skill',
  input: { skillName: 'stochastic-multi-agent-consensus', prompt: 'mock prompt' },
  rationale: 'multi-agent consensus 권장',
};

describe('codingAdapter — proposer path', () => {
  test('returns status=proposed with TaskDecompose spec when proposer injected', async () => {
    const proposers: AdapterProposers = {
      proposeTaskDecompose: async () => taskDecomposeProposal,
    };
    const r = await codingAdapter(ctxFor('coding', 'slack-handler', proposers));
    expect(r.status).toBe('proposed');
    expect(r.adapter).toBe('coding-task-decompose');
    expect(r.proposed?.tool).toBe('TaskDecompose');
    expect(r.proposed?.input.objective).toBe('mock objective');
    expect(r.pendingTracks).toBeUndefined();
  });

  test('proposer returns null → falls back to stub', async () => {
    const proposers: AdapterProposers = {
      proposeTaskDecompose: async () => null,
    };
    const r = await codingAdapter(ctxFor('coding', 'x', proposers));
    expect(r.status).toBe('stub');
    expect(r.adapter).toBe('coding-stub');
  });

  test('proposer throws → stub fallback with proposerError extra', async () => {
    const proposers: AdapterProposers = {
      proposeTaskDecompose: async () => {
        throw new Error('llm timeout');
      },
    };
    const r = await codingAdapter(ctxFor('coding', 'x', proposers));
    expect(r.status).toBe('stub');
    expect((r.extra as { proposerError?: string }).proposerError).toContain('llm timeout');
  });

  test('no proposer injected → legacy stub preserved', async () => {
    const r = await codingAdapter(ctxFor('coding'));
    expect(r.status).toBe('stub');
    expect(r.pendingTracks).toContain('TOX-2');
  });
});

describe('refactorAdapter — proposer path', () => {
  test('enriches proposal with baseline-test constraint', async () => {
    const proposers: AdapterProposers = {
      proposeTaskDecompose: async () => taskDecomposeProposal,
    };
    const r = await refactorAdapter(ctxFor('refactor', 'rf-split', proposers));
    expect(r.status).toBe('proposed');
    expect(r.adapter).toBe('refactor-task-decompose');
    const constraints = r.proposed?.input.constraints as Record<string, unknown>;
    expect(constraints.baselineTestsRequired).toBe(true);
    expect(constraints.maxPrSize).toBe(500);
  });

  test('legacy stub when no proposer', async () => {
    const r = await refactorAdapter(ctxFor('refactor'));
    expect(r.status).toBe('stub');
    expect((r.extra as { baselineTestsRequired?: boolean }).baselineTestsRequired).toBe(true);
  });
});

describe('monitoringAdapter — proposer path (scheduler retirement R1)', () => {
  // Scheduler-retirement ROADMAP §R1 (2026-05-11): adapter now
  // recommends `workflow.synth_from_intent` instead of `scheduler_create`.
  test('returns workflow-synth proposal when proposer injected', async () => {
    const proposers: AdapterProposers = {
      proposeScheduledJob: async () => schedulerProposal,
    };
    const r = await monitoringAdapter(ctxFor('monitoring', 'dram-daily', proposers));
    expect(r.status).toBe('proposed');
    expect(r.adapter).toBe('monitoring-workflow-synth');
    expect((r.extra as { suggestedTool?: string }).suggestedTool).toBe('workflow.synth_from_intent');
  });

  test('legacy stub preserved when no proposer', async () => {
    const r = await monitoringAdapter(ctxFor('monitoring'));
    expect(r.status).toBe('stub');
    expect((r.extra as { suggestedTool?: string }).suggestedTool).toBe('workflow.synth_from_intent');
  });
});

describe('analysisAdapter — proposer path', () => {
  test('returns skill proposal when proposer injected', async () => {
    const proposers: AdapterProposers = {
      proposeSkillInvocation: async () => skillProposal,
    };
    const r = await analysisAdapter(ctxFor('analysis', 'arch-decision', proposers));
    expect(r.status).toBe('proposed');
    expect(r.adapter).toBe('analysis-skill');
    expect(r.proposed?.tool).toBe('skill');
    expect(r.proposed?.input.skillName).toBe('stochastic-multi-agent-consensus');
  });

  test('legacy stub preserved when no proposer', async () => {
    const r = await analysisAdapter(ctxFor('analysis'));
    expect(r.status).toBe('stub');
    const skills = (r.extra as { suggestedSkills?: string[] }).suggestedSkills;
    expect(skills).toContain('stochastic-multi-agent-consensus');
  });
});

describe('dispatchGoalKind — end-to-end proposer propagation', () => {
  test('deps.proposers reaches adapter via RoutingContext', async () => {
    const proposers: AdapterProposers = {
      proposeTaskDecompose: async (ctx) => ({
        tool: 'TaskDecompose',
        input: { objective: `for ${ctx.goalSlug}`, goalSlug: ctx.goalSlug },
      }),
    };
    const r = await dispatchGoalKind({
      goalSlug: 'slack-handler',
      intake: { raw: 'Slack webhook 받아서 push 하는 handler 를 구현해줘' },
      deps: { proposers },
    });
    expect(r.classify.kind).toBe('coding');
    expect(r.adapter.status).toBe('proposed');
    expect(r.adapter.proposed?.input.objective).toBe('for slack-handler');
  });

  test('no proposers → stub path (regression guard)', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'slack-handler',
      intake: { raw: 'Slack webhook 받아서 push 하는 handler 를 구현해줘' },
    });
    expect(r.adapter.status).toBe('stub');
  });
});
