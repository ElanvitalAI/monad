import { describe, expect, test } from 'bun:test';
import { MCP_WIDGET_CALL_ROUTE_PATH } from '../../../../src/nexus/api/mcp-widget-call-route.js';
import { MCP_WIDGET_CALL_PATH, attachMcpAppFrame, createWidgetToolCaller, getMcpAppBridge } from './mcp-app-bridge-host';

/** These tests exist because the first cut of this bridge called an ACP method
 *  (`mcpServer/tool/call`) that lives only in old design notes — it type-checked
 *  and reached nothing. So the thing under test here is not "does the bridge
 *  decide correctly" (mcp-app-bridge.test.ts owns that) but ***"does the call
 *  leave through the route the daemon actually serves"***. */
describe('widget tool caller', () => {
  test('posts to the route the daemon serves', async () => {
    const seen: Array<{ path: string; init?: RequestInit }> = [];
    const caller = createWidgetToolCaller({
      async fetchJson(path, init) { seen.push({ path, init }); return { ok: true }; },
    });

    const result = await caller.callWidgetTool({ server: 'higgsfield', tool: 'generate_image', arguments: { prompt: 'x' } });

    expect(result).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe(MCP_WIDGET_CALL_ROUTE_PATH);
    expect(seen[0]!.path).toBe(MCP_WIDGET_CALL_PATH);
    expect(seen[0]!.init?.method).toBe('POST');
  });

  test('sends the local tool name and args in the shape the route parses', async () => {
    let body: unknown;
    const caller = createWidgetToolCaller({
      async fetchJson(_path, init) { body = JSON.parse(String(init?.body)); return {}; },
    });

    await caller.callWidgetTool({ server: 'higgsfield', tool: 'generate_image', arguments: { prompt: 'x' } });

    // The route requires `toolName` to be bare (/^[A-Za-z0-9_-]+$/) and `args`
    // to be an object; anything else is a 400 it never dispatches.
    expect(body).toEqual({ toolName: 'generate_image', args: { prompt: 'x' } });
  });

  test('never puts the server on the wire — the route derives it', async () => {
    let raw = '';
    const caller = createWidgetToolCaller({
      async fetchJson(_path, init) { raw = String(init?.body); return {}; },
    });

    await caller.callWidgetTool({ server: 'higgsfield', tool: 'generate_image', arguments: {} });

    expect(raw).not.toContain('higgsfield');
    expect(JSON.parse(raw)).not.toHaveProperty('server');
  });

  test('missing arguments become an empty object, not undefined', async () => {
    let body: unknown;
    const caller = createWidgetToolCaller({
      async fetchJson(_path, init) { body = JSON.parse(String(init?.body)); return {}; },
    });

    await caller.callWidgetTool({ server: 's', tool: 't', arguments: undefined });

    expect(body).toEqual({ toolName: 't', args: {} });
  });
});

describe('bridge instance', () => {
  const host = { addEventListener: () => undefined, removeEventListener: () => undefined };

  test('one bridge per transport so a second frame does not add a second listener', () => {
    const transport = { async fetchJson(_path: string, _init?: RequestInit) { return {}; } };
    expect(getMcpAppBridge(transport, host)).toBe(getMcpAppBridge(transport, host));
  });

  test('different transports get different bridges', () => {
    const a = { async fetchJson(_path: string, _init?: RequestInit) { return {}; } };
    const b = { async fetchJson(_path: string, _init?: RequestInit) { return {}; } };
    expect(getMcpAppBridge(a, host)).not.toBe(getMcpAppBridge(b, host));
  });

  test('a registered frame message reaches the daemon route', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const listening = {
      addEventListener: (_: 'message', cb: (event: MessageEvent) => void) => { listener = cb; },
      removeEventListener: () => undefined,
    };
    const paths: string[] = [];
    const transport = { async fetchJson(path: string, _init?: RequestInit) { paths.push(path); return { ok: 1 }; } };
    const bridge = getMcpAppBridge(transport, listening);
    const frame = { postMessage: () => undefined };
    bridge.register({ frameId: 'f', source: frame, server: 'higgsfield' });

    listener?.({
      source: frame,
      data: { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: 'generate_image', arguments: {} } },
    } as unknown as MessageEvent);
    await Promise.resolve();

    expect(paths).toEqual([MCP_WIDGET_CALL_ROUTE_PATH]);
  });
});

/** ⛔⭐⭐ 「안 미는 것」이 조용했다 — 그것이 16차 `[F]` 가 답을 못 낸 이유의 절반이다.
 *
 *  📏 실측: 위젯이 빈 화면으로 남았을 때 「⑴밀 것이 없었나 ⑵밀었는데 안 닿았나 ⑶닿았는데 못 그렸나」를
 *  가를 값이 하나도 없어, CDP 로 30분을 뒤지고도 «셋 중 무엇인지» 못 정했다.
 *  ⇒ 이제 「안 밀었다」에도 이름이 붙는다. ⛔ 결과 «값»은 안 싣는다(크고 남의 것이다) — 유무만. */
describe('attachment observation — the skip must name itself', () => {
  function captureDebug(run: () => void): string[] {
    const lines: string[] = [];
    const original = console.debug;
    console.debug = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try { run(); } finally { console.debug = original; }
    return lines;
  }

  const stubBridge = (published: unknown[]) => ({
    register: () => () => undefined,
    publish: (value: unknown) => { published.push(value); },
    disposeConversation: () => undefined,
    close: () => undefined,
  });

  test('names why it skipped when the result never arrived', () => {
    const published: unknown[] = [];
    const lines = captureDebug(() => {
      attachMcpAppFrame(stubBridge(published) as never, {
        frameId: 'f', source: {}, server: 's', tool: 't', toolCallId: 'c',
      });
    });
    expect(published).toEqual([]);
    const line = lines.find((l) => l.includes('mcp-app.bridge.attach'));
    expect(line).toBeDefined();
    expect(line).toContain('"skipped":"no-tool-result"');
    expect(line).toContain('"published":false');
  });

  test('names why it skipped when the tool is unknown — the routing key the push needs', () => {
    const published: unknown[] = [];
    const lines = captureDebug(() => {
      attachMcpAppFrame(stubBridge(published) as never, {
        frameId: 'f', source: {}, server: 's', toolResult: { content: [] },
      });
    });
    expect(published).toEqual([]);
    expect(lines.find((l) => l.includes('mcp-app.bridge.attach'))).toContain('"skipped":"no-tool"');
  });

  test('records the publish when both are present — a green path must also be observable', () => {
    const published: unknown[] = [];
    const lines = captureDebug(() => {
      attachMcpAppFrame(stubBridge(published) as never, {
        frameId: 'f', source: {}, server: 's', tool: 't', toolCallId: 'c', toolResult: { content: [] },
      });
    });
    expect(published).toHaveLength(1);
    const line = lines.find((l) => l.includes('mcp-app.bridge.attach'));
    expect(line).toContain('"published":true');
    // ⛔ 결과 «값»이 로그로 새면 안 된다 — 유무만 싣기로 한 계약을 여기서 문다.
    expect(line).not.toContain('content');
  });
});
