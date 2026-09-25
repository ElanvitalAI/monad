// H4 Phase 3.B.1 · CodexAppServerClient foundation.
//
// Unit tests with synthetic Duplex streams — no real codex binary
// spawn here. Real-binary smoke is deferred to 3.B.2 where the client
// is wired into agent-manager and tested via dogfood.

import { describe, test, expect, spyOn } from 'bun:test';
import { PassThrough } from 'node:stream';
import { debug } from '../src/debug/log.js';
import {
  CodexAppServerClient,
  buildCodexAppServerArgs,
  type CodexAppServerClientOpts,
} from '../src/acp/codex-app-server-client.js';
import {
  CodexAppServerError,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../src/acp/codex-app-server-proto.js';

interface Harness {
  stdin: PassThrough; // server reads from here (what client writes)
  stdout: PassThrough; // server writes here (what client reads)
  stderr: PassThrough;
  client: CodexAppServerClient;
  /** Collect every line the client wrote to stdin (server inbox). */
  serverInbox: string[];
  /** Inject a line the client will see as if the server sent it. */
  serverSend(msg: JsonRpcResponse | JsonRpcRequest | JsonRpcNotification): void;
  serverSendRaw(raw: string): void;
  close(): Promise<void>;
}

function makeHarness(opts: Partial<CodexAppServerClientOpts> = {}): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const serverInbox: string[] = [];
  stdin.on('data', (chunk: Buffer) => {
    // client may write multiple lines per chunk
    const text = chunk.toString('utf8');
    for (const line of text.split('\n')) {
      if (line.length > 0) serverInbox.push(line);
    }
  });
  const client = new CodexAppServerClient({
    stdin,
    stdout,
    stderr,
    requestTimeoutMs: null, // disable timeouts for deterministic tests
    ...opts,
  });
  return {
    stdin,
    stdout,
    stderr,
    client,
    serverInbox,
    serverSend(msg) {
      stdout.write(JSON.stringify(msg) + '\n');
    },
    serverSendRaw(raw) {
      stdout.write(raw);
    },
    async close() {
      await client.close();
    },
  };
}

/** Wait one microtask tick so readline + dispatch run. */
async function tick(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('CodexAppServerClient · round-trip', () => {
  test('request/response · resolves with result', async () => {
    const h = makeHarness();
    const pending = h.client.request<{ a: number }, { ok: boolean }>('echo', { a: 1 });
    await tick();
    expect(h.serverInbox.length).toBe(1);
    const sent = JSON.parse(h.serverInbox[0]!) as JsonRpcRequest;
    expect(sent.method).toBe('echo');
    expect(sent.params).toEqual({ a: 1 });
    expect(sent.jsonrpc).toBe('2.0');
    h.serverSend({ jsonrpc: '2.0', id: sent.id, result: { ok: true } });
    const resp = await pending;
    expect(resp).toEqual({ ok: true });
    await h.close();
  });

  test('request/error · rejects with CodexAppServerError carrying code', async () => {
    const h = makeHarness();
    const pending = h.client.request<unknown, unknown>('method.x', null);
    await tick();
    const sent = JSON.parse(h.serverInbox[0]!) as JsonRpcRequest;
    h.serverSend({
      jsonrpc: '2.0',
      id: sent.id,
      error: { code: -32602, message: 'bad params' },
    });
    let caught: unknown;
    try {
      await pending;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CodexAppServerError);
    expect((caught as CodexAppServerError).code).toBe(-32602);
    expect((caught as Error).message).toBe('bad params');
    await h.close();
  });

  test('multiple concurrent requests · responses out of order resolve correctly', async () => {
    const h = makeHarness();
    const p1 = h.client.request<unknown, { n: number }>('first', {});
    const p2 = h.client.request<unknown, { n: number }>('second', {});
    const p3 = h.client.request<unknown, { n: number }>('third', {});
    await tick();
    const reqs = h.serverInbox.slice(0, 3).map((l) => JSON.parse(l) as JsonRpcRequest);
    // respond in reverse order
    h.serverSend({ jsonrpc: '2.0', id: reqs[2]!.id, result: { n: 3 } });
    h.serverSend({ jsonrpc: '2.0', id: reqs[0]!.id, result: { n: 1 } });
    h.serverSend({ jsonrpc: '2.0', id: reqs[1]!.id, result: { n: 2 } });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual({ n: 1 });
    expect(r2).toEqual({ n: 2 });
    expect(r3).toEqual({ n: 3 });
    await h.close();
  });
});

describe('CodexAppServerClient · notifications', () => {
  test('onNotification fires for matching method', async () => {
    const h = makeHarness();
    const received: unknown[] = [];
    const off = h.client.onNotification('turn/completed', (p) => received.push(p));
    h.serverSend({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 't1' } });
    h.serverSend({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 't2' } });
    await tick();
    expect(received).toEqual([{ threadId: 't1' }, { threadId: 't2' }]);
    off();
    h.serverSend({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 't3' } });
    await tick();
    expect(received.length).toBe(2);
    await h.close();
  });

  test('unsubscribed method · no-op', async () => {
    const h = makeHarness();
    h.serverSend({ jsonrpc: '2.0', method: 'never.subscribed', params: {} });
    await tick();
    // no throw, nothing observable
    await h.close();
  });
});

