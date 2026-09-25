// Goal-loop chat hook bridge — FU-1.
//
// The dashboard's chat-input loop calls `runGoalLoopHook(...)` after
// every LLM turn. The bridge:
//   1. Extracts the last assistant turn from chat.history.
//   2. Calls shouldContinueAfterAssistantTurn (judge → action).
//   3. Returns a structured action the chat loop can act on.
//
// Decoupled from dashboard internals — this module knows the chat
// history shape but nothing about textInput / draw / promptCtl etc.
// That keeps the dashboard call site to ~10 lines of insertion.
//
// Preempt model:
//   - During streaming: existing Esc-abort gate aborts the LLM call.
//     The loop's runPlainTurn returns, this hook checks goal state,
//     and if the abort was the source of stoppage, the loop pauses.
//   - Between auto-turns: tight loop (no built-in delay). User can
//     not interleave keystrokes between turns (textInput is blocked
//     during runPlainTurn). Future enhancement: insert a brief
//     setTimeout window with Esc-watch, but that adds complexity for
//     a small gain.

import { debug } from '../debug/log.js';
import type { LLMMessage } from '../llm.js';
import { getCurrentGoal, isGoalActive, requireGoalResumeFromFollowUp, setStatus } from './registry.js';
import { shouldContinueAfterAssistantTurn, type LoopOptions } from './loop.js';
import { buildGoalStatusSummary } from './continuation.js';

export type GoalLoopAction =
  | { kind: 'no-loop' /* no active goal — fall through */ }
  | {
      kind: 'continue';
      /** Synthetic user text to feed into the next turn. */
      nextUserText: string;
      /** Header lines pushed to chat to make the auto-turn visible. */
      headerLines: string[];
    }
  | {
      kind: 'stop';
      /** Lines pushed to chat to surface the outcome
       *  (✅ done · ⏸ paused · ⚠ budget · ✗ judge-fail). */
      toastLines: string[];
      reason: 'done' | 'paused' | 'budget-limited' | 'judge-empty' | 'judge-failed';
    };

export function goalLoopActionForActiveGoal(active: boolean): GoalLoopAction['kind'] {
  return active ? 'continue' : 'no-loop';
}

export function isGoalLoopContinuationAction(action: GoalLoopAction['kind']): boolean {
  return action === 'continue';
}

/**
 * Conservative router for a paused goal. A new unrelated request must remain
 * a normal chat turn; only explicit correction/resume language may revive the
 * interrupted execution.
 */
export function isGoalFollowUpCorrection(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return /(?:\b(?:resume|continue|correct(?:ion)?|wrong|instead)\b|(?:정정|계속|재개|잘못|틀렸|아니라|대신)|(?:디렉토리|폴더|경로).{0,32}(?:bco|mna)|(?:bco|mna).{0,32}(?:디렉토리|폴더|경로))/iu.test(normalized);
}

/**
 * Route a correction for an interrupted goal back into its execution loop.
 * The caller supplies the returned prompt as the next user turn; therefore an
 * explanation about a wrong search root cannot terminate the original goal.
 */
export function resumeGoalFromUserFollowUp(followUp: string): GoalLoopAction {
  if (!isGoalFollowUpCorrection(followUp)) return { kind: 'no-loop' };
  const resumed = requireGoalResumeFromFollowUp(followUp);
  if (!resumed.ok) return { kind: 'no-loop' };
  debug.log('goal', 'follow-up.resume', { id: resumed.goal.id, followUp });
  return {
    kind: 'continue',
    nextUserText: `Continue the active goal. User correction/constraint: ${followUp.trim()}\nDo not only explain the correction; execute the next eligible step and produce the original goal's requested result.`,
    headerLines: ['  ↪ Goal resumed from user correction.'],
  };
}

export interface GoalLoopHookDeps {
  /** chat.history from dashboard — the LAST entry should be the
   *  assistant turn we just streamed. */
  history: LLMMessage[];
  /** Approximate tokens used in the just-finished turn. Best-effort —
   *  caller passes 0 if not tracked. */
  tokensUsed?: number;
  /** When set, indicates the LLM call was aborted (Esc / user
   *  preempt). The hook treats this as an immediate pause, NOT a
   *  judge call. */
  wasAborted?: boolean;
  /** Optional plan body — surfaced when goal was created from
   *  plan-exit (G)oal-loop drive (B1). */
  planBody?: string;
  /** Goal-loop options forwarded to shouldContinueAfterAssistantTurn
   *  (mostly judge model + retries). */
  loopOpts?: LoopOptions;
}

