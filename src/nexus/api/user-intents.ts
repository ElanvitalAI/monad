// ── NEXUS · user-intent emit endpoint (cascade-zyu W1 U0) ──
//
// PLAN: 내부 문서 `PLAN-user-intent-logging-2026-05-12` §3.2 / §7.1
// MANUAL: 내부 문서 `MANUAL-user-intent-logging-2026-05-12`
//
// Endpoints:
//   POST /v1/user-intents/emit   — PWA / iOS / Watch / AirPods bridge
//                                   forward UserIntentEventInput here.
//                                   Body = UserIntentEventInput JSON.
//                                   Returns { event_id, ts } on success.
//   POST /v1/user-intents/batch  — batched emit (iOS / Watch · 50ms
//                                   coalesce + retry queue). Body =
//                                   { events: UserIntentEventInput[] }.
//                                   Returns { ok, accepted, rejected,
//                                   event_ids: [...] }. PR D (2026-05-15
//                                   iOS cascade) — KGS substrate wire.
//
// The endpoint is the network counterpart to the in-process
// `userIntentLogger.emit(...)` call surfaces use directly. Both end
// up writing the same JSONL line (sink fan-out is owned by the
// logger), so a TUI keypress and a PWA swipe land in one combined
// stream the Patcher (Y3) ingests.
//
// Auth posture: loopback-only by default; opts.checkAuth lets the
// boot wiring tighten it when the NEXUS is bound to a non-loopback
// hostname (Tailscale share).

import {
  isUserIntentEventInput,
  userIntentLogger,
  type UserIntentEventInput,
} from '../../user-intent/index.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function badRequest(reason: string): Response {
  return jsonResponse({ error: 'bad_request', reason }, 400);
}

export interface UserIntentRouteOpts {
  /** Optional auth gate — matches the rest of the NEXUS POST routes
   *  shape. Tests pass undefined to skip. */
  checkAuth?: (req: Request) => boolean;
}

export async function handleUserIntentEmit(
  req: Request,
  opts: UserIntentRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('invalid JSON body'); }
  if (!isUserIntentEventInput(body)) {
    return badRequest('UserIntentEventInput.surface + intent.layer + intent.kind required');
  }
  const event = userIntentLogger().emit(body as UserIntentEventInput);
  if (!event) {
    return jsonResponse({ ok: false, reason: 'logger_disabled' }, 503);
  }
  return jsonResponse({ ok: true, event_id: event.event_id, ts: event.ts }, 200);
}

/** PR D (2026-05-15 iOS cascade) — batched emit · iOS forwarder 의 50 ms
 *  coalesce flush. partial success (일부 reject) 도 200 + 통계 — caller
 *  가 retry queue 의 partial drain 결정.
 *
 *  Body: `{ events: UserIntentEventInput[] }` · max 200 events / batch
 *  (caller-side cap · 본 endpoint 는 무제한 처리하나 RTT 측면에서 권장).
 */
export async function handleUserIntentBatch(
  req: Request,
  opts: UserIntentRouteOpts = {},
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('invalid JSON body'); }
  const obj = body as { events?: unknown } | null;
  if (!obj || !Array.isArray(obj.events)) {
    return badRequest('body.events: UserIntentEventInput[] required');
  }
  const eventIds: string[] = [];
  let accepted = 0;
  let rejected = 0;
  const logger = userIntentLogger();
  for (const candidate of obj.events) {
    if (!isUserIntentEventInput(candidate)) {
      rejected += 1;
      continue;
    }
    const event = logger.emit(candidate as UserIntentEventInput);
    if (event) {
      accepted += 1;
      eventIds.push(event.event_id);
    } else {
      // logger disabled — 전체 batch reject 보다 partial counting (caller
      // 가 retry queue 의 backoff 결정 신호 가능).
      rejected += 1;
    }
  }
  return jsonResponse({
    ok: true,
    accepted,
    rejected,
    event_ids: eventIds,
  }, 200);
}
