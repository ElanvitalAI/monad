// ── A3 (Phase 4 Bundle 2) — mesh-debate-orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createMeshDebateOrchestrator,
  type DebateAgent,
  type DebateMessage,
} from '../../src/acp/mesh-debate-orchestrator';

function agent(opts: {
  id: string;
  proposeVote: string;
  critiqueVote?: string;
  proposeReason?: string;
  critiqueReason?: string;
  failPropose?: boolean;
  failCritique?: boolean;
  delay?: number;
}): DebateAgent {
  return {
    id: opts.id,
    propose: opts.failPropose
      ? async () => null
      : async () => {
          if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
          return {
            agentId: opts.id,
            vote: opts.proposeVote,
            reasoning: opts.proposeReason ?? 'p',
          } as DebateMessage;
        },
    critique: opts.failCritique
      ? async () => null
      : async () => ({
          agentId: opts.id,
          vote: opts.critiqueVote ?? opts.proposeVote,
          reasoning: opts.critiqueReason ?? 'c',
        } as DebateMessage),
  };
}

describe('createMeshDebateOrchestrator — outcomes', () => {
  test('consensus → all agents same vote', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'codex', proposeVote: 'apply' }),
        agent({ id: 'gemini', proposeVote: 'apply' }),
        agent({ id: 'claude', proposeVote: 'apply' }),
      ],
    });
    const r = await orch.debate({ question: 'fix?', context: '...' });
    expect(r.outcome).toBe('consensus');
    expect(r.winningVote).toBe('apply');
    expect(r.votes['apply']).toBe(3);
  });

  test('majority → 2 of 3 same vote', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'codex', proposeVote: 'apply' }),
        agent({ id: 'gemini', proposeVote: 'apply' }),
        agent({ id: 'claude', proposeVote: 'investigate' }),
      ],
    });
    const r = await orch.debate({ question: 'fix?', context: '...' });
    expect(r.outcome).toBe('majority');
    expect(r.winningVote).toBe('apply');
    expect(r.votes['apply']).toBe(2);
    expect(r.votes['investigate']).toBe(1);
  });

  test('split → tie', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'a', proposeVote: 'apply' }),
        agent({ id: 'b', proposeVote: 'rollback' }),
      ],
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.outcome).toBe('split');
  });

  test('no-quorum → too many agents fail to propose', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'a', proposeVote: 'apply', failPropose: true }),
        agent({ id: 'b', proposeVote: 'apply', failPropose: true }),
        agent({ id: 'c', proposeVote: 'apply' }),
      ],
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.outcome).toBe('no-quorum');
  });

  test('agent changes vote in critique', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'a', proposeVote: 'apply', critiqueVote: 'apply' }),
        agent({ id: 'b', proposeVote: 'rollback', critiqueVote: 'apply' }),  // 설득됨
        agent({ id: 'c', proposeVote: 'apply', critiqueVote: 'apply' }),
      ],
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.outcome).toBe('consensus');
    expect(r.winningVote).toBe('apply');
  });
});

describe('createMeshDebateOrchestrator — round shape', () => {
  test('round.proposals + critiques captured', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'a', proposeVote: 'apply', proposeReason: 'because X' }),
        agent({ id: 'b', proposeVote: 'apply', proposeReason: 'because Y' }),
      ],
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.round.proposals.map((p) => p.reasoning)).toEqual(['because X', 'because Y']);
    expect(r.round.critiques).toHaveLength(2);
  });

  test('summary includes all agent reasonings', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'codex', proposeVote: 'apply', critiqueReason: 'after review confirms' }),
      ],
      minQuorumRatio: 0.5,
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.summary).toContain('codex');
    expect(r.summary).toContain('after review confirms');
  });
});

describe('createMeshDebateOrchestrator — budget', () => {
  test('agent past budget treated as no response', async () => {
    // Slow agent: propose times out (delay > budget) AND critique uses
    // the same budget — pass critique 까지 모두 무응답으로 처리하려면
    // failCritique 필요. 본 케이스는 propose 만 fail 인 경우 — critique
    // 는 정상 응답하므로 outcome=majority (2 apply + 1 rollback).
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'fast', proposeVote: 'apply' }),
        agent({ id: 'slow', proposeVote: 'rollback', delay: 200 }),
        agent({ id: 'fast2', proposeVote: 'apply' }),
      ],
      agentBudgetMs: 50,
    });
    const r = await orch.debate({ question: 'q', context: '' });
    expect(r.round.proposals).toHaveLength(2); // slow propose timed out
    expect(r.outcome).toBe('majority'); // 2 apply > 1 rollback (critique)
    expect(r.winningVote).toBe('apply');
  });

  test('agent failing both propose + critique excluded entirely', async () => {
    const orch = createMeshDebateOrchestrator({
      agents: [
        agent({ id: 'a', proposeVote: 'apply' }),
        agent({ id: 'b', proposeVote: 'apply' }),
        agent({ id: 'c', proposeVote: 'rollback', failPropose: true, failCritique: true }),
      ],
    });
    const r = await orch.debate({ question: 'q', context: '' });
    // c excluded — 2 apply consensus.
    expect(r.outcome).toBe('consensus');
    expect(r.winningVote).toBe('apply');
  });
});
