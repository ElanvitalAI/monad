// PWA · Fluent chain preview API (Z13-a).
//
// Typed fetch over `POST /v1/next-fluent/preview` (daemon:
// `src/nexus/api/next-fluent.ts`).
//
// ⛔ 경로는 «잎»에서 읽는다(확장자 없이 — `R-PWA3`).
import { NEXT_FLUENT_DISPATCH_PATH } from '../../../../src/nexus/api/rest-route-paths';

export interface NextFluentSuggestionWire {
  kind: string;
  score: number;
  endorsedBy: 'continuator' | 'opportunist' | 'closer' | 'none';
  reason: string;
  surfaceHint: string | null;
}

export interface NextFluentCardWire {
  kind: 'next-fluent';
  refId: string;
  refKind: string;
  suggestions: NextFluentSuggestionWire[];
  transcript: string;
  createdAt: number;
}

export interface TaskDonePreviewRequest {
  refId: string;
  refKind: string;
  finishedSurface: string | null;
  outcome: 'ok' | 'failed';
  completedAt: number;
  retroSummary?: string;
  tags?: string[];
}

export type FluentChainPreviewResult =
  | { kind: 'card'; card: NextFluentCardWire }
  | { kind: 'no-suggestions'; enabled: boolean }
  | { kind: 'disabled' };

export class FluentChainApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly body: unknown) {
    super(`fluent-chain ${status} on ${path}`);
    this.name = 'FluentChainApiError';
  }
}

export interface FluentChainApiOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authHeader?: string;
}

export interface FluentChainDispatchResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface FluentChainApiClient {
  preview(req: TaskDonePreviewRequest): Promise<FluentChainPreviewResult>;
  /** 칩 1-클릭 액션 실행(2026-07-15) — refId=phaseId, action=제안 kind. */
  dispatch(refId: string, action: string): Promise<FluentChainDispatchResult>;
}

export function createFluentChainApi(opts: FluentChainApiOpts): FluentChainApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const path = '/v1/next-fluent/preview';

  return {
    async preview(reqBody) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.authHeader) headers['authorization'] = opts.authHeader;
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
      });
      if (res.status === 204) return { kind: 'no-suggestions', enabled: true };
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        const enabled = (body && typeof body === 'object' && 'enabled' in body)
          ? Boolean((body as { enabled: unknown }).enabled)
          : false;
        return enabled ? { kind: 'no-suggestions', enabled } : { kind: 'disabled' };
      }
      // 503 next-fluent-not-wired = 데몬에 라우트 미배선(선택 기능 비활성) → 에러 아님·disabled 로 강등.
      //   그래야 미배선 데몬에서 태스크 카드마다 빨간 에러가 도배되지 않는다(2026-07-15·409→disabled 동형).
      if (res.status === 503 && body && typeof body === 'object'
          && (body as { error?: unknown }).error === 'next-fluent-not-wired') {
        return { kind: 'disabled' };
      }
      if (!res.ok) throw new FluentChainApiError(res.status, path, body);
      const wrapper = body as { card?: NextFluentCardWire };
      if (!wrapper?.card) throw new FluentChainApiError(res.status, path, body);
      return { kind: 'card', card: wrapper.card };
    },
    async dispatch(refId, action) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.authHeader) headers['authorization'] = opts.authHeader;
      const dispatchPath = NEXT_FLUENT_DISPATCH_PATH;
      const res = await fetchImpl(`${baseUrl}${dispatchPath}`, {
        method: 'POST', headers, body: JSON.stringify({ refId, action }),
      });
      const body = await res.json().catch(() => null) as FluentChainDispatchResult | null;
      if (body && typeof body === 'object' && 'ok' in body) return body;
      return { ok: false, error: `dispatch ${res.status}` };
    },
  };
}
