import { describe, expect, test } from 'bun:test';
import { McpConnectionError, McpServerError } from '../src/mcp/client.js';
import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import type { McpClientsHandle } from '../src/nexus/boot/register-mcp-clients.js';

const RESOURCE_PATH = '/v1/mcp/resources';

type ResourceContent = { uri: string; mimeType?: string; text?: string; blob?: string };
type ResourceReader = (uri: string) => Promise<{ contents: ResourceContent[] }>;
type ServerStatus = 'ready' | 'failed' | 'disabled';

function createFixture(readResource: ResourceReader, status: ServerStatus = 'ready') {
  const calls: string[] = [];
  const client = {
    opts: { id: 'canvas' },
    readResource: async (uri: string) => {
      calls.push(uri);
      return readResource(uri);
    },
  };
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return {
    calls,
    eventBus,
    registry: new TabRegistry(state),
    state,
    getMcpClients: () => ({
      clients: status === 'ready' ? [client] : [],
      registered: 0,
      perServer: { canvas: { status, toolCount: 0 } },
      shutdown: async () => {},
    }) as never,
  };
}

async function startResourceServer(readResource: ResourceReader, options: {
  status?: ServerStatus;
  authorized?: boolean;
  getMcpClients?: boolean;
  clientPresent?: boolean;
} = {}) {
  const fixture = createFixture(readResource, options.status);
  const getMcpClients = options.getMcpClients === false
    ? undefined
    : () => {
      const handle = fixture.getMcpClients() as McpClientsHandle;
      if (options.clientPresent === false) handle.clients = [];
      return handle;
    };
  const server = startNexusHttpServer({
    ...fixture,
    getMcpClients,
    metaApi: options.authorized === false ? {} : { noAuth: true },
    startPort: 53000 + Math.floor(Math.random() * 2000),
  });
  return { ...fixture, server };
}

function resourceUrl(serverUrl: string, server = 'canvas', uri = 'https://example.test/view'): string {
  return `${serverUrl}${RESOURCE_PATH}?server=${encodeURIComponent(server)}&uri=${encodeURIComponent(uri)}`;
}

