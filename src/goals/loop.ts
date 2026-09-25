// GoalLoop — Plan-Mode UX P1.3.
//
// Standalone orchestrator for the Hermes/Codex Ralph loop. The
// dashboard chat-loop is enormous (~11k LOC in src/dashboard/index.ts)
// so this PR ships the LOOP STATE MACHINE + judge integration as a
// pure, test-coverable module. The actual hook into the chat-loop —
// "after each LLM turn, call goalLoop.afterAssistantTurn()" — lands
// in P1.3b (a separate dashboard-only PR with 1+1 coord).
//
// Public API:
//   - planNextStep(input) → JudgeAction — pure decision: should we
//     stop / continue / pause? Calls the judge via opts.judgeFn so
//     tests can inject deterministic outcomes.
//   - executeAction(action) — applies the JudgeAction to the registry
//     (records turn, transitions status, emits debug events).
//   - shouldContinueAfterAssistantTurn(input, opts) — full convenience
//     path: judge call + state mutation + return the next prompt body
//     (or null when loop should pause). This is what the chat-loop
//     hook will call.
//
// Invariants:
//   D3 — never preempt user input. The chat-loop hook is responsible
//        for checking the input buffer BEFORE calling this.
//   D4 — budget hard cap enforced before judge call (saves cost).
//   D6 — judge fail → PAUSE+ASK, NEVER silent-continue.

import { debug } from '../debug/log.js';
import { getNestDepth } from '../agent/nest-depth.js';
import { getCurrentPtyId } from '../agent/pty-identity.js';
import { getHarnessRunId } from '../harness/harness-space.js';
import { getChannelBus } from '../terminal-matrix/index.js';
import {
  applyTruncation,
  LIFECYCLE_TRUNCATION_LIMITS,
  publishLifecycleRecord,
  type LifecycleRecord,
} from '../signal/lifecycle-record.js';
import type { ChannelBus } from '../terminal-matrix/channel-bus.js';
import { nextLifecycleSequence } from '../signal/lifecycle-sequence.js';
import { applyConfidenceGuard, judgeGoalTurn, type JudgeInput, type JudgeOptions, type JudgeResult } from './judge.js';
import { buildContinuationPrompt } from './continuation.js';
import {
  evaluateGoalBudget,
  getCurrentGoal,
  recordTurn,
  setLastVerdict,
  setStatus,
} from './registry.js';
import type { Goal, GoalBudgetDiagnostics, GoalJudgeVerdict } from './types.js';

export type JudgeAction =
  | { kind: 'no-goal' }
  | { kind: 'stop'; reason: 'done' | 'paused'; verdict: GoalJudgeVerdict; summary: string }
  | { kind: 'stop'; reason: 'budget-limited'; verdict: GoalJudgeVerdict; summary: string; budget: GoalBudgetDiagnostics }
  | { kind: 'continue'; verdict: GoalJudgeVerdict; summary: string; continuationPrompt: string }
  | { kind: 'pause-ask'; reason: 'judge-empty' | 'judge-failed'; lastSummary: string };

export interface AfterTurnInput {
  /** What the assistant just said. */
  lastAssistantTurn: string;
  /** Optional list of recent tool calls (judge sees actions, not just words). */
  recentToolCalls?: string[];
  /** Optional plan body — surfaced when goal was created from
   *  plan-exit `(G)oal-loop drive`. P2. */
  planBody?: string;
  /** Estimated tokens used in the turn (for budget accounting). */
  tokensUsed?: number;
}

let lifecycleStartedGoalId: string | undefined;

