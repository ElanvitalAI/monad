// AXON P5 — 7-factor termination detector.
//
// Claude Code's public-facing guidance includes lines like "더 이상 할
// 일 없어 ScheduleWakeup 호출하지 않습니다 — 루프 종료". elanous's
// equivalent signal is this detector: a pure function that inspects
// seven factors and returns a boolean verdict + confidence +
// per-factor breakdown. The caller (loop-prompt renderer, auto-mode
// runner, TOX feedback-loop) decides what to do with it.
//
// Policy — conservative by construction. A 7-factor check that
// threshold'd at 3/7 would often terminate mid-recovery; at 7/7
// it'd almost never fire because the user rarely answers clarifying
// questions quickly. We land on:
//
//   5/7  ⇒  terminate + confidence=high
//   3/7  ⇒  terminate + confidence=medium (only when factor 7
//           AnnounceCompletion is explicit)
//   else ⇒  keep going
//
// Factor 7 (AnnounceCompletion) is special — when the LLM has
// explicitly stated "I'm done" by calling the AnnounceCompletion
// tool, we respect it even when the structural factors disagree.
// False negatives (keep looping unnecessarily) are preferred to
// false positives (exit with work pending), but the AnnounceCompletion
// escape hatch keeps the LLM in control.

/** The seven observable inputs the detector scores. Every field is
 *  optional — callers supply whatever they can measure. Missing
 *  fields default to the "safe" interpretation (factor unsatisfied
 *  ⇒ don't contribute to termination). */
export interface TerminationInput {
  /** Result of the last provider turn's stopReason. `'end_turn'` is
   *  the only value that clears factor 1; everything else means the
   *  provider would have continued. */
  stopReason?: string;
  /** Whether any tool_use blocks in the last turn are still awaiting
   *  a tool_result. Non-zero ⇒ factor 2 fails. */
  pendingToolCalls?: number;
  /** Per-turn digest of the tool results emitted. When the last N
   *  turns produced byte-for-byte identical digests, the loop is
   *  spinning — factor 3 is satisfied. A single hash per turn is
   *  enough; caller picks the hash fn. */
  recentToolResultHashes?: readonly string[];
  /** Minimum run of identical hashes required to satisfy factor 3.
   *  Default 3. */
  idempotentRunMin?: number;
  /** Have the user's clarifying questions been answered (or no
   *  questions were asked in this session)? When true, factor 4
   *  is satisfied. */
  clarifyingQuestionsAnswered?: boolean;
  /** PFC-S4 goal termination rule result. When the rule has been
   *  evaluated and said `shouldTerminate=true`, factor 5 fires.
   *  Missing ⇒ factor 5 unsatisfied. */
  goalTerminationMet?: boolean;
  /** Budget snapshot — lets us satisfy factor 6 when the budget has
   *  a "done" signal (exhausted OR explicitly green-lit). Either
   *  `exhausted: true` or `okToStop: true` counts. */
  budget?: { exhausted?: boolean; okToStop?: boolean };
  /** Factor 7 — `AnnounceCompletion` tool was explicitly called.
   *  When true, termination is returned immediately regardless of
   *  other factors. */
  announceCompletion?: boolean;
}

export type FactorId =
  | 'stop-reason-end-turn'
  | 'no-pending-tool-calls'
  | 'idempotent-recent-turns'
  | 'clarifying-questions-answered'
  | 'goal-termination-met'
  | 'budget-done'
  | 'announce-completion';

export interface TerminationFactor {
  id: FactorId;
  label: string;
  satisfied: boolean;
  /** Short free-form explanation for debug / loop-prompt rendering. */
  note: string;
}

export type TerminationConfidence = 'high' | 'medium' | 'low';

export interface ShouldTerminateDecision {
  shouldTerminate: boolean;
  confidence: TerminationConfidence;
  /** Each factor in a stable order. Consumers can render as a checklist. */
  factors: TerminationFactor[];
  /** How many of the seven factors are satisfied. */
  satisfiedCount: number;
  /** Human-readable summary — safe to embed in a system prompt or
   *  status line. Always non-empty. */
  reason: string;
}

/** Default threshold — 5/7 for structural termination, plus the
 *  AnnounceCompletion escape hatch. Tuned to prefer false negatives. */
export const HIGH_CONFIDENCE_THRESHOLD = 5;
export const MEDIUM_CONFIDENCE_THRESHOLD = 3;

