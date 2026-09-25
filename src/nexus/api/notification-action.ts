// NEXUS · notification-action endpoint (R3 · BACKLOG-pwa-mobile-readiness #5).
//
// PWA service worker (apps/pwa/public/sw.js) POSTs here when the
// user taps an inline action button on a Web Push notification.
// The notification's `actions` array is supplied by
// `src/web-push/notify-turn-end.ts` — 5 entries mirroring
// INTENT_BUTTON_LABELS, each with action id `intent-<idx>`.
//
// Endpoint behavior
//   POST /v1/notification-action  body: { sessionId, action }
//     - sessionId: ACP session id (or null if the SW couldn't
//                  resolve one — still record so the recency boost
//                  benefits the next session the user opens)
//     - action:    'intent-0'..'intent-5'  → resolves to the label
//                  via INTENT_BUTTON_LABELS[idx]
//
// The endpoint records as an intent-prediction feedback tap (recency
// boost) so when the user opens the PWA the IntentPanel reflects
// the choice. R3 v2 (2026-05-09) — when `loopback` is wired, the
// handler also fires a synthetic ACP turn with the chosen label as
// the user prompt; the agent runs end-to-end + sends another web-push
// with its response, so the user sees progress on the lock screen
// without opening the PWA. Loopback is fire-and-forget — the response
// returns 200 to the SW immediately + logs `loopbackQueued: true`.
//
// Cross-ref:
//   apps/pwa/public/sw.js notificationclick handler
//   src/web-push/notify-turn-end.ts (TURN_END_ACTIONS)
//   src/web-push/notification-action-loopback.ts (R3 v2 loopback)
//   src/intent-prediction/index.ts (recordFeedback)

import {
  INTENT_BUTTON_LABELS,
  type IntentFeedback,
  type IntentPredictionService,
} from '../../intent-prediction/index.js';
import type { NotificationActionLoopback } from '../../web-push/notification-action-loopback.js';
import { debug } from '../../debug/log.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function badRequest(msg: string): Response {
  return jsonResponse({ error: msg }, 400);
}

const ACTION_ID_PREFIX = 'intent-';
const ACTION_ID_PATTERN = /^intent-([0-9]+)$/;

/** Resolve an `intent-N` action id back to its canonical
 *  IntentButtonLabel. Returns null when the id doesn't match the
 *  expected shape or the index is out of bounds. */
export function resolveNotificationActionLabel(
  actionId: string,
): (typeof INTENT_BUTTON_LABELS)[number] | null {
  const m = ACTION_ID_PATTERN.exec(actionId);
  if (!m) return null;
  const idx = Number.parseInt(m[1]!, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= INTENT_BUTTON_LABELS.length) return null;
  return INTENT_BUTTON_LABELS[idx]!;
}

export interface NotificationActionRouteOpts {
  service: IntentPredictionService;
  /** Optional auth check — production routes the same `checkAuth`
   *  shape that meta-api uses. SW POSTs without auth (see comment
   *  in apps/pwa/public/sw.js) so production pairs this endpoint
   *  with a Tailscale-only listener; tests pass undefined. */
  checkAuth?: (req: Request) => boolean;
  /** Wall-clock seam for tests. Defaults to Date.now. */
  now?: () => number;
  /** R3 v2 (2026-05-09) — fire-and-forget ACP loopback so the agent
   *  actually runs the chosen-label as a synthetic prompt. When
   *  omitted, behavior collapses to R3 v1 (feedback record only).
   *  Caller (runNexus) wires this from the same `runTurn` the ACP
   *  server uses; tests pass undefined to keep the unit scope tight. */
  loopback?: NotificationActionLoopback;
}

/** POST /v1/notification-action — record a notification action
 *  click. Body: { sessionId: string | null, action: string }.
 *
 *  Fire-and-forget from the SW's perspective — we still return a
 *  200 with the resolved label + feedback count so curl smoke
 *  tests can verify the round-trip. */
export async function handleNotificationAction(
  req: Request,
  opts: NotificationActionRouteOpts,
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

  const b = body as { sessionId?: unknown; action?: unknown };
  if (typeof b.action !== 'string' || b.action.length === 0) {
    return badRequest('action required (string)');
  }
  if (!b.action.startsWith(ACTION_ID_PREFIX)) {
    return badRequest(`action must start with "${ACTION_ID_PREFIX}"`);
  }
  const label = resolveNotificationActionLabel(b.action);
  if (!label) {
    return badRequest(`unknown action id: ${b.action}`);
  }
  // sessionId is optional — when absent (no session match in SW)
  // the recency boost still applies via a wildcard sentinel so the
  // next session the user opens can pick it up. Empty string +
  // null both fold to the sentinel.
  const sessionId = (typeof b.sessionId === 'string' && b.sessionId.length > 0)
    ? b.sessionId
    : '__notification_action__';
  const now = opts.now ?? Date.now;
  // Minimum-context feedback record. The ranker only uses the
  // recency-tap list for its boost, so the zeroed context fields
  // are fine here (the next live tick will carry the real session
  // context if the user actually opens that session).
  const feedback: IntentFeedback = {
    sessionId,
    chosen: label,
    context: {
      sessionId,
      lastTurnSummary: '',
      lastErr: null,
      progressPct: 0,
      fileEditCount: 0,
      idleMs: 0,
      recentTaps: [],
    },
    ts: now(),
  };
  opts.service.recordFeedback(feedback);
  // R3 v2 — fire-and-forget loopback. Only triggers when:
  //   1. opts.loopback is wired (runNexus path)
  //   2. sessionId resolved to a real id (not the wildcard sentinel) —
  //      we need a concrete session for runTurn's history persistence
  //      and the post-turn web-push fan-out.
  // The promise is intentionally NOT awaited: the SW expects a fast
  // 200 (action click is on the lock screen, no UI blocking the user).
  // Errors inside the loopback are logged in the runner itself.
  let loopbackQueued = false;
  if (opts.loopback && sessionId !== '__notification_action__') {
    loopbackQueued = true;
    void opts.loopback.run({ sessionId, promptText: label });
    debug.log('push.action.handler.loopback-queue', sessionId, label);
  }
  return jsonResponse({
    ok: true,
    label,
    sessionId,
    feedbackCount: opts.service.diagnostics().feedbackCount,
    loopbackQueued,
  }, 200);
}
