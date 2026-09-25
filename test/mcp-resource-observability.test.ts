import { describe, expect, it } from 'bun:test';
import { handleMcpResourceGet } from '../src/nexus/api/mcp-resource-route.js';
import { debug } from '../src/debug/log.js';

/** ⛔⭐⭐⭐ 계측은 «조용히 사라지는» 것이 본성이다 — 그래서 문다.
 *
 *  📏 2026-08-21 라이브: 같은 위젯 조회가 한 번은 17.96초, 다음엔 10분 넘게 안 돌아왔는데
 *  `monad logs` 에 ***25분간 한 줄도 없었다.*** ⇒ 「요청이 나갔나·상대가 느린가·우리가 멈췄나」를
 *  아무도 못 갈랐다. 이 파일이 그 네 갈래가 «값으로» 남는지 문다. */

function captured(): { events: Array<{ event: string; data: Record<string, unknown> }>; restore: () => void } {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const original = debug.log;
  (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
    if (category === 'mcp.resource.read') events.push({ event, data: (data ?? {}) as Record<string, unknown> });
  }) as typeof debug.log;
  return { events, restore: () => { (debug as { log: typeof debug.log }).log = original; } };
}

function route(readResource: () => Promise<unknown>) {
  return {
    authorize: () => true,
    getClients: () => ({
      clients: [{ opts: { id: 'higgsfield' }, readResource }],
      perServer: { higgsfield: { status: 'ready' } },
    }) as never,
  };
}

const REQUEST = new Request('http://d/v1/mcp/resources?server=higgsfield&uri=ui%3A%2F%2Fx');

describe('widget resource read — the four outcomes are values, not silence', () => {
  it('leaves a start line so «the request went out» is answerable on its own', async () => {
    const { events, restore } = captured();
    try {
      await handleMcpResourceGet(REQUEST, route(async () => ({ contents: [{ uri: 'ui://x', text: '<i/>' }] })));
    } finally { restore(); }
    expect(events[0]).toMatchObject({ event: 'start', data: { server: 'higgsfield', uri: 'ui://x' } });
  });

  it('records how long it took, how big it was, and whether the peer declared origins', async () => {
    const { events, restore } = captured();
    try {
      await handleMcpResourceGet(REQUEST, route(async () => ({
        contents: [{
          uri: 'ui://x', text: '<main/>', mimeType: 'text/html;profile=mcp-app',
          _meta: { ui: { csp: { connectDomains: ['https://a'] } } },
        }],
      })));
    } finally { restore(); }
    const ok = events.find((entry) => entry.event === 'ok');
    expect(ok).toBeDefined();
    expect(ok!.data.bytes).toBe('<main/>'.length);
    expect(ok!.data.mimeType).toBe('text/html;profile=mcp-app');
    // ⭐ 이 칸이 핵심이다 — 비면 위젯 CSP 가 전부 거부로 서고 「Connecting…」 에서 멈춘다.
    expect(ok!.data.cspHeaders).toEqual(['x-monad-mcp-app-connect-domains']);
    expect(typeof ok!.data.elapsedMs).toBe('number');
  });

  it('keeps «the peer did not say» as a value rather than dropping the field', async () => {
    const { events, restore } = captured();
    try {
      await handleMcpResourceGet(REQUEST, route(async () => ({ contents: [{ uri: 'ui://x', text: '<i/>' }] })));
    } finally { restore(); }
    const ok = events.find((entry) => entry.event === 'ok')!;
    // ⛔ 필드가 «사라지면» 「형식을 안 말했다」와 「우리가 안 실었다」가 구분되지 않는다.
    expect(Object.hasOwn(ok.data, 'mimeType')).toBe(true);
    expect(ok.data.mimeType).toBeNull();
    expect(ok.data.cspHeaders).toEqual([]);
  });

  it('names a missing resource separately from a failure', async () => {
    const { events, restore } = captured();
    try {
      await handleMcpResourceGet(REQUEST, route(async () => ({ contents: [] })));
    } finally { restore(); }
    expect(events.map((entry) => entry.event)).toEqual(['start', 'not-found']);
  });

  it('names a throw, and carries why — «못 닿았다» and «그 밖» need different next moves', async () => {
    const { events, restore } = captured();
    try {
      await handleMcpResourceGet(REQUEST, route(async () => { throw new Error('peer exploded'); }));
    } finally { restore(); }
    const failed = events.find((entry) => entry.event === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.data.reason).toContain('peer exploded');
    expect(typeof failed!.data.elapsedMs).toBe('number');
  });
});
