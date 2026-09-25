// PWA · Device fleet + template capability preview API (Z13-d).
//
// Typed fetch over `/v1/devices` + `/v1/templates/capability-preview`
// (daemon: `src/nexus/api/devices.ts`).
//
// ⛔ 경로는 «잎»에서 읽는다 — 문자열로 베끼면 한쪽만 바뀌어도 조용히 404 가 된다.
//   ⛔ 확장자를 붙이지 않는다(`R-PWA3` — webpack 은 `.js`→`.ts` 를 안 푼다).
import { DEVICES_PATH, TEMPLATE_CAPABILITY_PREVIEW_PATH } from '../../../../src/nexus/api/rest-route-paths';

export interface DeviceFleetSnapshot {
  totalDevices: number;
  snapshotAt: number;
  kinds: Array<{ kind: string; count: number; capabilities: string[] }>;
}

export interface CapabilityDecisionWire {
  requirement: {
    device: string;
    capability: string | readonly string[];
    enables: readonly string[];
    degrade_to: string;
  };
  outcome:
    | { status: 'enabled'; enables: readonly string[] }
    | { status: 'degraded'; degradeTo: string; missing: readonly string[] };
}

export interface CapabilityPreviewResponse {
  enabled: string[];
  degraded: string[];
  decisions: CapabilityDecisionWire[];
  fallbackHits: string[];
  fleet: DeviceFleetSnapshot;
}

export interface CapabilityPreviewRequest {
  optionalRequirements: Array<{
    device: string;
    capability: string | string[];
    enables: string[];
    degrade_to: string;
  }>;
  fallbackChain?: Array<{ if: string; then: string }>;
}

export class DevicesApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly body: unknown) {
    super(`devices ${status} on ${path}`);
    this.name = 'DevicesApiError';
  }
}

export interface DevicesApiOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authHeader?: string;
}

export interface DevicesApiClient {
  fleet(): Promise<DeviceFleetSnapshot>;
  preview(req: CapabilityPreviewRequest): Promise<CapabilityPreviewResponse>;
}

export function createDevicesApi(opts: DevicesApiOpts): DevicesApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.authHeader) headers['authorization'] = opts.authHeader;
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new DevicesApiError(res.status, path, body);
    return body;
  }

  return {
    async fleet() {
      return (await call(DEVICES_PATH)) as DeviceFleetSnapshot;
    },
    async preview(req) {
      return (await call(TEMPLATE_CAPABILITY_PREVIEW_PATH, {
        method: 'POST',
        body: JSON.stringify(req),
      })) as CapabilityPreviewResponse;
    },
  };
}
