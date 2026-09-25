// R5.0 (2026-05-09) — `/v1/sessions/active` snapshot.
//
// Powers the PWA Session Card Deck (R5.1+). The PWA shows
// in-progress sessions as a swipe stack so the user can decide
// (좌=reject · 우=approve · 위=pause · 아래=expand) per session
// without manually navigating to each one. We need a single
// endpoint that returns:
//   - all alive sessions ordered by recent activity
//   - per-session metadata the card renders without follow-up
//     (last activity time · preview · status pill)
//
// Status pill derivation (time-based only at v1; v2 may add the
// turn-tracker's lastErr for an explicit 'error' status):
//   active : lastTurnAt within 5 min
//   idle   : lastTurnAt within 24 h
//   stale  : older than 24 h (filtered out of the active list by
//            default — caller can opt in via `?stale=1`)
//
// Cross-ref:
//   src/boot/daemon-runtime.ts (DaemonSessionSummary)
//   src/nexus/api/meta-api.ts (handleSessionsList — sibling)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R5

import type { DaemonSessionHistory, DaemonSessionSummary } from '../../boot/daemon-runtime.js';

export type SessionStatus = 'active' | 'idle' | 'stale';

export interface ActiveSessionSnapshot extends DaemonSessionSummary {
  status: SessionStatus;
  /** ms since the last turn — useful for sort tie-breaks + UI age
   *  rendering (`3분 전` / `2시간 전`) without parsing `lastTurnAt`
   *  back into a Date on the client. */
  ageMs: number;
}

export interface SessionsActiveSnapshot {
  ok: true;
  sessions: ActiveSessionSnapshot[];
  total: number;
  ts: string;
}

export interface SessionsActiveOpts {
  history?: Pick<DaemonSessionHistory, 'summary'>;
  /** Wall-clock seam for tests. */
  now?: () => number;
  /** Auth check — same shape as sibling endpoints. */
  checkAuth?: (req: Request) => boolean;
}

const ACTIVE_THRESHOLD_MS = 5 * 60_000;       // 5 min
const IDLE_THRESHOLD_MS = 24 * 60 * 60_000;   // 24 h

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
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

function deriveStatus(ageMs: number): SessionStatus {
  if (ageMs <= ACTIVE_THRESHOLD_MS) return 'active';
  if (ageMs <= IDLE_THRESHOLD_MS) return 'idle';
  return 'stale';
}

/** GET /v1/sessions/active — live session snapshot for the card deck.
 *  Query params:
 *    `?stale=1`  include sessions whose last activity is >24h old
 *                (default omits them). Useful for the "show all"
 *                affordance the card deck offers when the active
 *                list is empty. */
export function handleSessionsActive(
  req: Request,
  opts: SessionsActiveOpts,
): Response {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!opts.history) {
    return jsonResponse({ ok: false, error: 'sessions_history_not_wired' }, 503);
  }

  const url = new URL(req.url);
  const includeStale = url.searchParams.get('stale') === '1';
  const now = opts.now ?? Date.now;
  const nowMs = now();

  const summaries = opts.history.summary();
  const enriched: ActiveSessionSnapshot[] = [];
  for (const s of summaries) {
    const turnMs = Date.parse(s.lastTurnAt);
    const ageMs = Number.isFinite(turnMs) ? Math.max(0, nowMs - turnMs) : Number.MAX_SAFE_INTEGER;
    const status = deriveStatus(ageMs);
    if (status === 'stale' && !includeStale) continue;
    enriched.push({ ...s, status, ageMs });
  }
  // Most-recent first so the card deck shows the most-engaging
  // session at the top (drives the swipe affordance).
  enriched.sort((a, b) => a.ageMs - b.ageMs);

  const body: SessionsActiveSnapshot = {
    ok: true,
    sessions: enriched,
    total: enriched.length,
    ts: new Date(nowMs).toISOString(),
  };
  return jsonResponse(body, 200);
}
