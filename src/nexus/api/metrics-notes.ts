// R-OCR.4.2 (2026-05-09) — metrics endpoints for the camera → notes
// pipeline.
//
//   GET  /v1/metrics/notes-from-image  → snapshot of the in-memory
//                                        collector (zero counts when
//                                        the daemon just booted).
//   POST /v1/metrics/notes-event       → PWA-side events the server
//                                        can't observe directly:
//                                        body {type:'cancel'|'edit'
//                                        |'discard', polishMode?}.
//
// Both endpoints share the same NotesMetricsCollector singleton wired
// at runNexus boot. When the collector is omitted from opts (tests
// without metrics) the GET returns an empty snapshot and the POST
// returns 503 not-wired.
//
// Cross-ref:
//   src/notes/metrics.ts (collector)
//   src/nexus/api/notes-from-image.ts (R-OCR.1 hook)
//   src/nexus/api/notes-save.ts (R-OCR.3 hook)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.4

import type { NotesMetricsCollector, NotesClientEventType } from '../../notes/metrics.js';

const VALID_EVENT_TYPES: readonly NotesClientEventType[] = ['cancel', 'edit', 'discard'];

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
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

export interface NotesMetricsRouteOpts {
  /** Shared collector singleton wired by runNexus at boot. When
   *  omitted, the GET returns an empty snapshot (so the PWA card can
   *  still render zero counts gracefully) and the POST returns 503. */
  metrics?: NotesMetricsCollector;
}

/** GET /v1/metrics/notes-from-image — snapshot of all counters. The
 *  endpoint name preserves the ROADMAP wording but the snapshot
 *  covers the full pipeline (ocr + save + client events). */
export function handleNotesMetricsSnapshot(
  _req: Request,
  opts: NotesMetricsRouteOpts,
): Response {
  if (!opts.metrics) {
    // Empty-snapshot fallback so the PWA Settings card always renders.
    // The user sees zeros when the collector isn't wired — clear
    // signal that something's off without needing a different render
    // branch.
    return jsonResponse({
      ok: true,
      snapshot: {
        ocr: { total: 0, failures: 0, byProvider: {}, byPolishMode: {} },
        save: { total: 0, failures: 0, byPolishMode: {} },
        client: { cancel: 0, edit: 0, discard: 0 },
        startedAt: new Date(0).toISOString(),
        ts: new Date().toISOString(),
      },
      wired: false,
    }, 200);
  }
  return jsonResponse({ ok: true, snapshot: opts.metrics.snapshot(), wired: true }, 200);
}

/** POST /v1/metrics/notes-event — PWA-side events. */
export async function handleNotesMetricsEvent(
  req: Request,
  opts: NotesMetricsRouteOpts,
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }
  if (!opts.metrics) {
    return jsonResponse({ ok: false, error: 'metrics_not_wired' }, 503);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'invalid_json' }, 400); }

  const b = body as { type?: unknown; polishMode?: unknown };
  if (typeof b.type !== 'string'
    || !VALID_EVENT_TYPES.includes(b.type as NotesClientEventType)) {
    return jsonResponse({
      ok: false,
      error: 'bad_request',
      reason: `type must be one of ${VALID_EVENT_TYPES.join('|')}`,
    }, 400);
  }
  const polishMode = typeof b.polishMode === 'string' ? b.polishMode : undefined;
  opts.metrics.recordClientEvent({
    type: b.type as NotesClientEventType,
    ...(polishMode ? { polishMode } : {}),
  });
  return jsonResponse({ ok: true }, 200);
}
