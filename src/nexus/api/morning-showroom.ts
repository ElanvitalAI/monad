// W9c Z13-c · POST /v1/morning-digest/showroom — 4-pane morning standup HTTP wire.
// Cf. Z7 substrate (#2440) digest-showroom-adapter.
//
// Body shape mirrors `MorningDigestInput` + an optional
// `backlogRecommendations[]` array (KGS signal that the digest composer
// itself does not carry).

import { composeMorningDigest, type MorningDigestInput } from '../../dispatch/morning-digest.js';
import {
  runMorningShowroom,
  type BacklogRecommendation,
  type MorningShowroomDeps,
} from '../../workflow-runtime/digest-showroom-adapter.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ⛔ 값은 «잎»이 갖는다 — 이유는 `rest-route-paths.ts` 머리말.
import { MORNING_SHOWROOM_PATH } from './rest-route-paths.js';
export { MORNING_SHOWROOM_PATH };
export function isMorningShowroomPath(p: string): boolean { return p === MORNING_SHOWROOM_PATH; }

export interface MorningShowroomRouteOpts {
  deps: MorningShowroomDeps;
  checkAuth?: (req: Request) => boolean;
}

export async function handleMorningShowroom(
  req: Request,
  opts: MorningShowroomRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid-json' }, 400); }

  const parsed = parseDigestInput(body);
  if (!parsed) {
    return jsonResponse({ error: 'invalid-digest-input' }, 400);
  }
  const digest = composeMorningDigest(parsed.input);
  const backlogRecommendations = parsed.backlogRecommendations;
  try {
    const card = await runMorningShowroom(
      { digest, ...(backlogRecommendations ? { backlogRecommendations } : {}) },
      opts.deps,
    );
    return jsonResponse({ card }, 200);
  } catch (err) {
    return jsonResponse(
      { error: 'morning-showroom-failed', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

interface ParsedRequest {
  input: MorningDigestInput;
  backlogRecommendations?: BacklogRecommendation[];
}

function parseDigestInput(body: unknown): ParsedRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.date !== 'string') return null;
  if (typeof b.windowStart !== 'string') return null;
  if (typeof b.windowEnd !== 'string') return null;
  if (!Array.isArray(b.runs)) return null;
  const input: MorningDigestInput = {
    date: b.date,
    windowStart: b.windowStart,
    windowEnd: b.windowEnd,
    runs: (b.runs as Array<Record<string, unknown>>).map((r) => ({
      taskId: String(r.taskId ?? ''),
      taskTitle: String(r.taskTitle ?? ''),
      outcome: (r.outcome as MorningDigestInput['runs'][number]['outcome']) ?? 'completed',
      startedAt: Number(r.startedAt ?? 0),
      ...(r.endedAt !== undefined ? { endedAt: Number(r.endedAt) } : {}),
      ...(r.errorSummary !== undefined ? { errorSummary: String(r.errorSummary) } : {}),
      ...(r.modelId !== undefined ? { modelId: String(r.modelId) } : {}),
      ...(r.tokensUsed !== undefined ? { tokensUsed: Number(r.tokensUsed) } : {}),
      ...(r.costUsd !== undefined ? { costUsd: Number(r.costUsd) } : {}),
    })),
    ...(Array.isArray(b.upcoming) ? {
      upcoming: (b.upcoming as Array<Record<string, unknown>>).map((u) => ({
        taskTitle: String(u.taskTitle ?? ''),
        ...(u.expectedSlot !== undefined ? { expectedSlot: String(u.expectedSlot) } : {}),
      })),
    } : {}),
    ...(b.resources && typeof b.resources === 'object' ? { resources: b.resources as MorningDigestInput['resources'] } : {}),
  };
  const out: ParsedRequest = { input };
  if (Array.isArray(b.backlogRecommendations)) {
    out.backlogRecommendations = (b.backlogRecommendations as Array<Record<string, unknown>>).map((r) => ({
      taskTitle: String(r.taskTitle ?? ''),
      ...(r.reason !== undefined ? { reason: String(r.reason) } : {}),
      ...(r.estimateMinutes !== undefined ? { estimateMinutes: Number(r.estimateMinutes) } : {}),
    }));
  }
  return out;
}
