// PWA · Mission Deliberation Room API client (Z13-b · W9c PR #2).
//
// Typed fetch helpers around `/v1/missions/:id/showroom*` (daemon
// implementation: `src/nexus/api/mission-showroom.ts`). The client is
// pure (no React imports) so it can be exercised from any surface
// (page · component · CLI fixture) and unit-tested via injected fetch.
//
// Endpoints:
//   GET  /v1/missions/:id/showroom          → spawn / restore
//   POST /v1/missions/:id/showroom/deliberate
//   POST /v1/missions/:id/showroom/decision
//   POST /v1/missions/:id/showroom/archive

export type MissionRoomStatus = 'active' | 'archived';

export interface MissionRoomDecisionWire {
  ts: number;
  question: string;
  opinions: Array<{ role: string; modelId?: string; text: string }>;
  resolution: { status: 'open' } | { status: 'decided'; chosen: string };
}

export interface MissionRoomStateWire {
  missionId: string;
  showroomSessionId: string;
  missionTag: string;
  status: MissionRoomStatus;
  spawnedAt: number;
  archivedAt?: number;
  decisions: MissionRoomDecisionWire[];
}

export interface MissionRoomSpawnResponse {
  state: MissionRoomStateWire;
  missionShowroomUrl: string;
}

export interface MissionRoomApiClient {
  spawn(missionId: string): Promise<MissionRoomSpawnResponse>;
  deliberate(missionId: string, question: string, missionContext?: string): Promise<MissionRoomDecisionWire>;
  decide(missionId: string, chosen: string): Promise<MissionRoomDecisionWire>;
  archive(missionId: string): Promise<MissionRoomStateWire>;
}

export interface MissionRoomApiOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authHeader?: string;
}

export class MissionRoomApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`mission-room ${status} on ${path}`);
    this.name = 'MissionRoomApiError';
  }
}

export function createMissionRoomApi(opts: MissionRoomApiOpts): MissionRoomApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const authHeader = opts.authHeader;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authHeader) headers['authorization'] = authHeader;
    if (init?.headers) Object.assign(headers, init.headers as Record<string, string>);
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new MissionRoomApiError(res.status, path, body);
    return body;
  }

  function p(missionId: string, suffix = ''): string {
    return `/v1/missions/${encodeURIComponent(missionId)}/showroom${suffix}`;
  }

  return {
    async spawn(missionId) {
      return (await call(p(missionId))) as MissionRoomSpawnResponse;
    },
    async deliberate(missionId, question, missionContext) {
      const body = await call(p(missionId, '/deliberate'), {
        method: 'POST',
        body: JSON.stringify({ question, ...(missionContext !== undefined ? { missionContext } : {}) }),
      }) as { decision: MissionRoomDecisionWire };
      return body.decision;
    },
    async decide(missionId, chosen) {
      const body = await call(p(missionId, '/decision'), {
        method: 'POST',
        body: JSON.stringify({ chosen }),
      }) as { decision: MissionRoomDecisionWire };
      return body.decision;
    },
    async archive(missionId) {
      const body = await call(p(missionId, '/archive'), { method: 'POST' }) as { state: MissionRoomStateWire };
      return body.state;
    },
  };
}
