// PLAN-model-intelligence-router-2026-07-10 · Part B / Phase B5 —
// Router decision audit log.
//
// The smart router runs BEFORE a turn, so its choice isn't a token/cost
// event (the turn's own usage logging captures spend). What is otherwise
// invisible is WHERE auto mode sent each turn and WHY. This append-only
// JSONL at ~/.elanous/router-decisions.jsonl records one line per auto
// decision so `auto` routing is auditable after the fact ("it sent the
// hard debugging turn to Opus, the summaries to Haiku").
//
// Best-effort throughout — logging must never break a turn.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelTier } from './types.js';
import type { TierRouteSource } from './task-router.js';

export interface RouterDecision {
  ts: number;
  /** Chosen tier + concrete model. */
  tier: ModelTier;
  model: string;
  /** How the tier was decided (heuristic / llm / fallback). */
  source: TierRouteSource;
  /** Short reason string from the router. */
  rationale: string;
  /** Provider the tier ladder resolved against. */
  provider: string;
  /** Truncated preview of the routed input (audit context, not full text). */
  textPreview?: string;
  /** Optional session/task correlation. */
  sessionId?: string;
}

export function getRouterDecisionPath(home: string = homedir()): string {
  return join(home, '.elanous', 'router-decisions.jsonl');
}

const PREVIEW_CAP = 160;

export interface LogRouterDecisionOpts {
  home?: string;
  now?: number;
}

/** Append one decision. Never throws. */
export function logRouterDecision(
  input: Omit<RouterDecision, 'ts'> & { text?: string },
  opts: LogRouterDecisionOpts = {},
): void {
  try {
    const { text, ...rest } = input;
    const entry: RouterDecision = {
      ts: opts.now ?? Date.now(),
      ...rest,
      ...(input.textPreview === undefined && typeof text === 'string'
        ? { textPreview: text.slice(0, PREVIEW_CAP) }
        : {}),
    };
    const path = getRouterDecisionPath(opts.home);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* swallow — audit logging is best-effort */
  }
}

/** Read recent decisions (most-recent last). Returns [] on any error. */
export function readRouterDecisions(
  opts: { home?: string; limit?: number } = {},
): RouterDecision[] {
  try {
    const raw = readFileSync(getRouterDecisionPath(opts.home), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const slice = opts.limit && opts.limit > 0 ? lines.slice(-opts.limit) : lines;
    const out: RouterDecision[] = [];
    for (const l of slice) {
      try { out.push(JSON.parse(l) as RouterDecision); } catch { /* skip bad line */ }
    }
    return out;
  } catch {
    return [];
  }
}