describe('MCP resource GET route', () => {
  // ── 리뷰 must-fix 회귀 (라운드 5 · 사람이 인수해 메움) ──
  //
  // 둘 다 같은 병이다 — ***모르는 것을 단정한다***.
  test('⛔ 상대가 형식을 «안 말하면» content-type 을 지어내지 않는다', async () => {
    const route = await startResourceServer(async (uri) => ({
      contents: [{ uri, text: 'no mime declared' }],   // ← mimeType «없음»
    }));
    try {
      const res = await fetch(resourceUrl(route.server.url));
      expect(res.status).toBe(200);
      // ⛔ `application/octet-stream` 은 「이진 덩어리다」라는 «주장»이다 — 우리는 그걸 모른다.
      expect(res.headers.get('content-type')).not.toBe('application/octet-stream');
      expect(await res.text()).toBe('no mime declared');
    } finally { route.server.stop(); }
  });

  test('⛔ 불변 보장이 «없는» 주소에 immutable 을 1년 붙이지 않는다', async () => {
    const route = await startResourceServer(async (uri) => ({
      contents: [{ uri, mimeType: 'text/html', text: '<b>v1</b>' }],
    }));
    try {
      const cc = (await fetch(resourceUrl(route.server.url))).headers.get('cache-control') ?? '';
      // 상대가 위젯을 갈아 끼우면 낡은 화면을 그 기간 내내 내주게 된다.
      expect(cc).not.toContain('immutable');
      expect(cc).not.toContain('31536000');
      // ✅ 대신 «쓰기 전에 다시 물어보게» 한다.
      expect(cc).toContain('no-cache');
    } finally { route.server.stop(); }
  });

  test('dispatches an authenticated HTTP request to the configured ready client and preserves text MIME/cache headers', async () => {
    const route = await startResourceServer(async (uri) => ({
      contents: [{ uri, mimeType: 'text/html; charset=utf-8', text: '<main>large body</main>' }],
    }));
    try {
      const first = await fetch(resourceUrl(route.server.url));
      const second = await fetch(resourceUrl(route.server.url));
      expect(first.status).toBe(200);
      expect(await first.text()).toBe('<main>large body</main>');
      expect(first.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(first.headers.get('cache-control')).toBe('private, no-cache');
      expect(second.headers.get('cache-control')).toBe(first.headers.get('cache-control'));
      expect(route.calls).toEqual(['https://example.test/view', 'https://example.test/view']);
    } finally {
      route.server.stop();
    }
  });

  test('passes base64 blobs through the HTTP dispatcher with their MIME type', async () => {
    const route = await startResourceServer(async (uri) => ({ contents: [{ uri, mimeType: 'image/png', blob: 'AAEC' }] }));
    try {
      const response = await fetch(resourceUrl(route.server.url, 'canvas', 'https://example.test/image'));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2]);
    } finally {
      route.server.stop();
    }
  });

  test('rejects unauthenticated HTTP requests before upstream access', async () => {
    const route = await startResourceServer(async () => ({ contents: [] }), { authorized: false });
    try {
      const response = await fetch(resourceUrl(route.server.url));
      expect(response.status).toBe(401);
      expect(route.calls).toEqual([]);
    } finally {
      route.server.stop();
    }
  });

  test('rejects malformed input and unknown server IDs without upstream access', async () => {
    const route = await startResourceServer(async () => ({ contents: [] }));
    try {
      const malformed = await fetch(`${route.server.url}${RESOURCE_PATH}?server=canvas&uri=not-a-uri`);
      const unknown = await fetch(resourceUrl(route.server.url, 'absent'));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: 'invalid-resource-uri' });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'mcp-server-not-configured', server: 'absent' });
      expect(route.calls).toEqual([]);
    } finally {
      route.server.stop();
    }
  });

  test('rejects inherited property names as unconfigured server IDs without upstream access', async () => {
    const route = await startResourceServer(async () => ({ contents: [] }));
    try {
      for (const server of ['__proto__', 'constructor']) {
        const response = await fetch(resourceUrl(route.server.url, server));
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'mcp-server-not-configured', server });
      }
      expect(route.calls).toEqual([]);
    } finally {
      route.server.stop();
    }
  });

  test('distinguishes missing resource, retryable boot connection failure, permanent boot states, and retryable upstream failure', async () => {
    const missing = await startResourceServer(async () => ({ contents: [] }));
    const failed = await startResourceServer(async () => ({ contents: [] }), { status: 'failed' });
    const disabled = await startResourceServer(async () => ({ contents: [] }), { status: 'disabled' });
    const missingClient = await startResourceServer(async () => ({ contents: [] }), { clientPresent: false });
    const unavailable = await startResourceServer(async () => { throw new McpConnectionError('unreachable', 'down'); });
    try {
      const missingResponse = await fetch(resourceUrl(missing.server.url, 'canvas', 'https://example.test/missing'));
      const failedResponse = await fetch(resourceUrl(failed.server.url));
      const disabledResponse = await fetch(resourceUrl(disabled.server.url));
      const missingClientResponse = await fetch(resourceUrl(missingClient.server.url));
      const unavailableResponse = await fetch(resourceUrl(unavailable.server.url));
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({ error: 'mcp-resource-not-found', uri: 'https://example.test/missing' });
      expect(failedResponse.status).toBe(503);
      expect(await failedResponse.json()).toEqual({ error: 'mcp-resource-unavailable', retryable: true });
      expect(failedResponse.headers.get('retry-after')).toBe('1');
      for (const response of [disabledResponse, missingClientResponse]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'mcp-resource-unavailable', retryable: false });
        expect(response.headers.get('retry-after')).toBeNull();
      }
      expect(failed.calls).toEqual([]);
      expect(disabled.calls).toEqual([]);
      expect(missingClient.calls).toEqual([]);
      expect(unavailableResponse.status).toBe(502);
      expect(await unavailableResponse.json()).toEqual({ error: 'mcp-resource-unavailable', retryable: true });
      expect(unavailableResponse.headers.get('retry-after')).toBe('1');
    } finally {
      missing.server.stop();
      failed.server.stop();
      disabled.server.stop();
      missingClient.server.stop();
      unavailable.server.stop();
    }
  });

  test('reports missing MCP client wiring as unavailable without upstream access', async () => {
    const route = await startResourceServer(async () => ({ contents: [] }), { getMcpClients: false });
    try {
      const response = await fetch(resourceUrl(route.server.url));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'mcp-resource-unavailable', retryable: false });
      expect(response.headers.get('retry-after')).toBeNull();
      expect(route.calls).toEqual([]);
    } finally {
      route.server.stop();
    }
  });

  test('maps resources/read JSON-RPC not-found errors to resource-not-found while other upstream errors remain unavailable', async () => {
    const missing = await startResourceServer(async () => { throw new McpServerError(-32002, 'Resource not found'); });
    const unavailable = await startResourceServer(async () => { throw new Error('invalid upstream payload'); });
    try {
      const missingResponse = await fetch(resourceUrl(missing.server.url, 'canvas', 'https://example.test/not-found-error'));
      const unavailableResponse = await fetch(resourceUrl(unavailable.server.url));
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({
        error: 'mcp-resource-not-found',
        uri: 'https://example.test/not-found-error',
      });
      expect(unavailableResponse.status).toBe(502);
      expect(await unavailableResponse.json()).toEqual({ error: 'mcp-resource-unavailable', retryable: false });
    } finally {
      missing.server.stop();
      unavailable.server.stop();
    }
  });

  test('keeps the inbound MCP transport on its distinct POST path', async () => {
    const route = await startResourceServer(async () => ({ contents: [] }));
    try {
      const response = await fetch(`${route.server.url}/v1/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(response.status).toBe(200);
      expect(route.calls).toEqual([]);
    } finally {
      route.server.stop();
    }
  });
});
