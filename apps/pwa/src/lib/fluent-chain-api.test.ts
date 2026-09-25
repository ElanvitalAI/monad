// W9c Z13-a · fluent-chain-api PWA wire.

import { describe, expect, test } from 'bun:test';
import {
  createFluentChainApi,
  FluentChainApiError,
  type TaskDonePreviewRequest,
} from './fluent-chain-api';

function mockFetch(handler: () => { status: number; body?: unknown }) {
  return (async () => {
    const r = handler();
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

const req: TaskDonePreviewRequest = {
  refId: 't-1', refKind: 'task', finishedSurface: 'terminal-pane',
  outcome: 'ok', completedAt: 1000,
};

describe('createFluentChainApi.preview', () => {
  test('200 with card → returns kind=card envelope', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 200,
      body: { card: { kind: 'next-fluent', refId: 't-1', refKind: 'task', suggestions: [], transcript: '', createdAt: 0 } },
    }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out.kind).toBe('card');
  });

  test('204 → returns no-suggestions enabled', async () => {
    const fetchImpl = mockFetch(() => ({ status: 204 }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out).toEqual({ kind: 'no-suggestions', enabled: true });
  });

  test('409 with enabled=false → returns disabled', async () => {
    const fetchImpl = mockFetch(() => ({ status: 409, body: { enabled: false } }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out).toEqual({ kind: 'disabled' });
  });

  test('503 next-fluent-not-wired → disabled(에러 아님·미배선 데몬 노이즈 방지)', async () => {
    const fetchImpl = mockFetch(() => ({ status: 503, body: { error: 'next-fluent-not-wired' } }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    expect(await api.preview(req)).toEqual({ kind: 'disabled' });
  });

  test('503 (기타 사유) → 여전히 throw(진짜 장애는 감추지 않음)', async () => {
    const fetchImpl = mockFetch(() => ({ status: 503, body: { error: 'upstream-down' } }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.preview(req); expect.unreachable(); }
    catch (e) { expect((e as Error).name).toBe('FluentChainApiError'); }
  });

  test('409 with enabled=true → returns no-suggestions enabled', async () => {
    const fetchImpl = mockFetch(() => ({ status: 409, body: { enabled: true } }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    const out = await api.preview(req);
    expect(out).toEqual({ kind: 'no-suggestions', enabled: true });
  });

  test('500 surfaces FluentChainApiError', async () => {
    const fetchImpl = mockFetch(() => ({ status: 500, body: { error: 'fluent-failed' } }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.preview(req); expect.unreachable(); }
    catch (err) {
      expect(err).toBeInstanceOf(FluentChainApiError);
      expect((err as FluentChainApiError).status).toBe(500);
    }
  });

  test('200 without card envelope is treated as error', async () => {
    const fetchImpl = mockFetch(() => ({ status: 200, body: {} }));
    const api = createFluentChainApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.preview(req); expect.unreachable(); }
    catch (err) {
      expect(err).toBeInstanceOf(FluentChainApiError);
    }
  });
});
