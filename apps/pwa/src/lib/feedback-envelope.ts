// M1 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// PWA-side wire mirror of `src/feedback/envelope.ts`.
//
// Structural duplicate (no cross-tree import — PWA tsconfig scopes
// strictly to `apps/pwa/src/**`). Daemon side is authoritative; this
// file MUST stay in lock-step with the daemon module. The wire JSON is
// the contract — runtime guard validates incoming envelopes match.
//
// Why duplicate instead of @workspace import? Two reasons:
//   1. PWA bundles for the browser; daemon types pull node-only deps.
//   2. Keeps the wire schema explicit at the boundary — anyone touching
//      one side sees the other has to change.

export const FEEDBACK_KINDS = [
  'tool.progress',
  'tool.diff',
  'tool.search-hit',
  'agent.status',
  'agent.thinking',
  'agent.plan',
  'debug.line',
  'perf.tick',
  'hud.segment',
  'mission.update',
  'agent.chat-stream',
  'media.image',
  'media.video',
  'media.job',
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackPhase = 'start' | 'delta' | 'update' | 'end';

/** Wire-side envelope — payload is `unknown` until kind narrowing.
 *  Per-kind payload types live in `feedback-envelope-payloads.ts`
 *  (added incrementally as M3/M4/M5 wire each kind to a renderer). */
export interface FeedbackEnvelopeWire {
  envelopeVersion: 1;
  sessionId: string;
  blockId: string;
  parentToolCallId?: string;
  kind: FeedbackKind;
  phase: FeedbackPhase;
  emittedAt: number;
  seq: number;
  payload: unknown;
  asciiFallback: readonly string[];
}

const FEEDBACK_KIND_SET: ReadonlySet<string> = new Set(FEEDBACK_KINDS);

const FEEDBACK_PHASE_SET: ReadonlySet<string> = new Set<FeedbackPhase>([
  'start',
  'delta',
  'update',
  'end',
]);

/** Run-time validation for incoming SSE `feedback` events. Returns
 *  false for any wire-level deviation; consumers MUST ignore the
 *  envelope when this returns false (don't dispatch to onFeedback).
 *  Mirrors `isFeedbackEnvelope` in `src/feedback/envelope.ts`. */
export function isFeedbackEnvelopeWire(value: unknown): value is FeedbackEnvelopeWire {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.envelopeVersion !== 1) return false;
  if (typeof v.sessionId !== 'string' || !v.sessionId) return false;
  if (typeof v.blockId !== 'string' || !v.blockId) return false;
  if (typeof v.kind !== 'string' || !FEEDBACK_KIND_SET.has(v.kind)) return false;
  if (typeof v.phase !== 'string' || !FEEDBACK_PHASE_SET.has(v.phase)) return false;
  if (typeof v.emittedAt !== 'number') return false;
  if (typeof v.seq !== 'number' || v.seq < 0) return false;
  if (!Array.isArray(v.asciiFallback)) return false;
  if (v.payload === undefined || v.payload === null) return false;
  if (v.parentToolCallId !== undefined && typeof v.parentToolCallId !== 'string') return false;
  return true;
}
