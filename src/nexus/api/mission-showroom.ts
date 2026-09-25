// W9b Z2 · GET /v1/missions/:id/showroom + POST archive + POST deliberate.

import {
  applyMissionDecision,
  archiveMissionRoom,
  runMissionDeliberation,
  spawnMissionRoom,
  type MissionRoomDeps,
} from '../../task-orchestrator/mission-showroom.js';
import type { Mission } from '../../task-orchestrator/mission.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface MissionShowroomRouteOpts {
  /** Resolve the Mission entity by id. Returns null when missing. The
   *  daemon wires this to the mission store (intake plane). */
  resolveMission: (missionId: string) => Promise<Mission | null>;
  /** Persist mission changes (the GET endpoint may attach
   *  `showroomSessionId` on first spawn). Best-effort — when undefined,
   *  the link still returns to the client but is not durable. */
  saveMission?: (mission: Mission) => Promise<void>;
  deps: MissionRoomDeps;
  checkAuth?: (req: Request) => boolean;
}

const ROOM_RE      = /^\/v1\/missions\/([^/]+)\/showroom$/;
const ARCHIVE_RE   = /^\/v1\/missions\/([^/]+)\/showroom\/archive$/;
const DELIBERATE_RE = /^\/v1\/missions\/([^/]+)\/showroom\/deliberate$/;
const DECISION_RE  = /^\/v1\/missions\/([^/]+)\/showroom\/decision$/;

export type MissionShowroomRoute =
  | { kind: 'room';        missionId: string }
  | { kind: 'archive';     missionId: string }
  | { kind: 'deliberate';  missionId: string }
  | { kind: 'decision';    missionId: string }
  | null;

export function parseMissionShowroomPath(pathname: string): MissionShowroomRoute {
  let m = pathname.match(ROOM_RE);
  if (m) return { kind: 'room', missionId: decodeURIComponent(m[1]!) };
  m = pathname.match(ARCHIVE_RE);
  if (m) return { kind: 'archive', missionId: decodeURIComponent(m[1]!) };
  m = pathname.match(DELIBERATE_RE);
  if (m) return { kind: 'deliberate', missionId: decodeURIComponent(m[1]!) };
  m = pathname.match(DECISION_RE);
  if (m) return { kind: 'decision', missionId: decodeURIComponent(m[1]!) };
  return null;
}

export async function handleMissionShowroom(
  req: Request,
  route: NonNullable<MissionShowroomRoute>,
  opts: MissionShowroomRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const mission = await opts.resolveMission(route.missionId);
  if (!mission) {
    return jsonResponse({ error: 'mission-not-found', missionId: route.missionId }, 404);
  }

  switch (route.kind) {
    case 'room':       return handleRoom(req, mission, opts);
    case 'archive':    return handleArchive(req, mission, opts);
    case 'deliberate': return handleDeliberate(req, mission, opts);
    case 'decision':   return handleDecision(req, mission, opts);
  }
}

async function handleRoom(
  req: Request,
  mission: Mission,
  opts: MissionShowroomRouteOpts,
): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const { mission: nextMission, state } = await spawnMissionRoom(mission, opts.deps);
  if (nextMission.showroomSessionId !== mission.showroomSessionId && opts.saveMission) {
    try { await opts.saveMission(nextMission); } catch { /* best-effort */ }
  }
  return jsonResponse({ state, missionShowroomUrl: showroomUrlFor(state.showroomSessionId) }, 200);
}

async function handleArchive(
  req: Request,
  mission: Mission,
  opts: MissionShowroomRouteOpts,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  try {
    const state = await archiveMissionRoom(mission, opts.deps);
    return jsonResponse({ state }, 200);
  } catch (err) {
    return jsonResponse(
      { error: 'archive-failed', detail: err instanceof Error ? err.message : String(err) },
      404,
    );
  }
}

async function handleDeliberate(
  req: Request,
  mission: Mission,
  opts: MissionShowroomRouteOpts,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid-json' }, 400); }

  const question = typeof (body as { question?: unknown }).question === 'string'
    ? ((body as { question: string }).question)
    : '';
  if (!question.trim()) {
    return jsonResponse({ error: 'question-required' }, 400);
  }
  const missionContext = typeof (body as { missionContext?: unknown }).missionContext === 'string'
    ? ((body as { missionContext: string }).missionContext)
    : undefined;

  try {
    const decision = await runMissionDeliberation(
      mission,
      { question, ...(missionContext !== undefined ? { missionContext } : {}) },
      opts.deps,
    );
    return jsonResponse({ decision }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('archived') ? 409 : 404;
    return jsonResponse({ error: 'deliberate-failed', detail: msg }, status);
  }
}

async function handleDecision(
  req: Request,
  mission: Mission,
  opts: MissionShowroomRouteOpts,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid-json' }, 400); }

  const chosen = typeof (body as { chosen?: unknown }).chosen === 'string'
    ? ((body as { chosen: string }).chosen)
    : '';
  if (!chosen.trim()) {
    return jsonResponse({ error: 'chosen-required' }, 400);
  }
  try {
    const updated = await applyMissionDecision(mission.id, chosen.trim(), opts.deps);
    if (!updated) {
      return jsonResponse({ error: 'no-open-decision' }, 409);
    }
    return jsonResponse({ decision: updated }, 200);
  } catch (err) {
    return jsonResponse(
      { error: 'decision-failed', detail: err instanceof Error ? err.message : String(err) },
      404,
    );
  }
}

function showroomUrlFor(showroomSessionId: string): string {
  // The PWA reads the `?show=` param to switch between rooms — see
  // ROADMAP-showroom-x-task-fabric §6.5 multi-showroom switching.
  return `/showroom?show=${encodeURIComponent(showroomSessionId)}`;
}
