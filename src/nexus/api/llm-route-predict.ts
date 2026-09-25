// NEXUS · POST /v1/llm/route/predict — mission router HTTP wire.
//
// HANDOFF §3.4 originally specified an ACP custom JSON-RPC method
// (`monad/route/predict`), but ACP SDK v0.14.1 does not expose a low-
// level escape hatch for agent→client custom methods (see notes in
// `src/acp/monad-extensions.ts`). A REST endpoint on the existing
// NEXUS HTTP server is the pragmatic equivalent — same DI seam, same
// bearer auth, same CORS surface as `/v1/llm/rotation` (PR #2576).
//
// Request body (JSON):
//   {
//     sessionId?: string,                                  // opaque · echoed back
//     text: string,                                        // user input snapshot
//     attachments?: Array<{ kind: 'image'|'audio'|'video'|'document' }>,
//   }
//
// Response (JSON, 200):
//   MissionPrediction (mission, provider, model?, confidence, tier, alternatives?)
//
// Error responses:
//   400 invalid-request — body parse failure / missing `text`
//   503 router-not-configured — `opts.missionRouter` not wired at boot
//
// The DI seam mirrors PR #2657's `conversationAggregator` pattern:
// production boot passes `globalMissionRouter()`; tests pass a fake.

import type { MissionRouter, MissionAttachmentKind } from '../../llm/mission-router.js';

const VALID_ATTACHMENT_KINDS: ReadonlyArray<MissionAttachmentKind> = [
  'image', 'audio', 'video', 'document',
];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
    },
  });
}

interface RoutePredictRequest {
  sessionId?: string;
  text: string;
  attachments?: Array<{ kind: string }>;
}

function isAttachmentKind(s: unknown): s is MissionAttachmentKind {
  return typeof s === 'string' && (VALID_ATTACHMENT_KINDS as readonly string[]).includes(s);
}

/** Pure parse step — returns the validated request or an error message
 *  for callers that want to format their own 400 response. */
export function parseRoutePredictBody(raw: unknown): { ok: true; req: RoutePredictRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  const text = obj.text;
  if (typeof text !== 'string') {
    return { ok: false, error: '`text` is required (string)' };
  }
  const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : undefined;
  const attachmentsRaw = obj.attachments;
  let attachments: Array<{ kind: string }> | undefined;
  if (Array.isArray(attachmentsRaw)) {
    attachments = [];
    for (const item of attachmentsRaw) {
      if (item && typeof item === 'object') {
        const kind = (item as Record<string, unknown>).kind;
        if (isAttachmentKind(kind)) attachments.push({ kind });
      }
    }
  }
  return {
    ok: true,
    req: {
      ...(sessionId !== undefined ? { sessionId } : {}),
      text,
      ...(attachments !== undefined ? { attachments } : {}),
    },
  };
}

export async function handleLlmRoutePredict(
  req: Request,
  opts: { missionRouter?: MissionRouter },
): Promise<Response> {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method-not-allowed', method: req.method }, 405);
  }
  if (!opts.missionRouter) {
    return jsonResponse({ error: 'router-not-configured' }, 503);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid-request', detail: 'body is not valid JSON' }, 400);
  }
  const parsed = parseRoutePredictBody(raw);
  if (!parsed.ok) {
    return jsonResponse({ error: 'invalid-request', detail: parsed.error }, 400);
  }

  const prediction = await opts.missionRouter.predict({
    text: parsed.req.text,
    sessionId: parsed.req.sessionId,
    attachments: parsed.req.attachments?.map((a) => ({ kind: a.kind as MissionAttachmentKind })),
  });
  return jsonResponse(prediction, 200);
}
