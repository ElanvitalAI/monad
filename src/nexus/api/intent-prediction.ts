// NEXUS · intent-prediction REST + SSE handlers (Phase 0.5 · 2026-05-08).
//
// PLAN: 내부 문서 `PLAN-ios-companion-app-2026-05-08` §7.3
//
// Endpoints
//   GET  /v1/intent-prediction/:sessionId            — snapshot
//   GET  /v1/intent-prediction/:sessionId/sse        — live stream
//   POST /v1/intent-prediction/:sessionId/feedback   — record tap
//
// Architecture decision: a per-session SSE endpoint (rather than
// fan-out via the global `/v1/events` bus) so the PWA Intent panel
// can subscribe to exactly one session's ranking without filtering
// noise. The 5s tick × N sessions traffic stays scoped — proxies +
// EventSource-based clients see a clean per-tab connection.
//
// Cross-ref: src/intent-prediction/index.ts (service composer)

import {
  isIntentButtonLabel,
  type IntentContext,
  type IntentFeedback,
  type IntentPredictionService,
  type IntentRanking,
} from '../../intent-prediction/index.js';
import { SSE_HEARTBEAT_MS } from './sse-heartbeat.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function badRequest(msg: string): Response {
  return jsonResponse({ error: msg }, 400);
}

function notFound(): Response {
  return jsonResponse({ error: 'not found' }, 404);
}

export interface IntentPredictionRouteOpts {
  /** The composed intent-prediction service. NEXUS bootstrap
   *  constructs this once and passes through to every request. */
  service: IntentPredictionService;
  /** Optional auth check — production routes through the same
   *  meta-api `checkAuth` shape; tests pass undefined to skip. */
  checkAuth?: (req: Request) => boolean;
}

/** GET /v1/intent-prediction/:sessionId  — current ranking snapshot.
 *
 *  Lazy-subscribes the session id on first call so PWA tabs that
 *  arrive without a prior SSE connection still see a populated
 *  ranking instead of `null`. Subsequent calls reuse the cached
 *  ranking; the next tick re-publishes via SSE. */
export function handleIntentPredictionSnapshot(
  req: Request,
  sessionId: string,
  opts: IntentPredictionRouteOpts,
): Response {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (!sessionId) return badRequest('sessionId required');
  // Subscribe lazily — the service tickNow's the new id so the
  // immediate snapshot reflects the latest context.
  const ranking = opts.service.subscribe(sessionId);
  if (!ranking) return notFound();
  return jsonResponse(ranking, 200);
}

/** GET /v1/intent-prediction/:sessionId/sse — live ranking stream.
 *
 *  Each ranking change emits an `event: intent-prediction.ranking`
 *  frame. Clients should parse the `data:` payload as `IntentRanking`.
 *  Heartbeat comment every 25s so intermediaries don't time out. */
export function handleIntentPredictionSse(
  req: Request,
  sessionId: string,
  opts: IntentPredictionRouteOpts,
): Response {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (!sessionId) return badRequest('sessionId required');

  let teardown: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string): void => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };

      // Initial comment so curl + browser EventSource see the
      // connection succeed immediately.
      send(`: nexus intent-prediction stream (sessionId: ${sessionId})\n\n`);

      // Subscribe + emit the latest snapshot right away so the
      // PWA panel renders without waiting for the first tick.
      const initial = opts.service.subscribe(sessionId);
      if (initial) {
        send(`event: intent-prediction.ranking\n`);
        send(`data: ${JSON.stringify(initial)}\n\n`);
      }

      const off = opts.service.onRanking((ranking: IntentRanking) => {
        if (ranking.sessionId !== sessionId) return;  // scope filter
        send(`event: intent-prediction.ranking\n`);
        send(`data: ${JSON.stringify(ranking)}\n\n`);
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), SSE_HEARTBEAT_MS);
      teardown = () => {
        clearInterval(heartbeat);
        off();
        opts.service.unsubscribe(sessionId);
      };
    },
    cancel() {
      teardown?.();
      teardown = undefined;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}

