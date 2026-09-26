import { describe, expect, test } from 'bun:test';
import {
  createMcpAppBridgeState, createBrowserMcpAppBridge, decideMcpAppMessage,
  disposeMcpAppConversation, disposeMcpAppFrame, publishMcpAppToolResult, registerMcpAppFrame, settleMcpAppCall,
} from './mcp-app-bridge';

const sourceA = {};
const sourceB = {};
const request = (id: string, name = 'weather', extra: Record<string, unknown> = {}) =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { city: 'Seoul' }, ...extra } });

function registered() {
  let state = createMcpAppBridgeState();
  state = registerMcpAppFrame(state, { frameId: 'a', source: sourceA, server: 'trusted-a' }).state;
  state = registerMcpAppFrame(state, { frameId: 'b', source: sourceB, server: 'trusted-b' }).state;
  return state;
}

function daemonAction(state: ReturnType<typeof createMcpAppBridgeState>, source: object, id: string) {
  const decided = decideMcpAppMessage(state, source, request(id));
  const action = decided.actions[0];
  if (!action || action.kind !== 'daemon-tool-call') throw new Error('expected daemon action');
  return { state: decided.state, action };
}

describe('MCP app bridge policy', () => {
  test('observes untrusted and malformed input without processing it', () => {
    let decided = decideMcpAppMessage(registered(), {}, request('1'));
    expect(decided.actions).toEqual([{ kind: 'observe', reason: 'untrusted-source' }]);
    decided = decideMcpAppMessage(registered(), sourceA, { hello: 'world' });
    expect(decided.actions).toEqual([{ kind: 'observe', reason: 'malformed-message' }]);
  });

  test('returns Method not found for unsupported methods and denies external links', () => {
    for (const method of ['unknown/method', 'ui/open-link']) {
      const decided = decideMcpAppMessage(registered(), sourceA, { jsonrpc: '2.0', id: 'x', method });
      // ⛔ 위치가 아니라 «내용»으로 문다 — 관측 행동이 앞에 붙어도 계약은 그대로다.
      const responded = decided.actions.find((a) => a.kind === 'respond');
      expect(responded).toMatchObject({ kind: 'respond', frameId: 'a', message: { error: { code: -32601 } } });
    }
  });

  test('⭐ 거부한 메서드 «이름»을 관측에 남긴다 — 무엇을 더 구현할지는 그 값으로 정한다', () => {
    const decided = decideMcpAppMessage(registered(), sourceA, { jsonrpc: '2.0', id: 'x', method: 'ui/size-changed' });
    expect(decided.actions).toContainEqual({ kind: 'observe', reason: 'unknown-method', method: 'ui/size-changed' });
  });

  test('⛔ 이름을 남겨도 «답은 반드시» 간다 — 조용히 버리면 상대가 영영 기다린다', () => {
    const decided = decideMcpAppMessage(registered(), sourceA, { jsonrpc: '2.0', id: 'x', method: 'ui/whatever' });
    expect(decided.actions.some((a) => a.kind === 'respond')).toBe(true);
  });

  test('uses a frame-fixed server and ignores app supplied server overrides', () => {
    const decided = decideMcpAppMessage(registered(), sourceA, request('1', 'weather', { server: 'attacker' }));
    expect(decided.actions).toMatchObject([{ kind: 'daemon-tool-call', frameId: 'a', server: 'trusted-a', tool: 'weather', arguments: { city: 'Seoul' } }]);
  });

  test('rejects duplicate ids in one frame but permits the same id in another frame', () => {
    const first = daemonAction(registered(), sourceA, 'same');
    expect(decideMcpAppMessage(first.state, sourceA, request('same')).actions[0]).toMatchObject({ kind: 'respond', message: { error: { code: -32600 } } });
    expect(decideMcpAppMessage(first.state, sourceB, request('same')).actions[0]).toMatchObject({ kind: 'daemon-tool-call', frameId: 'b' });
  });

  test('correlates result and daemon error with only their originating frame', () => {
    const aRequest = daemonAction(registered(), sourceA, 'a1');
    const bRequest = daemonAction(aRequest.state, sourceB, 'b1');
    const b = settleMcpAppCall(bRequest.state, 'b', bRequest.action.generation, 'b1', { result: { from: 'b' } });
    expect(b.actions[0]).toMatchObject({ kind: 'respond', frameId: 'b', message: { id: 'b1', result: { from: 'b' } } });
    const a = settleMcpAppCall(b.state, 'a', aRequest.action.generation, 'a1', { error: 'offline' });
    expect(a.actions[0]).toMatchObject({ kind: 'respond', frameId: 'a', message: { id: 'a1', error: { code: -32603 } } });
  });

  test('rejects a stale completion after frame disposal and same-id re-registration', () => {
    const first = daemonAction(registered(), sourceA, 'same');
    let state = disposeMcpAppFrame(first.state, 'a').state;
    state = registerMcpAppFrame(state, { frameId: 'a', source: sourceA, server: 'new-server' }).state;
    const current = daemonAction(state, sourceA, 'same');
    const stale = settleMcpAppCall(current.state, 'a', first.action.generation, 'same', { result: 'old' });
    expect(stale.actions).toEqual([]);
    const fresh = settleMcpAppCall(stale.state, 'a', current.action.generation, 'same', { result: 'new' });
    expect(fresh.actions[0]).toMatchObject({ kind: 'respond', frameId: 'a', message: { result: 'new' } });
  });

  test('keeps generation monotonic across conversation disposal so delayed results stay stale', () => {
    const first = daemonAction(registered(), sourceA, 'same');
    let state = disposeMcpAppConversation(first.state);
    state = registerMcpAppFrame(state, { frameId: 'a', source: sourceA, server: 'new-server' }).state;
    const current = daemonAction(state, sourceA, 'same');

    expect(current.action.generation).toBeGreaterThan(first.action.generation);
    const stale = settleMcpAppCall(current.state, 'a', first.action.generation, 'same', { result: 'old' });
    expect(stale.actions).toEqual([]);
    const fresh = settleMcpAppCall(stale.state, 'a', current.action.generation, 'same', { result: 'new' });
    expect(fresh.actions[0]).toMatchObject({ kind: 'respond', frameId: 'a', message: { result: 'new' } });
  });
});

