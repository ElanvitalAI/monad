/** HTTP route contracts shared by the MCP daemon and PWA. This leaf must remain import-free. */
export const MCP_WIDGET_CALL_ROUTE = '/v1/mcp/widgets/call';
export const MCP_RESOURCE_ROUTE = '/v1/mcp/resources';

/** ⛔⭐⭐ 위젯이 「어디에 연결해도 되나 · 어디서 그림을 받아도 되나」를 나르는 머리 이름.
 *
 *  📏 2026-08-21 라이브: 리소스 경로가 본문만 돌려주고 상대가 «선언한» 허용 출처를 버려서
 *  위젯 CSP 가 전부 `'none'` 이 됐다 ⇒ 그림이 깨지고 「Connecting...」 에서 영영 멈췄다.
 *  ⛔ 이 이름들은 «잎»에 둔다 — 라우트 모듈에 두면 브라우저가 그것을 import 하면서
 *    데몬 그래프를 통째로 번들에 끌어온다(같은 날 그 함정을 한 번 밟았다). */
export const MCP_APP_CONNECT_DOMAINS_HEADER = 'x-elanous-mcp-app-connect-domains';
export const MCP_APP_RESOURCE_DOMAINS_HEADER = 'x-elanous-mcp-app-resource-domains';
