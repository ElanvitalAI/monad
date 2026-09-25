// ── McpClient unit tests ──
//
// Fixture-driven JSON-RPC round-trip. The real child process is
// replaced with a FakeChild (EventEmitter-shaped object) so tests
// run in a few ms without spawning binaries.

import { afterEach, beforeEach, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  McpClient,
  McpConnectionError,
  classifyMcpHttpResponse,
  classifyMcpNetworkError,
  formatMcpConnectionGuidance,
  isRetryableMcpConnectionFailure,
  parseWwwAuthenticate,
  type ChildProcessLike,
  type McpHttpFetch,
} from '../src/mcp/client';
import { MCP_PROTOCOL_VERSION_LATEST } from '../src/mcp/server';
import { type McpOAuthFetch } from '../src/mcp/mcp-oauth';
import { loadTokens, saveTokens } from '../src/oauth/store';

// ─── Fakes ───────────────────────────────────────────────────────

class FakeChild implements ChildProcessLike {
  written: string[] = [];
  killed: Array<'SIGTERM' | 'SIGKILL'> = [];
  failWrites = false;
  stdin = {
    write: (line: string): void => {
      if (this.failWrites) throw new Error('reply write failed');
      this.written.push(line);
    },
  };
  stdout = {
    on: (event: 'data', cb: (chunk: Buffer | string) => void): void => {
      if (event === 'data') this._onData = cb;
    },
  };
  private _onData: ((chunk: Buffer | string) => void) | null = null;
  private _exitListeners: Array<
    (code: number | null, signal: string | null) => void
  > = [];

  on(
    event: 'exit',
    cb: (code: number | null, signal: string | null) => void,
  ): void {
    if (event === 'exit') this._exitListeners.push(cb);
  }

  kill(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
    this.killed.push(signal);
    return true;
  }

  emitLine(line: string): void {
    this._onData?.(line + '\n');
  }
  emitData(chunk: string): void {
    this._onData?.(chunk);
  }
  emitExit(code: number | null = 0, signal: string | null = null): void {
    for (const cb of [...this._exitListeners]) cb(code, signal);
  }

  lastParsedRequest(): {
    jsonrpc: string;
    id?: number;
    method: string;
    params?: unknown;
  } {
    const last = this.written[this.written.length - 1] ?? '';
    return JSON.parse(last.trim());
  }
}

interface FakeTimer {
  cancelled: boolean;
  readonly delayMs: number;
  fire(): void;
}

function makeFakeTimerFactory(): {
  timers: FakeTimer[];
  setTimer: (cb: () => void, ms: number) => { cancel(): void };
} {
  const timers: FakeTimer[] = [];
  return {
    timers,
    setTimer: (cb, ms) => {
      let cancelled = false;
      let fired = false;
      const t: FakeTimer = {
        delayMs: ms,
        get cancelled() {
          return cancelled;
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        set cancelled(v: boolean) {
          cancelled = v;
        },
        fire(): void {
          if (cancelled || fired) return;
          fired = true;
          cb();
        },
      };
      timers.push(t);
      return {
        cancel: (): void => {
          cancelled = true;
        },
      };
    },
  };
}

function makeFakeSpawnFactory(): {
  children: FakeChild[];
  spawn: (cmd: string, args: string[]) => ChildProcessLike;
} {
  const children: FakeChild[] = [];
  return {
    children,
    spawn: (_cmd, _args) => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  // 4 microtask ticks — enough for spawnAndHandshake().catch() chains in
  // the reconnect path to fully settle.
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function waitForTimers(timers: FakeTimer[], count: number): Promise<void> {
  for (let i = 0; i < 20 && timers.length < count; i++) await flushMicrotasks();
}

async function startAndHandshake(
  client: McpClient,
  children: FakeChild[],
): Promise<FakeChild> {
  const startPromise = client.start();
  await flushMicrotasks();
  const child = children[children.length - 1]!;
  const req = child.lastParsedRequest();
  expect(req.method).toBe('initialize');
  expect(req.id).toBe(1);
  child.emitLine(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION_LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '0.1' },
      },
    }),
  );
  await startPromise;
  return child;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('McpClient construction', () => {
  test('throws on empty command', () => {
    expect(() => new McpClient({ id: 'x', command: [] })).toThrow(
      /empty command/,
    );
  });

  test('exposes serverId + initial state', () => {
    const { spawn } = makeFakeSpawnFactory();
    const c = new McpClient({ id: 'fake', command: ['nope'], spawn });
    expect(c.serverId).toBe('fake');
    expect(c.currentState).toBe('idle');
    expect(c.isReady).toBe(false);
  });
});

describe('McpClient handshake', () => {
  test('start() sends initialize and transitions to ready', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['fake-mcp'], spawn });
    const start = client.start();
    await flushMicrotasks();
    expect(children.length).toBe(1);
    const child = children[0]!;
    const initReq = child.lastParsedRequest();
    expect(initReq.method).toBe('initialize');
    expect((initReq.params as { protocolVersion: string }).protocolVersion).toBe(
      '2025-11-25',
    );
    expect((initReq.params as { protocolVersion: string }).protocolVersion).toBe(
      MCP_PROTOCOL_VERSION_LATEST,
    );
    expect((initReq.params as { capabilities: Record<string, unknown> }).capabilities).toEqual({
      extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
    });
    child.emitLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
    );
    await start;
    expect(client.isReady).toBe(true);
    // After initialize, client sends notifications/initialized (fire-and-forget).
    expect(child.written.length).toBe(2);
    const notif = JSON.parse(child.written[1]!.trim());
    expect(notif.method).toBe('notifications/initialized');
    expect(notif.id).toBeUndefined();
  });

  test('start() rejects with the server error', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    const start = client.start();
    await flushMicrotasks();
    const child = children[0]!;
    child.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'init failed' },
      }),
    );
    await expect(start).rejects.toThrow(/init failed/);
    expect(client.currentState).toBe('idle');
  });
});

describe('McpClient tools/list', () => {
  test('returns array of tools from server', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const listPromise = client.listTools();
    await flushMicrotasks();
    const child = children[0]!;
    const req = child.lastParsedRequest();
    expect(req.method).toBe('tools/list');
    expect(req.id).toBe(2);
    child.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            { name: 'build_target', description: 'Build a target' },
            { name: 'run_tests', description: 'Run unit tests' },
          ],
        },
      }),
    );
    const tools = await listPromise;
    expect(tools.length).toBe(2);
    expect(tools[0]!.name).toBe('build_target');
    expect(tools[1]!.description).toBe('Run unit tests');
  });

  test('returns empty array when server omits tools field', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const listPromise = client.listTools();
    await flushMicrotasks();
    children[0]!.emitLine(
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }),
    );
    const tools = await listPromise;
    expect(tools).toEqual([]);
  });

  test('preserves server metadata that links a tool to a resource', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const listPromise = client.listTools();
    await flushMicrotasks();
    const metadata = { 'openai/outputTemplate': 'ui://screens/build.html' };
    children[0]!.emitLine(JSON.stringify({
      jsonrpc: '2.0', id: 2, result: {
        tools: [{ name: 'build', description: 'Build', inputSchema: { type: 'object' }, _meta: metadata }],
      },
    }));
    await expect(listPromise).resolves.toEqual([
      { name: 'build', description: 'Build', inputSchema: { type: 'object' }, _meta: metadata },
    ]);
  });

  test('throws when called before start()', async () => {
    const { spawn } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await expect(client.listTools()).rejects.toThrow(/not ready/);
  });
});

describe('McpClient resources', () => {
  test('lists every cursor page and preserves resource metadata', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const listed = client.listResources();
    await flushMicrotasks();
    expect(children[0]!.lastParsedRequest()).toMatchObject({ method: 'resources/list', id: 2, params: {} });
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
      resources: [{ uri: 'ui://screens/one.html', mimeType: 'text/html', _meta: { view: 'pane' } }],
      nextCursor: 'page-2',
    }}));
    await flushMicrotasks();
    expect(children[0]!.lastParsedRequest()).toMatchObject({ method: 'resources/list', id: 3, params: { cursor: 'page-2' } });
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {
      resources: [{ uri: 'ui://screens/two.html', name: 'Two', _meta: { view: 'modal' } }],
    }}));
    await expect(listed).resolves.toEqual([
      { uri: 'ui://screens/one.html', mimeType: 'text/html', _meta: { view: 'pane' } },
      { uri: 'ui://screens/two.html', name: 'Two', _meta: { view: 'modal' } },
    ]);
  });

  test('reads text and binary contents without losing MIME types or metadata', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const read = client.readResource('ui://screens/main.html');
    await flushMicrotasks();
    expect(children[0]!.lastParsedRequest()).toMatchObject({
      method: 'resources/read', id: 2, params: { uri: 'ui://screens/main.html' },
    });
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {
      contents: [
        { uri: 'ui://screens/main.html', mimeType: 'text/html', text: '<main/>', _meta: { theme: 'dark' } },
        { uri: 'ui://assets/icon.png', mimeType: 'image/png', blob: 'iVBORw0KGgo=', _meta: { density: 2 } },
      ],
    }}));
    await expect(read).resolves.toEqual({
      contents: [
        { uri: 'ui://screens/main.html', mimeType: 'text/html', text: '<main/>', _meta: { theme: 'dark' } },
        { uri: 'ui://assets/icon.png', mimeType: 'image/png', blob: 'iVBORw0KGgo=', _meta: { density: 2 } },
      ],
    });
  });

  test('propagates unsupported resource errors instead of returning an empty list', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const listed = client.listResources();
    await flushMicrotasks();
    children[0]!.emitLine(JSON.stringify({
      jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'resources unsupported' },
    }));
    await expect(listed).rejects.toMatchObject({ name: 'McpServerError', code: -32601 });
  });
});

