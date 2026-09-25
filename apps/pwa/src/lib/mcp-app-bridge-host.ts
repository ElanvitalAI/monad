import { MCP_WIDGET_CALL_ROUTE } from '../../../../src/tool-runtime/mcp-route-path';
import { createBrowserMcpAppBridge, type BrowserMcpAppBridge, type McpAppBridgeEventHost, type McpAppToolCaller } from './mcp-app-bridge';
import { debugLog } from './debug';

/** REST edge for widget tool calls.
 *
 *  ⛔ The daemon route derives the MCP server from trusted server-side
 *  context and ignores any server the caller supplies — that is the whole
 *  point of `POST /v1/mcp/widgets/call`. The bridge still carries `server`
 *  so the host-side pairing stays auditable, but it is deliberately not
 *  put on the wire: sending it would invite a future reader to think the
 *  request chooses the server. */
export const MCP_WIDGET_CALL_PATH = MCP_WIDGET_CALL_ROUTE;

/** Narrowed to exactly what this edge needs. `DaemonClient.fetchJson` is
 *  generic and satisfies it; keeping the port non-generic means a test double
 *  is four lines instead of a generic method that has to lie about its
 *  return type. */
export interface WidgetCallTransport {
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export function createWidgetToolCaller(transport: WidgetCallTransport): McpAppToolCaller {
  return {
    async callWidgetTool({ tool, arguments: args }) {
      return transport.fetchJson(MCP_WIDGET_CALL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: tool, args: args ?? {} }),
      });
    },
  };
}

export interface McpAppFrameAttachment {
  frameId: string;
  source: object;
  server: string;
  tool?: string;
  toolCallId?: string;
  /** 이 화면을 만든 툴 호출의 결과. 규범상 호스트가 «초기 상태»로 밀어야 하는 값이다. */
  toolResult?: unknown;
}

/** ⛔⭐⭐⭐ 프레임 «배선»을 이 자리로 꺼낸 이유 — 리액트 `onLoad` 안에 두면 물 수가 없다.
 *
 *  📏 2026-08-21 실측: 이 배선이 «세 군데» 끊겨 있었고 시험 전부가 초록이었다.
 *    ① `publishMcpAppToolResult` 를 부르는 프로덕션 자리가 «0» 이었다.
 *    ② 브리지 표면에 `publish` 가 «없어서» 부를 방법 자체가 없었다.
 *    ③ 등록이 `tool` 을 «안 실어» 라우팅 조건 `frame.tool === published.tool` 이 영영 안 맞았다.
 *  ⇒ 셋 다 「기능이 없다」가 아니라 «있는데 그 경로가 안 쓴다» 였다. 그래서 그 경로를
 *    ***함수로 꺼내 시험이 직접 물게 한다*** — 렌더 콜백 안에 두면 다시 조용히 끊긴다. */
export function attachMcpAppFrame(bridge: BrowserMcpAppBridge, frame: McpAppFrameAttachment): () => void {
  const unregister = bridge.register({
    frameId: frame.frameId,
    source: frame.source,
    server: frame.server,
    ...(frame.tool !== undefined ? { tool: frame.tool } : {}),
    ...(frame.toolCallId !== undefined ? { toolCallId: frame.toolCallId } : {}),
  });
  // ⛔ 결과가 없거나 툴 이름이 없으면 «안 민다» — 라우팅이 툴 이름으로 갈리고,
  //   빈 것을 밀면 위젯이 「결과가 비었다」로 읽는다. 「모른다」와 「비었다」는 다른 값이다.
  const willPublish = frame.toolResult !== undefined && frame.tool !== undefined;
  // ⛔⭐⭐ 📏 2026-08-22(16차 `[F]`): ***안 미는 것이 «조용했다».***
  //   위젯이 빈 화면으로 남았을 때 「밀 것이 없었나 · 밀었는데 안 닿았나 · 닿았는데 못 그렸나」를
  //   가를 값이 하나도 없어, 사람이 CDP 로 30분을 뒤지고도 답을 못 냈다.
  //   ⇒ 「안 밀었다」에도 «이름»을 붙인다. ⛔ 결과 «값»은 안 싣는다(크고, 남의 것이다) — 유무만.
  debugLog('mcp-app.bridge.attach', {
    frameId: frame.frameId,
    server: frame.server,
    hasTool: frame.tool !== undefined,
    hasToolCallId: frame.toolCallId !== undefined,
    hasToolResult: frame.toolResult !== undefined,
    published: willPublish,
    ...(willPublish ? {} : { skipped: frame.tool === undefined ? 'no-tool' : 'no-tool-result' }),
  });
  if (willPublish) {
    bridge.publish({
      server: frame.server,
      tool: frame.tool!,
      ...(frame.toolCallId !== undefined ? { toolCallId: frame.toolCallId } : {}),
      result: frame.toolResult,
    });
  }
  return unregister;
}

/** One bridge per transport. Frames from different conversations share it —
 *  isolation is per-frame inside the bridge (registered Window identity),
 *  not per-bridge, so a second bridge would only add a second listener. */
const bridges = new WeakMap<object, BrowserMcpAppBridge>();

export function getMcpAppBridge(
  transport: WidgetCallTransport,
  host: McpAppBridgeEventHost,
): BrowserMcpAppBridge {
  const existing = bridges.get(transport);
  if (existing) return existing;
  const created = createBrowserMcpAppBridge(host, createWidgetToolCaller(transport));
  bridges.set(transport, created);
  return created;
}
