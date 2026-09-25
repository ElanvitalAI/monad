import { describe, expect, test } from 'bun:test';
import {
  createBrowserMcpAppBridge, createMcpAppBridgeState, decideMcpAppMessage,
  disposeMcpAppConversation, disposeMcpAppFrame, MCP_APP_PUSH_MAX_BYTES,
  publishMcpAppToolResult, registerMcpAppFrame, settleMcpAppCall,
  MCP_UI_INITIALIZED_METHOD, MCP_UI_TOOL_RESULT_METHOD, MCP_APP_RESULT_OMITTED_META_KEY,
} from './mcp-app-bridge';

const sourceA = {};
const sourceB = {};
// ⛔⭐ 이름을 «베끼지 않는다» — 반대편에서 읽는다. 베낀 시험은 «한쪽만» 물어서,
//   2026-08-21 까지 틀린 이름(`notifications/tool-result`)과 틀린 모양(`{ tool, result }`)을
//   «계약으로» 잠가 두고 있었다. 규범은 `ui/notifications/tool-result` ⊕ `params = CallToolResult` 다.
const ready = { jsonrpc: '2.0', method: MCP_UI_INITIALIZED_METHOD };
const request = (id: string, name = 'weather') =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });
/** ⛔ 규범은 `params: CallToolResult` 를 요구한다. 픽스처가 «여기서» 그 모양을 만든다 —
 *  시험마다 손으로 적으면 또 갈리고, 옛 판은 실제로 문자열을 «통과»로 고정하고 있었다. */
const body = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const result = (server: string, tool: string, value: unknown) => ({ server, tool, result: body(value) });

function push(action: ReturnType<typeof publishMcpAppToolResult>['actions'][number]) {
  if (action.kind !== 'notify') throw new Error('expected push notification');
  return action.message;
}

function registered(tool = 'weather', server = 'trusted') {
  return registerMcpAppFrame(createMcpAppBridgeState(), { frameId: 'a', source: sourceA, server, tool }).state;
}