describe('McpClient tools/call', () => {
  test('returns result content from server', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const callPromise = client.callTool('build_target', { scheme: 'monad' });
    await flushMicrotasks();
    const child = children[0]!;
    const req = child.lastParsedRequest();
    expect(req.method).toBe('tools/call');
    expect(req.params).toEqual({
      name: 'build_target',
      arguments: { scheme: 'monad' },
    });
    child.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: 'build ok' }],
          structuredContent: { duration_ms: 1234 },
        },
      }),
    );
    const result = await callPromise;
    expect(result.content?.[0]!.text).toBe('build ok');
    expect(
      (result.structuredContent as { duration_ms: number }).duration_ms,
    ).toBe(1234);
  });

  test('rejects when server replies with error', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const callPromise = client.callTool('nope', {});
    await flushMicrotasks();
    children[0]!.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32601, message: 'unknown tool: nope' },
      }),
    );
    await expect(callPromise).rejects.toThrow(/unknown tool: nope/);
  });

  test('multi-line stdout buffer is split correctly', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    const call1 = client.callTool('a', {});
    await flushMicrotasks();
    const call2 = client.callTool('b', {});
    await flushMicrotasks();
    // Server flushes both responses in a single chunk.
    const chunk =
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'A' }] } }) +
      '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'B' }] } }) +
      '\n';
    children[0]!.emitData(chunk);
    const [r1, r2] = await Promise.all([call1, call2]);
    expect(r1.content?.[0]!.text).toBe('A');
    expect(r2.content?.[0]!.text).toBe('B');
  });
});

describe('McpClient parse / framing edge cases', () => {
  test('parse error on garbled line is logged but does not crash', async () => {
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine('not-json{{{');
    expect(logs.some((l) => l.event === 'mcp.client.parse-error')).toBe(true);
    // Subsequent legitimate response still works.
    const callPromise = client.callTool('x', {});
    await flushMicrotasks();
    children[0]!.emitLine(
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }),
    );
    const r = await callPromise;
    expect(r).toBeDefined();
  });

  test('a SERVER-INITIATED request (method + id) is observed, not silently dropped', async () => {
    // ⛔⭐ 이것이 이 시험의 이유다 — 서버가 `elicitation/create` 같은 «자기 쪽 요청»을
    //    보내면 종전 코드는 「모르는 id」로 «말없이» 버렸다. 그래서 서버는 영원히 기다리고
    //    우리는 물었다는 사실조차 몰랐다. ⇒ 「아무도 안 묻는다」와 「물었는데 흘렸다」가 구분됐다.
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({
      jsonrpc: '2.0', id: 99, method: 'elicitation/create',
      params: { mode: 'form', message: '고르세요', requestedSchema: { type: 'object' } },
    }));
    const hit = logs.find((l) => l.event === 'mcp.client.server-request');
    expect(hit).toBeDefined();
    expect(hit!.data?.method).toBe('elicitation/create');
    expect(hit!.data?.requestId).toBe(99);
    // ⛔ 값이 아니라 «키 이름»만 실린다 — url 모드 elicitation 은 민감정보를 나른다.
    expect(hit!.data?.paramKeys).toEqual(['mode', 'message', 'requestedSchema']);
    expect(JSON.stringify(hit!.data)).not.toContain('고르세요');
    await flushMicrotasks();
    expect(JSON.parse(children[0]!.written.at(-1)!.trim())).toEqual({
      jsonrpc: '2.0', id: 99,
      error: { code: -32601, message: 'method not found: elicitation/create' },
    });
    const replied = logs.find((l) => l.event === 'mcp.client.server-request-replied');
    expect(replied?.data?.method).toBe('elicitation/create');
  });

  test('a notification (method, NO id) is observed as a notification — not as a request', async () => {
    // ⛔ `method` 하나로 가르면 알림이 「서버 요청」으로 둔갑한다. 가르는 축은 id 다.
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({
      jsonrpc: '2.0', method: 'notifications/log', params: { level: 'info' },
    }));
    expect(logs.some((l) => l.event === 'mcp.client.server-request')).toBe(false);
    const note = logs.find((l) => l.event === 'mcp.client.notification-dropped');
    expect(note?.data?.method).toBe('notifications/log');
    expect(children[0]!.written).toHaveLength(2);
  });

  test('null and empty request ids are preserved in Method not found replies', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'unknown/null' }));
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: '', method: 'unknown/empty' }));
    await flushMicrotasks();
    expect(children[0]!.written.slice(-2).map((line) => JSON.parse(line.trim()))).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'method not found: unknown/null' } },
      { jsonrpc: '2.0', id: '', error: { code: -32601, message: 'method not found: unknown/empty' } },
    ]);
  });

  test('reply transport failures are contained and subsequent normal responses still resolve', async () => {
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn, logger: (event, data) => logs.push({ event, data }) });
    await startAndHandshake(client, children);
    children[0]!.failWrites = true;
    expect(() => children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'unknown/fails' }))).not.toThrow();
    await flushMicrotasks();
    expect(logs.some((l) => l.event === 'mcp.client.server-request-reply-failed')).toBe(true);
    children[0]!.failWrites = false;
    const call = client.callTool('x', {});
    await flushMicrotasks();
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }));
    expect(await call).toBeDefined();
  });

  test('a STRING-id response is an orphan too — pending is keyed by number so it can never match', async () => {
    // ⛔⭐ JSON-RPC id 는 `number | string` 둘 다다. 초판은 `typeof !== 'number'` 로 걸러
    //    string id 응답을 「다룰 수 없는 줄」로 «오분류»했다(리뷰 must-fix ①).
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 'abc-123', result: {} }));
    const orphan = logs.find((l) => l.event === 'mcp.client.orphan-response');
    expect(orphan?.data?.requestId).toBe('abc-123');
    expect(logs.some((l) => l.event === 'mcp.client.unaddressable-line')).toBe(false);
  });

  test('method + id:null is an addressable request — not a notification', async () => {
    // ⛔⭐ JSON-RPC 에서 «알림»은 id 칸이 «없는» 것이다. `id: null` 도 원래 식별자 값을
    // 보존해 오류로 회신하는 서버 시작 요청이다.
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({
      jsonrpc: '2.0', id: null, method: 'elicitation/create', params: { mode: 'url' },
    }));
    const hit = logs.find((l) => l.event === 'mcp.client.server-request');
    expect(hit?.data?.method).toBe('elicitation/create');
    expect(hit?.data?.addressable).toBe(true);
    expect(logs.some((l) => l.event === 'mcp.client.notification-dropped')).toBe(false);
    await flushMicrotasks();
    expect(JSON.parse(children[0]!.written.at(-1)!.trim())).toEqual({
      jsonrpc: '2.0', id: null,
      error: { code: -32601, message: 'method not found: elicitation/create' },
    });
  });

  test('an EMPTY method is still a request shape — not an orphan response (2R must-fix)', async () => {
    // ⛔ `length > 0` 으로 재면 `{method:"", id:1}` 이 응답 축으로 떨어져 고아 응답으로 둔갑한다.
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: '' }));
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', method: '' }));
    expect(logs.some((l) => l.event === 'mcp.client.orphan-response')).toBe(false);
    expect(logs.some((l) => l.event === 'mcp.client.unaddressable-line')).toBe(false);
    expect(logs.filter((l) => l.event === 'mcp.client.server-request')).toHaveLength(1);
    expect(logs.filter((l) => l.event === 'mcp.client.notification-dropped')).toHaveLength(1);
  });

  test('valid-JSON-but-not-an-object lines do not kill the stream (3R must-fix · 내가 낸 회귀)', async () => {
    // ⛔⭐ `JSON.parse('1')` 은 «성공»한다. 그 뒤 `'id' in 1` 이 TypeError 를 던지면
    //    그 예외가 stdout 데이터 콜백을 타고 나가 스트림 처리를 깬다.
    //    ⇒ 원시값·배열·null 을 넣고 「던지지 않는다 ⊕ 그 뒤 정상 왕복이 산다」를 함께 문다.
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    for (const raw of ['1', '"x"', 'null', 'true', '[1,2]']) {
      expect(() => children[0]!.emitLine(raw)).not.toThrow();
    }
    expect(logs.filter((l) => l.event === 'mcp.client.unaddressable-line')).toHaveLength(5);

    // ⭐ 그리고 그 뒤 «정상 왕복이 산다» — 스트림이 안 죽었다는 증거는 이것이다.
    const callPromise = client.callTool('x', {});
    await flushMicrotasks();
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }));
    expect(await callPromise).toBeDefined();
  });

  test('a response to an UNKNOWN id is observed as an orphan', async () => {
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake', command: ['x'], spawn,
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitLine(JSON.stringify({ jsonrpc: '2.0', id: 4242, result: {} }));
    const orphan = logs.find((l) => l.event === 'mcp.client.orphan-response');
    expect(orphan?.data?.requestId).toBe(4242);
  });

  test('notifications (id-less) on stdout are ignored without throwing', async () => {
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({ id: 'fake', command: ['x'], spawn });
    await startAndHandshake(client, children);
    // Server pushes a notification — we don't subscribe in this phase.
    children[0]!.emitLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/log', params: { level: 'info' } }),
    );
    // No assert apart from "did not throw". A subsequent call still works.
    const callPromise = client.callTool('x', {});
    await flushMicrotasks();
    children[0]!.emitLine(
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }),
    );
    await callPromise;
  });
});

