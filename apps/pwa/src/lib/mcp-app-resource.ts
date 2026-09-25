import {
  MCP_APP_CONNECT_DOMAINS_HEADER,
  MCP_APP_RESOURCE_DOMAINS_HEADER,
  MCP_RESOURCE_ROUTE,
} from '../../../../src/tool-runtime/mcp-route-path';


export const MCP_RESOURCE_PATH = MCP_RESOURCE_ROUTE;

export function mcpAppResourcePath(server: string, uri: string): string {
  const query = new URLSearchParams({ server, uri });
  return `${MCP_RESOURCE_PATH}?${query.toString()}`;
}

/** 머리로 온 허용 출처. ⛔ 이름은 데몬 라우트와 «같은 집»에서 읽는다 — 베끼지 않는다.
 *
 *  ⛔⭐⭐ 「모른다」와 「비었다고 «선언»했다」를 다른 값으로 돌려준다:
 *    머리 «없음» → `undefined`(상대가 그 칸을 말하지 않았다)
 *    머리 «빈 값» → `[]`      (상대가 「아무 데도 허용 안 함」이라 «말했다»)
 *  ⚠️ CSP 결과는 둘 다 거부다 — 모르는데 여는 것은 보안 후퇴다. 갈리는 것은 «진단»이지 정책이 아니다. */
function originsFrom(res: Response, header: string): string[] | undefined {
  const raw = res.headers.get(header);
  if (raw === null) return undefined;
  return raw.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0);
}

export interface McpAppResourceBody {
  html: string;
  connectDomains?: string[];
  resourceDomains?: string[];
}

/** 프레임에 실을 허용 출처를 «고른다».
 *
 *  ⛔📏 무인 리뷰 should-fix(2026-08-21): 이 결정이 렌더 본문 «안»에 있으면 시험이 못 문다 —
 *  조회 결과가 실제 CSP 로 흘러가는 «마지막 배선»이 그 자리다. ⇒ 함수로 꺼내 여기서 문다.
 *  ⭐ 블록이 이미 아는 값이 우선이다 — 그것은 툴 결과가 «직접» 선언한 것이라 한 다리 더 가깝다. */
export function mcpAppFrameDomains(
  block: { connectDomains?: string[]; resourceDomains?: string[] },
  fetched: McpAppResourceBody | null,
): { connectDomains?: string[]; resourceDomains?: string[] } {
  return {
    ...(block.connectDomains ?? fetched?.connectDomains ? { connectDomains: block.connectDomains ?? fetched?.connectDomains } : {}),
    ...(block.resourceDomains ?? fetched?.resourceDomains ? { resourceDomains: block.resourceDomains ?? fetched?.resourceDomains } : {}),
  };
}

/** 머리를 읽어야 하므로 응답을 그대로 주는 문이 필요하다.
 *  ⛔ export 하지 않는다 — 이 모듈 밖에 소비처가 «없다»(무인 리뷰 must-fix · 2026-08-21).
 *  호출부는 구조적으로 맞는 객체를 넘기면 되고, 그것이 이 저장소의 다른 포트와 같은 방식이다. */
interface McpAppResourceTransport {
  fetchResponse(path: string, init?: RequestInit): Promise<Response>;
}

/** Fetches a widget body the tool result did not embed.
 *
 *  ⛔📏 2026-08-21 라이브: ***이 경로가 「가끔 도는 폴백」이 아니라 «늘 도는 길»이었다.***
 *  읽는 쪽이 형식을 `=== 'text/html'` 로 비교했는데 실제 값은 `text/html;profile=mcp-app` 이라
 *  임베드 본문이 영영 안 쓰였기 때문이다. 그래서 위젯은 매번 35~57초를 기다렸다.
 *
 *  ⛔⭐ 그리고 이 경로는 상대가 «선언한» CSP 허용 출처를 버리고 있었다 ⇒ 위젯 CSP 가 전부
 *  `'none'` 이 되어 그림도 못 받고 연결도 못 했다(「Connecting...」 에서 영영 멈춤).
 *  ⇒ 이제 그 목록을 머리에서 읽어 «같이» 돌려준다.
 *
 *  ⛔ null 로 돌려준다 — 못 받은 본문이 기존 폴백 문구를 지우면 안 된다. */
export async function fetchMcpAppHtml(
  transport: McpAppResourceTransport,
  input: { server: string; uri: string; signal?: AbortSignal },
): Promise<McpAppResourceBody | null> {
  if (!input.server || !input.uri) return null;
  try {
    const res = await transport.fetchResponse(
      mcpAppResourcePath(input.server, input.uri),
      input.signal ? { signal: input.signal } : undefined,
    );
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length === 0) return null;
    // ⛔ 같은 머리를 두 번 파싱하지 않는다(무인 리뷰 should-fix · 2026-08-21).
    const connectDomains = originsFrom(res, MCP_APP_CONNECT_DOMAINS_HEADER);
    const resourceDomains = originsFrom(res, MCP_APP_RESOURCE_DOMAINS_HEADER);
    return {
      html,
      ...(connectDomains ? { connectDomains } : {}),
      ...(resourceDomains ? { resourceDomains } : {}),
    };
  } catch {
    return null;
  }
}
