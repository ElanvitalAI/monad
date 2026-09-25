// Session-cumulative prompt-cache metrics.
//
// Module-scoped singleton. The dashboard accumulates per-turn usage
// events into these counters and the `/cache` slash surfaces a human-
// readable summary. Tests must call `resetSessionMetrics()` in their
// afterEach to avoid cross-test leakage — the singleton is a
// conscious trade-off for zero-wiring UX (no context-threading
// through the entire provider-to-UI stack).

import type { LLMUsage } from './types.js';

export interface SessionSummary {
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  /** read / (read + create + input), rounded to integer percent.
   *  Null when the denominator is 0 (no usage recorded yet). */
  readonly hitRatePct: number | null;
  /** Breakdown by provider — lets `/cache` render which backend did
   *  the heavy lifting when a session mixes Anthropic + OpenAI. */
  readonly byProvider: Record<string, {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  }>;
}

interface ProviderBucket {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

interface MutableState {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  byProvider: Map<string, ProviderBucket>;
}

function blankState(): MutableState {
  return {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    byProvider: new Map(),
  };
}

let state: MutableState = blankState();

function bumpProviderBucket(provider: string, u: LLMUsage, countTurn: boolean): void {
  let bucket = state.byProvider.get(provider);
  if (!bucket) {
    bucket = {
      turns: 0, inputTokens: 0, outputTokens: 0,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    };
    state.byProvider.set(provider, bucket);
  }
  if (countTurn) bucket.turns += 1;
  bucket.inputTokens += u.inputTokens ?? 0;
  bucket.outputTokens += u.outputTokens ?? 0;
  bucket.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
  bucket.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
}

/** Accumulate one usage event into the session totals. A "turn" is
 *  counted when this event carries prompt-side tokens (input or
 *  cache read / create) — that way Anthropic's two-event pattern
 *  (message_start + message_delta) only increments turns once. */
export function recordUsage(u: LLMUsage): void {
  const promptSide =
    (u.inputTokens ?? 0) > 0 ||
    (u.cacheReadInputTokens ?? 0) > 0 ||
    (u.cacheCreationInputTokens ?? 0) > 0;
  if (promptSide) state.turns += 1;
  state.inputTokens += u.inputTokens ?? 0;
  state.outputTokens += u.outputTokens ?? 0;
  state.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
  state.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
  bumpProviderBucket(u.provider ?? 'unknown', u, promptSide);
}

export function getSessionSummary(): SessionSummary {
  const denom = state.inputTokens + state.cacheReadInputTokens + state.cacheCreationInputTokens;
  const hit = denom > 0 ? Math.round((state.cacheReadInputTokens / denom) * 100) : null;
  const byProvider: SessionSummary['byProvider'] = {};
  for (const [k, v] of state.byProvider) {
    byProvider[k] = { ...v };
  }
  return {
    turns: state.turns,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadInputTokens: state.cacheReadInputTokens,
    cacheCreationInputTokens: state.cacheCreationInputTokens,
    hitRatePct: hit,
    byProvider,
  };
}

export function resetSessionMetrics(): void {
  state = blankState();
}

/** Render a 1–3 line summary suitable for the `/cache` slash output.
 *  Totals line is always present; per-provider rows appear when the
 *  session has seen more than one provider. */
export function formatSessionSummary(s: SessionSummary): string {
  const hit = s.hitRatePct === null ? 'n/a' : `${s.hitRatePct}%`;
  const head = `session: turns=${s.turns} in=${s.inputTokens} out=${s.outputTokens} read=${s.cacheReadInputTokens} create=${s.cacheCreationInputTokens} (hit ${hit})`;
  const providers = Object.keys(s.byProvider);
  if (providers.length <= 1) return head;
  const rows = providers.map(p => {
    const b = s.byProvider[p]!;
    return `  ${p}: turns=${b.turns} in=${b.inputTokens} out=${b.outputTokens} read=${b.cacheReadInputTokens} create=${b.cacheCreationInputTokens}`;
  });
  return [head, ...rows].join('\n');
}

/** Compact HUD badge — "💾 78%" / "💾 --". Intended for the bottom
 *  secondary-status row next to the 💰 cost segment. Returns only the
 *  text; the status-bar segment helper applies color. */
export function formatCacheBadge(s: SessionSummary): string {
  if (s.hitRatePct === null) return '💾 --';
  return `💾 ${s.hitRatePct}%`;
}
