import { describe, expect, test } from 'bun:test';
import { attachMcpAppFrame } from './mcp-app-bridge-host';
import {
  createBrowserMcpAppBridge, MCP_APP_RESULT_OMITTED_META_KEY, MCP_UI_INITIALIZED_METHOD, MCP_UI_TOOL_RESULT_METHOD,
  type McpAppBridgeEventHost,
} from './mcp-app-bridge';

/** ⛔⭐⭐⭐ 이 파일이 무는 것은 «로직»이 아니라 «배선»이다.
 *
 *  📏 2026-08-21 전수 실측 — 결과 푸시 경로가 «세 군데» 끊겨 있었고 시험 32개가 전부 초록이었다:
 *    ① `publishMcpAppToolResult` 의 프로덕션 호출자 0
 *    ② 브리지 표면에 `publish` 가 없음 (부를 문 자체가 없다)
 *    ③ 등록이 `tool` 을 안 실어 라우팅이 영영 안 맞음
 *  ⇒ 순수 함수 시험은 ①②③ 중 «하나도» 못 잡는다 — 그것들은 「무는가」가 아니라
 *    ***「그 코드가 실행 경로에 있나」***이기 때문이다. 그래서 배선을 함수로 꺼내 여기서 문다. */

function harness() {
  let listener: ((event: MessageEvent) => void) | undefined;
  const host: McpAppBridgeEventHost = {
    addEventListener: (_type, next) => { listener = next; },
    removeEventListener: () => { listener = undefined; },
  };
  const posted: unknown[] = [];
  const source = { postMessage: (message: unknown) => { posted.push(message); } };
  const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async () => ({}) });
  const ready = () => listener?.({ source, data: { jsonrpc: '2.0', method: MCP_UI_INITIALIZED_METHOD } } as unknown as MessageEvent);
  return { bridge, source, posted, ready };
}

describe('MCP app frame attachment — the wiring, not the reducer', () => {
  test('a widget that says it is ready receives the result of the call that created it', () => {
    const { bridge, source, posted, ready } = harness();

    attachMcpAppFrame(bridge, {
      frameId: 'f', source, server: 'higgsfield', tool: 'generate_image', toolCallId: 'call-1',
      toolResult: { content: [{ type: 'text', text: 'done' }] },
    });
    // ⛔ 준비 «전»에는 아무것도 안 간다 — 규범에 호스트→위젯 인사말이 없다.
    expect(posted).toEqual([]);

    ready();
    expect(posted).toEqual([{
      jsonrpc: '2.0',
      method: MCP_UI_TOOL_RESULT_METHOD,
      params: { content: [{ type: 'text', text: 'done' }] },
    }]);
  });

  test('the result is not pushed when the frame does not name its tool, because routing turns on that name', () => {
    const { bridge, source, posted, ready } = harness();
    attachMcpAppFrame(bridge, { frameId: 'f', source, server: 'higgsfield', toolResult: { content: [] } });
    ready();
    expect(posted).toEqual([]);
  });

  test('a frame without a result stays silent rather than pushing an empty one', () => {
    const { bridge, source, posted, ready } = harness();
    attachMcpAppFrame(bridge, { frameId: 'f', source, server: 'higgsfield', tool: 'generate_image', toolCallId: 'call-1' });
    ready();
    expect(posted).toEqual([]);
  });

  test('two screens of the same tool each keep their own call result', () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host: McpAppBridgeEventHost = {
      addEventListener: (_type, next) => { listener = next; },
      removeEventListener: () => { listener = undefined; },
    };
    const first: unknown[] = [];
    const second: unknown[] = [];
    const sourceOne = { postMessage: (message: unknown) => { first.push(message); } };
    const sourceTwo = { postMessage: (message: unknown) => { second.push(message); } };
    const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async () => ({}) });

    attachMcpAppFrame(bridge, { frameId: 'one', source: sourceOne, server: 's', tool: 't', toolCallId: 'call-1', toolResult: { content: [{ type: 'text', text: 'first' }] } });
    attachMcpAppFrame(bridge, { frameId: 'two', source: sourceTwo, server: 's', tool: 't', toolCallId: 'call-2', toolResult: { content: [{ type: 'text', text: 'second' }] } });
    listener?.({ source: sourceOne, data: { jsonrpc: '2.0', method: MCP_UI_INITIALIZED_METHOD } } as unknown as MessageEvent);
    listener?.({ source: sourceTwo, data: { jsonrpc: '2.0', method: MCP_UI_INITIALIZED_METHOD } } as unknown as MessageEvent);

    expect(first).toEqual([{ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: { content: [{ type: 'text', text: 'first' }] } }]);
    expect(second).toEqual([{ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: { content: [{ type: 'text', text: 'second' }] } }]);
  });

  test('a payload that is not a tool result is named as omitted rather than sent as one', () => {
    // ⛔📏 무인 리뷰(2026-08-21 · PR #10861)가 잡은 자리다. 규범은 `params: CallToolResult` 를
    //   요구하는데 `result` 가 `unknown` 이라 문자열도 그대로 나갔고, 내가 쓴 시험이 그것을
    //   «성공으로 고정»해 규범 위반을 계약으로 잠갔다. ⇒ 경계에서 가르고 이유를 «이름으로» 남긴다.
    const { bridge, source, posted, ready } = harness();
    attachMcpAppFrame(bridge, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'call-1', toolResult: 'a bare string' });
    ready();
    expect(posted).toEqual([{
      jsonrpc: '2.0',
      method: MCP_UI_TOOL_RESULT_METHOD,
      params: { content: [], _meta: { [MCP_APP_RESULT_OMITTED_META_KEY]: 'not_a_tool_result' } },
    }]);
  });

  test('a result whose content is not an array is refused, because that is not the normative shape', () => {
    const { bridge, source, posted, ready } = harness();
    attachMcpAppFrame(bridge, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'call-1', toolResult: { content: 'text' } });
    ready();
    expect(posted).toEqual([{
      jsonrpc: '2.0',
      method: MCP_UI_TOOL_RESULT_METHOD,
      params: { content: [], _meta: { [MCP_APP_RESULT_OMITTED_META_KEY]: 'not_a_tool_result' } },
    }]);
  });

  test('a result without content is accepted, because the normative schema defaults that field', () => {
    const { bridge, source, posted, ready } = harness();
    attachMcpAppFrame(bridge, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'call-1', toolResult: { structuredContent: { ok: true } } });
    ready();
    expect(posted).toEqual([{ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: { structuredContent: { ok: true } } }]);
  });

  test('unregistering the attachment stops later results from reaching that screen', () => {
    const { bridge, source, posted, ready } = harness();
    const detach = attachMcpAppFrame(bridge, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'call-1', toolResult: { content: [] } });
    detach();
    ready();
    bridge.publish({ server: 's', tool: 't', toolCallId: 'call-1', result: 'late' });
    expect(posted).toEqual([]);
  });
});
