import {
  isRetryableMcpConnectionFailure,
  McpServerError,
  type McpClient,
  type McpResourceContent,
} from '../../mcp/client.js';
import {
  MCP_APP_CONNECT_DOMAINS_HEADER,
  MCP_APP_RESOURCE_DOMAINS_HEADER,
  MCP_RESOURCE_ROUTE,
} from '../../tool-runtime/mcp-route-path.js';
import type { McpClientsHandle } from '../boot/register-mcp-clients.js';
import { debug } from '../../debug/log.js';

const MCP_RESOURCE_NOT_FOUND_CODE = -32002;

export const MCP_RESOURCE_ROUTE_PATH = MCP_RESOURCE_ROUTE;
// ⛔⭐ **`immutable` 을 1년 붙이지 않는다.** 우리는 그 주소가 «불변이라는 보장»을 갖고 있지 않다 —
//    서버가 위젯을 갈아 끼우면 낡은 화면을 1년 동안 내주게 된다(리뷰 must-fix).
//    ✅ 대신 «다시 물어보게» 한다: 캐시는 두되 쓰기 전에 확인시킨다.
//    ⇒ 상대가 바꾸면 다음 요청에서 바로 반영되고, 안 바꿨으면 본문을 다시 안 받는다.
const CACHE_CONTROL = 'private, no-cache';

type ResourceClient = Pick<McpClient, 'readResource'> & { opts?: { id?: string } };

function clientId(client: McpClient): string | undefined {
  return (client as unknown as ResourceClient).opts?.id;
}

export interface McpResourceRouteOpts {
  getClients: () => McpClientsHandle | undefined;
  authorize: (req: Request) => boolean;
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function selectedContent(contents: McpResourceContent[], uri: string): McpResourceContent | undefined {
  return contents.find((content) => content.uri === uri && (typeof content.text === 'string' || typeof content.blob === 'string'));
}

/** ⛔⭐⭐ 「모른다」와 「비었다고 «선언»했다」를 다른 값으로 나른다.
 *
 *  📏 무인 리뷰 must-fix(2026-08-21 · PR #10887): 초판은 둘 다 «머리 부재»로 뭉갰고,
 *  그러면 읽는 쪽이 「상대가 아무것도 허용 안 한다」를 「우리가 못 들었다」와 구별할 수 없다.
 *  ⛔ **CSP 결과는 둘 다 거부다** — 모르는데 여는 것은 보안 후퇴다. 갈리는 것은 «진단»이다.
 *
 *  ⇒ 배열이 아니면 `undefined`(머리 없음 = 모른다) · 배열이면 «빈 문자열이라도» 머리를 붙인다. */
function originList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((origin): origin is string => typeof origin === 'string' && origin.trim().length > 0)
    .join(',');
}