export function evaluateTermination(input: TerminationInput): ShouldTerminateDecision {
  const factors: TerminationFactor[] = [
    factorStopReason(input),
    factorNoPending(input),
    factorIdempotent(input),
    factorClarifying(input),
    factorGoalTermination(input),
    factorBudget(input),
    factorAnnounceCompletion(input),
  ];
  const satisfiedCount = factors.reduce((n, f) => n + (f.satisfied ? 1 : 0), 0);
  const announce = factors[factors.length - 1]!;

  // AnnounceCompletion escape hatch — LLM has explicit say.
  if (announce.satisfied) {
    return {
      shouldTerminate: true,
      confidence: satisfiedCount >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'medium',
      factors,
      satisfiedCount,
      reason: satisfiedCount >= HIGH_CONFIDENCE_THRESHOLD
        ? `AnnounceCompletion + ${satisfiedCount - 1} structural factors satisfied — safe to terminate.`
        : `AnnounceCompletion called explicitly (only ${satisfiedCount - 1} structural factors) — respecting LLM decision.`,
    };
  }

  if (satisfiedCount >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      shouldTerminate: true,
      confidence: 'high',
      factors,
      satisfiedCount,
      reason: `${satisfiedCount}/7 factors satisfied — idempotent + pending work drained.`,
    };
  }

  // Below high-confidence threshold but meets medium — we do NOT
  // terminate without AnnounceCompletion. The medium slot exists so
  // callers can render "close to done" signals to the LLM as context.
  return {
    shouldTerminate: false,
    confidence: satisfiedCount >= MEDIUM_CONFIDENCE_THRESHOLD ? 'medium' : 'low',
    factors,
    satisfiedCount,
    reason: satisfiedCount >= MEDIUM_CONFIDENCE_THRESHOLD
      ? `${satisfiedCount}/7 factors satisfied — close to done, but keep going unless AnnounceCompletion is called.`
      : `${satisfiedCount}/7 factors satisfied — work still in progress.`,
  };
}

// ── per-factor scorers ──────────────────────────────────────────

function factorStopReason(input: TerminationInput): TerminationFactor {
  const satisfied = input.stopReason === 'end_turn';
  return {
    id: 'stop-reason-end-turn',
    label: 'Last turn ended naturally (stopReason=end_turn)',
    satisfied,
    note: input.stopReason === undefined
      ? 'stopReason not reported yet'
      : satisfied
        ? 'end_turn'
        : `stopReason=${input.stopReason}`,
  };
}

function factorNoPending(input: TerminationInput): TerminationFactor {
  const count = input.pendingToolCalls ?? 0;
  return {
    id: 'no-pending-tool-calls',
    label: 'No pending tool_use blocks awaiting tool_result',
    satisfied: count === 0,
    note: count === 0 ? 'drained' : `${count} pending`,
  };
}

function factorIdempotent(input: TerminationInput): TerminationFactor {
  const hashes = input.recentToolResultHashes ?? [];
  const min = input.idempotentRunMin ?? 3;
  if (hashes.length < min) {
    return {
      id: 'idempotent-recent-turns',
      label: `Last ${min} turns produced identical tool results (no progress)`,
      satisfied: false,
      note: `only ${hashes.length} hashes, need ${min}`,
    };
  }
  const tail = hashes.slice(-min);
  const allSame = tail.every(h => h === tail[0]);
  return {
    id: 'idempotent-recent-turns',
    label: `Last ${min} turns produced identical tool results (no progress)`,
    satisfied: allSame,
    note: allSame ? `run of ${min} identical` : 'still changing',
  };
}

function factorClarifying(input: TerminationInput): TerminationFactor {
  const answered = input.clarifyingQuestionsAnswered ?? false;
  return {
    id: 'clarifying-questions-answered',
    label: 'User has answered outstanding clarifying questions',
    satisfied: answered,
    note: input.clarifyingQuestionsAnswered === undefined
      ? 'unknown'
      : answered ? 'answered' : 'pending',
  };
}

function factorGoalTermination(input: TerminationInput): TerminationFactor {
  const met = input.goalTerminationMet ?? false;
  return {
    id: 'goal-termination-met',
    label: 'Goal-level termination rule evaluated to true',
    satisfied: met,
    note: input.goalTerminationMet === undefined
      ? 'no goal rule supplied'
      : met ? 'rule matched' : 'rule unmet',
  };
}

function factorBudget(input: TerminationInput): TerminationFactor {
  const b = input.budget ?? {};
  const satisfied = !!(b.exhausted || b.okToStop);
  return {
    id: 'budget-done',
    label: 'Budget exhausted OR explicitly okay-to-stop',
    satisfied,
    note: b.exhausted
      ? 'exhausted'
      : b.okToStop
        ? 'okToStop'
        : 'budget OK to continue',
  };
}

function factorAnnounceCompletion(input: TerminationInput): TerminationFactor {
  const called = input.announceCompletion ?? false;
  return {
    id: 'announce-completion',
    label: 'AnnounceCompletion tool called explicitly by the LLM',
    satisfied: called,
    note: called ? 'called' : 'not called',
  };
}

/** Compact text render useful for loop-prompt injection + debug log.
 *  Each line is a checkbox so the LLM can visually audit which
 *  factors it's currently missing. */
export function formatTerminationForPrompt(d: ShouldTerminateDecision): string {
  const head = d.shouldTerminate
    ? `**Termination decision: TERMINATE** (${d.confidence} confidence, ${d.satisfiedCount}/7)`
    : `**Termination decision: CONTINUE** (${d.confidence} confidence, ${d.satisfiedCount}/7)`;
  const lines = d.factors.map(f => `  [${f.satisfied ? 'x' : ' '}] ${f.label} — ${f.note}`);
  return [head, ...lines, `Reason: ${d.reason}`].join('\n');
}
