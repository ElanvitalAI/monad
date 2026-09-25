// PWA · Idle nudge preview API client (Z13-c).
// Wire over `POST /v1/idle-nudge/preview`.
//
// ⛔ 경로는 «잎»에서 읽는다(확장자 없이 — `R-PWA3`).
import { IDLE_NUDGE_PATH } from '../../../../src/nexus/api/rest-route-paths';

export type NudgeTaskStatus = 'ready' | 'running' | 'review' | 'blocked' | 'awaiting-approval';

export interface IdleNudgeRequest {
  taskId: string;
  status: NudgeTaskStatus;
  enteredStatusAt: number;
  observedAt: number;
  taskTitle: string;
  recentActivity?: string;
}

export interface IdleNudgeLaneWire {
  persona: 'analyzer' | 'proposer' | 'motivator';
  modelId?: string;
  text: string;
}

export interface IdleNudgeRecordWire {
  taskId: string;
  status: NudgeTaskStatus;
  idleMs: number;
  spawnedAt: number;
  lanes: IdleNudgeLaneWire[];
  showroomSessionId: string;
}

export type IdleNudgeDecisionWire =
  | { kind: 'nudge'; reason: 'idle-threshold-exceeded'; status: NudgeTaskStatus; idleMs: number }
  | { kind: 'skip';  reason: 'still-fresh' | 'unknown-status' | 'rate-limited' }
  | { kind: 'defer'; reason: 'quiet-hours'; nextEligibleAt: number };

export interface IdleNudgePreviewResult {
  decision: IdleNudgeDecisionWire;
  record: IdleNudgeRecordWire | null;
}

export class IdleNudgeApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly body: unknown) {
    super(`idle-nudge ${status} on ${path}`);
    this.name = 'IdleNudgeApiError';
  }
}

export interface IdleNudgeApiOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authHeader?: string;
}

export interface IdleNudgeApiClient {
  preview(req: IdleNudgeRequest): Promise<IdleNudgePreviewResult>;
}

export function createIdleNudgeApi(opts: IdleNudgeApiOpts): IdleNudgeApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const path = IDLE_NUDGE_PATH;

  return {
    async preview(reqBody) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.authHeader) headers['authorization'] = opts.authHeader;
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new IdleNudgeApiError(res.status, path, body);
      return body as IdleNudgePreviewResult;
    },
  };
}
