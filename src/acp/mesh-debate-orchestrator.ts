// ── A3 (Phase 4 Bundle 2) — codex/gemini/claude mesh shell debate ──
//
// HANDOFF Phase 4 / ROADMAP §7 A3: "codex/gemini/claude mesh 가 한 shell
// 토론". 여러 LLM agent 가 같은 context (shell history) 위에서 multi-turn
// 의견 교환 → 합의 또는 다수 의견 추출.
//
// Pure orchestrator — agent provider list 주입. 각 agent 가 turn 별 propose
// (initial position) + critique (다른 agent 의견 review) + final vote.
//
// 최종 outcome:
//   - 'consensus': 모든 agent 동일 vote
//   - 'majority': 과반 vote
//   - 'split': 동률 — moderator agent 또는 사용자 결정
//   - 'no-quorum': 응답 못 한 agent 가 너무 많음

export interface DebateAgent {
  readonly id: string;
  readonly displayName?: string;
  /** initial proposition - shell context 받아서 의견 + reasoning. */
  propose: (input: { question: string; context: string }) => Promise<DebateMessage | null>;
  /** Other agents 의 propositions 보고 critique + 최종 vote. */
  critique: (input: {
    question: string;
    context: string;
    proposals: readonly DebateMessage[];
    selfId: string;
  }) => Promise<DebateMessage | null>;
}

export interface DebateMessage {
  readonly agentId: string;
  /** Position label — 일관된 비교 위해 'option:foo' 또는 짧은 라벨.
   *  예: 'apply', 'rollback', 'investigate-more'. */
  readonly vote: string;
  readonly reasoning: string;
  /** Confidence 0-1. */
  readonly confidence?: number;
}

export interface DebateRound {
  readonly proposals: readonly DebateMessage[];
  readonly critiques: readonly DebateMessage[];
}

export type DebateOutcome = 'consensus' | 'majority' | 'split' | 'no-quorum';

export interface DebateResult {
  readonly outcome: DebateOutcome;
  readonly winningVote?: string;
  readonly votes: Record<string, number>;
  readonly round: DebateRound;
  /** Convenience — 모든 agent 의 reasoning 묶음 (audit). */
  readonly summary: string;
}

export interface MeshDebateOrchestratorDeps {
  agents: readonly DebateAgent[];
  /** Per-agent propose / critique budget. Default 30s. */
  agentBudgetMs?: number;
  /** Quorum 기준 — 응답한 agent 수 / 전체 agent. Default 0.5. */
  minQuorumRatio?: number;
  /** Majority 기준 — winning vote 수 / 응답 수. Default 0.5 (over half). */
  majorityRatio?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface MeshDebateInput {
  readonly question: string;
  /** Shell history / 결과 등 context (substrate aggregated). */
  readonly context: string;
}

export interface MeshDebateOrchestrator {
  debate(input: MeshDebateInput): Promise<DebateResult>;
}

const DEFAULT_AGENT_BUDGET = 30_000;
const DEFAULT_MIN_QUORUM = 0.5;
const DEFAULT_MAJORITY = 0.5;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

function tally(messages: readonly DebateMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    counts[m.vote] = (counts[m.vote] ?? 0) + 1;
  }
  return counts;
}

function pickWinner(counts: Record<string, number>): { winner: string | null; runnerUp: number } {
  let winner: string | null = null;
  let max = 0;
  let secondMax = 0;
  for (const [vote, n] of Object.entries(counts)) {
    if (n > max) {
      secondMax = max;
      max = n;
      winner = vote;
    } else if (n > secondMax) {
      secondMax = n;
    }
  }
  return { winner, runnerUp: secondMax === max ? max : secondMax };
}

export function createMeshDebateOrchestrator(
  deps: MeshDebateOrchestratorDeps,
): MeshDebateOrchestrator {
  const budget = deps.agentBudgetMs ?? DEFAULT_AGENT_BUDGET;
  const quorumRatio = deps.minQuorumRatio ?? DEFAULT_MIN_QUORUM;
  const majorityRatio = deps.majorityRatio ?? DEFAULT_MAJORITY;
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async debate(input) {
      log('mesh-debate.start', '', { agents: deps.agents.length });

      // Round 1 — propose (parallel)
      const proposals = await Promise.all(
        deps.agents.map((a) =>
          withTimeout(a.propose({ question: input.question, context: input.context }), budget),
        ),
      );
      const proposalMsgs = proposals.filter((p): p is DebateMessage => p !== null);

      log('mesh-debate.proposals', '', { count: proposalMsgs.length });

      // Quorum check on proposals
      const minResponses = Math.ceil(deps.agents.length * quorumRatio);
      if (proposalMsgs.length < minResponses) {
        return {
          outcome: 'no-quorum',
          votes: tally(proposalMsgs),
          round: { proposals: proposalMsgs, critiques: [] },
          summary: `no-quorum (${proposalMsgs.length}/${deps.agents.length} responded)`,
        };
      }

      // Round 2 — critique (parallel · each agent reviews others' proposals)
      const critiques = await Promise.all(
        deps.agents.map((a) =>
          withTimeout(
            a.critique({
              question: input.question,
              context: input.context,
              proposals: proposalMsgs,
              selfId: a.id,
            }),
            budget,
          ),
        ),
      );
      const critiqueMsgs = critiques.filter((c): c is DebateMessage => c !== null);

      log('mesh-debate.critiques', '', { count: critiqueMsgs.length });

      // Tally critique votes (final position)
      const finalVotes = tally(critiqueMsgs);
      const { winner, runnerUp } = pickWinner(finalVotes);
      const totalCritiques = critiqueMsgs.length;
      const winnerCount = winner ? finalVotes[winner] ?? 0 : 0;

      const summary = critiqueMsgs.map((m) => `[${m.agentId}] ${m.vote}: ${m.reasoning}`).join('\n');

      let outcome: DebateOutcome;
      if (totalCritiques < minResponses) {
        outcome = 'no-quorum';
      } else if (winnerCount === totalCritiques) {
        outcome = 'consensus';
      } else if (winnerCount > totalCritiques * majorityRatio && winnerCount > runnerUp) {
        outcome = 'majority';
      } else {
        outcome = 'split';
      }

      log('mesh-debate.outcome', outcome, { winner, votes: finalVotes });

      return {
        outcome,
        ...(winner !== null ? { winningVote: winner } : {}),
        votes: finalVotes,
        round: { proposals: proposalMsgs, critiques: critiqueMsgs },
        summary,
      };
    },
  };
}
