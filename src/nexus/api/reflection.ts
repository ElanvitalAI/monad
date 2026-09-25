// R6.2 (2026-05-09) — daily reflection endpoints.
//
//   GET /v1/reflection/today        — today's snapshot
//   GET /v1/reflection/:date        — specific day (YYYY-MM-DD)
//
// Both routes return the same `DailyReflectionSnapshot` shape so
// the PWA renders one component for both. v1 produces deterministic
// counts; v2 (Hansei LLM polish) wraps the snapshot.
//
// Cross-ref:
//   src/notes/daily-reflection.ts (buildDailyReflection)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R6

import {
  buildDailyReflection,
  dateKey,
  dayBounds,
  type DailyReflectionInput,
} from '../../notes/daily-reflection.js';

export type ReflectionRouteOpts = Pick<DailyReflectionInput, 'metrics' | 'history' | 'now'> & {
  /** Auth check seam. */
  checkAuth?: (req: Request) => boolean;
};

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

/** Extract the date from a path of shape /v1/reflection/:date.
 *  Returns 'today' for /v1/reflection/today; the date string
 *  for a YYYY-MM-DD; null otherwise. */
export function parseReflectionPath(pathname: string): string | null {
  const m = /^\/v1\/reflection\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const seg = decodeURIComponent(m[1]!);
  if (seg === 'today') return 'today';
  if (/^\d{4}-\d{2}-\d{2}$/.test(seg) && dayBounds(seg)) return seg;
  return null;
}

export function handleReflection(
  req: Request,
  segment: string,
  opts: ReflectionRouteOpts,
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

  const now = opts.now ?? Date.now;
  const date = segment === 'today' ? dateKey(now()) : segment;

  const snapshot = buildDailyReflection({
    date,
    ...(opts.metrics ? { metrics: opts.metrics } : {}),
    ...(opts.history ? { history: opts.history } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  return jsonResponse({ ok: true, snapshot }, 200);
}
