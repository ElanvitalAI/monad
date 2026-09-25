// W9c Z13-c · POST /v1/idle-nudge/preview — Z7 auto-relay HTTP wire.
// Cf. Z7 substrate (#2440) task-listener + nudge-policy.

import {
  observeIdleTask,
  type AutoRelayListenerDeps,
} from '../../showroom/auto-relay/task-listener.js';
import type { IdleTaskObservation } from '../../showroom/auto-relay/nudge-policy.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ⛔ 값은 «잎»이 갖는다 — 이유는 `rest-route-paths.ts` 머리말.
import { IDLE_NUDGE_PATH } from './rest-route-paths.js';
export { IDLE_NUDGE_PATH };
export function isIdleNudgePath(p: string): boolean { return p === IDLE_NUDGE_PATH; }

export interface IdleNudgeRouteOpts {
  deps: AutoRelayListenerDeps;
  checkAuth?: (req: Request) => boolean;
}

const STATUSES = new Set(['ready', 'running', 'review', 'blocked', 'awaiting-approval']);

export async function handleIdleNudge(
  req: Request,
  opts: IdleNudgeRouteOpts,
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

  const observation = parseObservation(body);
  if (!observation) {
    return jsonResponse({ error: 'invalid-observation' }, 400);
  }
  const ctx = parseContext(body);
  try {
    const { decision, record } = await observeIdleTask(observation, ctx, opts.deps);
    return jsonResponse({ decision, record }, 200);
  } catch (err) {
    return jsonResponse(
      { error: 'idle-nudge-failed', detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

function parseObservation(body: unknown): IdleTaskObservation | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.taskId !== 'string' || !b.taskId.trim()) return null;
  if (typeof b.status !== 'string' || !STATUSES.has(b.status)) return null;
  if (typeof b.enteredStatusAt !== 'number') return null;
  if (typeof b.observedAt !== 'number') return null;
  return {
    taskId: b.taskId,
    status: b.status as IdleTaskObservation['status'],
    enteredStatusAt: b.enteredStatusAt,
    observedAt: b.observedAt,
  };
}

function parseContext(body: unknown): { taskTitle: string; recentActivity?: string } {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const ctx: { taskTitle: string; recentActivity?: string } = {
    taskTitle: typeof b.taskTitle === 'string' ? b.taskTitle : '',
  };
  if (typeof b.recentActivity === 'string') ctx.recentActivity = b.recentActivity;
  return ctx;
}