export function publishGoalLifecycle(bus: ChannelBus, name: 'started'): void;
export function publishGoalLifecycle(bus: ChannelBus, name: 'failed', reason: string): void;
export function publishGoalLifecycle(
  bus: ChannelBus,
  name: 'complete',
  payload: { summary: string; changedFiles: readonly string[] },
): void;
export function publishGoalLifecycle(
  bus: ChannelBus,
  name: 'started' | 'failed' | 'complete',
  detail?: string | { summary: string; changedFiles: readonly string[] },
): void {
  const runId = getHarnessRunId();
  const ptyId = getCurrentPtyId();
  if (!runId || !ptyId) {
    debug.log('signal', 'lifecycle.skip-no-identity', {
      missing: [!runId && 'runId', !ptyId && 'ptyId'].filter(Boolean),
    });
    return;
  }

  const envelope = {
    runId,
    ptyId,
    subjectPtyId: ptyId,
    depth: getNestDepth(),
    role: 'child' as const,
    seq: nextLifecycleSequence(ptyId),
    at: Date.now(),
  };

  if (name === 'started') {
    publishLifecycleRecord(bus, { ...envelope, class: 'progress', name, truncated: false });
    observePublished(name, envelope, false);
    return;
  }

  if (name === 'complete') {
    const source = detail as { summary: string; changedFiles: readonly string[] };
    const truncation = applyTruncation(source, LIFECYCLE_TRUNCATION_LIMITS);
    const payload = {
      summary: truncation.payload.summary as string,
      changedFiles: truncation.payload.changedFiles as readonly string[],
    };
    const record: LifecycleRecord = truncation.truncated
      ? {
          ...envelope,
          class: 'progress',
          name,
          payload,
          truncated: true,
          truncatedFields: truncation.truncatedFields as [string, ...string[]],
        }
      : { ...envelope, class: 'progress', name, payload, truncated: false };
    publishLifecycleRecord(bus, record);
    observePublished(name, envelope, record.truncated);
    return;
  }

  const truncation = applyTruncation({ reason: detail as string }, LIFECYCLE_TRUNCATION_LIMITS);
  const payload = { reason: truncation.payload.reason as string };
  const record: LifecycleRecord = truncation.truncated
    ? {
        ...envelope,
        class: 'progress',
        name,
        payload,
        truncated: true,
        truncatedFields: truncation.truncatedFields as [string, ...string[]],
      }
    : { ...envelope, class: 'progress', name, payload, truncated: false };
  publishLifecycleRecord(bus, record);
  observePublished(name, envelope, record.truncated);
}

/** ⭐ The bus is process-local, so a successful publish leaves NO trace outside this
 *  process. Without this line the obligation is fulfilled but invisible: from a
 *  federated query, "published" and "the code never ran" look identical — and the
 *  whole point of this track is that a signal nobody can hear is not a signal.
 *  cf. 제1원칙 — 조회에 안 뜨면 계측 누락이다. */
function observePublished(
  name: 'started' | 'failed' | 'complete',
  envelope: { runId: string; ptyId: string; depth: number; seq: number },
  truncated: boolean,
): void {
  debug.log('signal', 'lifecycle.published', {
    name,
    runId: envelope.runId,
    ptyId: envelope.ptyId,
    depth: envelope.depth,
    seq: envelope.seq,
    truncated,
  });
}

export interface LoopOptions {
  /** Test seam — replace the live judge with a deterministic stub. */
  judgeFn?: (input: JudgeInput, opts: JudgeOptions & { retries?: number }) => Promise<JudgeResult | null>;
  /** Local lifecycle bus; production uses the terminal matrix singleton. */
  lifecycleBus?: ChannelBus;
  /** Override config-resolved judge model. */
  judgeModel?: string;
  /** Number of retries on `empty` / parse-fail before PAUSE-ASK. */
  judgeRetries?: number;
  /** AbortSignal threaded through to the judge call. */
  signal?: AbortSignal;
}

/** Single entry point — called by the chat-loop hook after every
 *  assistant turn. Records token usage, runs judge, mutates registry,
 *  returns the next action.
 *
 *  Returns immediately with `kind: 'no-goal'` when no goal is in the
 *  registry — the hook is a hot path and we don't want it doing
 *  judge calls when there's no work. */