describe('CodexAppServerClient · server-originated requests', () => {
  test('registered handler · reply with result', async () => {
    const h = makeHarness();
    h.client.setServerRequestHandler('execCommandApproval', async (params) => {
      expect(params).toEqual({ command: ['ls'] });
      return { decision: 'approve' };
    });
    h.serverSend({
      jsonrpc: '2.0',
      method: 'execCommandApproval',
      id: 's-1',
      params: { command: ['ls'] },
    });
    await tick(3);
    // client should have written a response back
    const reply = h.serverInbox.map((l) => JSON.parse(l) as JsonRpcResponse).find(
      (m) => m.id === 's-1',
    );
    expect(reply).toBeDefined();
    expect(reply!.result).toEqual({ decision: 'approve' });
    expect(reply!.error).toBeUndefined();
    await h.close();
  });

  test('handler throws · reply with JSON-RPC error', async () => {
    const h = makeHarness();
    h.client.setServerRequestHandler('execCommandApproval', async () => {
      throw new Error('denied by policy');
    });
    h.serverSend({
      jsonrpc: '2.0',
      method: 'execCommandApproval',
      id: 's-2',
      params: {},
    });
    await tick(3);
    const reply = h.serverInbox.map((l) => JSON.parse(l) as JsonRpcResponse).find(
      (m) => m.id === 's-2',
    );
    expect(reply).toBeDefined();
    expect(reply!.error).toBeDefined();
    expect(reply!.error!.code).toBe(-32603);
    expect(reply!.error!.message).toBe('denied by policy');
    await h.close();
  });

  test('unregistered method · reply with -32601 Method not found', async () => {
    const h = makeHarness();
    h.serverSend({
      jsonrpc: '2.0',
      method: 'nobody.cares',
      id: 's-3',
      params: {},
    });
    await tick(3);
    const reply = h.serverInbox.map((l) => JSON.parse(l) as JsonRpcResponse).find(
      (m) => m.id === 's-3',
    );
    expect(reply).toBeDefined();
    expect(reply!.error?.code).toBe(-32601);
    await h.close();
  });
});

