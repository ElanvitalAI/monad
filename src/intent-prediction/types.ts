// Intent-prediction types — Phase 0.5 (2026-05-08).
//
// PLAN: 내부 문서 `PLAN-ios-companion-app-2026-05-08` §7
// BACKLOG: 내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.1
//
// Phase 0.5 minimum surface — PWA Intent panel + iOS lock widget /
// Live Activity / Watch / CarPlay all consume the same ranker
// output. PR 6 ships REST/SSE; APNs + ACP `peer.kind === 'ios'`
// routing land in a follow-up PR (after Apple Developer Program +
// production cert).

/** Canonical 6 button labels — Korean copy locked in for the
 *  Phase 0 dogfood window. The label set is part of the public
 *  contract: the PWA renders these strings verbatim and the iOS
 *  port (Phase 1) replays them in `LocalizedStringResource`. */
export const INTENT_BUTTON_LABELS = [
  '계속 진행',
  '오토파일럿',
  '추가 보완',
  'diff 보여줘',
  '승인',
  '잠시 멈춤',
] as const;

export type IntentButtonLabel = (typeof INTENT_BUTTON_LABELS)[number];

/** Single ranker candidate. Confidence is `0..1`. The ranker
 *  always returns one entry per canonical label (six total) so
 *  consumers can render a stable button grid; the `confidence`
 *  encodes ranking. */
export interface IntentCandidate {
  label: IntentButtonLabel;
  confidence: number;
  /** Short rationale for the rank — surfaced in dev tooling +
   *  optional tooltip. Not localized for Phase 0.5. */
  reason: string;
}

/** Snapshot of all six candidates plus a monotonic version stamp
 *  so SSE subscribers can dedupe ticks that didn't change. */
export interface IntentRanking {
  sessionId: string;
  /** Always 6 entries · stable order = INTENT_BUTTON_LABELS order.
   *  The `confidence` field encodes ranking; sort client-side
   *  when displaying as a "top-N". */
  candidates: IntentCandidate[];
  /** Monotonic version, advancing on every distinct ranking. The
   *  ranker bumps this only when at least one confidence changed
   *  by ≥0.05 OR the top label changed; identical re-ranks reuse
   *  the previous version so SSE clients can skip. */
  version: number;
  /** Wall-clock ms when the ranking was computed. */
  generatedAt: number;
}

/** Heuristic ranker input. Phase 0.5 wires what the existing PWA
 *  + daemon surfaces already produce (no new instrumentation
 *  required). LLM-judge follow-up extends with `kgsRecent` etc. */
export interface IntentContext {
  sessionId: string;
  /** One-line summary of the latest assistant turn (or empty when
   *  the session just spawned). Used as a tie-breaker between
   *  "계속 진행" vs "승인". Truncated to 200 chars by the caller. */
  lastTurnSummary: string;
  /** Latest error message surfaced by the session, or null. When
   *  set, '잠시 멈춤' gets a hard boost. */
  lastErr: string | null;
  /** 0..1 — caller estimates progress through the active arc.
   *  Best-effort; absent → treated as 0 (early). */
  progressPct: number;
  /** Number of file edits the session has emitted so far. Drives
   *  'diff 보여줘' confidence. */
  fileEditCount: number;
  /** Wall-clock ms since the last user input. Drives
   *  '오토파일럿' (long idle → hand off) and gently boosts
   *  '잠시 멈춤' when paired with an error. */
  idleMs: number;
  /** Recent button taps for this user — most-recent first. The
   *  ranker uses simple recency boost on the last 3 distinct
   *  labels so the panel stays familiar without locking in. */
  recentTaps: IntentButtonLabel[];
}

/** Feedback record persisted when the user taps a button. The
 *  ranker reads aggregated counts to weight future suggestions;
 *  the iOS Phase 1 KGS port consumes the same shape via
 *  `feedback-loop.ts`. */
export interface IntentFeedback {
  sessionId: string;
  chosen: IntentButtonLabel;
  /** Snapshot of the context that produced the ranking the user
   *  was choosing from. Stored verbatim so the ranker can
   *  replay-train without joining tables. */
  context: IntentContext;
  /** Wall-clock ms — fixes the chosen label to a tick. */
  ts: number;
}
