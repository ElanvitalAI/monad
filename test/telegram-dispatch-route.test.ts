// 넥서스 밖 텔레그램 폴러 → core 워크플로 트리거: 경로(bearer · 모양 검사) ⊕ 전달 클라이언트(503 재시도).
import { describe, expect, test } from 'bun:test';
import { parseTelegramDispatchEvent, startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { defaultBaseUrl, forwardTelegramDispatch } from '../src/telegram-dispatch-forward.js';
import type { TelegramEvent } from '../src/workflow-runtime/triggers/telegram-source.js';

function fixture() {
  const bus = new NexusEventBus();
  const state = createNexusState({ nexusVersion: '0.0.0', phase: 'test' });
  state.bus = bus;
  return { state, registry: new TabRegistry(state), bus };
}
const port = (): number => 58000 + Math.floor(Math.random() * 1500);
const EVENT: TelegramEvent = { kind: 'command', chat: '1', user: '2', body: 'hi', command: 'ping' };

describe('POST /v1/workflows/telegram-dispatch', () => {
  test('reaches workflowDaemon.dispatchTelegram only with the bearer, and returns its results', async () => {
    const seen: TelegramEvent[] = [];
    const fix = fixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: port(),
      metaApi: { bearerToken: 'tok' },
      workflowDaemon: {
        dispatchWebhook: async () => null,
        dispatchTelegram: async (e) => { seen.push(e); return [{ workflowName: 'wf', nodeId: 'n', ok: true }]; },
      },
    });
    try {
      const url = `${srv.url}/v1/workflows/telegram-dispatch`;
      const denied = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: EVENT }) });
      expect(denied.status).toBe(401);
      expect(seen).toHaveLength(0);

      const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify({ event: { kind: 'nope' } }) });
      expect(bad.status).toBe(400);

      const ok = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' }, body: JSON.stringify({ event: EVENT }) });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ results: [{ workflowName: 'wf', nodeId: 'n', ok: true }] });
      expect(seen).toEqual([EVENT]);
    } finally { srv.stop(); }
  });

  test('503 when the workflow daemon has no telegram dispatch wired', async () => {
    const fix = fixture();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port(), metaApi: { noAuth: true } });
    try {
      const res = await fetch(`${srv.url}/v1/workflows/telegram-dispatch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: EVENT }) });
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('event parser keeps only known fields and kinds', () => {
    expect(parseTelegramDispatchEvent({ event: { ...EVENT, extra: 1 } })).toEqual(EVENT);
    expect(parseTelegramDispatchEvent({ event: { kind: 'message', chat: 1, user: '2', body: '' } })).toBeNull();
    expect(parseTelegramDispatchEvent({})).toBeNull();
  });
});

describe('forwardTelegramDispatch', () => {
  test('retries while core answers 503 (restarting), then returns core results', async () => {
    const statuses = [503, 503, 200];
    const calls: RequestInit[] = [];
    const sleeps: number[] = [];
    const results = await forwardTelegramDispatch(EVENT, {
      baseUrl: () => 'http://core',
      token: () => 'tok',
      sleep: async (ms) => { sleeps.push(ms); },
      fetchImpl: (async (_url: string, init: RequestInit) => {
        calls.push(init);
        const status = statuses.shift()!;
        return new Response(JSON.stringify(status === 200 ? { results: [{ workflowName: 'wf', nodeId: 'n', ok: true }] } : {}), { status });
      }) as unknown as typeof fetch,
    });
    expect(results).toEqual([{ workflowName: 'wf', nodeId: 'n', ok: true }]);
    expect(calls).toHaveLength(3);
    expect((calls[0]!.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ event: EVENT });
    expect(sleeps).toEqual([2_000, 2_000]);
  });

  test('does not retry a 401 and returns no results', async () => {
    let n = 0;
    const results = await forwardTelegramDispatch(EVENT, {
      baseUrl: () => 'http://core', token: () => null, sleep: async () => {},
      fetchImpl: (async () => { n++; return new Response('{}', { status: 401 }); }) as unknown as typeof fetch,
    });
    expect(results).toEqual([]);
    expect(n).toBe(1);
  });

  test('a connection failure is retried then given up without throwing', async () => {
    let n = 0;
    const results = await forwardTelegramDispatch(EVENT, {
      baseUrl: () => 'http://core', token: () => 'tok', sleep: async () => {}, attempts: 3,
      fetchImpl: (async () => { n++; throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
    });
    expect(results).toEqual([]);
    expect(n).toBe(3);
  });

  test('no core runtime (null base) sends nothing — never guesses the prod port', async () => {
    let n = 0;
    const results = await forwardTelegramDispatch(EVENT, {
      baseUrl: () => null, token: () => 'tok', sleep: async () => {},
      fetchImpl: (async () => { n++; return new Response('{}'); }) as unknown as typeof fetch,
    });
    expect(results).toEqual([]);
    expect(n).toBe(0);
  });
});

// 🩸 2026-09-25 — 죽은 테스트 넥서스가 남긴 runtime.json(httpPort 31415)을 믿고 운영 core 로 보냈다.
describe('defaultBaseUrl trusts a runtime only while its pid lives', () => {
  const rt = { pid: 47214, startedAt: '2026-09-10T00:17:15.276Z', nexusVersion: '0.17.0', phase: 'running', httpPort: 31415, httpHost: '127.0.0.1' } as never;
  test('dead pid → null (nothing sent)', () => {
    expect(defaultBaseUrl({ runtime: () => rt, alive: () => false })).toBeNull();
  });
  test('live pid → its address', () => {
    expect(defaultBaseUrl({ runtime: () => rt, alive: () => true })).toBe('http://127.0.0.1:31415');
  });
  test('no runtime → null', () => {
    expect(defaultBaseUrl({ runtime: () => null, alive: () => true })).toBeNull();
  });
});
