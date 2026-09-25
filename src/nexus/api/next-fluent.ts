// W9c Z13-a · POST /v1/next-fluent/preview — Z10 fluent showroom HTTP wire.
// Cf. Z10 substrate (#2438) + 내부 문서 §2 Z13-a.
//
// The endpoint accepts a `TaskDoneRecord` shape, fires the Z10 3-persona
// cascade against an injected lane callable + next-action source, and
// returns the resulting `NextFluentCard`. The PWA chip + future cron
// task-done hook both consume the same endpoint so the chain has one
// canonical entry point.

import {
  runNextFluentShowroom,
  type NextFluentCard,
  type NextFluentHookDeps,
  type TaskDoneRecord,
} from '../../task-orchestrator/next-fluent-hook.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const NEXT_FLUENT_PREVIEW_PATH = '/v1/next-fluent/preview';
/** W? 2026-07-15 — 칩 1-클릭 액션 실행(rebuild·split·skip·check·escalate·revise). */
// ⛔ 값은 «잎»이 갖는다 — 이유는 `rest-route-paths.ts` 머리말.
import { NEXT_FLUENT_DISPATCH_PATH } from './rest-route-paths.js';
export { NEXT_FLUENT_DISPATCH_PATH };

export function isNextFluentPreviewPath(pathname: string): boolean {
  return pathname === NEXT_FLUENT_PREVIEW_PATH;
}
export function isNextFluentDispatchPath(pathname: string): boolean {
  return pathname === NEXT_FLUENT_DISPATCH_PATH;
}

/** 칩 클릭 → 페이즈 액션 실행 콜러블(데몬이 dispatchAutopilotMissions 로 배선). refId=phaseId. */
export type NextFluentDispatchFn = (refId: string, action: string) => Promise<{ ok: boolean; message?: string; error?: string }>;

export interface NextFluentRouteOpts {
  /** Deps for the showroom hook; the daemon wires lane callable +
   *  next-action source. The `enabled` toggle is honored — when false
   *  the endpoint returns 409 instead of silently returning null. */
  deps: NextFluentHookDeps;
  /** 1-클릭 액션 실행(2026-07-15) — 미배선이면 dispatch route 503. */
  dispatch?: NextFluentDispatchFn;
  checkAuth?: (req: Request) => boolean;
}

/** POST /v1/next-fluent/dispatch — {refId, action} → 페이즈 액션 실행(HITL 파리티). */
export async function handleNextFluentDispatch(
  req: Request,
  opts: NextFluentRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);
  if (!opts.dispatch) return jsonResponse({ error: 'next-fluent-dispatch-not-wired' }, 503);
  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid-json' }, 400); }
  const b = body as { refId?: unknown; action?: unknown };
  if (typeof b.refId !== 'string' || !b.refId.trim() || typeof b.action !== 'string' || !b.action.trim()) {
    return jsonResponse({ error: 'invalid-dispatch' }, 400);
  }
  let r: { ok: boolean; message?: string; error?: string };
  try { r = await opts.dispatch(b.refId, b.action); }
  catch (err) { return jsonResponse({ error: 'dispatch-failed', detail: err instanceof Error ? err.message : String(err) }, 500); }
  return jsonResponse(r, r.ok ? 200 : 400);
}

export async function handleNextFluentPreview(
  req: Request,
  opts: NextFluentRouteOpts,
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

  const record = parseRecord(body);
  if (!record) {
    return jsonResponse({ error: 'invalid-record' }, 400);
  }

  let card: NextFluentCard | null;
  try {
    card = await runNextFluentShowroom(record, opts.deps);
  } catch (err) {
    return jsonResponse(
      { error: 'fluent-failed', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
  if (!card) {
    // Either toggle is off OR the next-action source declined.
    return jsonResponse({ error: 'no-suggestions', enabled: opts.deps.enabled() }, opts.deps.enabled() ? 204 : 409);
  }
  return jsonResponse({ card }, 200);
}

function parseRecord(body: unknown): TaskDoneRecord | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;
  if (typeof r.refId !== 'string' || !r.refId.trim()) return null;
  if (typeof r.refKind !== 'string' || !r.refKind.trim()) return null;
  if (r.outcome !== 'ok' && r.outcome !== 'failed') return null;
  if (typeof r.completedAt !== 'number') return null;
  const finishedSurface = r.finishedSurface ?? null;
  const record: TaskDoneRecord = {
    refId: r.refId,
    refKind: r.refKind,
    finishedSurface: typeof finishedSurface === 'string'
      ? (finishedSurface as TaskDoneRecord['finishedSurface'])
      : null,
    outcome: r.outcome,
    completedAt: r.completedAt,
  };
  if (typeof r.retroSummary === 'string') record.retroSummary = r.retroSummary;
  if (Array.isArray(r.tags)) {
    record.tags = r.tags.filter((t): t is string => typeof t === 'string');
  }
  return record;
}