describe('McpClient dispose', () => {
  test('sends SIGTERM and resolves on exit', async () => {
    const { setTimer } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
    });
    await startAndHandshake(client, children);
    const disposePromise = client.dispose();
    await flushMicrotasks();
    expect(children[0]!.killed).toContain('SIGTERM');
    children[0]!.emitExit(0, 'SIGTERM');
    await disposePromise;
    expect(client.currentState).toBe('disposed');
  });

  test('escalates to SIGKILL when grace expires', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
      shutdownGraceMs: 1000,
    });
    await startAndHandshake(client, children);
    const disposePromise = client.dispose();
    await flushMicrotasks();
    expect(children[0]!.killed).toContain('SIGTERM');
    // Fire the grace-window timer — should escalate.
    expect(timers.length).toBe(1);
    timers[0]!.fire();
    await disposePromise;
    expect(children[0]!.killed).toContain('SIGKILL');
  });

  test('rejects pending requests', async () => {
    const { setTimer } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
    });
    await startAndHandshake(client, children);
    const callPromise = client.callTool('x', {});
    await flushMicrotasks();
    const dispose = client.dispose();
    await flushMicrotasks();
    children[0]!.emitExit(0, 'SIGTERM');
    await dispose;
    await expect(callPromise).rejects.toThrow(/disposed/);
  });

  test('idempotent — second dispose() is a no-op', async () => {
    const { setTimer } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
    });
    await startAndHandshake(client, children);
    const first = client.dispose();
    await flushMicrotasks();
    children[0]!.emitExit(0, 'SIGTERM');
    await first;
    await client.dispose(); // does not throw
    expect(client.currentState).toBe('disposed');
  });
});

describe('McpClient reconnect', () => {
  test('unexpected exit triggers reconnect via backoff timer', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
      reconnectBackoffMs: [100, 500],
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    expect(children.length).toBe(1);

    // Server dies unexpectedly.
    children[0]!.emitExit(1, null);
    expect(client.currentState).toBe('reconnecting');
    expect(timers.length).toBe(1);

    // Fire reconnect timer → respawn.
    timers[0]!.fire();
    await flushMicrotasks();
    expect(children.length).toBe(2);

    // New child receives initialize. nextId is monotonic across reconnects
    // so we read the actual id from the request instead of hardcoding it.
    const newChild = children[1]!;
    const initReq = newChild.lastParsedRequest();
    expect(initReq.method).toBe('initialize');
    newChild.emitLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: initReq.id,
        result: { protocolVersion: MCP_PROTOCOL_VERSION_LATEST, capabilities: {}, serverInfo: { name: 'fake' } },
      }),
    );
    await flushMicrotasks();
    expect(client.isReady).toBe(true);
  });

  test('halts after backoff exhausted', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
      reconnectBackoffMs: [10],
      logger: (event, data) => logs.push({ event, data }),
    });
    await startAndHandshake(client, children);
    children[0]!.emitExit(1, null);
    // First reconnect attempt.
    expect(timers.length).toBe(1);
    timers[0]!.fire();
    await flushMicrotasks();
    expect(children.length).toBe(2);
    // Second child also dies immediately before completing initialize.
    children[1]!.emitExit(1, null);
    // No more backoff slots — should halt.
    expect(client.currentState).toBe('halted');
    expect(logs.some((l) => l.event === 'mcp.client.halt')).toBe(true);
  });

  test('reconnectBackoffMs:[] disables reconnect — single exit → halt', async () => {
    const { setTimer } = makeFakeTimerFactory();
    const { spawn, children } = makeFakeSpawnFactory();
    const client = new McpClient({
      id: 'fake',
      command: ['x'],
      spawn,
      setTimer,
      reconnectBackoffMs: [],
    });
    await startAndHandshake(client, children);
    children[0]!.emitExit(0, null);
    expect(client.currentState).toBe('halted');
  });
});

