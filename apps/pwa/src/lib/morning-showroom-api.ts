// PWA · Morning Showroom API client (Z13-c).
// Wire over `POST /v1/morning-digest/showroom`.
//
// ⛔ 경로는 «잎»에서 읽는다(확장자 없이 — `R-PWA3`).
import { MORNING_SHOWROOM_PATH } from '../../../../src/nexus/api/rest-route-paths';

export interface MorningShowroomLaneWire {
  lane: 'yesterday' | 'today' | 'blockers' | 'opportunities';
  modelId?: string;
  text: string;
  prompt: string;
}

export interface MorningShowroomCardWire {
  kind: 'morning-digest-showroom';
  date: string;
  lanes: MorningShowroomLaneWire[];
  createdAt: number;
}

export interface MorningDigestRequest {
  date: string;
  windowStart: string;
  windowEnd: string;
  runs: Array<{
    taskId: string;
    taskTitle: string;
    outcome: 'completed' | 'failed' | 'awaiting-approval' | 'cancelled' | 'retrying';
    startedAt: number;
    endedAt?: number;
    errorSummary?: string;
    modelId?: string;
    tokensUsed?: number;
    costUsd?: number;
  }>;
  upcoming?: Array<{ taskTitle: string; expectedSlot?: string }>;
  backlogRecommendations?: Array<{ taskTitle: string; reason?: string; estimateMinutes?: number }>;
}

export class MorningShowroomApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly body: unknown) {
    super(`morning-showroom ${status} on ${path}`);
    this.name = 'MorningShowroomApiError';
  }
}

export interface MorningShowroomApiOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authHeader?: string;
}

export interface MorningShowroomApiClient {
  compose(req: MorningDigestRequest): Promise<MorningShowroomCardWire>;
}

export function createMorningShowroomApi(opts: MorningShowroomApiOpts): MorningShowroomApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const path = MORNING_SHOWROOM_PATH;

  return {
    async compose(reqBody) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.authHeader) headers['authorization'] = opts.authHeader;
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new MorningShowroomApiError(res.status, path, body);
      const wrapper = body as { card?: MorningShowroomCardWire };
      if (!wrapper?.card) throw new MorningShowroomApiError(res.status, path, body);
      return wrapper.card;
    },
  };
}
