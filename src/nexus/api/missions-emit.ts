// cascade-zyu W8-A 옵션 A (2026-05-14) — `POST /v1/missions/test` mock emitter.
//
// 사용자가 iOS Companion shell 의 "Test Mission" 버튼 tap → 본 endpoint 가
// 30초 mock mission 을 5-step progress (0 → 0.2 → 0.4 → 0.6 → 0.8 → 1.0)
// 으로 emit. iOS-side `MissionEnvelopeRouter` (Phase 3 #2646) 가 envelope
// 를 흡수 → Dynamic Island 가 active. Companion shell 의 "Coming soon ·
// Live Mission" 항목이 실제 진입 surface 로 활성.
//
// 의의: 본 W8-A series 의 dogfood demo. mission orchestration arc (Z2 /
// Y4 / U5) 의 실 mission emit 까지 가지 않고도 사용자가 즉시 Dynamic Island
// 작동 확인 가능. 실 mission emitter 는 별 트랙.

import { createSeqTracker, makeEnvelope, type FeedbackEnvelope } from '../../feedback/envelope.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const MISSIONS_TEST_PATH = '/v1/missions/test';

export function isMissionsTestPath(pathname: string): boolean {
  return pathname === MISSIONS_TEST_PATH;
}

export interface MissionsTestRouteOpts {
  /** Per-session broadcaster (`getActiveAcpFeedbackBroadcaster()`). Null = daemon
   *  has no active ACP peer · endpoint returns 503. */
  broadcastToSession:
    | ((sessionId: string, env: FeedbackEnvelope) => Promise<{ delivered: number }>)
    | null;
  /** Optional clock injection for tests. */
  now?: () => number;
  /** Optional sleep injection (default `setTimeout`). Tests pass a deterministic stub. */
  sleep?: (ms: number) => Promise<void>;
}

export interface MissionsTestRequestBody {
  /** ACP session id that the mission envelopes will be routed to. iOS
   *  Companion shell sends `ACPClient.currentSessionId`; the iOS-side
   *  `MissionEnvelopeRouter` subscribes to that session's feedback
   *  stream. Required — without a valid sessionId the broadcast no-ops. */
  sessionId: string;
  /** Optional override — defaults to "Test mission (5-step demo)". */
  title?: string;
  /** Optional override — defaults to 🚀. */
  emoji?: string;
  /** Total wall-clock ms (default 30_000 = 30s). step interval = total/5. */
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 30_000;
const STEP_COUNT = 5;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleMissionsTest(
  req: Request,
  opts: MissionsTestRouteOpts,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  if (!opts.broadcastToSession) {
    return jsonResponse({ error: 'acp-not-active' }, 503);
  }

  let body: Partial<MissionsTestRequestBody> = {};
  if (req.headers.get('content-length') !== '0') {
    try {
      body = (await req.json()) as Partial<MissionsTestRequestBody>;
    } catch {
      return jsonResponse({ error: 'invalid-json-body' }, 400);
    }
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return jsonResponse({ error: 'sessionId-required' }, 400);
  }
  const totalMs = body.durationMs ?? DEFAULT_DURATION_MS;
  const stepMs = Math.max(100, Math.floor(totalMs / STEP_COUNT));
  const title = body.title ?? 'Test mission (5-step demo)';
  const emoji = body.emoji ?? '🚀';
  const missionId = `test-${Date.now().toString(36)}`;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  // Background dispatch — REST response 는 즉시 202 return, mission 은
  // setTimeout chain 으로 진행. 실 mission orchestration arc 진입 시
  // task-orchestrator + scheduler 가 lifecycle 소유.
  void runMissionDemo({
    sessionId: body.sessionId,
    missionId,
    title,
    emoji,
    stepMs,
    broadcastToSession: opts.broadcastToSession,
    sleep,
    now,
  });

  return jsonResponse(
    {
      ok: true,
      missionId,
      sessionId: body.sessionId,
      title,
      emoji,
      stepCount: STEP_COUNT,
      stepMs,
      totalMs: stepMs * STEP_COUNT,
    },
    202,
  );
}

interface MissionDemoArgs {
  sessionId: string;
  missionId: string;
  title: string;
  emoji: string;
  stepMs: number;
  broadcastToSession: (
    sessionId: string,
    env: FeedbackEnvelope,
  ) => Promise<{ delivered: number }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function runMissionDemo(args: MissionDemoArgs): Promise<void> {
  const { sessionId, missionId, title, emoji, stepMs, broadcastToSession, sleep, now } = args;
  const blockId = `${sessionId}:mission:${missionId}`;
  const seqTracker = createSeqTracker();

  // op=start · phase=start · progress=0.
  await broadcastToSession(
    sessionId,
    makeEnvelope(
      {
        kind: 'mission.update',
        sessionId,
        blockId,
        phase: 'start',
        payload: {
          missionId,
          title,
          status: 'running',
          progress: 0,
          etaIso: new Date(now() + stepMs * STEP_COUNT).toISOString(),
          emoji,
          op: 'start',
        },
        now,
      },
      seqTracker,
    ),
  );

  // 5-step progress updates.
  for (let step = 1; step <= STEP_COUNT - 1; step++) {
    await sleep(stepMs);
    const progress = step / STEP_COUNT;
    await broadcastToSession(
      sessionId,
      makeEnvelope(
        {
          kind: 'mission.update',
          sessionId,
          blockId,
          phase: 'update',
          payload: {
            missionId,
            title,
            status: 'running',
            progress,
            etaIso: new Date(now() + stepMs * (STEP_COUNT - step)).toISOString(),
            emoji,
            op: 'update',
          },
          now,
        },
        seqTracker,
      ),
    );
  }

  // Final step → done.
  await sleep(stepMs);
  await broadcastToSession(
    sessionId,
    makeEnvelope(
      {
        kind: 'mission.update',
        sessionId,
        blockId,
        phase: 'end',
        payload: {
          missionId,
          title,
          status: 'done',
          progress: 1,
          emoji,
          op: 'end',
        },
        now,
      },
      seqTracker,
    ),
  );
}