export async function shouldContinueAfterAssistantTurn(
  input: AfterTurnInput,
  opts: LoopOptions = {},
): Promise<JudgeAction> {
  const goal = getCurrentGoal();
  if (!goal || goal.status !== 'active') {
    return { kind: 'no-goal' };
  }

  const lifecycleBus = opts.lifecycleBus ?? getChannelBus();
  if (lifecycleStartedGoalId !== goal.id) {
    lifecycleStartedGoalId = goal.id;
    publishGoalLifecycle(lifecycleBus, 'started');
  }

  // Budget gate FIRST — saves the judge call when we're already done.
  // Single recordTurn() call per loop iteration: the verdict + summary
  // get layered in below after the judge runs. We record turn-count
  // and tokens up-front so budget evaluation sees current numbers, then
  // mutate verdict/summary after the judge instead of double-bumping
  // turnsUsed (regression caught by goals-loop.test.ts on 2026-05-05).
  recordTurn({ tokens: input.tokensUsed });

  const after = getCurrentGoal()!;
  const budget = evaluateGoalBudget(after, Date.now());
  if (budget.isOverBudget) {
    setStatus('budget-limited', 'budget-exhausted');
    debug.log('goal', 'loop.budget-exhausted', {
      id: after.id,
      exceededAxes: budget.exceededAxes,
      tokenMeasurement: budget.tokenMeasurement,
    });
    publishGoalLifecycle(lifecycleBus, 'failed', 'budget-exhausted');
    return {
      kind: 'stop',
      reason: 'budget-limited',
      verdict: after.lastVerdict ?? 'partial',
      summary: `Budget exhausted: ${budget.exceededAxes.map(({ axis }) => axis).join(', ')}.`,
      budget,
    };
  }

  // Run the judge — opt-in fn for tests, real LLM call otherwise.
  const judgeFn = opts.judgeFn ?? judgeGoalTurn;
  const judgeInput: JudgeInput = {
    objective: after.objective,
    lastAssistantTurn: input.lastAssistantTurn,
    recentToolCalls: input.recentToolCalls,
    planBody: input.planBody,
  };
  let raw: JudgeResult | null;
  try {
    raw = await judgeFn(judgeInput, {
      model: opts.judgeModel,
      retries: opts.judgeRetries ?? 1,
      signal: opts.signal,
    });
  } catch (err) {
    debug.log('goal', 'loop.judge-throw', { id: after.id, message: (err as Error).message });
    setStatus('paused', 'judge-failed');
    return { kind: 'pause-ask', reason: 'judge-failed', lastSummary: (err as Error).message };
  }

  if (!raw) {
    setStatus('paused', 'judge-empty');
    return {
      kind: 'pause-ask',
      reason: 'judge-empty',
      lastSummary: '(judge could not produce a verdict)',
    };
  }

  const verdict = applyConfidenceGuard(raw);
  setLastVerdict(verdict.verdict, verdict.summary);

  if (verdict.verdict === 'done') {
    setStatus('complete', 'judge-done');
    debug.log('goal', 'loop.complete', { id: after.id, summary: verdict.summary });
    return { kind: 'stop', reason: 'done', verdict: 'done', summary: verdict.summary };
  }

  if (verdict.verdict === 'empty') {
    // Treated as fail — pause for user confirmation.
    setStatus('paused', 'verdict-empty');
    return {
      kind: 'pause-ask',
      reason: 'judge-empty',
      lastSummary: verdict.summary,
    };
  }

  // continue or partial → produce continuation prompt
  const next: Goal = {
    ...getCurrentGoal()!,
    lastVerdict: verdict.verdict,
    lastSummary: verdict.summary,
  };
  const continuationPrompt = buildContinuationPrompt({
    goal: next,
    judgeSummary: verdict.summary,
    hint: verdict.verdict === 'partial' ? 'partial' : 'continue',
  });
  return {
    kind: 'continue',
    verdict: verdict.verdict,
    summary: verdict.summary,
    continuationPrompt,
  };
}

/** Convenience: did the user signal a preempt? Loop hooks call this
 *  before issuing the next auto-turn. Today this is just `isGoalActive()`
 *  — the chat-loop's input-buffer check is the actual preempt signal,
 *  but we expose this here so future hooks have a single seam. */
export function shouldIssueAutoTurn(): boolean {
  const g = getCurrentGoal();
  return !!g && g.status === 'active';
}

/** Forced manual pause — used by the `/goal pause` slash + future
 *  Shift+Tab plan-mode-enter hook. Tolerates no-goal. */
export function pauseLoop(reason: string): void {
  const g = getCurrentGoal();
  if (!g || g.status !== 'active') return;
  setStatus('paused', reason);
}