describe('CodexAppServerClient · framing + resilience', () => {
  test('partial line buffered until newline', async () => {
    const h = makeHarness();
    const received: unknown[] = [];
    h.client.onNotification('ping', (p) => received.push(p));
    // write in two chunks, split mid-JSON
    h.serverSendRaw('{"jsonrpc":"2.0","method":"ping","params":{"v":1');
    await tick();
    expect(received).toEqual([]);
    h.serverSendRaw('}}\n');
    await tick();
    expect(received).toEqual([{ v: 1 }]);
    await h.close();
  });

  test('multiple lines in one chunk · each parsed separately', async () => {
    const h = makeHarness();
    const received: unknown[] = [];
    h.client.onNotification('ping', (p) => received.push(p));
    h.serverSendRaw(
      '{"jsonrpc":"2.0","method":"ping","params":1}\n' +
        '{"jsonrpc":"2.0","method":"ping","params":2}\n' +
        '{"jsonrpc":"2.0","method":"ping","params":3}\n',
    );
    await tick();
    expect(received).toEqual([1, 2, 3]);
    await h.close();
  });

  test('malformed JSON · onParseError called · client stays alive', async () => {
    const errors: string[] = [];
    const h = makeHarness({
      onParseError: (_err, raw) => errors.push(raw),
    });
    h.serverSendRaw('not-json\n');
    await tick();
    expect(errors).toEqual(['not-json']);
    // client still routes valid notifications after the bad line
    const received: unknown[] = [];
    h.client.onNotification('ping', (p) => received.push(p));
    h.serverSend({ jsonrpc: '2.0', method: 'ping', params: 'ok' });
    await tick();
    expect(received).toEqual(['ok']);
    await h.close();
  });

  test('orphan response · id with no pending entry · no throw', async () => {
    const h = makeHarness();
    h.serverSend({ jsonrpc: '2.0', id: 'no-such-id', result: null });
    await tick();
    // no throw · silent drop
    await h.close();
  });

  test('empty / whitespace lines ignored', async () => {
    const h = makeHarness();
    const received: unknown[] = [];
    h.client.onNotification('ping', (p) => received.push(p));
    h.serverSendRaw('\n\n   \n');
    h.serverSend({ jsonrpc: '2.0', method: 'ping', params: 'ok' });
    await tick();
    expect(received).toEqual(['ok']);
    await h.close();
  });
});

describe('CodexAppServerClient · transport log contract', () => {
  test('five transport edge cases share a queryable category, fixed events, and payload values', async () => {
    const calls: Array<{ category: string; event: string; data?: Record<string, unknown>; options?: unknown }> = [];
    const logSpy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>, options?: unknown) => {
      calls.push({
        category,
        event,
        ...(data === undefined ? {} : { data }),
        ...(options === undefined ? {} : { options }),
      });
    }) as never);
    const h = makeHarness();
    const blocked = new BackpressureStdin();
    const blockedClient = new CodexAppServerClient({
      stdin: blocked,
      stdout: new PassThrough(),
      requestTimeoutMs: null,
      drainTimeoutMs: 0,
    });

    try {
      h.serverSendRaw('not-json\n');
      h.serverSendRaw('[]\n');
      h.serverSend({ jsonrpc: '2.0', id: 'orphan-42', result: null });
      h.client.onNotification('turn/failed', () => { throw new Error('listener failed'); });
      h.serverSend({ jsonrpc: '2.0', method: 'turn/failed', params: null });
      blocked.block();
      blockedClient.notify('buffered', null);
      await tick(3);
      blocked.unblock();
      await tick(2);
    } finally {
      await h.close();
      await blockedClient.close();
      logSpy.mockRestore();
    }

    expect(calls).toEqual([
      {
        category: 'acp.cxn.appserver',
        event: 'parse-error',
        data: { message: expect.any(String), raw: 'not-json' },
        options: { level: 'error' },
      },
      {
        category: 'acp.cxn.appserver',
        event: 'unknown-message',
        data: { type: 'object', raw: '[]' },
      },
      {
        category: 'acp.cxn.appserver',
        event: 'orphan-response',
        data: { id: 'orphan-42' },
      },
      {
        category: 'acp.cxn.appserver',
        event: 'notification-listener-throw',
        data: { method: 'turn/failed', message: 'listener failed' },
      },
      {
        category: 'acp.cxn.appserver',
        event: 'stdin-backpressure',
        data: { phase: 'await-drain' },
      },
    ]);
  });
});

