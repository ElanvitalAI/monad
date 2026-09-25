// CV-3 mobile-readiness item #1 · intent prediction hook (Phase 0.5).
//
// Subscribes to NEXUS `/v1/intent-prediction/:sessionId/sse` and
// exposes the live ranking + a feedback POST helper to the
// presenter component. Split from <IntentPanel /> so the logic
// can be unit-tested without DOM (PWA test env mirrors the β-1a
// `use-hitl-banner` pattern).
//
// Endpoint shape (PR 6 / #2047):
//   GET  /v1/intent-prediction/:sessionId/sse   — ranking stream
//   POST /v1/intent-prediction/:sessionId/feedback   — record tap
//
// SSE event kind: `intent-prediction.ranking`. Each frame's data
// payload is `IntentRanking` (canonical 6 candidates).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NexusClient } from '@/nexus/client';

// Canonical 6 button labels, mirrored from
// src/intent-prediction/types.ts. Frozen for the Phase 0 dogfood
// window so the iOS port (Phase 1) can pin localized strings
// against the same set.
export const INTENT_BUTTON_LABELS = [
  '계속 진행',
  '오토파일럿',
  '추가 보완',
  'diff 보여줘',
  '승인',
  '잠시 멈춤',
] as const;
export type IntentButtonLabel = (typeof INTENT_BUTTON_LABELS)[number];

export interface IntentCandidate {
  label: IntentButtonLabel;
  confidence: number;
  reason: string;
}

export interface IntentRanking {
  sessionId: string;
  candidates: IntentCandidate[];
  version: number;
  generatedAt: number;
}

/** The shape the PWA sends back to /feedback. The Phase 0.5 server
 *  re-derives `recentTaps` server-side, so the client doesn't need
 *  to track it — passing `[]` is acceptable. */
export interface IntentFeedbackContext {
  sessionId: string;
  lastTurnSummary: string;
  lastErr: string | null;
  progressPct: number;
  fileEditCount: number;
  idleMs: number;
}

export interface UseIntentPredictionOpts {
  /** NEXUS client used for the SSE subscription. Pass null to
   *  no-op (SSG prerender / no daemon configured). */
  client: NexusClient | null;
  /** sessionId to subscribe to. Pass null to skip subscription
   *  (e.g. before a Showroom DM session is provisioned). */
  sessionId: string | null;
  /** Daemon HTTP base URL — used for the /feedback POST. Empty
   *  string → submit returns early with an error. */
  baseUrl: string;
  /** Production gathers context from Showroom state (last turn
   *  summary, error, progress estimates). When omitted, we send
   *  a baseline empty context — Phase 0.5 server tolerates that. */
  buildContext?: () => IntentFeedbackContext | null;
  /** Optional fetch impl for tests. */
  fetchImpl?: typeof fetch;
  /** Optional debug hook (events: 'intent.sse.ranking',
   *  'intent.sse.error', 'intent.feedback.submit',
   *  'intent.feedback.error'). */
  onDebug?: (event: string, payload: Record<string, unknown>) => void;
}

export interface UseIntentPredictionResult {
  /** Live ranking — null until the first SSE frame arrives. */
  ranking: IntentRanking | null;
  /** True while a feedback POST is in flight. */
  submitting: boolean;
  /** Last submit error or null. */
  error: string | null;
  /** Record the user's tap. The hook constructs the request body
   *  using `buildContext` (or a baseline default) and POSTs to the
   *  /feedback endpoint. The server immediately re-ticks so the
   *  next SSE frame reflects the recency boost. */
  submitTap: (label: IntentButtonLabel) => Promise<void>;
}

/** Sort the 6 candidates by descending confidence. Pure helper —
 *  the presenter calls this once per render to display top-N
 *  styling. */
export function sortByConfidence(candidates: IntentCandidate[]): IntentCandidate[] {
  return [...candidates].sort((a, b) => b.confidence - a.confidence);
}

/** Map confidence ∈ [0,1] → bg intensity ∈ [0,100] for tailwind
 *  bg-{color}-{N} class names. The base floor (0.15) keeps the
 *  dimmest button still readable. */
export function confidenceToIntensity(confidence: number): number {
  if (Number.isNaN(confidence) || !Number.isFinite(confidence)) return 100;
  if (confidence <= 0) return 100;
  if (confidence >= 0.9) return 600;
  if (confidence >= 0.7) return 500;
  if (confidence >= 0.5) return 400;
  if (confidence >= 0.3) return 300;
  if (confidence >= 0.15) return 200;
  return 100;
}