/** POST /v1/intent-prediction/:sessionId/feedback — record a tap.
 *
 *  Body: { chosen: IntentButtonLabel, context: IntentContext }
 *  The service records into its feedback store + immediately
 *  re-ticks the session so subsequent SSE frames reflect the new
 *  recency boost. */
export async function handleIntentPredictionFeedback(
  req: Request,
  sessionId: string,
  opts: IntentPredictionRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (!sessionId) return badRequest('sessionId required');
  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('invalid JSON body'); }

  const b = body as { chosen?: unknown; context?: unknown };
  if (!isIntentButtonLabel(b.chosen)) {
    return badRequest('chosen must be one of the canonical IntentButtonLabel values');
  }
  // Context shape validation: every required field present + types.
  // The ranker tolerates missing optional fields, but we still
  // enforce a baseline so corrupt clients fail loudly here rather
  // than producing garbage rankings later.
  const ctx = b.context as Partial<IntentContext> | undefined;
  if (!ctx || typeof ctx !== 'object') {
    return badRequest('context required');
  }
  if (typeof ctx.sessionId !== 'string' || ctx.sessionId !== sessionId) {
    return badRequest('context.sessionId must match URL :sessionId');
  }
  if (typeof ctx.lastTurnSummary !== 'string') {
    return badRequest('context.lastTurnSummary required (string)');
  }
  if (ctx.lastErr !== null && typeof ctx.lastErr !== 'string') {
    return badRequest('context.lastErr must be string or null');
  }
  if (typeof ctx.progressPct !== 'number') {
    return badRequest('context.progressPct required (number)');
  }
  if (typeof ctx.fileEditCount !== 'number') {
    return badRequest('context.fileEditCount required (number)');
  }
  if (typeof ctx.idleMs !== 'number') {
    return badRequest('context.idleMs required (number)');
  }

  const feedback: IntentFeedback = {
    sessionId,
    chosen: b.chosen,
    context: {
      sessionId,
      lastTurnSummary: ctx.lastTurnSummary,
      lastErr: ctx.lastErr,
      progressPct: ctx.progressPct,
      fileEditCount: ctx.fileEditCount,
      idleMs: ctx.idleMs,
      // recentTaps is server-managed (the store overrides it on the
      // next tick) — accept whatever the client sent but the ranker
      // will ignore it after the immediate re-tick.
      recentTaps: Array.isArray(ctx.recentTaps)
        ? ctx.recentTaps.filter(isIntentButtonLabel)
        : [],
    },
    ts: Date.now(),
  };

  opts.service.recordFeedback(feedback);
  return jsonResponse({ ok: true, feedbackCount: opts.service.diagnostics().feedbackCount }, 200);
}

/** Route dispatcher — http-server delegates here for any path that
 *  starts with `/v1/intent-prediction/`. Returns null when the
 *  path doesn't match a known shape so the caller falls through
 *  to the 404 handler. */
export async function dispatchIntentPredictionRoute(
  req: Request,
  url: URL,
  opts: IntentPredictionRouteOpts,
): Promise<Response | null> {
  const PREFIX = '/v1/intent-prediction/';
  if (!url.pathname.startsWith(PREFIX)) return null;
  const tail = url.pathname.slice(PREFIX.length);
  if (!tail) return null;

  // Match `:sessionId/sse`, `:sessionId/feedback`, or `:sessionId`.
  if (tail.endsWith('/sse')) {
    if (req.method !== 'GET') return jsonResponse({ error: 'method not allowed' }, 405);
    const sessionId = decodeURIComponent(tail.slice(0, -'/sse'.length));
    return handleIntentPredictionSse(req, sessionId, opts);
  }
  if (tail.endsWith('/feedback')) {
    if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);
    const sessionId = decodeURIComponent(tail.slice(0, -'/feedback'.length));
    return handleIntentPredictionFeedback(req, sessionId, opts);
  }
  // Plain `:sessionId` snapshot.
  if (req.method !== 'GET') return jsonResponse({ error: 'method not allowed' }, 405);
  const sessionId = decodeURIComponent(tail);
  return handleIntentPredictionSnapshot(req, sessionId, opts);
}