describe('MCP app host-result push reducer', () => {
  test('pushes initial and later host results in the existing JSON-RPC notification envelope after ready', () => {
    let state = registered();
    state = decideMcpAppMessage(state, sourceA, ready).state;
    const initial = publishMcpAppToolResult(state, result('trusted', 'weather', { temperature: 20 }));
    const later = publishMcpAppToolResult(initial.state, result('trusted', 'weather', { temperature: 21 }));

    expect(push(initial.actions[0]!)).toEqual({ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body({ temperature: 20 }) });
    expect(push(later.actions[0]!)).toEqual({ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body({ temperature: 21 }) });
  });

  test('buffers host results before trusted ready and flushes them FIFO', () => {
    let state = registered();
    state = publishMcpAppToolResult(state, result('trusted', 'weather', { sequence: 1 })).state;
    state = publishMcpAppToolResult(state, result('trusted', 'weather', { sequence: 2 })).state;

    const flushed = decideMcpAppMessage(state, sourceA, ready);
    expect(flushed.actions.map(push)).toEqual([
      { jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body({ sequence: 1 }) },
      { jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body({ sequence: 2 }) },
    ]);
    expect(decideMcpAppMessage(flushed.state, sourceA, ready).actions).toEqual([]);
    expect(decideMcpAppMessage(flushed.state, {}, ready).actions).toEqual([{ kind: 'observe', reason: 'untrusted-source' }]);
  });

  test('correlates host results with the registered server, tool, frame, and generation only', () => {
    let state = registerMcpAppFrame(createMcpAppBridgeState(), { frameId: 'a', source: sourceA, server: 'one', tool: 'weather' }).state;
    state = registerMcpAppFrame(state, { frameId: 'b', source: sourceB, server: 'two', tool: 'weather' }).state;
    state = decideMcpAppMessage(state, sourceA, ready).state;
    state = decideMcpAppMessage(state, sourceB, ready).state;

    const one = publishMcpAppToolResult(state, result('one', 'weather', 'one-only'));
    expect(one.actions.map(push)).toEqual([{ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body('one-only') }]);
    expect(publishMcpAppToolResult(one.state, result('missing', 'weather', 'never')).actions).toEqual([]);

    const queued = publishMcpAppToolResult(one.state, result('one', 'weather', 'stale')).state;
    const disposed = disposeMcpAppFrame(queued, 'a');
    const replacement = registerMcpAppFrame(disposed.state, { frameId: 'a', source: sourceA, server: 'one', tool: 'weather' });
    expect(decideMcpAppMessage(replacement.state, sourceA, ready).actions).toEqual([]);
    expect(publishMcpAppToolResult(replacement.state, result('two', 'weather', 'two-only')).actions.map(push)).toEqual([
      { jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body('two-only') },
    ]);
  });

  test('drops queued host results when the conversation is disposed', () => {
    let state = publishMcpAppToolResult(registered(), result('trusted', 'weather', 'queued')).state;
    state = disposeMcpAppConversation(state);
    state = registerMcpAppFrame(state, { frameId: 'a', source: sourceA, server: 'trusted', tool: 'weather' }).state;
    expect(decideMcpAppMessage(state, sourceA, ready).actions).toEqual([]);
  });

  test('keeps boundary payloads, identifies only size overflow as too_large, and rejects clone failures safely', () => {
    let state = decideMcpAppMessage(registered(), sourceA, ready).state;
    const boundaryResult = { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_PUSH_MAX_BYTES - 200) }] };
    const boundary = publishMcpAppToolResult(state, { server: 'trusted', tool: 'weather', result: boundaryResult });
    expect(push(boundary.actions[0]!).params).toBe(boundaryResult);

    const large = publishMcpAppToolResult(boundary.state, { server: 'trusted', tool: 'weather', result: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_PUSH_MAX_BYTES) }] } });
    expect(push(large.actions[0]!)).toEqual({ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: { content: [], _meta: { [MCP_APP_RESULT_OMITTED_META_KEY]: 'too_large' } } });

    const circular: { content: unknown[]; self?: unknown } = { content: [] };
    circular.self = circular;
    const circularResult = publishMcpAppToolResult(large.state, { server: 'trusted', tool: 'weather', result: circular });
    expect(push(circularResult.actions[0]!)).toEqual({ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: { content: [], _meta: { [MCP_APP_RESULT_OMITTED_META_KEY]: 'unserializable' } } });
  });

  test('preserves screen-to-host tools/call behavior without pushing the settled widget response', () => {
    const state = decideMcpAppMessage(decideMcpAppMessage(registered('weather'), sourceA, ready).state, sourceA, request('one', 'other-tool'));
    expect(state.actions).toMatchObject([{ kind: 'daemon-tool-call', frameId: 'a', tool: 'other-tool' }]);
    const daemon = state.actions[0]!;
    if (daemon.kind !== 'daemon-tool-call') throw new Error('expected daemon call');
    const settled = settleMcpAppCall(state.state, 'a', daemon.generation, 'one', { result: { from: 'widget-call' } });
    expect(settled.actions).toEqual([{ kind: 'respond', frameId: 'a', message: { jsonrpc: '2.0', id: 'one', result: { from: 'widget-call' } } }]);
  });
});

describe('MCP app browser adapter', () => {
  test('delivers the existing screen-to-host caller result only to the trusted registered window', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host = {
      addEventListener: (_: 'message', callback: (event: MessageEvent) => void) => { listener = callback; },
      removeEventListener: () => undefined,
    };
    const postedA: Array<[unknown, string]> = [];
    const postedB: Array<[unknown, string]> = [];
    const frameA = { postMessage: (message: unknown, target: string) => { postedA.push([message, target]); } };
    const frameB = { postMessage: (message: unknown, target: string) => { postedB.push([message, target]); } };
    const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async ({ tool }) => ({ tool }) });
    bridge.register({ frameId: 'a', source: frameA, server: 'one', tool: 'weather' });
    bridge.register({ frameId: 'b', source: frameB, server: 'two', tool: 'weather' });

    listener?.({ source: frameA, data: ready } as unknown as MessageEvent);
    listener?.({ source: frameA, data: request('one') } as unknown as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(postedA).toContainEqual([{ jsonrpc: '2.0', id: 'one', result: { tool: 'weather' } }, '*']);
    // ⛔ 규범상 호스트는 위젯에 `initialized` 를 «보내지 않는다»(방향이 View → Host 다).
    //   그래서 다른 서버의 화면에는 «아무것도» 가지 않아야 한다 — 이전엔 인사말 하나가 갔다.
    expect(postedB).toEqual([]);
    bridge.close();
  });
});