function extractLastAssistantText(history: LLMMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (!msg) continue;
    if (msg.role !== 'assistant') continue;
    if (typeof msg.content === 'string') return msg.content;
    // ContentBlock[] — concat text parts only
    return msg.content
      .map((b) => (typeof b === 'object' && b && 'type' in b && b.type === 'text' && 'text' in b
        ? String(b.text)
        : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** The single entry point for the dashboard chat-loop hook. Returns
 *  the next action (continue / stop / no-loop). Side effects: judge
 *  call (LLM) + registry mutations via shouldContinueAfterAssistantTurn. */
export async function runGoalLoopHook(deps: GoalLoopHookDeps): Promise<GoalLoopAction> {
  if (!isGoalActive()) return { kind: 'no-loop' };

  // Aborted turn: the user (or system) cancelled mid-stream. Treat as
  // pause-ask — never auto-continue past an abort.
  if (deps.wasAborted) {
    setStatus('paused', 'user-preempt');
    debug.log('goal', 'loop.preempt', { source: 'abort' });
    return {
      kind: 'stop',
      reason: 'paused',
      toastLines: ['  ⏸ Goal paused — turn was interrupted. /goal resume to continue.'],
    };
  }

  const lastAssistantTurn = extractLastAssistantText(deps.history);
  if (!lastAssistantTurn) {
    // No assistant text to judge against — happens when a slash
    // command was the only thing in the turn. Treat as no-op.
    return { kind: 'no-loop' };
  }

  const action = await shouldContinueAfterAssistantTurn(
    {
      lastAssistantTurn,
      tokensUsed: deps.tokensUsed,
      planBody: deps.planBody,
    },
    deps.loopOpts ?? {},
  );

  if (action.kind === 'no-goal') return { kind: 'no-loop' };

  if (action.kind === 'continue') {
    const goal = getCurrentGoal()!;
    return {
      kind: 'continue',
      nextUserText: action.continuationPrompt,
      headerLines: [
        `  🎯 auto-turn ${goal.usage.turnsUsed + 1}/${goal.budget.maxTurns} — ${truncate(action.summary, 80)}`,
        `     (Esc during streaming to interrupt)`,
      ],
    };
  }

  if (action.kind === 'stop') {
    if (action.reason === 'done') {
      const goal = getCurrentGoal()!;
      return {
        kind: 'stop',
        reason: 'done',
        toastLines: [
          `  ✅ Goal complete — ${truncate(action.summary, 100)}`,
          `     ${buildGoalStatusSummary(goal)}`,
        ],
      };
    }
    if (action.reason === 'budget-limited') {
      return {
        kind: 'stop',
        reason: 'budget-limited',
        toastLines: budgetToastLines(action.budget),
      };
    }
    return {
      kind: 'stop',
      reason: 'paused',
      toastLines: [
        `  ⏸ Goal paused — ${truncate(action.summary, 100)}`,
        `     /goal status / /goal resume to continue.`,
      ],
    };
  }

  // pause-ask
  return {
    kind: 'stop',
    reason: action.reason,
    toastLines: [
      `  ⏸ Goal paused — judge could not produce a verdict.`,
      `     last: ${truncate(action.lastSummary, 100)}`,
      `     /goal status / /goal resume after reviewing.`,
    ],
  };
}

function budgetToastLines(budget: Extract<Awaited<ReturnType<typeof shouldContinueAfterAssistantTurn>>, { kind: 'stop'; reason: 'budget-limited' }>['budget']): string[] {
  const exceeded = new Map(budget.exceededAxes.map((entry) => [entry.axis, entry]));
  const turn = exceeded.get('maxTurns');
  const token = exceeded.get('tokenBudget');
  const wallClock = exceeded.get('wallClockMaxMs');
  const labels = [turn && 'turn', token && 'token', wallClock && 'wall-clock'].filter(Boolean);
  const details = [
    turn && `turns ${turn.used}/${turn.limit}`,
    token && `tokens ${token.used}/${token.limit}${budget.tokenMeasurement === 'measured' ? '' : ' (unmeasured)'}`,
    wallClock && `wall-clock ${wallClock.used}/${wallClock.limit}ms`,
  ].filter(Boolean).join('; ');
  const remedies = [
    turn && '/goal budget <N> extends turns',
    token && '/goal budget tokens=<N> extends tokens',
    wallClock && '/goal budget wall=<N>s extends wall-clock',
  ].filter(Boolean);
  const guidance = `     ${remedies.join('; ')}. Increase every exhausted axis before /goal resume.`;
  return [
    `  ⚠ Goal paused — ${labels.join(' + ')} budget exhausted (${details}).`,
    guidance,
  ];
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