function jsonHeaders(extra: Record<string, string> = {}): { get(name: string): string | null } {
  const map = new Map(Object.entries({ 'content-type': 'application/json', ...extra }).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

function rpcResult(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

describe('McpConnectionError classification', () => {
  test('401 Bearer WWW-Authenticate preserves the full challenge and extracts resource_metadata + scope', () => {
    const challenge = 'Bearer resource_metadata="https://auth.example/.well-known/oauth-protected-resource", scope="mcp:tools"';
    const err = classifyMcpHttpResponse({
      status: 401,
      bodyText: '',
      wwwAuthenticate: challenge,
      detail: 'https://mcp.example.com',
    });
    expect(err).toBeInstanceOf(McpConnectionError);
    expect(err!.reason).toBe('auth-required');
    expect(err!.wwwAuthenticate).toBe(challenge);
    expect(err!.resourceMetadata).toBe('https://auth.example/.well-known/oauth-protected-resource');
    expect(err!.scope).toBe('mcp:tools');
    expect(formatMcpConnectionGuidance(err!)).toContain(challenge);
    expect(isRetryableMcpConnectionFailure(err)).toBe(false);
  });

  test('network / timeout / TLS failures classify as unreachable and are retryable', () => {
    const net = classifyMcpNetworkError(new Error('connect ECONNREFUSED'), 'https://192.0.2.1/mcp');
    expect(net.reason).toBe('unreachable');
    expect(isRetryableMcpConnectionFailure(net)).toBe(true);
    expect(formatMcpConnectionGuidance(net)).toContain('192.0.2.1');
    expect(formatMcpConnectionGuidance(net)).not.toContain('authentication required');
  });

  test('200 HTML is not-mcp and is not retryable', () => {
    const err = classifyMcpHttpResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      bodyText: '<html>not mcp</html>',
    });
    expect(err!.reason).toBe('not-mcp');
    expect(isRetryableMcpConnectionFailure(err)).toBe(false);
    expect(formatMcpConnectionGuidance(err!)).toContain('HTML');
  });

  test('the three human-readable messages are pairwise distinct', () => {
    const auth = formatMcpConnectionGuidance(classifyMcpHttpResponse({
      status: 401, bodyText: '', wwwAuthenticate: 'Bearer scope="x"',
    })!);
    const unreach = formatMcpConnectionGuidance(classifyMcpNetworkError(new Error('timeout'), 'https://192.0.2.1'));
    const notMcp = formatMcpConnectionGuidance(classifyMcpHttpResponse({
      status: 200, contentType: 'text/html', bodyText: '<html></html>',
    })!);
    expect(auth).not.toBe(unreach);
    expect(auth).not.toBe(notMcp);
    expect(unreach).not.toBe(notMcp);
  });

  test('parseWwwAuthenticate does not throw on garbage', () => {
    expect(parseWwwAuthenticate('!!!')).toEqual({});
    expect(parseWwwAuthenticate('Bearer')).toEqual({});
  });
});

describe('McpClient HTTP transport', () => {
  test('initialize + tools/list round-trip against a loopback MCP server, echoing session id', async () => {
    const posts: Array<{ body: string; headers: Record<string, string> }> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      posts.push({ body: init.body, headers: init.headers });
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders({ 'mcp-session-id': 'sess-1' }),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST, capabilities: { tools: {} } }),
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      if (req.method === 'tools/list') {
        expect(init.headers['mcp-session-id']).toBe('sess-1');
        return {
          status: 200,
          headers: jsonHeaders({ 'mcp-session-id': 'sess-1' }),
          text: async () => rpcResult(req.id!, { tools: [{ name: 'echo', description: 'e' }] }),
        };
      }
      throw new Error(`unexpected method ${req.method}`);
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [],
    });
    await client.start();
    expect(client.isReady).toBe(true);
    const tools = await client.listTools();
    expect(tools).toEqual([{ name: 'echo', description: 'e' }]);
    expect(posts[0]!.body).toContain('"method":"initialize"');
    expect(JSON.parse(posts[0]!.body).params.capabilities).toEqual({
      extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
    });
    expect(posts.some((p) => p.body.includes('notifications/initialized'))).toBe(true);
    await client.dispose();
  });

  test('address transport posts a Method not found reply with the original request id', async () => {
    const posts: string[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      posts.push(init.body);
      const req = JSON.parse(init.body) as { id?: number; method?: string };
      if (req.method === 'initialize') {
        return { status: 200, headers: jsonHeaders(), text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST, capabilities: {} }) };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({ id: 'http', url: 'http://127.0.0.1:9/mcp', fetch, reconnectBackoffMs: [] });
    await client.start();
    (client as unknown as { replyMethodNotFound(id: number | string | null, method: string): void })
      .replyMethodNotFound('server-9', 'unknown/address');
    await flushMicrotasks();
    expect(JSON.parse(posts.at(-1)!)).toEqual({
      jsonrpc: '2.0', id: 'server-9',
      error: { code: -32601, message: 'method not found: unknown/address' },
    });
    await client.dispose();
  });

  test('401 challenge is not retried — request count stays 1', async () => {
    const challenge = 'Bearer resource_metadata="https://auth.example/meta", scope="mcp"';
    let calls = 0;
    const fetch: McpHttpFetch = async () => {
      calls += 1;
      return {
        status: 401,
        headers: jsonHeaders({ 'www-authenticate': challenge }),
        text: async () => '',
      };
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [0, 0],
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'auth-required', wwwAuthenticate: challenge });
    expect(calls).toBe(1);
    expect(client.httpRequestCount).toBe(1);
  });

  test('unreachable retries at least twice', async () => {
    let calls = 0;
    const fetch: McpHttpFetch = async () => {
      calls += 1;
      throw new Error('connect EHOSTUNREACH');
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://192.0.2.1/mcp',
      fetch,
      reconnectBackoffMs: [0],
      setTimer: (cb) => {
        cb();
        return { cancel() {} };
      },
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'unreachable' });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(client.httpRequestCount).toBeGreaterThanOrEqual(2);
  });

  test('200 HTML classifies as not-mcp and is not retried', async () => {
    let calls = 0;
    const fetch: McpHttpFetch = async () => {
      calls += 1;
      return {
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => '<html>nope</html>',
      };
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/',
      fetch,
      reconnectBackoffMs: [0, 0],
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'not-mcp' });
    expect(calls).toBe(1);
  });

  test('SSE JSON data event is accepted as a JSON-RPC result', async () => {
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
          text: async () => `event: message\ndata: ${rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST })}\n\n`,
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      throw new Error(req.method);
    };
    const client = new McpClient({ id: 'http', url: 'http://127.0.0.1:9/mcp', fetch, reconnectBackoffMs: [] });
    await client.start();
    expect(client.isReady).toBe(true);
    await client.dispose();
  });

  test('hanging response body is aborted by the request timeout and does not retry auth-style success', async () => {
    const fetch: McpHttpFetch = async (_url, init) => ({
      status: 200,
      headers: jsonHeaders(),
      text: () => new Promise<string>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      httpTimeoutMs: 30,
      reconnectBackoffMs: [],
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'unreachable' });
    expect(client.httpRequestCount).toBe(1);
  });

  test('successful HTTP body read cancels the request timeout timer', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
        };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      setTimer,
      reconnectBackoffMs: [],
    });
    await client.start();
    expect(timers.length).toBeGreaterThan(0);
    expect(timers.every((t) => t.cancelled)).toBe(true);
    await client.dispose();
  });

  test('subsequent HTTP requests send the negotiated MCP-Protocol-Version', async () => {
    const versions: Array<string | undefined> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      versions.push(init.headers['mcp-protocol-version']);
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        expect(init.headers['mcp-protocol-version']).toBeUndefined();
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: '2025-03-26', capabilities: {} }),
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      if (req.method === 'tools/list') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { tools: [{ name: 'echo' }] }),
        };
      }
      throw new Error(req.method);
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [],
    });
    await client.start();
    await client.listTools();
    expect(versions.slice(1)).toEqual(['2025-03-26', '2025-03-26']);
    await client.dispose();
  });

  test('open SSE stream returns on matching multiline JSON-RPC after a notification', async () => {
    const encoder = new TextEncoder();
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\n`,
            ));
            controller.enqueue(encoder.encode(`data: {"jsonrpc":"2.0","id":${req.id!},"result":{\n`));
            controller.enqueue(encoder.encode('data: "protocolVersion":"2025-11-25"}}\n\n'));
          },
        });
        return {
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
          text: async () => {
            throw new Error('text() must not wait for an open SSE stream');
          },
          body: stream,
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      throw new Error(req.method);
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [],
    });
    await client.start();
    expect(client.isReady).toBe(true);
    await client.dispose();
  });

  test('open 401 body is auth-required without retry even if text() never settles', async () => {
    const challenge = 'Bearer resource_metadata="https://auth.example/meta", scope="mcp"';
    let textCalls = 0;
    const fetch: McpHttpFetch = async () => ({
      status: 401,
      headers: jsonHeaders({ 'www-authenticate': challenge }),
      text: () => {
        textCalls += 1;
        return new Promise<string>(() => { /* never settles */ });
      },
    });
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      httpTimeoutMs: 250,
      reconnectBackoffMs: [0, 0],
    });
    await expect(client.start()).rejects.toMatchObject({
      reason: 'auth-required',
      wwwAuthenticate: challenge,
    });
    expect(textCalls).toBe(0);
    expect(client.httpRequestCount).toBe(1);
  });

  test('JSON-RPC response with neither result nor error is not-mcp and is not retried', async () => {
    let calls = 0;
    const fetch: McpHttpFetch = async (_url, init) => {
      calls += 1;
      const req = JSON.parse(init.body) as { id?: number };
      return {
        status: 200,
        headers: jsonHeaders(),
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: req.id }),
      };
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [0, 0],
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'not-mcp' });
    expect(calls).toBe(1);
  });

  test('initialize result without protocolVersion is not-mcp, not a silent latest-version fallback', async () => {
    const versions: Array<string | undefined> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      versions.push(init.headers['mcp-protocol-version']);
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { capabilities: {} }),
        };
      }
      throw new Error(`unexpected follow-up ${req.method} with protocol ${init.headers['mcp-protocol-version']}`);
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [0, 0],
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'not-mcp' });
    expect(client.isReady).toBe(false);
    expect(versions).toEqual([undefined]);
    expect(client.httpRequestCount).toBe(1);
  });

  test('dispose() aborts every in-flight HTTP POST, not only the last one', async () => {
    const inFlight: AbortSignal[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST, capabilities: {} }),
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      if (!init.signal) throw new Error('missing abort signal');
      inFlight.push(init.signal);
      return {
        status: 200,
        headers: jsonHeaders(),
        text: () => new Promise<string>((_resolve, reject) => {
          const fail = (): void => {
            queueMicrotask(() => reject(new Error('aborted')));
          };
          const signal = init.signal!;
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail, { once: true });
        }),
      };
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://127.0.0.1:9/mcp',
      fetch,
      reconnectBackoffMs: [],
      httpTimeoutMs: 30_000,
    });
    await client.start();
    const p1 = client.listTools();
    const p2 = client.callTool('echo', {});
    const settled = Promise.allSettled([p1, p2]);
    const waitStart = Date.now();
    while (inFlight.length < 2 && Date.now() - waitStart < 1000) {
      await Promise.resolve();
    }
    expect(inFlight).toHaveLength(2);
    expect(inFlight.every((s) => !s.aborted)).toBe(true);
    await client.dispose();
    expect(inFlight.every((s) => s.aborted)).toBe(true);
    const results = await settled;
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});

// ── 5xx·429 는 «닿지 못함»이지 «MCP 아님»이 아니다 (인수 시 수정) ──
//
// 🔴 인수 전 코드는 401 을 뺀 «모든» 비-2xx 를 `not-mcp` 로 분류했다.
//    `isRetryableMcpConnectionFailure` 는 `unreachable` «만» 참을 내므로
//    ⇒ ***502·503·429 같은 일시적 상류 장애가 영영 재시도되지 않았다.***
//    골 계약(「닿지 못한 것·시간이 넘은 것은 다시 시도」)과 정면으로 어긋난다.
describe('classifyMcpHttpResponse — 재시도 «가능»과 «불가»를 상태 코드로 가른다', () => {
  const classify = (status: number, extra: Record<string, unknown> = {}) =>
    classifyMcpHttpResponse({ status, bodyText: 'x', ...extra });

  test('5xx 는 unreachable — 다시 걸면 될 수 있다', () => {
    for (const status of [500, 502, 503, 504]) {
      const err = classify(status)!;
      expect(err.reason).toBe('unreachable');
      expect(isRetryableMcpConnectionFailure(err)).toBe(true);
    }
  });

  test('429 도 unreachable — 「지금은」 안 된다는 말이다', () => {
    const err = classify(429)!;
    expect(err.reason).toBe('unreachable');
    expect(isRetryableMcpConnectionFailure(err)).toBe(true);
  });

  test('⛔ 401 은 재시도하지 않는다 — 다시 걸어도 같은 답이다', () => {
    const err = classify(401, { wwwAuthenticate: 'Bearer realm="x"' })!;
    expect(err.reason).toBe('auth-required');
    expect(isRetryableMcpConnectionFailure(err)).toBe(false);
  });

  test('403 preserves unknown credential and recovery state instead of inventing either fact', () => {
    const err = classify(403)!;
    expect(err.reason).toBe('unreachable');
    expect(isRetryableMcpConnectionFailure(err)).toBe(true);
    expect(err.message).toContain('403 with unknown credential state; treating as transient');
    expect(err.message).not.toContain('without Bearer credentials');

    const bearerWithUnknownRecovery = classify(403, { hadBearer: true })!;
    expect(bearerWithUnknownRecovery.message).toContain(
      '403 with Bearer credentials and unknown recovery state; treating as transient',
    );
    expect(bearerWithUnknownRecovery.message).not.toContain('attempting credential recovery');
  });

  test('403 without Bearer credentials is transient and records its classification rationale', () => {
    const err = classify(403, { hadBearer: false, credentialRecoveryAttempted: false })!;
    expect(err.reason).toBe('unreachable');
    expect(isRetryableMcpConnectionFailure(err)).toBe(true);
    expect(err.message).toContain('403 without Bearer credentials; treating as transient');
    expect(err.detail).toContain('403 without Bearer credentials; treating as transient');
  });

  test('⛔ other 4xx are not-mcp — retrying a bad path or request is pointless', () => {
    for (const status of [400, 404, 410]) {
      const err = classify(status)!;
      expect(err.reason).toBe('not-mcp');
      expect(isRetryableMcpConnectionFailure(err)).toBe(false);
    }
  });

  test('세 갈래의 «사람이 읽는 문면»이 서로 다르다 — 같으면 안 가른 것이다', () => {
    const auth = classify(401, { wwwAuthenticate: 'Bearer realm="x"' })!.message;
    const unreach = classify(503)!.message;
    const notMcp = classify(200, { contentType: 'text/html', bodyText: '<html>' })!.message;
    expect(new Set([auth, unreach, notMcp]).size).toBe(3);
  });
});

// ── 재시도가 «실제로» 도는가 — 로컬 HTTP fixture (리뷰 must-fix) ──
//
// ⛔⭐ 앞의 분류 시험은 `isRetryableMcpConnectionFailure(err)` 만 물었다 — 그것은
//    ***「분류가 맞나」이지 「클라이언트가 다시 거나」가 아니다.*** 리뷰가 그걸 Goodhart 로 짚었고
//    맞았다: 분류를 고쳤는데 `tools/list` 는 재시도 배선이 «없어서» 한 번에 실패하고 있었다.
//    ⇒ 진짜 소켓을 세우고 «메서드별 요청 수»를 센다.
//    ⚠️ 초판 fixture 는 「몇 번째 요청인가」로 갈랐다가 `notifications/initialized` 가
//       그 계수를 밀어 어긋났다. ⇒ ***요청 본문의 `method` 로 라우팅***한다.
describe('McpClient HTTP — 재시도가 실제로 도는가 (메서드별 요청 수)', () => {
  const startFixture = async (
    handler: (method: string, nth: number, id: unknown) => { status: number; body: string; ct?: string },
  ) => {
    const hits: Record<string, number> = {};
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        let method = '?'; let id: unknown = null;
        try { const b = JSON.parse(await req.text()); method = b.method ?? '?'; id = b.id ?? null; } catch { /* ignore */ }
        hits[method] = (hits[method] ?? 0) + 1;
        const r = handler(method, hits[method]!, id);
        return new Response(r.body, { status: r.status, headers: { 'content-type': r.ct ?? 'application/json' } });
      },
    });
    return { url: `http://127.0.0.1:${server.port}/mcp`, hits, stop: () => server.stop(true) };
  };
  const okInit = (id: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: MCP_PROTOCOL_VERSION_LATEST, capabilities: {}, serverInfo: { name: 'f', version: '0' } } });
  const ok = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result });

  test('handshake 가 503 을 만나면 «다시» 건다 — 그리고 결국 붙는다', async () => {
    const f = await startFixture((m, n, id) => {
      if (m === 'initialize') return n <= 2 ? { status: 503, body: 'unavailable' } : { status: 200, body: okInit(id) };
      return { status: 202, body: '' };
    });
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await client.start();
      expect(client.isReady).toBe(true);
      expect(f.hits['initialize']).toBe(3);         // ⭐ 「한 번」이 아니다
      await client.dispose();
    } finally { f.stop(); }
  });

  test('⛔⭐ 영구 503 — 요청 수가 «백오프 상한 그대로»다 (중첩 증폭 방어)', async () => {
    // 🔴 초판은 손 맞추기를 `httpRetry` 로 감싸 놓고 그 «안»의 `initialize` 도 다시
    //    재시도해서 백오프가 «곱해졌다» — 🧪 실측 3칸 백오프에서 4회가 아니라 ***16회***.
    //    ⇒ 재시도 «소유자»를 손 맞추기 하나로 정했다. 이 시험이 그 상한을 못 박는다.
    const f = await startFixture(() => ({ status: 503, body: 'unavailable' }));
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await expect(client.start()).rejects.toThrow();
      expect(f.hits['initialize']).toBe(4);          // ⭐ 백오프 3칸 + 최초 1회
      await client.dispose();
    } finally { f.stop(); }
  });

  test('429 Retry-After delta-seconds를 따르고 관측에 출처를 남긴다', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const logs: Array<{ event: string; data?: Record<string, unknown> }> = [];
    let initializeHits = 0;
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize' && ++initializeHits === 1) {
        return { status: 429, headers: { get: (name: string) => name === 'retry-after' ? '2' : name === 'content-type' ? 'application/json' : null }, text: async () => 'busy', body: null };
      }
      if (req.method === 'initialize') return { status: 200, headers: { get: () => 'application/json' }, text: async () => okInit(req.id), body: null };
      return { status: 202, headers: { get: () => 'application/json' }, text: async () => '', body: null };
    };
    const client = new McpClient({ id: 'retry-after', url: 'http://example.test/mcp', fetch, setTimer, reconnectBackoffMs: [7], logger: (event, data) => logs.push({ event, data }) });
    const start = client.start();
    await waitForTimers(timers, 2);
    expect(timers).toHaveLength(2);
    expect(timers[1]!.delayMs).toBe(2_000);
    expect(logs).toContainEqual({ event: 'mcp.client.reconnect-scheduled', data: expect.objectContaining({ delayMs: 2_000, delaySource: 'retry-after', followedRetryAfter: true }) });
    timers[1]!.fire();
    await start;
    await client.dispose();
  });

  test('429 Retry-After HTTP date, malformed, and over-limit values select date or backoff', async () => {
    const cases = [
      { header: new Date(Date.now() + 2_000).toUTCString(), expected: 'date' as const },
      { header: null, expected: 7 },
      { header: 'wat', expected: 7 },
      { header: '1e1', expected: 7 },
      { header: '0.5', expected: 7 },
      { header: '-1', expected: 7 },
      { header: '999999', expected: 7 },
    ];
    for (const { header, expected } of cases) {
      const { setTimer, timers } = makeFakeTimerFactory();
      let initializeHits = 0;
      const fetch: McpHttpFetch = async (_url, init) => {
        const req = JSON.parse(init.body) as { id?: number; method: string };
        if (req.method === 'initialize' && ++initializeHits === 1) return { status: 429, headers: { get: (name: string) => name === 'retry-after' ? header : name === 'content-type' ? 'application/json' : null }, text: async () => 'busy', body: null };
        if (req.method === 'initialize') return { status: 200, headers: { get: () => 'application/json' }, text: async () => okInit(req.id), body: null };
        return { status: 202, headers: { get: () => 'application/json' }, text: async () => '', body: null };
      };
      const client = new McpClient({ id: 'retry-after', url: 'http://example.test/mcp', fetch, setTimer, reconnectBackoffMs: [7] });
      const start = client.start();
      await waitForTimers(timers, 2);
      const retryTimer = timers[1]!;
      if (expected === 'date') {
        expect(retryTimer.delayMs).toBeGreaterThan(0);
        expect(retryTimer.delayMs).not.toBe(7);
      } else expect(retryTimer.delayMs).toBe(expected);
      retryTimer.fire();
      await start;
      await client.dispose();
    }
  });

  test('dispose cancels and settles a retry sleep without a later retry, while firing releases its timer', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    let requests = 0;
    const fetch: McpHttpFetch = async () => {
      requests += 1;
      return { status: 503, headers: { get: () => 'application/json' }, text: async () => 'busy', body: null };
    };
    const client = new McpClient({ id: 'retry-dispose', url: 'http://example.test/mcp', fetch, setTimer, reconnectBackoffMs: [50] });
    const start = client.start();
    await waitForTimers(timers, 2);
    const retryTimer = timers[1]!;
    await client.dispose();
    expect(retryTimer.cancelled).toBe(true);
    await expect(start).rejects.toThrow(/disposed/);
    expect(requests).toBe(1);

    const normal = new McpClient({ id: 'retry-fire', url: 'http://example.test/mcp', fetch, setTimer, reconnectBackoffMs: [50] });
    const normalStart = normal.start();
    await waitForTimers(timers, 4);
    const normalRetryTimer = timers[3]!;
    normalRetryTimer.fire();
    await expect(normalStart).rejects.toThrow();
    await normal.dispose();
    expect(normalRetryTimer.cancelled).toBe(false);
  });

  test('dispose settles every concurrent retry sleep and cancels every timer', async () => {
    const { setTimer, timers } = makeFakeTimerFactory();
    const client = new McpClient({
      id: 'concurrent-retry-dispose',
      url: 'http://example.test/mcp',
      setTimer,
      reconnectBackoffMs: [50],
    });
    const retry = (client as unknown as {
      httpRetry: <T>(
        run: () => Promise<T>,
        what: string,
      ) => Promise<T>;
    }).httpRetry.bind(client);
    const unavailable = () => Promise.reject(new McpConnectionError('unreachable', 'busy'));
    const first = retry(unavailable, 'first');
    const second = retry(unavailable, 'second');
    await waitForTimers(timers, 2);
    expect(timers).toHaveLength(2);

    await client.dispose();

    expect(timers.every((timer) => timer.cancelled)).toBe(true);
    await expect(first).rejects.toThrow(/disposed/);
    await expect(second).rejects.toThrow(/disposed/);
  });

  test('백오프가 «비면» 재시도가 아예 없다 — 요청 한 번', async () => {
    const f = await startFixture(() => ({ status: 503, body: 'unavailable' }));
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [] });
      await expect(client.start()).rejects.toThrow();
      expect(f.hits['initialize']).toBe(1);
      await client.dispose();
    } finally { f.stop(); }
  });

  test('⛔ 401 은 «다시 걸지 않는다» — 요청이 정확히 «한 번»', async () => {
    const f = await startFixture(() => ({ status: 401, body: '{"error":"Unauthorized"}' }));
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await expect(client.start()).rejects.toThrow();
      expect(f.hits['initialize']).toBe(1);          // ⭐ 재시도 0
      await client.dispose();
    } finally { f.stop(); }
  });

  test('⭐ tools/list 의 503 도 «다시» 건다 — handshake «밖»이라 초판은 한 번에 죽었다', async () => {
    const f = await startFixture((m, n, id) => {
      if (m === 'initialize') return { status: 200, body: okInit(id) };
      if (m === 'tools/list') return n <= 2 ? { status: 503, body: 'unavailable' } : { status: 200, body: ok(id, { tools: [{ name: 'a' }] }) };
      return { status: 202, body: '' };
    });
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await client.start();
      expect(await client.listTools()).toHaveLength(1);
      expect(f.hits['tools/list']).toBe(3);          // ⭐ 503 두 번을 넘겨 붙었다
      expect(f.hits['initialize']).toBe(1);          // ⊕ handshake 는 안 다시 걸렸다
      await client.dispose();
    } finally { f.stop(); }
  });

  test('⛔ notifications/initialized 의 503 을 «삼키지» 않는다 — 서버가 못 받았는데 ready 가 되면 안 된다', async () => {
    // 🔴 초판은 `httpNotify` 가 `unreachable` 을 삼켜 «로그만 남기고» state='ready' 로 넘어갔다.
    //    서버는 우리를 초기화된 것으로 «모르는데» 우리는 붙었다고 믿는 상태다.
    //    ⇒ 손 맞추기 «안»에서 난 재시도 대상 실패는 위로 던져 전체를 다시 걸게 한다.
    const f = await startFixture((m, n, id) => {
      if (m === 'initialize') return { status: 200, body: okInit(id) };
      if (m === 'notifications/initialized') {
        return n <= 2 ? { status: 503, body: 'unavailable' } : { status: 202, body: '' };
      }
      return { status: 202, body: '' };
    });
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await client.start();
      expect(client.isReady).toBe(true);
      // ⭐ notify 가 503 을 두 번 냈으므로 손 맞추기 «전체»가 세 번 돌았어야 한다
      expect(f.hits['notifications/initialized']).toBe(3);
      expect(f.hits['initialize']).toBe(3);
      await client.dispose();
    } finally { f.stop(); }
  });

  test('resources/list 503 is retried through the same idempotent request path', async () => {
    const f = await startFixture((m, n, id) => {
      if (m === 'initialize') return { status: 200, body: okInit(id) };
      if (m === 'resources/list') return n === 1
        ? { status: 503, body: 'unavailable' }
        : { status: 200, body: ok(id, { resources: [{ uri: 'ui://screen' }] }) };
      return { status: 202, body: '' };
    });
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0] });
      await client.start();
      await expect(client.listResources()).resolves.toEqual([{ uri: 'ui://screen' }]);
      expect(f.hits['resources/list']).toBe(2);
      await client.dispose();
    } finally { f.stop(); }
  });

  test('resources/read uses the shared HTTP request timeout', async () => {
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') return {
        status: 200, headers: jsonHeaders(),
        text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
      };
      if (req.method === 'notifications/initialized') return { status: 202, headers: jsonHeaders(), text: async () => '' };
      return {
        status: 200, headers: jsonHeaders(),
        text: () => new Promise<string>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      };
    };
    const client = new McpClient({ id: 'timeout', url: 'http://example.test/mcp', fetch, httpTimeoutMs: 20, reconnectBackoffMs: [] });
    await client.start();
    await expect(client.readResource('ui://screen')).rejects.toMatchObject({ reason: 'unreachable' });
    await client.dispose();
  });

  test('⛔⭐ tools/call 은 «다시 걸지 않는다» — 돈 쓰는 툴을 두 번 부르면 안 된다', async () => {
    const f = await startFixture((m, _n, id) => {
      if (m === 'initialize') return { status: 200, body: okInit(id) };
      if (m === 'tools/call') return { status: 503, body: 'unavailable' };
      return { status: 202, body: '' };
    });
    try {
      const client = new McpClient({ id: 'f', url: f.url, reconnectBackoffMs: [0, 0, 0] });
      await client.start();
      await expect(client.callTool('pay', {})).rejects.toThrow();
      expect(f.hits['tools/call']).toBe(1);          // ⭐ 멱등하지 «않으므로» 한 번뿐
      await client.dispose();
    } finally { f.stop(); }
  });
});

