// R5.4 (2026-05-09) — POST /v1/sessions/:id/decision.
//
// PWA Session Card Deck swipe lands a decision per session
// (reject / approve / pause / expand). v1 records the decision +
// publishes an event-bus frame so other consumers (ACP forward
// adapter · metric collector · log) can subscribe. Actual ACP
// message dispatch is intentionally deferred — keeping the
// endpoint pure-record means the deck UX is shippable today and
// the dispatch wiring can land incrementally without breaking the
// PWA contract.
//
// Endpoint shape
//   POST /v1/sessions/:id/decision
//   Content-Type: application/json
//   Body:
//     {
//       decision: 'reject' | 'approve' | 'pause' | 'expand'
//     }
//
// Response (200)
//   { ok, sessionId, decision, ts }
//
// Cross-ref:
//   src/nexus/api/sessions-active.ts (sibling — snapshot endpoint)
//   apps/pwa/src/components/card-swipe/CardSweepView.tsx (PWA caller)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R5

import type { NexusEventBus } from './event-bus.js';
import { debug } from '../../debug/log.js';

export type SessionDecision = 'reject' | 'approve' | 'pause' | 'expand';

export const SESSION_DECISIONS: readonly SessionDecision[] = [
  'reject', 'approve', 'pause', 'expand',
];

export interface SessionsDecisionOpts {
  /** Optional event bus — when provided, every accepted decision
   *  publishes `session-decision` so /v1/events SSE consumers (PWA
   *  status panel · future ACP forward adapter) can react without
   *  polling. */
  eventBus?: Pick<NexusEventBus, 'publish'>;
  /** Auth check seam. */
  checkAuth?: (req: Request) => boolean;
  /** Wall-clock seam. */
  now?: () => number;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function badRequest(reason: string): Response {
  return jsonResponse({ ok: false, error: 'bad_request', reason }, 400);
}

function isSessionDecision(v: unknown): v is SessionDecision {
  return typeof v === 'string' && (SESSION_DECISIONS as readonly string[]).includes(v);
}

/** Extract sessionId from a path of shape `/v1/sessions/:id/decision`.
 *  Returns null when the shape doesn't match (caller responds 404). */
export function parseSessionDecisionPath(pathname: string): string | null {
  const m = /^\/v1\/sessions\/([^/]+)\/decision$/.exec(pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1]!);
  // path-traversal guard — sessionIds never contain these segments;
  // a rewrite attempt indicates a malformed caller.
  if (!id || id === '..' || id.includes('/') || id.includes('\\')) return null;
  return id;
}

export async function handleSessionsDecision(
  req: Request,
  sessionId: string,
  opts: SessionsDecisionOpts,
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!sessionId) {
    return badRequest('sessionId required in path');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('invalid JSON body'); }
  const b = body as { decision?: unknown };
  if (!isSessionDecision(b.decision)) {
    return badRequest(
      `decision must be one of: ${SESSION_DECISIONS.join(', ')}`,
    );
  }

  const now = opts.now ?? Date.now;
  const ts = now();
  const tsIso = new Date(ts).toISOString();

  if (debug.enabled) {
    debug.log('sessions.decision', sessionId, {
      decision: b.decision,
      tsIso,
    });
  }

  // Fan to the event bus so subscribers (PWA SSE · future ACP
  // forward adapter) react without polling. Failure is inert —
  // the user-facing flow doesn't depend on bus delivery.
  if (opts.eventBus) {
    try {
      opts.eventBus.publish({
        ts,
        kind: 'session-decision',
        detail: { sessionId, decision: b.decision },
      });
    } catch { /* swallow */ }
  }

  return jsonResponse({
    ok: true,
    sessionId,
    decision: b.decision,
    ts: tsIso,
  }, 200);
}
