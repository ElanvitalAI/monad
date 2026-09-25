// CV-3 β-1a · PWA in-app HITL banner state hook.
//
// Subscribes to NEXUS `hitl.banner.show` / `hitl.banner.cancel`
// events and exposes the active prompt + submit() to the presenter
// component. Split from <HitlBanner /> so the logic can be unit-
// tested without the DOM (PWA test env has no React Testing
// Library — we test hooks via direct calls).
//
// Wire model:
//   - One pending banner at a time. A new `show` event replaces
//     any active one (rare but possible; the user-side race is
//     server-driven, not client-driven).
//   - `cancel` only clears when the requestId matches — defends
//     against stale cancels from a sibling channel that won the
//     server-side race after the user already answered here.
//   - submit() POSTs `/v1/hitl/callback/:requestId` with
//     `{answer:boolean}`. Same endpoint Pushcut Shortcut already
//     resolves through; the http-server's resolveAnswer dispatcher
//     wins whichever arrived first.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NexusClient } from '@/nexus/client';

export interface PendingHitlBanner {
  requestId: string;
  prompt: string;
  detail?: string;
  yesLabel: string;
  noLabel: string;
}

export interface UseHitlBannerOpts {
  /** NEXUS client for SSE subscription. Pass null to no-op (e.g.
   *  during SSG prerender or when the daemon baseUrl isn't set). */
  client: NexusClient | null;
  /** Daemon HTTP base URL — used to POST the callback. Empty string
   *  is treated as "no daemon configured" (submit returns early). */
  baseUrl: string;
  /** Optional fetch impl for tests. Production passes nothing → uses
   *  global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional debug hook so tests can verify subscription side-
   *  effects without depending on console output. */
  onDebug?: (event: string, payload: Record<string, unknown>) => void;
}

export interface UseHitlBannerResult {
  pending: PendingHitlBanner | null;
  /** True while a POST is in flight. Buttons disable to prevent
   *  double-submit (network race with a sibling channel resolving
   *  the server-side request). */
  submitting: boolean;
  /** Last submit error (cleared on each new show / submit). */
  error: string | null;
  /** Resolve the active banner. No-op when no pending. */
  submit: (answer: boolean) => Promise<void>;
}

interface ShowDetail {
  requestId: unknown;
  prompt: unknown;
  detail?: unknown;
  yesLabel?: unknown;
  noLabel?: unknown;
}

interface CancelDetail {
  requestId?: unknown;
}

export function parseShowDetail(detail: unknown): PendingHitlBanner | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as ShowDetail;
  if (typeof d.requestId !== 'string' || typeof d.prompt !== 'string') return null;
  return {
    requestId: d.requestId,
    prompt: d.prompt,
    ...(typeof d.detail === 'string' ? { detail: d.detail } : {}),
    yesLabel: typeof d.yesLabel === 'string' ? d.yesLabel : 'Yes',
    noLabel: typeof d.noLabel === 'string' ? d.noLabel : 'No',
  };
}

export function parseCancelRequestId(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as CancelDetail;
  return typeof d.requestId === 'string' ? d.requestId : null;
}

/** Pure reducer applied when an SSE event arrives. Extracted so the
 *  hook's behavior can be unit-tested without spinning up React. */
export function reduceHitlBannerEvent(
  prev: PendingHitlBanner | null,
  evKind: string,
  evDetail: unknown,
): PendingHitlBanner | null {
  if (evKind === 'hitl.banner.show') {
    return parseShowDetail(evDetail) ?? prev;
  }
  if (evKind === 'hitl.banner.cancel') {
    if (!prev) return prev;
    const cancelId = parseCancelRequestId(evDetail);
    if (cancelId !== null && cancelId !== prev.requestId) return prev;
    return null;
  }
  return prev;
}

/** Build the callback POST URL — exposed for unit tests. baseUrl
 *  trailing slash is stripped (mirrors the hook's behavior). */
export function buildCallbackUrl(baseUrl: string, requestId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/v1/hitl/callback/${encodeURIComponent(requestId)}`;
}

/** Interpret a submit() fetch response.
 *
 *   - 2xx → clear banner, no error
 *   - 404 → clear banner silently (sibling channel already won the
 *           server-side race; the request is already resolved)
 *   - other → keep banner, surface error so the user can retry */
export type SubmitOutcome =
  | { kind: 'cleared' }
  | { kind: 'error'; message: string };

export function interpretSubmitResponse(status: number): SubmitOutcome {
  if (status >= 200 && status < 300) return { kind: 'cleared' };
  if (status === 404) return { kind: 'cleared' };
  return { kind: 'error', message: `HTTP ${status}` };
}

export function useHitlBanner(opts: UseHitlBannerOpts): UseHitlBannerResult {
  const { client, baseUrl, fetchImpl, onDebug } = opts;
  const [pending, setPending] = useState<PendingHitlBanner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef<typeof fetch>(fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch));

  useEffect(() => {
    fetchRef.current = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch);
  }, [fetchImpl]);

  useEffect(() => {
    if (!client) return undefined;
    const off = client.subscribeEvents({
      topics: ['hitl.banner.'],
      onEvent: (ev) => {
        if (ev.kind === 'hitl.banner.show' || ev.kind === 'hitl.banner.cancel') {
          if (ev.kind === 'hitl.banner.show') {
            const parsed = parseShowDetail(ev.detail);
            if (parsed) onDebug?.('hitl.banner.show', { requestId: parsed.requestId });
          } else {
            const cid = parseCancelRequestId(ev.detail);
            onDebug?.('hitl.banner.cancel', { requestId: cid ?? '(missing)' });
          }
          setPending((prev) => reduceHitlBannerEvent(prev, ev.kind, ev.detail));
          if (ev.kind === 'hitl.banner.show') setError(null);
        }
      },
      onError: (err) => onDebug?.('hitl.banner.sse-error', { msg: err.message }),
    });
    return off;
  }, [client, onDebug]);

  const submit = useCallback(async (answer: boolean): Promise<void> => {
    if (!pending) return;
    if (submitting) return;
    if (!baseUrl) {
      setError('daemon baseUrl not configured');
      return;
    }
    if (!fetchRef.current) {
      setError('fetch unavailable');
      return;
    }
    setSubmitting(true);
    setError(null);
    const url = buildCallbackUrl(baseUrl, pending.requestId);
    onDebug?.('hitl.banner.submit', { requestId: pending.requestId, answer });
    try {
      const res = await fetchRef.current(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      const outcome = interpretSubmitResponse(res.status);
      if (outcome.kind === 'cleared') setPending(null);
      else setError(outcome.message);
    } catch (err) {
      setError((err as Error).message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }, [baseUrl, onDebug, pending, submitting]);

  return { pending, submitting, error, submit };
}