describe('McpClient HTTP OAuth wiring', () => {
  const RESOURCE_META = 'https://192.0.2.10/.well-known/oauth-protected-resource';
  const AS = 'https://192.0.2.20';
  const ISSUER = 'https://192.0.2.20';
  const AUTHORIZE = 'https://192.0.2.20/authorize';
  const TOKEN = 'https://192.0.2.20/token';
  const REGISTER = 'https://192.0.2.20/register';
  const AS_META = 'https://192.0.2.20/.well-known/oauth-authorization-server';
  const MCP_URL = 'http://127.0.0.1:9/mcp';
  const CHALLENGE = `Bearer resource_metadata="${RESOURCE_META}", scope="mcp:tools"`;

  let storeDir: string;
  let storePath: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'mcp-client-oauth-'));
    storePath = join(storeDir, 'auth.json');
  });
  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  function oauthJson(status: number, body: unknown): Awaited<ReturnType<McpOAuthFetch>> {
    return {
      status,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
    };
  }

  function makeOauthFetch(opts: {
    token?: (body: string) => Record<string, unknown> | { status: number; body: unknown };
    recorded?: Array<{ method: string; url: string; body?: string }>;
  } = {}): McpOAuthFetch {
    const recorded = opts.recorded ?? [];
    return async (url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      recorded.push({ method, url, body: init?.body });
      if (url === RESOURCE_META) {
        return oauthJson(200, { resource: MCP_URL, authorization_servers: [AS] });
      }
      if (url === AS_META) {
        return oauthJson(200, {
          issuer: ISSUER,
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
          registration_endpoint: REGISTER,
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url === REGISTER) return oauthJson(201, { client_id: 'client-1' });
      if (url === TOKEN) {
        const out = opts.token
          ? opts.token(init?.body ?? '')
          : {
              access_token: 'access-1',
              refresh_token: 'refresh-1',
              expires_in: 3600,
              token_type: 'Bearer',
            };
        if ('status' in out && typeof (out as { status: unknown }).status === 'number') {
          const failed = out as { status: number; body: unknown };
          return oauthJson(failed.status, failed.body);
        }
        return oauthJson(200, out);
      }
      throw new Error(`unexpected oauth url ${method} ${url}`);
    };
  }

  test('attaches a stored issuer access token as Authorization: Bearer', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const auths: Array<string | undefined> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      auths.push(init.headers.authorization);
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
        };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [],
      oauthIssuer: ISSUER,
      oauthStorePath: storePath,
    });
    await client.start();
    expect(auths[0]).toBe('Bearer stored-access');
    await client.dispose();
  });

  test('falls back to the static bearer when a configured issuer has no OAuth token', async () => {
    const envName = 'MONAD_MCP_CLIENT_STATIC_FALLBACK';
    const previous = process.env[envName];
    const staticToken = 'static-fallback-token';
    process.env[envName] = staticToken;
    const auths: Array<string | undefined> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      auths.push(init.headers.authorization);
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return { status: 200, headers: jsonHeaders(), text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }) };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    try {
      const client = new McpClient({
        id: 'http', url: MCP_URL, fetch, reconnectBackoffMs: [], oauthIssuer: ISSUER,
        oauthStorePath: storePath, bearerTokenEnv: envName,
      });
      await client.start();
      expect(auths).toContain(`Bearer ${staticToken}`);
      await client.dispose();
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('omits Authorization when the configured static bearer environment variable is missing', async () => {
    const envName = 'MONAD_MCP_CLIENT_MISSING_STATIC_BEARER';
    const previous = process.env[envName];
    delete process.env[envName];
    const auths: Array<string | undefined> = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      auths.push(init.headers.authorization);
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return { status: 200, headers: jsonHeaders(), text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }) };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    try {
      const client = new McpClient({ id: 'http', url: MCP_URL, fetch, reconnectBackoffMs: [], bearerTokenEnv: envName });
      await client.start();
      expect(auths).toContain(undefined);
      await client.dispose();
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('unauthenticated 401 with resourceMetadata obtains credentials and retries once', async () => {
    const oauthRecorded: Array<{ method: string; url: string; body?: string }> = [];
    let mcpCalls = 0;
    const fetch: McpHttpFetch = async (_url, init) => {
      mcpCalls += 1;
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (!init.headers.authorization) {
        return {
          status: 401,
          headers: jsonHeaders({ 'www-authenticate': CHALLENGE }),
          text: async () => '',
        };
      }
      expect(init.headers.authorization).toBe('Bearer access-1');
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
        };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [0, 0],
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({ recorded: oauthRecorded }),
      authorize: async (request) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('state')).toBe(request.state);
        return { code: 'auth-code', state: request.state };
      },
    });
    await client.start();
    expect(mcpCalls).toBe(3); // initialize 401 → retry initialize 200 → notify
    expect(client.httpRequestCount).toBe(3);
    expect(oauthRecorded.some((r) => r.url === RESOURCE_META)).toBe(true);
    expect(oauthRecorded.some((r) => r.url === AS_META)).toBe(true);
    expect(loadTokens(ISSUER, storePath)?.tokens.accessToken).toBe('access-1');
    await client.dispose();
  });

  test('resources/read refreshes rejected credentials and retries through the shared OAuth path', async () => {
    saveTokens(
      ISSUER,
      { accessToken: 'stale-access', refreshToken: 'live-refresh', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer' },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false }, storePath,
    );
    const auths: string[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') return {
        status: 200, headers: jsonHeaders(),
        text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
      };
      if (req.method === 'notifications/initialized') return { status: 202, headers: jsonHeaders(), text: async () => '' };
      auths.push(init.headers.authorization ?? '');
      if (auths.length === 1) return { status: 401, headers: jsonHeaders({ 'www-authenticate': CHALLENGE }), text: async () => '' };
      return { status: 200, headers: jsonHeaders(), text: async () => rpcResult(req.id!, {
        contents: [{ uri: 'ui://screen', text: 'recovered' }],
      }) };
    };
    const client = new McpClient({
      id: 'http', url: MCP_URL, fetch, reconnectBackoffMs: [], oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN, oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({ token: () => ({
        access_token: 'fresh-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer',
      }) }),
    });
    await client.start();
    await expect(client.readResource('ui://screen')).resolves.toEqual({
      contents: [{ uri: 'ui://screen', text: 'recovered' }],
    });
    expect(auths).toEqual(['Bearer stale-access', 'Bearer fresh-access']);
    await client.dispose();
  });

  test('metadata-free 401 stays auth-required without OAuth traffic', async () => {
    const oauthRecorded: Array<{ method: string; url: string }> = [];
    const fetch: McpHttpFetch = async () => ({
      status: 401,
      headers: jsonHeaders({ 'www-authenticate': 'Bearer' }),
      text: async () => '',
    });
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [0, 0],
      oauthStorePath: storePath,
      oauthFetch: async (url, init) => {
        oauthRecorded.push({ method: init?.method ?? 'GET', url });
        throw new Error('oauth fetch must not run');
      },
      authorize: async () => ({ code: 'x', state: 'y' }),
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'auth-required' });
    expect(client.httpRequestCount).toBe(1);
    expect(oauthRecorded).toEqual([]);
  });

  test('credentialed 403 refreshes once, retries transiently, then raises auth-required without a second refresh', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stale-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const oauthRecorded: Array<{ method: string; url: string; body?: string }> = [];
    const auths: string[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      auths.push(init.headers.authorization ?? '');
      return {
        status: 403,
        headers: jsonHeaders(),
        text: async () => '',
      };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [0],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({
        recorded: oauthRecorded,
        token: () => ({
          access_token: 'fresh-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }),
    });
    let caught: unknown;
    try {
      await client.start();
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ reason: 'auth-required' });
    expect((caught as Error).message).toContain('403 after Bearer recovery; treating as transient');
    expect(auths).toEqual(['Bearer stale-access', 'Bearer fresh-access', 'Bearer fresh-access']);
    expect(client.httpRequestCount).toBe(3);
    expect(oauthRecorded.filter((r) => r.url === TOKEN)).toHaveLength(1);
  });

  // ── 리뷰 must-fix 회귀 (라운드 3 · 사람이 인수해 메움) ──
  //
  // ⛔ 403 흔적이 재시도 체인에 «영구 유지»되면, 그 뒤에 온 5xx·429 까지
  //    `auth-required` 로 뒤집혀 ***영영 다시 걸리지 않는다*** — 이 착지가
  //    「5xx·429 는 종전대로 다시 건다」를 불변식으로 걸었는데 그것을 깬다.
  //    ⇒ 변환은 «최종 실패가 403일 때»만 일어나야 한다.
  test('⭐⭐ 403 → 갱신 → 403 → 재시도 → 503 의 «최종» 오류는 unreachable 이다', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stale-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const statuses: number[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      void init;
      // 앞의 둘은 403(갱신을 부르고 그 뒤에도 거부), 그 다음부터는 서버가 아프다.
      const status = statuses.length < 2 ? 403 : 503;
      statuses.push(status);
      return { status, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [0, 0],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({
        token: () => ({
          access_token: 'fresh-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }),
    });
    let caught: unknown;
    try {
      await client.start();
    } catch (err) {
      caught = err;
    }
    expect(statuses.slice(0, 2)).toEqual([403, 403]);
    expect(statuses.at(-1)).toBe(503);
    // ⛔ 이 줄이 must-fix 를 «직접» 센다 — 흔적이 남으면 auth-required 가 나온다.
    expect(caught).toMatchObject({ reason: 'unreachable' });
  });

  test('concurrent credentialed 403 retry chains isolate recovery state before shared token refresh', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stale-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const oauthRecorded: Array<{ method: string; url: string; body?: string }> = [];
    const initial403 = new Set<number>();
    let releaseInitial403: () => void;
    const initial403Ready = new Promise<void>((resolve) => { releaseInitial403 = resolve; });
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
        };
      }
      if (req.method === 'notifications/initialized') {
        return { status: 202, headers: jsonHeaders(), text: async () => '' };
      }
      if (req.method === 'tools/list' && !initial403.has(req.id!)) {
        initial403.add(req.id!);
        if (initial403.size === 2) releaseInitial403!();
        await initial403Ready;
        return { status: 403, headers: jsonHeaders(), text: async () => '' };
      }
      return { status: 200, headers: jsonHeaders(), text: async () => rpcResult(req.id!, { tools: [] }) };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({
        recorded: oauthRecorded,
        token: () => ({
          access_token: 'fresh-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }),
    });
    await client.start();
    await Promise.all([client.listTools(), client.listTools()]);
    expect(initial403).toHaveLength(2);
    expect(oauthRecorded.filter((r) => r.url === TOKEN)).toHaveLength(1);
    expect(client.httpRequestCount).toBe(6);
    await client.dispose();
  });

  test('handshake 403 recovery does not suppress notification 401 recovery', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stale-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const oauthRecorded: Array<{ method: string; url: string; body?: string }> = [];
    const requests: Array<{ method: string; authorization?: string }> = [];
    let tokenCalls = 0;
    const fetch: McpHttpFetch = async (_url, init) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      requests.push({ method: req.method, authorization: init.headers.authorization });
      const sameMethodCalls = requests.filter((request) => request.method === req.method).length;
      if (req.method === 'initialize' && sameMethodCalls === 1) {
        return { status: 403, headers: jsonHeaders(), text: async () => '' };
      }
      if (req.method === 'initialize') {
        return {
          status: 200,
          headers: jsonHeaders(),
          text: async () => rpcResult(req.id!, { protocolVersion: MCP_PROTOCOL_VERSION_LATEST }),
        };
      }
      if (req.method === 'notifications/initialized' && sameMethodCalls === 1) {
        return { status: 401, headers: jsonHeaders({ 'www-authenticate': CHALLENGE }), text: async () => '' };
      }
      return { status: 202, headers: jsonHeaders(), text: async () => '' };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({
        recorded: oauthRecorded,
        token: () => {
          tokenCalls += 1;
          return {
            access_token: `fresh-access-${tokenCalls}`,
            refresh_token: `rotated-refresh-${tokenCalls}`,
            expires_in: 3600,
            token_type: 'Bearer',
          };
        },
      }),
    });
    await client.start();
    expect(client.isReady).toBe(true);
    expect(requests).toEqual([
      { method: 'initialize', authorization: 'Bearer stale-access' },
      { method: 'initialize', authorization: 'Bearer fresh-access-1' },
      { method: 'notifications/initialized', authorization: 'Bearer fresh-access-1' },
      { method: 'notifications/initialized', authorization: 'Bearer fresh-access-2' },
    ]);
    expect(oauthRecorded.filter((record) => record.url === TOKEN)).toHaveLength(2);
    expect(client.httpRequestCount).toBe(4);
    await client.dispose();
  });

  test('credentialed 401 refreshes once then raises auth-required on a second 401', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'stale-access',
        refreshToken: 'live-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const oauthRecorded: Array<{ method: string; url: string; body?: string }> = [];
    const auths: string[] = [];
    const fetch: McpHttpFetch = async (_url, init) => {
      auths.push(init.headers.authorization ?? '');
      return {
        status: 401,
        headers: jsonHeaders({ 'www-authenticate': CHALLENGE }),
        text: async () => '',
      };
    };
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [0, 0],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: makeOauthFetch({
        recorded: oauthRecorded,
        token: (body) => {
          expect(body).toContain('grant_type=refresh_token');
          return {
            access_token: 'fresh-access',
            refresh_token: 'rotated-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          };
        },
      }),
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'auth-required' });
    expect(auths).toEqual(['Bearer stale-access', 'Bearer fresh-access']);
    expect(client.httpRequestCount).toBe(2);
    expect(oauthRecorded.filter((r) => r.url === TOKEN)).toHaveLength(1);
    expect(loadTokens(ISSUER, storePath)?.tokens.accessToken).toBe('fresh-access');
  });

  test('open 401 body is still auth-required without waiting on text()', async () => {
    let textCalls = 0;
    const fetch: McpHttpFetch = async () => ({
      status: 401,
      headers: jsonHeaders({ 'www-authenticate': CHALLENGE }),
      text: () => {
        textCalls += 1;
        return new Promise<string>(() => { /* never settles */ });
      },
    });
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      httpTimeoutMs: 250,
      reconnectBackoffMs: [0, 0],
      oauthStorePath: storePath,
      authorize: async (request) => ({ code: 'x', state: request.state }),
      oauthFetch: makeOauthFetch({
        token: () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }),
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'auth-required' });
    expect(textCalls).toBe(0);
  });

  test('static bearer environment fallback sends non-empty values, omits blank values, and never exposes the token in errors', async () => {
    const envName = 'MONAD_MCP_CLIENT_STATIC_BEARER';
    const previous = process.env[envName];
    const token = 'static-client-token';
    try {
      process.env[envName] = token;
      const auths: Array<string | undefined> = [];
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async (_url, init) => {
          auths.push(init.headers.authorization);
          throw new Error('connect refused');
        },
      });
      await expect(client.start()).rejects.not.toThrow(token);
      expect(auths).toEqual([`Bearer ${token}`]);

      process.env[envName] = '   ';
      const blankAuths: Array<string | undefined> = [];
      const blankClient = new McpClient({
        id: 'http',
        url: MCP_URL,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async (_url, init) => {
          blankAuths.push(init.headers.authorization);
          throw new Error('connect refused');
        },
      });
      await expect(blankClient.start()).rejects.toThrow('address unreachable');
      expect(blankAuths).toEqual([undefined]);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  // ⛔ 정적 베어러 서버가 401 을 «계속» 돌려줄 때 무한 재시도로 가지 않는가.
  //    정상 전송만 검증하면 이 축은 영영 안 눌린다(리뷰 지적 · #18564).
  test('a static-bearer server answering 401 forever stops after a bounded number of requests', async () => {
    const envName = 'MONAD_MCP_CLIENT_401_BOUND';
    const previous = process.env[envName];
    try {
      process.env[envName] = 'static-401-token';
      let requests = 0;
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async () => {
          requests += 1;
          return {
            ok: false,
            status: 401,
            headers: { get: (n: string) => (n.toLowerCase() === 'www-authenticate' ? 'Bearer' : null) },
            text: async () => '',
            json: async () => ({}),
          } as unknown as Awaited<ReturnType<McpHttpFetch>>;
        },
      });
      await expect(client.start()).rejects.toThrow();
      // 상한을 «수»로 못 박는다 — 늘어나면 이 시험이 잡는다.
      expect(requests).toBeGreaterThan(0);
      expect(requests).toBeLessThanOrEqual(4);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  // ⛔ oauthConfiguredButUnavailable 의 «두 값»을 각각 못 박는다 — 하나만 보면
  //    「만료된 OAuth 를 정적 토큰이 덮은 것」과 「처음부터 정적 서버인 것」이 접힌다.
  test('oauthConfiguredButUnavailable distinguishes an expired OAuth server from a static-only one', async () => {
    const envName = 'MONAD_MCP_CLIENT_SRC_FLAG';
    const previous = process.env[envName];
    try {
      process.env[envName] = 'flag-probe-token';
      const fetch = async () => {
        throw new Error('connect refused');
      };

      // ⓐ OAuth 가 «설정된 적 없다» → false
      const staticOnly = new McpClient({
        id: 'http', url: MCP_URL, bearerTokenEnv: envName, reconnectBackoffMs: [], fetch,
      });
      await expect(staticOnly.start()).rejects.toThrow();
      expect(staticOnly.bearerSource).toEqual({
        kind: 'static', envName, oauthConfiguredButUnavailable: false,
      });

      // ⓑ OAuth 가 «설정돼 있는데» 유효 토큰이 없어 정적으로 떨어졌다 → true
      const withOauth = new McpClient({
        id: 'http', url: MCP_URL, bearerTokenEnv: envName, reconnectBackoffMs: [], fetch,
        oauthIssuer: 'https://issuer.example/never-stored',
      });
      await expect(withOauth.start()).rejects.toThrow();
      expect(withOauth.bearerSource).toEqual({
        kind: 'static', envName, oauthConfiguredButUnavailable: true,
      });

      // ⛔ 두 값이 «같지 않다» — 접히면 이 단언이 잡는다
      expect(staticOnly.bearerSource).not.toEqual(withOauth.bearerSource);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  // ⭐ 자격 «출처»가 밖에서 보이나 — 토큰 «값»은 절대 실리지 않는다.
  test('bearerSource reports the static env-var NAME and never the token value', async () => {
    const envName = 'MONAD_MCP_CLIENT_SOURCE_PROBE';
    const previous = process.env[envName];
    const token = 'source-probe-secret';
    try {
      process.env[envName] = token;
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async () => {
          throw new Error('connect refused');
        },
      });
      expect(client.bearerSource).toEqual({ kind: 'none' });
      await expect(client.start()).rejects.toThrow();
      const src = client.bearerSource;
      expect(src.kind).toBe('static');
      expect(JSON.stringify(src)).toContain(envName);
      expect(JSON.stringify(src)).not.toContain(token);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('OAuth issuer falls back to static bearer when no valid OAuth token exists', async () => {
    const envName = 'MONAD_MCP_CLIENT_OAUTH_NULL_BEARER';
    const previous = process.env[envName];
    try {
      process.env[envName] = 'static-after-oauth-null';
      const auths: Array<string | undefined> = [];
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        oauthIssuer: ISSUER,
        oauthStorePath: storePath,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async (_url, init) => {
          auths.push(init.headers.authorization);
          throw new Error('connect refused');
        },
      });
      await expect(client.start()).rejects.toThrow('address unreachable');
      expect(auths).toEqual(['Bearer static-after-oauth-null']);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('missing static bearer environment omits Authorization when OAuth yields no token', async () => {
    const envName = 'MONAD_MCP_CLIENT_MISSING_BEARER';
    const previous = process.env[envName];
    try {
      delete process.env[envName];
      const auths: Array<string | undefined> = [];
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        oauthIssuer: ISSUER,
        oauthStorePath: storePath,
        bearerTokenEnv: envName,
        reconnectBackoffMs: [],
        fetch: async (_url, init) => {
          auths.push(init.headers.authorization);
          throw new Error('connect refused');
        },
      });
      await expect(client.start()).rejects.toThrow('address unreachable');
      expect(auths).toEqual([undefined]);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('OAuth bearer takes precedence over a configured static bearer environment fallback', async () => {
    const envName = 'MONAD_MCP_CLIENT_PREFERRED_BEARER';
    const previous = process.env[envName];
    try {
      process.env[envName] = 'static-client-token';
      saveTokens(
        ISSUER,
        { accessToken: 'oauth-client-token', refreshToken: '', expiresAt: Date.now() + 3600_000, tokenType: 'Bearer' },
        { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
        storePath,
      );
      const auths: Array<string | undefined> = [];
      const client = new McpClient({
        id: 'http',
        url: MCP_URL,
        bearerTokenEnv: envName,
        oauthIssuer: ISSUER,
        oauthStorePath: storePath,
        reconnectBackoffMs: [],
        fetch: async (_url, init) => {
          auths.push(init.headers.authorization);
          throw new Error('connect refused');
        },
      });
      await expect(client.start()).rejects.toThrow('address unreachable');
      expect(auths).toEqual(['Bearer oauth-client-token']);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  test('unreachable does not hit the token endpoint and does not delete credentials', async () => {
    saveTokens(
      ISSUER,
      {
        accessToken: 'keep-access',
        refreshToken: 'keep-refresh',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { authMode: 'mcp-oauth', accountUuid: 'client-1', mirrorCodex: false },
      storePath,
    );
    const oauthRecorded: Array<{ url: string }> = [];
    const fetch: McpHttpFetch = async () => {
      throw new Error('connect EHOSTUNREACH');
    };
    const client = new McpClient({
      id: 'http',
      url: 'http://192.0.2.1/mcp',
      fetch,
      reconnectBackoffMs: [],
      oauthIssuer: ISSUER,
      oauthTokenEndpoint: TOKEN,
      oauthStorePath: storePath,
      oauthFetch: async (url) => {
        oauthRecorded.push({ url });
        throw new Error('oauth fetch must not run');
      },
    });
    await expect(client.start()).rejects.toMatchObject({ reason: 'unreachable' });
    expect(oauthRecorded.filter((r) => r.url === TOKEN)).toHaveLength(0);
    expect(loadTokens(ISSUER, storePath)?.tokens.accessToken).toBe('keep-access');
    expect(loadTokens(ISSUER, storePath)?.tokens.refreshToken).toBe('keep-refresh');
  });

  // ── 리뷰 must-fix ①⑤ 회귀 (사람이 인수해 메움) ──
  //
  // ⛔ 골의 수용 기준은 「S256 미지원이면 «이유를 붙여» 실패」였다. 단위 함수는
  //    그것을 지켰는데 ***클라이언트 흐름에서 그 이유가 사라졌다*** —
  //    `tryRecoverAuth` 의 `catch` 가 삼켰기 때문이다. 단위 시험만 있으면
  //    이 회귀가 조용히 지나간다. 그래서 «클라이언트 밖으로 나온 오류»를 센다.
  test('⭐⭐ S256 미지원의 «이유»가 호출자까지 온다 — auth-required 로 뭉개지 않는다', async () => {
    const fetch: McpHttpFetch = async () => ({
      status: 401,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'www-authenticate'
            ? `Bearer resource_metadata="${RESOURCE_META}"`
            : n.toLowerCase() === 'content-type'
              ? 'application/json'
              : null,
      },
      text: async () => '',
      body: null,
    });
    const client = new McpClient({
      id: 'http',
      url: MCP_URL,
      fetch,
      reconnectBackoffMs: [],
      oauthStorePath: storePath,
      authorize: async () => {
        throw new Error('authorize must not be reached when S256 is unsupported');
      },
      oauthFetch: async (url) => {
        if (url === RESOURCE_META) {
          return oauthJson(200, { resource: MCP_URL, authorization_servers: [AS] });
        }
        if (url === AS_META) {
          // 상대가 S256 을 «안» 지원한다고 답한다. ⚠️ 등록 종점은 «주어야» 한다 —
          // 없으면 그 «앞»의 등록 단계에서 먼저 걸려 S256 경로에 닿지 않는다.
          return oauthJson(200, {
            issuer: ISSUER,
            authorization_endpoint: AUTHORIZE,
            token_endpoint: TOKEN,
            registration_endpoint: REGISTER,
            code_challenge_methods_supported: ['plain'],
          });
        }
        if (url === REGISTER) return oauthJson(201, { client_id: 'client-1' });
        throw new Error(`unexpected oauth url ${url}`);
      },
    });
    let caught: unknown;
    try {
      await client.start();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpConnectionError);
    const conn = caught as McpConnectionError;
    expect(conn.reason).toBe('auth-required');
    // ⛔ 이 줄이 must-fix 를 «직접» 센다 — 이유가 없으면 여기서 깨진다.
    expect(conn.message).toContain('s256-unsupported');
    await client.dispose();
  });
});