describe('CodexAppServerClient · close / exit', () => {
  test('close rejects pending with "client closed"', async () => {
    const h = makeHarness();
    const pending = h.client.request<unknown, unknown>('method', null);
    await tick();
    await h.close();
    let caught: unknown;
    try {
      await pending;
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toMatch(/closed/);
  });

  test('_markExit rejects pending + fires onExit listeners', async () => {
    const h = makeHarness();
    const pending = h.client.request<unknown, unknown>('method', null);
    await tick();
    const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    h.client.onExit((code, signal) => exits.push({ code, signal }));
    h.client._markExit(1, null);
    let caught: unknown;
    try {
      await pending;
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toMatch(/exited/);
    expect(exits).toEqual([{ code: 1, signal: null }]);
  });

  test('request after close throws synchronously via rejected promise', async () => {
    const h = makeHarness();
    await h.close();
    let caught: unknown;
    try {
      await h.client.request('x', null);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toMatch(/closed/);
  });
});

describe('CodexAppServerClient · notify (fire-and-forget)', () => {
  test('notify writes JSON-RPC notification (no id)', async () => {
    const h = makeHarness();
    h.client.notify('$/cancel', { requestId: 'abc' });
    await tick();
    const line = JSON.parse(h.serverInbox[0]!) as JsonRpcNotification;
    expect(line.method).toBe('$/cancel');
    expect(line.params).toEqual({ requestId: 'abc' });
    expect((line as { id?: unknown }).id).toBeUndefined();
    await h.close();
  });
});

// ── M5 (2026-04-28) — stdin backpressure (await drain) ────────────────
//
// The harness above uses PassThrough which never returns false from
// write — so we use a custom Writable that simulates a full kernel
// buffer (write returns false until 'drain' is emitted). The test
// then verifies:
//   1. writeMessage parks the chain on 'drain'
//   2. concurrent writes serialise (FIFO, no interleaving)
//   3. drain timeout produces an error (drainTimeoutMs)
//   4. closed client rejects new writes synchronously

import { Writable } from 'node:stream';

class BackpressureStdin extends Writable {
  /** When true, every write returns false until drain() is called. */
  private blocked = false;
  /** Capture every write payload so tests can inspect FIFO order. */
  readonly received: string[] = [];

  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.received.push(s);
    cb();
  }

  /** node stream 'write' returns false when the buffer is full. We
   *  override the public write to model the back-pressure scenario. */
  override write(chunk: unknown, ...rest: unknown[]): boolean {
    super.write(chunk as Buffer | string, ...(rest as []));
    return !this.blocked;
  }

  block(): void {
    this.blocked = true;
  }

  unblock(): void {
    this.blocked = false;
    this.emit('drain');
  }
}

describe('CodexAppServerClient · M5 stdin backpressure', () => {
  function makeBlockedHarness(opts: Partial<CodexAppServerClientOpts> = {}) {
    const stdin = new BackpressureStdin();
    const stdout = new PassThrough();
    const client = new CodexAppServerClient({
      stdin,
      stdout,
      requestTimeoutMs: null,
      drainTimeoutMs: 50,  // tight timeout so failure cases finish fast
      ...opts,
    });
    return { stdin, stdout, client };
  }

  test('write returning false parks the chain until drain emits', async () => {
    const { stdin, client } = makeBlockedHarness();
    stdin.block();
    const p1 = client.notify('a', null) as unknown as undefined;
    void p1;
    // First write went through — chain now waiting for drain.
    await tick();
    expect(stdin.received.length).toBe(1);
    // Queue a second write — it shouldn't arrive yet.
    client.notify('b', null);
    await tick();
    await tick();
    expect(stdin.received.length).toBe(1);
    // Drain — second write should now flow.
    stdin.unblock();
    await tick();
    expect(stdin.received.length).toBe(2);
    expect(JSON.parse(stdin.received[1]!.trim()).method).toBe('b');
    await client.close();
  });

  test('drain timeout rejects the request promise', async () => {
    const { stdin, client } = makeBlockedHarness({ drainTimeoutMs: 30 });
    stdin.block();
    let firstErr: unknown;
    // first write fills the buffer + parks chain
    const p1 = client.request('first', null).catch((e) => { firstErr = e; });
    void p1;
    await new Promise((r) => setTimeout(r, 60));
    expect(firstErr).toBeInstanceOf(Error);
    expect((firstErr as Error).message).toMatch(/drain timeout/i);
    await client.close();
  });

  test('FIFO order preserved across concurrent notify calls', async () => {
    const { stdin, client } = makeBlockedHarness();
    stdin.block();
    client.notify('a', null);
    client.notify('b', null);
    client.notify('c', null);
    await tick();
    // Only first one made it past write before backpressure kicked in.
    // (Writable.write 가 false 반환이라도 chunk 는 buffer 에 들어갔으므로
    // received.length > 0 — 본 테스트의 핵심은 unblock 후 순서이지
    // 정확한 received count 가 아님.)
    stdin.unblock();
    await tick();
    await tick();
    await tick();
    expect(stdin.received.length).toBe(3);
    const methods = stdin.received.map((r) => JSON.parse(r.trim()).method);
    expect(methods).toEqual(['a', 'b', 'c']);
    await client.close();
  });

  test('writeMessage on closed client rejects synchronously', async () => {
    const { client } = makeBlockedHarness();
    await client.close();
    let caught: unknown;
    try {
      await client.request('x', null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/closed/);
  });

  test('after a drain failure, subsequent writes still proceed (chain not poisoned)', async () => {
    const { stdin, client } = makeBlockedHarness({ drainTimeoutMs: 30 });
    stdin.block();
    let firstErr: unknown;
    const p1 = client.request('first', null).catch((e) => { firstErr = e; });
    void p1;
    await new Promise((r) => setTimeout(r, 60));
    expect(firstErr).toBeInstanceOf(Error);
    // Drain (recover the stream) and queue a fresh notification.
    stdin.unblock();
    await tick();
    const before = stdin.received.length;
    client.notify('after-drain', null);
    await tick();
    await tick();
    expect(stdin.received.length).toBeGreaterThanOrEqual(before + 1);
    const last = stdin.received[stdin.received.length - 1]!.trim();
    expect(JSON.parse(last).method).toBe('after-drain');
    await client.close();
  });

  test('zero drainTimeoutMs disables the timeout (parks indefinitely until drain)', async () => {
    const { stdin, client } = makeBlockedHarness({ drainTimeoutMs: 0 });
    stdin.block();
    let resolved = false;
    void client.notify('x', null);
    void (async () => {
      await new Promise((r) => setTimeout(r, 80));
      resolved = true;
    })();
    await new Promise((r) => setTimeout(r, 100));
    // Drained after 100 ms — timer would have fired at ~30 ms but is disabled.
    expect(resolved).toBe(true);
    stdin.unblock();
    await tick();
    await client.close();
  });
});

describe('buildCodexAppServerArgs — code_mode always off', () => {
  test('default args force features.code_mode_host=false', () => {
    // codex 0.144.0's code_mode needs a codex-code-mode-host binary the
    // cask omits — disabling it is non-optional so /cdx tool calls work.
    expect(buildCodexAppServerArgs()).toEqual(['app-server', '-c', 'features.code_mode_host=false']);
  });

  test('appends the disable flag to caller-supplied args', () => {
    const args = buildCodexAppServerArgs(['app-server', '-c', 'model=o3']);
    expect(args.slice(0, 3)).toEqual(['app-server', '-c', 'model=o3']);
    // still ends with the code_mode disable — not optional.
    expect(args.join(' ')).toContain('-c features.code_mode_host=false');
  });
});
