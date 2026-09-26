// cascade-zyu W8-A 옵션 B (2026-05-14) — ACP turn lifecycle → mission.update.
//
// `runAcpServer` 의 prompt handler (src/acp/server.ts) 가 본 helper 를 통해
// turn 시작/종료 시 `mission.update` envelope 를 broadcast. iOS-side
// `MissionEnvelopeRouter` (Phase 3 #2646) 가 자동 흡수 → Dynamic Island
// Live Activity 활성. 모든 chat prompt 가 자연 mission surface 가 됨.
//
// 옵션 A (POST /v1/missions/test) 와 차이:
//   - A = 사용자 명시 trigger (Companion shell Test Mission 버튼)
//   - B = chat turn 자동 (사용자 액션 0 · 모든 prompt 가 surface)
//
// emit 실패 시 turn 자체는 영향 0 (try/catch + telemetric only · prompt 진행
// 계속). seqTracker 는 per-turn instance (turn 간 격리 · monotonic blockId scope).

import {
  createSeqTracker,
  makeEnvelope,
  type FeedbackEnvelope,
  type MissionUpdatePayload,
} from '../feedback/envelope.js';
import { formatElanousFeedbackEnvelope } from './elanous-extensions.js';

/** prompt handler 가 받은 `broadcast` 함수 (sessionUpdate notification 보내는
 *  공통 wrap). agent_thought_chunk + elanous/feedback/emit text-in-text wire
 *  로 envelope payload 를 fan-out. */
export type AcpBroadcastFn = (
  sessionId: string,
  update: { sessionUpdate: string; content: { type: 'text'; text: string } },
) => Promise<void>;

export interface MissionTurnEmitter {
  /** Turn start — Activity.request 트리거. title = first 60 chars of prompt. */
  start(): Promise<void>;
  /** Turn end — status 'done' (정상) 또는 'error' (aborted/exception). */
  end(status: 'done' | 'error'): Promise<void>;
}

export interface MissionTurnEmitterDeps {
  sessionId: string;
  /** First user text block 의 첫 60 자. 빈 경우 fallback "chat turn". */
  userText: string;
  broadcast: AcpBroadcastFn;
  /** test 시 deterministic missionId. omit = `turn-${Date.now()}`. */
  missionIdOverride?: string;
  /** test 시 deterministic clock. omit = Date.now. */
  now?: () => number;
}

const TURN_EMOJI = '💬';
const TITLE_MAX = 60;

function deriveTitle(userText: string): string {
  const trimmed = userText.trim();
  if (trimmed.length === 0) return 'chat turn';
  const oneLine = trimmed.split('\n')[0]!.trim();
  if (oneLine.length <= TITLE_MAX) return oneLine;
  return oneLine.slice(0, TITLE_MAX - 1) + '…';
}

export function createMissionTurnEmitter(
  deps: MissionTurnEmitterDeps,
): MissionTurnEmitter {
  const seqTracker = createSeqTracker();
  const now = deps.now ?? Date.now;
  const missionId = deps.missionIdOverride ?? `turn-${now().toString(36)}`;
  const blockId = `${deps.sessionId}:mission:${missionId}`;
  const title = deriveTitle(deps.userText);

  async function broadcastEnvelope(env: FeedbackEnvelope): Promise<void> {
    try {
      const text = formatElanousFeedbackEnvelope({ method: 'emit', payload: env });
      await deps.broadcast(deps.sessionId, {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text },
      });
    } catch {
      // telemetric only — turn 자체 영향 0
    }
  }

  function envelopeOf(
    phase: 'start' | 'end',
    payload: MissionUpdatePayload,
  ): FeedbackEnvelope {
    return makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: deps.sessionId,
        blockId,
        phase,
        payload,
        now,
      },
      seqTracker,
    );
  }

  return {
    async start() {
      const env = envelopeOf('start', {
        missionId,
        title,
        status: 'running',
        emoji: TURN_EMOJI,
        op: 'start',
      });
      await broadcastEnvelope(env);
    },
    async end(status) {
      const env = envelopeOf('end', {
        missionId,
        title,
        status,
        progress: status === 'done' ? 1 : undefined,
        emoji: TURN_EMOJI,
        op: 'end',
      });
      await broadcastEnvelope(env);
    },
  };
}
