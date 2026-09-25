// Intent-prediction · heuristic ranker — Phase 0.5.
//
// 6 canonical buttons with rule-based confidence scoring. Each
// rule contributes a small additive bonus to one or more labels;
// confidences are clamped to [0,1] post-aggregation. The shape
// stays deliberately deterministic (no LLM call, no I/O) so the
// 5s tick stays cheap (~µs) and tests can pin exact values.
//
// LLM-judge upgrade (PLAN §7.2 option 1) ships in a follow-up PR
// once Phase 0 dogfood proves the heuristic floor is too noisy.
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7.2
//   내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.1

import {
  INTENT_BUTTON_LABELS,
  type IntentButtonLabel,
  type IntentCandidate,
  type IntentContext,
  type IntentRanking,
} from './types.js';

/** Base confidence applied to every label so the panel never
 *  shows a "fully cold" button (visually bad — looks like a bug).
 *  Rules add on top up to ~0.85. */
const BASE_CONFIDENCE = 0.15;

/** Recency boost — each of the last 3 distinct taps adds this much
 *  to its label's confidence so the user can "chain" common
 *  decisions without losing rank. */
const RECENCY_BOOST = 0.08;

/** Idle threshold (ms) — past this, the ranker leans towards
 *  '오토파일럿' (let the agent run unattended) since the user
 *  isn't actively watching. */
const IDLE_AUTOPILOT_MS = 60_000;

/** File-edit count threshold — when the session emitted ≥ this
 *  many file edits without explicit user review, 'diff 보여줘'
 *  gets a strong boost. */
const EDITS_REVIEW_THRESHOLD = 3;

/** Progress threshold — at and above this, '승인' rises so the
 *  user can confirm a near-finished arc with one tap. */
const PROGRESS_APPROVE_THRESHOLD = 0.7;

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

interface RankBucket {
  confidence: number;
  reasons: string[];
}

function emptyBuckets(): Record<IntentButtonLabel, RankBucket> {
  const out = {} as Record<IntentButtonLabel, RankBucket>;
  for (const label of INTENT_BUTTON_LABELS) {
    out[label] = { confidence: BASE_CONFIDENCE, reasons: [] };
  }
  return out;
}

function bump(
  buckets: Record<IntentButtonLabel, RankBucket>,
  label: IntentButtonLabel,
  delta: number,
  reason: string,
): void {
  buckets[label].confidence += delta;
  buckets[label].reasons.push(reason);
}

/** Pure heuristic ranker. Same context → same ranking — no I/O,
 *  no clock dependency. The version-bump policy lives in
 *  `tick.ts` (depends on prior ranking, not the ranker itself). */
export function rankIntents(ctx: IntentContext): IntentCandidate[] {
  const b = emptyBuckets();

  // ── error path ──────────────────────────────────────────────
  if (ctx.lastErr && ctx.lastErr.trim().length > 0) {
    bump(b, '잠시 멈춤', 0.55, '최근 오류 발생');
    bump(b, '추가 보완', 0.20, '오류 후 보완 가능');
  }

  // ── progress drives "계속" / "승인" ─────────────────────────
  if (ctx.progressPct >= PROGRESS_APPROVE_THRESHOLD) {
    bump(b, '승인', 0.50, '진행률 ≥ 70%');
    bump(b, '계속 진행', 0.18, '진행률 ≥ 70%');
  } else if (ctx.progressPct >= 0.3) {
    bump(b, '계속 진행', 0.35, '중간 진행');
  } else if (ctx.progressPct > 0) {
    bump(b, '계속 진행', 0.18, '초기 진행');
  }

  // ── file edits drive "diff 보여줘" ──────────────────────────
  if (ctx.fileEditCount >= EDITS_REVIEW_THRESHOLD) {
    bump(b, 'diff 보여줘', 0.50, `최근 ${ctx.fileEditCount}건 file edit`);
  } else if (ctx.fileEditCount > 0) {
    bump(b, 'diff 보여줘', 0.20, `최근 ${ctx.fileEditCount}건 file edit`);
  }

  // ── idle drives "오토파일럿" ────────────────────────────────
  if (ctx.idleMs >= IDLE_AUTOPILOT_MS) {
    const idleSec = Math.floor(ctx.idleMs / 1000);
    bump(b, '오토파일럿', 0.45, `${idleSec}s 동안 idle`);
  } else if (ctx.idleMs >= IDLE_AUTOPILOT_MS / 2) {
    bump(b, '오토파일럿', 0.18, 'idle 누적 중');
  }

  // ── recency boost (last 3 distinct taps) ────────────────────
  // Skipping duplicates so a single repeated tap doesn't dominate.
  const seen = new Set<IntentButtonLabel>();
  let used = 0;
  for (const t of ctx.recentTaps) {
    if (used >= 3) break;
    if (seen.has(t)) continue;
    seen.add(t);
    bump(b, t, RECENCY_BOOST, '최근 사용');
    used += 1;
  }

  // ── lastTurnSummary tie-breaker (very small) ────────────────
  const summary = ctx.lastTurnSummary.toLowerCase();
  if (summary.includes('완료') || summary.includes('done') || summary.includes('finished')) {
    bump(b, '승인', 0.10, '응답에 완료 표시');
  }
  if (summary.includes('대기') || summary.includes('waiting')) {
    bump(b, '계속 진행', 0.08, '대기 표시');
  }

  return INTENT_BUTTON_LABELS.map((label) => ({
    label,
    confidence: clamp01(b[label].confidence),
    reason: b[label].reasons.join(' · ') || '기본 추천',
  }));
}

/** Build a ranking shell around the pure ranker output, with the
 *  caller-supplied version + clock. tick.ts wraps this to
 *  manage version-bump policy. */
export function buildRanking(
  ctx: IntentContext,
  version: number,
  now: number,
): IntentRanking {
  return {
    sessionId: ctx.sessionId,
    candidates: rankIntents(ctx),
    version,
    generatedAt: now,
  };
}

/** Floating-point safe threshold for "noticeable confidence
 *  change" — exposing as a const so tests can sanity-check the
 *  boundary without relying on raw 0.05 (which fails IEEE 754
 *  equality, e.g. 0.95-0.90 ≈ 0.04999…). The value is large
 *  enough to filter UI-flicker noise but small enough to surface
 *  real ranker shifts. */
export const RANKING_DIFF_THRESHOLD = 0.0499;

/** Compare two rankings to decide whether a tick should bump
 *  the version. Bump rules (any one suffices):
 *    1. Top label by confidence changed.
 *    2. Any label's confidence changed by ≥ RANKING_DIFF_THRESHOLD
 *       (~0.05, FP-safe).
 *  Otherwise the version reuses prior — SSE clients dedupe. */
export function rankingsDiffer(
  prev: IntentRanking | null,
  next: IntentCandidate[],
): boolean {
  if (!prev) return true;
  if (prev.candidates.length !== next.length) return true;
  // Top-by-confidence comparison
  const sortedPrev = [...prev.candidates].sort((a, c) => c.confidence - a.confidence);
  const sortedNext = [...next].sort((a, c) => c.confidence - a.confidence);
  if (sortedPrev[0]?.label !== sortedNext[0]?.label) return true;
  // Per-label delta comparison
  const prevByLabel = new Map(prev.candidates.map((c) => [c.label, c.confidence]));
  for (const c of next) {
    const before = prevByLabel.get(c.label) ?? 0;
    if (Math.abs(c.confidence - before) >= RANKING_DIFF_THRESHOLD) return true;
  }
  return false;
}