/** ⛔ These four exist because the round-2 review found the isolation test
 *  above only ever configured *different servers* — it could not have caught
 *  a same-server/same-tool broadcast, while its name claimed frame
 *  correlation. A test that cannot fail for the defect it names is worse than
 *  no test: it reads as coverage. */
describe('two screens from the same server and the same tool', () => {
  const twoFrames = () => {
    let state = createMcpAppBridgeState();
    state = registerMcpAppFrame(state, { frameId: 'first', source: sourceA, server: 's', tool: 't', toolCallId: 'call-1' }).state;
    state = registerMcpAppFrame(state, { frameId: 'second', source: sourceB, server: 's', tool: 't', toolCallId: 'call-2' }).state;
    state = decideMcpAppMessage(state, sourceA, ready).state;
    state = decideMcpAppMessage(state, sourceB, ready).state;
    return state;
  };

  test('a result reaches only the screen its own call created', () => {
    const out = publishMcpAppToolResult(twoFrames(), { server: 's', tool: 't', toolCallId: 'call-2', result: body('second-image') });
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]).toMatchObject({ kind: 'notify', frameId: 'second' });
  });

  test('the other screen keeps its own result — the second call does not overwrite the first', () => {
    let state = twoFrames();
    const first = publishMcpAppToolResult(state, { server: 's', tool: 't', toolCallId: 'call-1', result: body('first-image') });
    state = first.state;
    const second = publishMcpAppToolResult(state, { server: 's', tool: 't', toolCallId: 'call-2', result: body('second-image') });
    expect(first.actions.map((a) => (a as { frameId: string }).frameId)).toEqual(['first']);
    expect(second.actions.map((a) => (a as { frameId: string }).frameId)).toEqual(['second']);
    expect(push(second.actions[0]!)).toMatchObject({ method: MCP_UI_TOOL_RESULT_METHOD, params: body('second-image') });
  });

  test('a result naming a call no screen holds reaches nobody', () => {
    const out = publishMcpAppToolResult(twoFrames(), { server: 's', tool: 't', toolCallId: 'call-99', result: body('x') });
    expect(out.actions).toEqual([]);
  });
});

describe('a result that arrives before its screen exists', () => {
  test('is held, then delivered once that screen registers and says it is listening', () => {
    let state = createMcpAppBridgeState();
    // Tool finishes first; React has not mounted the iframe yet.
    const published = publishMcpAppToolResult(state, { server: 's', tool: 't', toolCallId: 'call-1', result: body('image') });
    expect(published.actions).toEqual([]);
    state = published.state;

    const registration = registerMcpAppFrame(state, { frameId: 'f', source: sourceA, server: 's', tool: 't', toolCallId: 'call-1' });
    state = registration.state;
    // ⛔ 등록은 이제 «아무 말도 안 한다» — 규범에 호스트→위젯 `initialized` 가 없다.
    //   그리고 붙잡아 둔 결과는 위젯이 준비됐다고 말하기 «전»에 나가면 안 된다.
    expect(registration.actions).toEqual([]);

    const readied = decideMcpAppMessage(state, sourceA, ready);
    expect(readied.actions).toHaveLength(1);
    expect(push(readied.actions[0]!)).toEqual({ jsonrpc: '2.0', method: MCP_UI_TOOL_RESULT_METHOD, params: body('image') });
  });

  test('is not handed to a screen from a different call', () => {
    let state = publishMcpAppToolResult(createMcpAppBridgeState(), { server: 's', tool: 't', toolCallId: 'call-1', result: body('image') }).state;
    state = registerMcpAppFrame(state, { frameId: 'f', source: sourceA, server: 's', tool: 't', toolCallId: 'call-2' }).state;
    expect(decideMcpAppMessage(state, sourceA, ready).actions).toEqual([]);
  });

  test('an unnamed result is not held — it would pile up against screens that never arrive', () => {
    const out = publishMcpAppToolResult(createMcpAppBridgeState(), { server: 's', tool: 't', result: body('image') });
    expect(out.state.unmatched).toEqual([]);
  });

  test('disposing the conversation drops what was held', () => {
    const state = publishMcpAppToolResult(createMcpAppBridgeState(), { server: 's', tool: 't', toolCallId: 'c', result: body('x') }).state;
    expect(disposeMcpAppConversation(state).unmatched).toEqual([]);
  });
});