/** 리소스 `_meta.ui.csp` 에서 허용 출처를 꺼내 머리로. ⛔ 없으면 «안 붙인다». */
export function mcpAppCspHeaders(content: McpResourceContent): Record<string, string> {
  const meta = (content as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const ui = (meta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return {};
  const csp = (ui as Record<string, unknown>).csp;
  if (!csp || typeof csp !== 'object' || Array.isArray(csp)) return {};
  const connect = originList((csp as Record<string, unknown>).connectDomains);
  const resource = originList((csp as Record<string, unknown>).resourceDomains);
  return {
    ...(connect !== undefined ? { [MCP_APP_CONNECT_DOMAINS_HEADER]: connect } : {}),
    ...(resource !== undefined ? { [MCP_APP_RESOURCE_DOMAINS_HEADER]: resource } : {}),
  };
}

function responseBody(content: McpResourceContent): string | Blob {
  if (typeof content.text === 'string') return content.text;
  return new Blob([Uint8Array.fromBase64(content.blob!)]);
}

/** GET /v1/mcp/resources?server=<configured-id>&uri=<resource-uri>. */
export async function handleMcpResourceGet(req: Request, opts: McpResourceRouteOpts): Promise<Response> {
  if (!opts.authorize(req)) return jsonResponse({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const serverId = url.searchParams.get('server');
  const uri = url.searchParams.get('uri');
  if (!serverId || !uri) return jsonResponse({ error: 'invalid-resource-request' }, 400);
  try {
    new URL(uri);
  } catch {
    return jsonResponse({ error: 'invalid-resource-uri' }, 400);
  }

  const handle = opts.getClients();
  if (!handle) return jsonResponse({ error: 'mcp-resource-unavailable', retryable: false }, 503);

  if (!Object.hasOwn(handle.perServer, serverId)) {
    return jsonResponse({ error: 'mcp-server-not-configured', server: serverId }, 404);
  }
  const server = handle.perServer[serverId];
  if (server.status !== 'ready') {
    const retryable = server.status === 'failed';
    return jsonResponse(
      { error: 'mcp-resource-unavailable', retryable },
      503,
      retryable ? { 'retry-after': '1' } : undefined,
    );
  }
  const client = handle.clients.find((candidate) => clientId(candidate) === serverId) as ResourceClient | undefined;
  if (!client) {
    return jsonResponse({ error: 'mcp-resource-unavailable', retryable: false }, 503);
  }

  // ⛔⭐⭐⭐ 2026-08-21 라이브: 이 경로에 계측이 «0» 이었다. 그래서 위젯이 안 뜰 때
  //   ⓐ 요청이 나갔나 ⓑ 상대가 느린가 ⓒ 우리가 멈췄나 를 «아무도 못 갈랐다».
  //   📏 실측이 그것을 증명했다 — 같은 조회가 한 번은 18초, 다음엔 10분 넘게 안 돌아왔는데
  //     `monad logs` 에 25분간 «한 줄도» 없었다. ⇒ 나가는 자리와 돌아오는 자리를 «둘 다» 남긴다.
  const startedAt = Date.now();
  debug.log('mcp.resource.read', 'start', { server: serverId, uri });
  try {
    const result = await client.readResource(uri);
    const content = selectedContent(result.contents, uri);
    if (!content) {
      debug.log('mcp.resource.read', 'not-found', { server: serverId, uri, elapsedMs: Date.now() - startedAt });
      return jsonResponse({ error: 'mcp-resource-not-found', uri }, 404);
    }
    const csp = mcpAppCspHeaders(content);
    debug.log('mcp.resource.read', 'ok', {
      server: serverId,
      uri,
      elapsedMs: Date.now() - startedAt,
      bytes: typeof content.text === 'string' ? content.text.length : content.blob?.length ?? 0,
      // ⛔ 「모른다」가 직렬화에서 «사라지지» 않게 명시한다 — 없는 필드와 「상대가 형식을 안 말했다」는 다른 값이다.
      mimeType: content.mimeType ?? null,
      // ⭐ 「상대가 허용 출처를 말했나」 — 이것이 없으면 위젯 CSP 가 전부 거부로 선다.
      cspHeaders: Object.keys(csp),
    });
    return new Response(responseBody(content), {
      headers: {
        // ⛔⭐⭐ 2026-08-21 라이브: 이 경로로 온 위젯은 CSP 가 «전부 `'none'`» 이라
        //   이미지도 못 받고 연결도 못 해 ***「Connecting...」 에서 영영 멈췄다.***
        //   본문만 돌려주고 상대가 «선언한» 허용 출처를 버렸기 때문이다.
        //   ⇒ 그 목록을 같이 나른다. ⛔ 본문 형식은 그대로 둔다 — 위젯 HTML 이 JSON 이 되면
        //     읽는 쪽이 전부 갈린다. 그래서 «머리»에 싣는다.
        ...csp,
        // ⛔⭐ 상대가 형식을 «안 말했으면» 우리가 지어내지 않는다.
        //    `application/octet-stream` 은 「이진 덩어리다」라는 «주장»이고, 우리는 그걸 모른다.
        //    ⇒ 모르면 그 머리를 «안 붙인다». 「모른다」와 「이진이다」는 다른 값이다(리뷰 must-fix).
        ...(content.mimeType ? { 'content-type': content.mimeType } : {}),
        'cache-control': CACHE_CONTROL,
      },
    });
  } catch (err) {
    // ⛔ 실패도 «이름으로» 가른다 — 「없다」·「못 닿았다」·「그 밖」은 다음 수가 다르다.
    const outcome = err instanceof McpServerError && err.code === MCP_RESOURCE_NOT_FOUND_CODE ? 'not-found'
      : isRetryableMcpConnectionFailure(err) ? 'unreachable' : 'failed';
    debug.log('mcp.resource.read', outcome, {
      server: serverId,
      uri,
      elapsedMs: Date.now() - startedAt,
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    if (outcome === 'not-found') return jsonResponse({ error: 'mcp-resource-not-found', uri }, 404);
    if (outcome === 'unreachable') {
      return jsonResponse({ error: 'mcp-resource-unavailable', retryable: true }, 502, { 'retry-after': '1' });
    }
    return jsonResponse({ error: 'mcp-resource-unavailable', retryable: false }, 502);
  }
}
