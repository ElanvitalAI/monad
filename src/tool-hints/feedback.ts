// Post-dispatch hint feedback.
//
// After each native-tool dispatch, peek at the result and optionally
// auto-create a follow-on hint that steers the next tool call. This
// is the "prefrontal cortex" loop — the system watches its own output
// and adjusts future behavior without the LLM having to reason about
// low-level failures.
//
// Conservative by design: only a small set of well-understood
// patterns fire. Cap 3 auto-hints per turn to prevent a feedback
// storm (e.g. a retry that keeps failing shouldn't spawn a new hint
// every time).

import { debug } from '../debug/log.js';
import { addHint, listHints } from './registry.js';
import type { Hint } from './types.js';

export interface DispatchObservation {
  tool: string;            // displayName (resolved by skill-runner)
  args: Record<string, unknown>;
  outputText: string;
  isError: boolean;
  durationMs: number;
}

const MAX_FEEDBACK_PER_TURN = 3;
let feedbackCountThisTurn = 0;

/** Wired into skill-runner's endTurn path (via registry.endTurn
 *  trigger) — resets the per-turn cap. */
export function resetFeedbackCounterForTesting(): void {
  feedbackCountThisTurn = 0;
}

export function resetFeedbackCounterOnTurnEnd(): void {
  feedbackCountThisTurn = 0;
}

/** Inspect a just-completed tool dispatch and optionally add
 *  follow-on hints. Returns the hints that were created, so callers
 *  can surface them for debugging. Capped at 3 per turn. */
export function applyHintFeedback(obs: DispatchObservation): Hint[] {
  if (feedbackCountThisTurn >= MAX_FEEDBACK_PER_TURN) return [];

  const created: Hint[] = [];

  // ── Rule 1: network timeout on web_fetch / web_search ──
  // Give the next call a larger default timeout_ms. Skip if an
  // equivalent hint already exists (don't stack doubles).
  if ((obs.tool === 'WebFetch' || obs.tool === 'WebSearch') && /\btimeout\b/i.test(obs.outputText)) {
    const key = `${obs.tool.toLowerCase()}_timeout_default`;
    if (!hasAutoHint(key)) {
      const h = addHint({
        kind: 'param-default',
        tool: obs.tool,
        scope: 'turn',
        reason: 'previous call timed out — use a larger timeout',
        sourceSignal: `feedback:${key}`,
        payload: { args: { timeout_ms: 30_000 } },
      });
      created.push(h);
    }
  }

  // ── Rule 2: transport-layer errors on web_fetch ──
  // Suggests DNS / connectivity trouble, not just a 404. Propose
  // api_call (a finer-grained HTTP tool, when it lands in P9) so
  // the LLM can probe status codes directly.
  if (obs.isError && /\b(ENOTFOUND|ECONNREFUSED|EHOSTUNREACH)\b/i.test(obs.outputText)) {
    const key = 'network_error_prefer_api_call';
    if (!hasAutoHint(key)) {
      const h = addHint({
        kind: 'prefer',
        tool: 'api_call',
        scope: 'turn',
        reason: 'transport-layer error seen — api_call exposes status codes',
        sourceSignal: `feedback:${key}`,
      });
      created.push(h);
    }
  }

  // ── Rule 3: "tool not available" / disabled notice in result ──
  // Add a disable hint so the LLM stops proposing it until reset.
  if (obs.isError && /\btool '([^']+)' not available\b/i.test(obs.outputText)) {
    const match = obs.outputText.match(/\btool '([^']+)' not available\b/i);
    const missingTool = match?.[1];
    if (missingTool) {
      const key = `disable_${missingTool}`;
      if (!hasAutoHint(key)) {
        const h = addHint({
          kind: 'disable',
          tool: missingTool,
          scope: 'session',
          reason: `tool '${missingTool}' reported unavailable`,
          sourceSignal: `feedback:${key}`,
        });
        created.push(h);
      }
    }
  }

  // ── Rule 4: rate-limit-like response on paid search ──
  // Session-scope avoid — next retry should try a different engine.
  if (/\b(rate limit|429|too many requests)\b/i.test(obs.outputText)) {
    const key = `rate_limit_${obs.tool}`;
    if (!hasAutoHint(key)) {
      const h = addHint({
        kind: 'avoid',
        tool: obs.tool,
        scope: 'session',
        reason: 'rate limit seen — avoid for the remainder of this session',
        sourceSignal: `feedback:${key}`,
      });
      created.push(h);
    }
  }

  if (created.length > 0) {
    feedbackCountThisTurn += created.length;
    debug.log('hint.auto', 'created', {
      tool: obs.tool,
      isError: obs.isError,
      count: created.length,
      budget: MAX_FEEDBACK_PER_TURN - feedbackCountThisTurn,
      ids: created.map(h => h.id),
    });
  }

  return created;
}

function hasAutoHint(sourceKey: string): boolean {
  const signal = `feedback:${sourceKey}`;
  return listHints().some(h => h.sourceSignal === signal);
}

/** Test-only: inspect the counter. */
export function getFeedbackCountForTesting(): number {
  return feedbackCountThisTurn;
}
