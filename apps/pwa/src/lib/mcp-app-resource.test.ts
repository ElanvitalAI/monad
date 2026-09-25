import { describe, expect, test } from 'bun:test';
import { MCP_RESOURCE_ROUTE_PATH } from '../../../../src/nexus/api/mcp-resource-route.js';
import {
  MCP_APP_CONNECT_DOMAINS_HEADER,
  MCP_APP_RESOURCE_DOMAINS_HEADER,
} from '../../../../src/tool-runtime/mcp-route-path';
import { MCP_RESOURCE_PATH, fetchMcpAppHtml, mcpAppResourcePath } from './mcp-app-resource';

describe('resource path', () => {
  test('matches the route the daemon serves', () => {
    expect(MCP_RESOURCE_PATH).toBe(MCP_RESOURCE_ROUTE_PATH);
  });

  test('carries server and uri as query params the route reads', () => {
    const path = mcpAppResourcePath('higgsfield', 'ui://higgsfield/generation-v2.html');
    const url = new URL(path, 'http://x');
    expect(url.pathname).toBe(MCP_RESOURCE_ROUTE_PATH);
    expect(url.searchParams.get('server')).toBe('higgsfield');
    expect(url.searchParams.get('uri')).toBe('ui://higgsfield/generation-v2.html');
  });

  test('escapes a uri that would otherwise split the query', () => {
    const path = mcpAppResourcePath('s', 'ui://a?b=1&server=evil');
    const url = new URL(path, 'http://x');
    // The injected `server=evil` must stay inside the uri value, not become a
    // second server param the route might read instead.
    expect(url.searchParams.get('server')).toBe('s');
    expect(url.searchParams.get('uri')).toBe('ui://a?b=1&server=evil');
  });
});

function transport(body: string, opts: { status?: number; headers?: Record<string, string>; seen?: { path?: string; init?: RequestInit }; onCall?: () => void } = {}) {
  return {
    async fetchResponse(path: string, init?: RequestInit): Promise<Response> {
      opts.onCall?.();
      if (opts.seen) { opts.seen.path = path; opts.seen.init = init; }
      return new Response(body, { status: opts.status ?? 200, headers: opts.headers });
    },
  };
}

describe('fetching a body the result did not embed', () => {
  test('returns the html the route serves', async () => {
    const seen: { path?: string } = {};
    const body = await fetchMcpAppHtml(transport('<div>widget</div>', { seen }), { server: 'higgsfield', uri: 'ui://x' });
    expect(body?.html).toBe('<div>widget</div>');
    expect(new URL(seen.path!, 'http://x').pathname).toBe(MCP_RESOURCE_ROUTE_PATH);
  });

  test('🚨 carries the allowed origins the peer declared — without them the widget CSP is all none', async () => {
    // ⛔📏 2026-08-21 라이브: 이 경로로 온 위젯은 허용 출처가 없어 CSP 가 전부 `'none'` 이 됐고,
    //   그림이 깨지고 「Connecting...」 에서 영영 멈췄다. 그 목록이 «오는지»를 여기서 문다.
    const body = await fetchMcpAppHtml(
      transport('<div/>', {
        headers: {
          [MCP_APP_CONNECT_DOMAINS_HEADER]: 'https://api.higgsfield.ai, https://ws.higgsfield.ai',
          [MCP_APP_RESOURCE_DOMAINS_HEADER]: 'https://cdn.higgsfield.ai',
        },
      }),
      { server: 's', uri: 'ui://x' },
    );
    expect(body?.connectDomains).toEqual(['https://api.higgsfield.ai', 'https://ws.higgsfield.ai']);
    expect(body?.resourceDomains).toEqual(['https://cdn.higgsfield.ai']);
  });

  test('no origin header means «we were not told» — not «none allowed»', async () => {
    const body = await fetchMcpAppHtml(transport('<div/>'), { server: 's', uri: 'ui://x' });
    expect(body?.connectDomains).toBeUndefined();
    expect(body?.resourceDomains).toBeUndefined();
  });

  test('🚨 an empty header means the peer «declared» an empty list — that is a different value from silence', async () => {
    // ⛔📏 무인 리뷰 must-fix(2026-08-21): 이 둘을 뭉개면 「상대가 아무것도 허용 안 한다」와
    //   「우리가 못 들었다」를 영영 구별할 수 없다. ⚠️ CSP 결과는 둘 다 거부다 — 갈리는 것은 «진단»이다.
    const body = await fetchMcpAppHtml(
      transport('<div/>', { headers: { [MCP_APP_CONNECT_DOMAINS_HEADER]: '' } }),
      { server: 's', uri: 'ui://x' },
    );
    expect(body?.connectDomains).toEqual([]);          // 선언됐고, 비어 있다
    expect(body?.resourceDomains).toBeUndefined();     // 그 칸은 «말하지 않았다»
  });

  test('an error status is not a widget body', async () => {
    // The route answers errors as JSON with a non-2xx status; rendering that
    // body would put daemon internals in an iframe.
    const body = await fetchMcpAppHtml(transport('{"error":"mcp-server-not-configured"}', { status: 404 }), { server: 's', uri: 'ui://x' });
    expect(body).toBeNull();
  });

  test('a throwing transport leaves the caller fallback standing', async () => {
    const body = await fetchMcpAppHtml(
      { async fetchResponse(): Promise<Response> { throw new Error('503'); } },
      { server: 'higgsfield', uri: 'ui://x' },
    );
    expect(body).toBeNull();
  });

  test('empty body is not a widget', async () => {
    expect(await fetchMcpAppHtml(transport(''), { server: 's', uri: 'ui://x' })).toBeNull();
  });

  test('never asks without a server — the route would 400 and we would burn a round trip', async () => {
    let called = false;
    const body = await fetchMcpAppHtml(transport('x', { onCall: () => { called = true; } }), { server: '', uri: 'ui://x' });
    expect(body).toBeNull();
    expect(called).toBe(false);
  });

  test('never asks without a uri', async () => {
    let called = false;
    const body = await fetchMcpAppHtml(transport('x', { onCall: () => { called = true; } }), { server: 's', uri: '' });
    expect(body).toBeNull();
    expect(called).toBe(false);
  });

  test('forwards an abort signal so an unmounted block stops asking', async () => {
    const seen: { init?: RequestInit } = {};
    const controller = new AbortController();
    await fetchMcpAppHtml(transport('x', { seen }), { server: 's', uri: 'ui://x', signal: controller.signal });
    expect(seen.init?.signal).toBe(controller.signal);
  });
});