describe('browser adapter', () => {
  test('posts initialization and correlated daemon success only to the registered source', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const removed: unknown[] = [];
    const host = {
      addEventListener: (_: string, callback: (event: MessageEvent) => void) => { listener = callback; },
      removeEventListener: (_: 'message', callback: (event: MessageEvent) => void) => { removed.push(callback); },
    };
    const calls: unknown[] = [];
    const daemon = { callWidgetTool: async (input: unknown) => { calls.push(input); return { ok: true }; } };
    const posted: unknown[] = [];
    const frame = { postMessage: (message: unknown) => { posted.push(message); } };
    const bridge = createBrowserMcpAppBridge(host, daemon);
    bridge.register({ frameId: 'frame', source: frame, server: 'fixed' });
    // ⛔ 등록만으로는 «아무것도» 보내지 않는다 — 규범에 호스트→위젯 `initialized` 가 없다.
    expect(posted).toEqual([]);
    listener?.({ source: frame, data: request('1') } as unknown as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ server: 'fixed', tool: 'weather', arguments: { city: 'Seoul' } }]);
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: '1', result: { ok: true } });
    bridge.close();
    expect(removed).toHaveLength(1);
  });

  test('keeps a replacement registration when the prior cleanup runs', () => {
    const host = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const daemon = { callWidgetTool: async () => ({ ok: true }) };
    const source = { postMessage: () => undefined };
    const bridge = createBrowserMcpAppBridge(host, daemon);
    const disposeOld = bridge.register({ frameId: 'frame', source, server: 'old' });
    bridge.register({ frameId: 'frame', source, server: 'new' });
    disposeOld();

    let listener: ((event: MessageEvent) => void) | undefined;
    const routedHost = {
      addEventListener: (_: string, callback: (event: MessageEvent) => void) => { listener = callback; },
      removeEventListener: () => undefined,
    };
    bridge.close();
    const calls: unknown[] = [];
    const routedBridge = createBrowserMcpAppBridge(routedHost, { callWidgetTool: async (input: unknown) => { calls.push(input); return {}; } });
    const oldCleanup = routedBridge.register({ frameId: 'frame', source, server: 'old' });
    routedBridge.register({ frameId: 'frame', source, server: 'new' });
    oldCleanup();
    listener?.({ source, data: request('replacement') } as unknown as MessageEvent);
    expect(calls).toEqual([{ server: 'new', tool: 'weather', arguments: { city: 'Seoul' } }]);
    routedBridge.close();
  });

  test('routes a re-registered source only through its newest frame binding', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host = {
      addEventListener: (_: string, callback: (event: MessageEvent) => void) => { listener = callback; },
      removeEventListener: () => undefined,
    };
    const calls: unknown[] = [];
    const source = { postMessage: () => undefined };
    const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async (input: unknown) => { calls.push(input); return {}; } });
    const oldCleanup = bridge.register({ frameId: 'old', source, server: 'old-server' });
    bridge.register({ frameId: 'new', source, server: 'new-server' });
    oldCleanup();
    listener?.({ source, data: request('new-source') } as unknown as MessageEvent);
    await Promise.resolve();
    expect(calls).toEqual([{ server: 'new-server', tool: 'weather', arguments: { city: 'Seoul' } }]);
    bridge.close();
  });

  test('posts daemon rejection as a correlated JSON-RPC error only to the requesting frame', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const host = {
      addEventListener: (_: string, callback: (event: MessageEvent) => void) => { listener = callback; },
      removeEventListener: () => undefined,
    };
    const rejected = Promise.reject(new Error('offline'));
    const daemon = { callWidgetTool: () => rejected };
    const postedA: unknown[] = [];
    const postedB: unknown[] = [];
    const frameA = { postMessage: (message: unknown) => { postedA.push(message); } };
    const frameB = { postMessage: (message: unknown) => { postedB.push(message); } };
    const bridge = createBrowserMcpAppBridge(host, daemon);
    bridge.register({ frameId: 'a', source: frameA, server: 'fixed-a' });
    bridge.register({ frameId: 'b', source: frameB, server: 'fixed-b' });
    listener?.({ source: frameA, data: request('reject') } as unknown as MessageEvent);
    await rejected.catch(() => undefined);
    await Promise.resolve();
    expect(postedA).toContainEqual({
      jsonrpc: '2.0', id: 'reject', error: { code: -32603, message: 'Daemon tool call failed', data: 'Error: offline' },
    });
    expect(postedB).toEqual([]);
    bridge.close();
  });
});

