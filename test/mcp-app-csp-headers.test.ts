import { describe, expect, it } from 'bun:test';
import { mcpAppCspHeaders } from '../src/nexus/api/mcp-resource-route.js';
import {
  MCP_APP_CONNECT_DOMAINS_HEADER,
  MCP_APP_RESOURCE_DOMAINS_HEADER,
} from '../src/tool-runtime/mcp-route-path.js';

/** ⛔⭐⭐⭐ 2026-08-21 라이브 실측(`[F]` 15차 · Dia CDP 로 실제 위젯 iframe 을 읽음):
 *
 *  ```
 *  CSP: default-src 'none'; connect-src 'none'; img-src 'none'; style-src 'none'; font-src 'none'
 *  ```
 *  ⇒ 위젯 안 그림이 깨지고 ***「Connecting...」 에서 영영 멈췄다.***
 *  원인은 이 라우트가 본문만 돌려주고 상대가 `_meta.ui.csp` 로 «선언한» 허용 출처를 버린 것이다.
 *  ⇒ 그 목록을 머리로 나른다. 이 파일이 그 계약을 문다. */

describe('widget resource — the peer’s allowed origins ride along', () => {
  it('carries both lists when the peer declared them', () => {
    expect(mcpAppCspHeaders({
      uri: 'ui://x',
      text: '<div/>',
      _meta: { ui: { csp: { connectDomains: ['https://api.x', 'https://ws.x'], resourceDomains: ['https://cdn.x'] } } },
    } as never)).toEqual({
      [MCP_APP_CONNECT_DOMAINS_HEADER]: 'https://api.x,https://ws.x',
      [MCP_APP_RESOURCE_DOMAINS_HEADER]: 'https://cdn.x',
    });
  });

  it('says nothing when the peer said nothing — «모른다» must not read as «없다»', () => {
    expect(mcpAppCspHeaders({ uri: 'ui://x', text: '<div/>' } as never)).toEqual({});
    expect(mcpAppCspHeaders({ uri: 'ui://x', text: '<div/>', _meta: {} } as never)).toEqual({});
    expect(mcpAppCspHeaders({ uri: 'ui://x', text: '<div/>', _meta: { ui: { csp: {} } } } as never)).toEqual({});
  });

  it('🚨 an explicitly empty list is «declared», so it rides as an empty header — not as silence', () => {
    // ⛔📏 무인 리뷰 must-fix(2026-08-21): 초판은 이것을 «머리 부재»로 뭉갰다. 그러면 읽는 쪽이
    //   「상대가 아무것도 허용 안 한다」를 「우리가 못 들었다」와 구별할 수 없다.
    //   ⚠️ CSP 결과는 둘 다 거부다 — 갈리는 것은 «진단»이지 정책이 아니다.
    expect(mcpAppCspHeaders({ uri: 'ui://x', _meta: { ui: { csp: { connectDomains: [] } } } } as never))
      .toEqual({ [MCP_APP_CONNECT_DOMAINS_HEADER]: '' });
  });

  it('drops non-string entries rather than shipping them into a CSP', () => {
    expect(mcpAppCspHeaders({
      uri: 'ui://x',
      _meta: { ui: { csp: { connectDomains: ['https://ok', 42, null, '  '] } } },
    } as never)).toEqual({ [MCP_APP_CONNECT_DOMAINS_HEADER]: 'https://ok' });
  });

  it('ignores a malformed meta shape instead of throwing on the widget path', () => {
    expect(mcpAppCspHeaders({ uri: 'ui://x', _meta: [1, 2] } as never)).toEqual({});
    expect(mcpAppCspHeaders({ uri: 'ui://x', _meta: { ui: 'nope' } } as never)).toEqual({});
    expect(mcpAppCspHeaders({ uri: 'ui://x', _meta: { ui: { csp: 'nope' } } } as never)).toEqual({});
  });
});