/** Build the /feedback POST URL. Exposed for unit tests. */
export function buildFeedbackUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/v1/intent-prediction/${encodeURIComponent(sessionId)}/feedback`;
}

/** Pure parser for an SSE ranking frame. Returns null on shape
 *  mismatch so the caller can ignore corrupt frames silently. */
export function parseRankingFrame(data: unknown): IntentRanking | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Partial<IntentRanking>;
  if (typeof r.sessionId !== 'string') return null;
  if (!Array.isArray(r.candidates) || r.candidates.length !== 6) return null;
  if (typeof r.version !== 'number') return null;
  if (typeof r.generatedAt !== 'number') return null;
  for (const c of r.candidates) {
    if (!c || typeof c !== 'object') return null;
    const cc = c as Partial<IntentCandidate>;
    if (typeof cc.label !== 'string') return null;
    if (typeof cc.confidence !== 'number') return null;
  }
  return r as IntentRanking;
}

const DEFAULT_FEEDBACK_CONTEXT = (sessionId: string): IntentFeedbackContext => ({
  sessionId,
  lastTurnSummary: '',
  lastErr: null,
  progressPct: 0,
  fileEditCount: 0,
  idleMs: 0,
});

export function useIntentPrediction(opts: UseIntentPredictionOpts): UseIntentPredictionResult {
  const { client, sessionId, baseUrl, buildContext, fetchImpl, onDebug } = opts;
  const [ranking, setRanking] = useState<IntentRanking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef<typeof fetch>(fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch));

  useEffect(() => {
    fetchRef.current = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch);
  }, [fetchImpl]);

  // Reset ranking state when sessionId changes — defends against
  // stale data when the Showroom flips DM sessions or panel focus.
  useEffect(() => {
    if (!sessionId) setRanking(null);
  }, [sessionId]);

  useEffect(() => {
    if (!client) return undefined;
    if (!sessionId) return undefined;
    // 2026-05-09 dogfood fix — `service.recordFeedback` and the 5s
    // tick loop both gate on `tickScheduler.subscribers.has(sessionId)`,
    // so they no-op until something explicitly subscribes the
    // sessionId. The per-session SSE/snapshot endpoints subscribe
    // server-side as a side-effect; the global /v1/events bus does
    // NOT. Without this initial GET the tick scheduler never adds
    // this session, the ranker is never invoked, and the panel sits
    // at ranking=null forever even though the global events SSE is
    // wired correctly. The GET is fire-and-forget — the actual
    // ranking arrives via the SSE handler below.
    const url = `${baseUrl.replace(/\/$/, '')}/v1/intent-prediction/${encodeURIComponent(sessionId)}`;
    onDebug?.('intent.snapshot.attempt', { url });
    void (fetchRef.current?.(url, { method: 'GET' })?.then(async (res) => {
      if (!res.ok) return;
      try {
        const data = await res.json();
        const parsed = parseRankingFrame(data);
        if (parsed && parsed.sessionId === sessionId) {
          // Hand the snapshot through the same path live SSE frames
          // take so the first paint reflects the real ranking even
          // before the next tick lands.
          onDebug?.('intent.sse.ranking', { version: parsed.version });
          setRanking(parsed);
        }
      } catch { /* swallow — non-JSON or parse mismatch is fine */ }
    }).catch(() => { /* network blip — SSE will recover */ }));

    // The IntentPredictionService SSE uses a `kinds: [...]` opt
    // forward-compat hook on subscribeEvents to attach a named
    // listener for the `intent-prediction.ranking` frame. The
    // server scopes by sessionId via the URL; we filter again
    // client-side as defence against future fan-out widening.
    const off = client.subscribeEvents({
      topics: ['intent-prediction.'],
      kinds: ['intent-prediction.ranking'],
      onEvent: (ev) => {
        // The server emits `event: intent-prediction.ranking\ndata: <ranking>\n\n`.
        // The PWA NexusClient forwards the parsed data through as `ev`,
        // but the shape arriving here can be either the wrapped
        // `NexusEvent` (with `ev.detail`) or the raw ranking. Try both.
        if ((ev as { kind?: string }).kind === 'intent-prediction.ranking') {
          const detail = (ev as { detail?: unknown }).detail;
          const parsed = parseRankingFrame(detail);
          if (parsed && parsed.sessionId === sessionId) {
            onDebug?.('intent.sse.ranking', { version: parsed.version });
            setRanking(parsed);
          }
        } else {
          const parsed = parseRankingFrame(ev);
          if (parsed && parsed.sessionId === sessionId) {
            onDebug?.('intent.sse.ranking', { version: parsed.version });
            setRanking(parsed);
          }
        }
      },
      onError: (err) => onDebug?.('intent.sse.error', { msg: err.message }),
    });
    return off;
  }, [client, sessionId, baseUrl, onDebug]);

  const submitTap = useCallback(async (label: IntentButtonLabel): Promise<void> => {
    if (!sessionId) return;
    if (submitting) return;
    if (!baseUrl) {
      setError('daemon baseUrl not configured');
      return;
    }
    if (!fetchRef.current) {
      setError('fetch unavailable');
      return;
    }
    const ctx = buildContext?.() ?? DEFAULT_FEEDBACK_CONTEXT(sessionId);
    if (ctx.sessionId !== sessionId) {
      // Defensive: the build context might lag a session swap;
      // align to the URL session id so the server doesn't 400.
      ctx.sessionId = sessionId;
    }
    setSubmitting(true);
    setError(null);
    onDebug?.('intent.feedback.submit', { label, sessionId });
    try {
      const res = await fetchRef.current(buildFeedbackUrl(baseUrl, sessionId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chosen: label, context: ctx }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        onDebug?.('intent.feedback.error', { status: res.status });
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'submit failed';
      setError(msg);
      onDebug?.('intent.feedback.error', { msg });
    } finally {
      setSubmitting(false);
    }
  }, [baseUrl, buildContext, onDebug, sessionId, submitting]);

  return { ranking, submitting, error, submitTap };
}