/** ⛔⭐ 2026-08-21 실물: 위젯 iframe 안에 `-32601 Method not found` 가 찍혔고,
 *  관측을 넓혀 잡은 이름이 `ui/initialize` 였다. 계약은 상대 번들에서 직접 읽었다. */
describe('악수 — ui/initialize', () => {
  const ask = (method: string) =>
    decideMcpAppMessage(registered(), sourceA, { jsonrpc: '2.0', id: 'h1', method, params: {} });

  test('악수에 «답한다» — 거부하면 위젯이 영영 시작하지 못한다', () => {
    const out = ask('ui/initialize');
    const responded = out.actions.find((a) => a.kind === 'respond');
    expect(responded).toBeDefined();
    expect(JSON.stringify(responded)).not.toContain('-32601');
  });

  test('응답이 상대가 «읽는» 네 칸을 담는다', () => {
    const msg = (ask('ui/initialize').actions.find((a) => a.kind === 'respond') as { message: Record<string, unknown> }).message;
    const result = msg.result as Record<string, unknown>;
    for (const k of ['protocolVersion', 'hostInfo', 'hostCapabilities', 'hostContext']) {
      expect(result).toHaveProperty(k);
    }
  });

  test('⛔ «하는 것»만 선언한다 — 툴 프록시는 켜고, 링크 열기는 «켜지 않는다»', () => {
    const msg = (ask('ui/initialize').actions.find((a) => a.kind === 'respond') as { message: Record<string, unknown> }).message;
    const caps = (msg.result as Record<string, unknown>).hostCapabilities as Record<string, unknown>;
    expect(caps).toHaveProperty('serverTools');
    // 막는 기능을 «한다»고 말하면 상대가 그것을 믿고 UI 를 그린다.
    expect(caps).not.toHaveProperty('openLinks');
    expect(caps).not.toHaveProperty('downloadFile');
  });

  test('링크 열기는 «여전히» 막는다 — 악수를 구현했다고 열리지 않는다', () => {
    const out = ask('ui/open-link');
    expect(JSON.stringify(out.actions)).toContain('-32601');
  });

  test('ui/ 접두의 준비 알림도 «준비»로 친다', () => {
    const state = registered();
    const readied = decideMcpAppMessage(state, sourceA,
      { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(readied.state).not.toBe(state);
  });
});

/** ⛔⭐⭐⭐ 「관측을 심었다」 ≠ 「그 관측이 뜬다」 — 이 저장소가 정본화한 규율(2026-08-21).
 *
 *  📏 16차 `[F]` 실측이 이 절을 낳았다: 위젯이 빈 화면으로 남았는데 ***왜인지 아무도 못 말했다.***
 *  결과가 64KB 를 넘으면 우리는 본문을 버리고 `content: []` 를 보내는데(`too_large`),
 *  그 사실이 위젯의 `_meta` «안»에만 있었다 — 우리 고유 키라 위젯은 이해할 리 없고,
 *  `elanous logs` 에도 한 줄도 없었다. 그래서 CDP 로 30분을 뒤지고도 답이 안 나왔다.
 *
 *  ⛔ 아래는 «두 겹»이다. 값만 물면 배선이 조용히 끊겨도 초록이기 때문이다(15차 §4 ⑦). */
describe('the push carries why it was omitted — a silent truncation is what made the widget unexplainable', () => {
  const bigResult = { content: [{ type: 'text', text: 'x'.repeat(70 * 1024) }] };

  test('a too-large result reports the size it tried to send, not just that it failed', () => {
    let state = createMcpAppBridgeState();
    const source = { postMessage: () => undefined };
    state = registerMcpAppFrame(state, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'c' }).state;
    const ready = decideMcpAppMessage(state, source, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    state = ready.state;
    const pushed = publishMcpAppToolResult(state, { server: 's', tool: 't', toolCallId: 'c', result: bigResult });
    const notify = pushed.actions.find((a) => a.kind === 'notify');

    expect(notify?.omitted).toBe('too_large');
    // ⛔ 「너무 크다」만 알면 다음 수가 없다 — 상한을 올릴지 결과를 줄일지는 «얼마나» 넘쳤나로 갈린다.
    expect(notify?.bytes).toBeGreaterThan(64 * 1024);
    // 위젯에는 규범대로 «빈 결과»가 간다. 사유는 우리 이름공간에만 실린다.
    expect((notify?.message as { params: { content: unknown[] } }).params.content).toEqual([]);
  });

  test('a result that fits reports its size and no omission', () => {
    let state = createMcpAppBridgeState();
    const source = { postMessage: () => undefined };
    state = registerMcpAppFrame(state, { frameId: 'f', source, server: 's', tool: 't', toolCallId: 'c' }).state;
    state = decideMcpAppMessage(state, source, { jsonrpc: '2.0', method: 'ui/notifications/initialized' }).state;
    const pushed = publishMcpAppToolResult(state, { server: 's', tool: 't', toolCallId: 'c', result: { content: [] } });
    const notify = pushed.actions.find((a) => a.kind === 'notify');

    expect(notify?.omitted).toBeUndefined();
    expect(notify?.bytes).toBeGreaterThan(0);
  });

  test('the runner actually logs that push — the value is useless if nothing emits it', () => {
    // ⛔ 이것이 «이음매»다. 위 둘은 결정 함수만 물고, 실행부가 관측을 안 내도 통과한다.
    const lines: string[] = [];
    // ⛔📏 1차판은 `console.log` 를 감쌌고 시험이 «실패»했다 — `debugLog` 는 `console.debug` 로 쓴다.
    //   ⭐ 그 실패가 이 시험의 값을 증명한다: 관측이 어디로도 안 나가는 상태를 «잡아냈다».
    const original = console.debug;
    console.debug = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      let listener: ((event: MessageEvent) => void) | undefined;
      const host = {
        addEventListener: (_: string, cb: (event: MessageEvent) => void) => { listener = cb; },
        removeEventListener: () => undefined,
      };
      const source = { postMessage: () => undefined };
      const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async () => ({}) });
      bridge.register({ frameId: 'f', source, server: 's', tool: 't', toolCallId: 'c' });
      listener?.({ source, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' } } as unknown as MessageEvent);
      bridge.publish({ server: 's', tool: 't', toolCallId: 'c', result: bigResult });
      bridge.close();
    } finally {
      console.debug = original;
    }
    const pushLine = lines.find((l) => l.includes('mcp-app.bridge.push'));
    expect(pushLine).toBeDefined();
    expect(pushLine).toContain('too_large');
    // ⛔ 「불렀다」이지 「닿았다」가 아니다 — 이름이 아는 만큼만 말한다(리뷰 must-fix).
    expect(pushLine).toContain('"post":"posted"');
  });

  test('still logs when postMessage throws — the silent failure this PR exists to end', () => {
    // ⛔📏 무인 리뷰 must-fix: 1차판은 예외가 나면 로그까지 «못 갔다».
    //   ⇒ 이 PR 이 고치러 온 「정상 경로의 조용한 실패」를 이 PR 자신이 다시 만들고 있었다.
    const lines: string[] = [];
    const original = console.debug;
    console.debug = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    let threw = false;
    try {
      let listener: ((event: MessageEvent) => void) | undefined;
      const host = {
        addEventListener: (_: string, cb: (event: MessageEvent) => void) => { listener = cb; },
        removeEventListener: () => undefined,
      };
      const source = { postMessage: () => { throw new Error('frame is gone'); } };
      const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async () => ({}) });
      bridge.register({ frameId: 'f', source, server: 's', tool: 't', toolCallId: 'c' });
      listener?.({ source, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' } } as unknown as MessageEvent);
      bridge.publish({ server: 's', tool: 't', toolCallId: 'c', result: { content: [] } });
      bridge.close();
    } catch { threw = true; } finally { console.debug = original; }

    // ⛔ 브리지가 «터지지 않는다» — 위젯 하나가 사라졌다고 대화 전체가 죽으면 안 된다.
    expect(threw).toBe(false);
    expect(lines.find((l) => l.includes('mcp-app.bridge.push'))).toContain('"post":"threw"');
  });

  test('names a vanished target rather than reporting a delivery', () => {
    const lines: string[] = [];
    const original = console.debug;
    console.debug = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      let listener: ((event: MessageEvent) => void) | undefined;
      const host = {
        addEventListener: (_: string, cb: (event: MessageEvent) => void) => { listener = cb; },
        removeEventListener: () => undefined,
      };
      // 등록은 되지만 `postMessage` 가 «없는» 창 — 프레임이 이미 헐린 뒤의 모습이다.
      const source = {} as { postMessage?: never };
      const bridge = createBrowserMcpAppBridge(host, { callWidgetTool: async () => ({}) });
      bridge.register({ frameId: 'f', source, server: 's', tool: 't', toolCallId: 'c' });
      listener?.({ source, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized' } } as unknown as MessageEvent);
      bridge.publish({ server: 's', tool: 't', toolCallId: 'c', result: { content: [] } });
      bridge.close();
    } finally { console.debug = original; }
    expect(lines.find((l) => l.includes('mcp-app.bridge.push'))).toContain('"post":"no-target"');
  });
});
