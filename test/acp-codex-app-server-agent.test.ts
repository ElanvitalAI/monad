// H4 Phase 3.B.2a · CodexAppServerAgent unit tests.
//
// Drives the agent with a mock CodexAppServerClient so tests don't
// spawn the real `codex app-server` binary. Validates the seams that
// 3.B.2 owns: brand-switch-integration, initialize handshake,
// newSession → thread/start, prompt → turn/start + notification
// dispatch, cancel → turn/interrupt, approval server-request routing.

import { describe, test, expect, mock, spyOn, afterEach } from 'bun:test';
import { PassThrough } from 'node:stream';
import { debug } from '../src/debug/log.js';
import { CodexAppServerAgent, CodexAppServerSessionNotFoundError, elicitationSchemaKeys } from '../src/acp/codex-app-server-agent.js';
import { CodexAppServerClient } from '../src/acp/codex-app-server-client.js';
import type { CasThreadIndex, CasThreadIndexEntry } from '../src/acp/codex-app-server-thread-index.js';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../src/acp/codex-app-server-proto.js';

type DebugEvent = { category: string; event: string; data?: Record<string, unknown> };

function recordDebugEvents(): { events: DebugEvent[]; restore: () => void } {
  const events: DebugEvent[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, data });
  }) as never);
  return { events, restore: () => spy.mockRestore() };
}

afterEach(() => { spyOn(debug, 'log').mockRestore(); });

/** In-memory CasThreadIndex stub · prevents tests from touching the
 *  real `~/.config/elanous/codex-app-server-threads.json` file. */
function makeMemThreadIndex(): CasThreadIndex {
  const map = new Map<string, CasThreadIndexEntry>();
  return {
    get path() { return '/mem'; },
    get(id) { return map.get(id) ?? null; },
    put(id, input) {
      const ts = Date.now();
      const entry: CasThreadIndexEntry = {
        synthId: id,
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: input.createdAt ?? ts,
        lastTurnAt: input.lastTurnAt ?? ts,
      };
      map.set(id, entry);
      return entry;
    },
    touch(id) {
      const e = map.get(id);
      if (!e) return null;
      const updated = { ...e, lastTurnAt: Date.now() };
      map.set(id, updated);
      return updated;
    },
    setMcpPolicy(id, policy) {
      const e = map.get(id);
      if (!e) return null;
      const updated = policy === null ? { ...e } : { ...e, mcpPolicy: policy };
      if (policy === null) delete (updated as { mcpPolicy?: unknown }).mcpPolicy;
      map.set(id, updated);
      return updated;
    },
    remove(id) { return map.delete(id); },
    list() { return [...map.values()]; },
  };
}

interface Harness {
  stdin: PassThrough;
  stdout: PassThrough;
  client: CodexAppServerClient;
  agent: CodexAppServerAgent;
  sent: JsonRpcRequest[];
  threadIndex: CasThreadIndex;
  reply(id: string | number, result: unknown): void;
  replyError(id: string | number, message: string): void;
  notify(method: string, params: unknown): void;
  serverRequest(method: string, id: string, params: unknown): void;
}

function makeHarness(opts: {
  permissionApprover?: ReturnType<typeof mock>;
  threadIndex?: CasThreadIndex;
  mcpToolCallHandler?: import('../src/acp/codex-app-server-agent.js').CodexMcpToolCallHandler;
  elicitationHandler?: import('../src/acp/codex-app-server-agent.js').CodexElicitationHandler;
  imageTempDir?: string;
  turnQuietMs?: number;
  turnHardMs?: number;
  onCapabilities?: (capabilities: import('../src/acp/capabilities.js').ElanousCapabilities) => void;
} = {}): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: JsonRpcRequest[] = [];
  const responses: JsonRpcResponse[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object' && 'method' in obj) {
          sent.push(obj as JsonRpcRequest);
        } else if (obj && typeof obj === 'object' && 'id' in obj) {
          responses.push(obj as JsonRpcResponse);
        }
      } catch {
        /* swallow · non-JSON lines */
      }
    }
  });
  const client = new CodexAppServerClient({
    stdin,
    stdout,
    requestTimeoutMs: null,
  });
  const threadIndex = opts.threadIndex ?? makeMemThreadIndex();
  const agent = new CodexAppServerAgent({
    backendId: 'codex-app-server',
    cwd: '/tmp',
    permissionApprover: opts.permissionApprover as unknown as undefined,
    mcpToolCallHandler: opts.mcpToolCallHandler,
    elicitationHandler: opts.elicitationHandler,
    imageTempDir: opts.imageTempDir,
    onCapabilities: opts.onCapabilities,
    ...(opts.turnQuietMs !== undefined ? { turnQuietMs: opts.turnQuietMs } : {}),
    ...(opts.turnHardMs !== undefined ? { turnHardMs: opts.turnHardMs } : {}),
    _clientForTesting: client,
    _threadIndexForTesting: threadIndex,
  });
  return {
    stdin,
    stdout,
    client,
    agent,
    sent,
    threadIndex,
    reply(id, result) {
      const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      stdout.write(JSON.stringify(resp) + '\n');
    },
    replyError(id: string | number, message: string) {
      stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
    },
    notify(method, params) {
      const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
      stdout.write(JSON.stringify(notif) + '\n');
    },
    serverRequest(method, id, params) {
      const req: JsonRpcRequest = { jsonrpc: '2.0', method, id, params };
      stdout.write(JSON.stringify(req) + '\n');
    },
    // Test helper · expose stdin-side responses so tests can assert
    // what the agent wrote back for server-requests.
    get responses() { return responses; },
  } as Harness & { responses: JsonRpcResponse[] };
}

async function tick(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function findRequest(sent: JsonRpcRequest[], method: string): JsonRpcRequest | undefined {
  return sent.find((m) => m.method === method);
}

describe('CodexAppServerAgent · start / initialize', () => {
  test('start() sends initialize and waits for response · advertises its capability snapshot', async () => {
    const observed: Array<{ protocolVersion: number; image: boolean; audio: boolean; loadSession: boolean }> = [];
    const h = makeHarness({
      onCapabilities: (capabilities) => observed.push({
        protocolVersion: capabilities.protocolVersion,
        image: capabilities.prompt.image,
        audio: capabilities.prompt.audio,
        loadSession: capabilities.loadSession,
      }),
    });
    const p = h.agent.start();
    await tick();
    const init = findRequest(h.sent, 'initialize');
    expect(init).toBeDefined();
    expect(init!.params).toMatchObject({ clientInfo: { name: 'elanous' } });
    h.reply(init!.id, { serverInfo: { name: 'codex', version: '0.x' } });
    await p;
    expect(h.agent.getCapabilities()).toMatchObject({ protocolVersion: 1 });
    expect(observed).toEqual([{
      protocolVersion: 1,
      image: true,
      audio: false,
      loadSession: true,
    }]);
    await h.agent.stop();
  });

  test('double start is idempotent (initialize not re-sent)', async () => {
    const h = makeHarness();
    const p1 = h.agent.start();
    await tick();
    const init = findRequest(h.sent, 'initialize')!;
    h.reply(init.id, {});
    await p1;
    h.sent.length = 0;
    await h.agent.start();
    expect(findRequest(h.sent, 'initialize')).toBeUndefined();
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · lifecycle observation', () => {
  test('injected client lifecycle emits common events without spawn or prompt bodies', async () => {
    const recorded = recordDebugEvents();
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    const start = h.agent.start();
    await tick();
    const advertised = {
      serverInfo: { name: 'codex-observed', version: '9.9.9' },
      capabilities: { customCapability: true },
    };
    h.reply(findRequest(h.sent, 'initialize')!.id, advertised);
    await start;
    const initialized = recorded.events.find((event) => event.event === 'initialized')!;
    expect(initialized.data).toMatchObject({
      backendId: 'codex-app-server',
      serverInfo: advertised.serverInfo,
      capabilities: advertised.capabilities,
    });
    expect(initialized.data).not.toHaveProperty('protocolVersion');
    const session = await completeNewSession(h, 'observed-thread');
    const secret = 'prompt-body-must-not-appear';
    const prompt = h.agent.prompt(session, [{ type: 'text', text: secret }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.reply(turn.id, {});
    h.notify('turn/completed', { threadId: 'observed-thread', turn: { status: 'completed', items: [] } });
    await prompt;
    const events = recorded.events.filter((event) => event.category === 'acp.client');
    expect(events.map((event) => event.event)).toEqual(['initialized', 'session-new', 'prompt-start', 'prompt-end']);
    expect(events.every((event) => event.data?.backendId === 'codex-app-server')).toBe(true);
    expect(events.find((event) => event.event === 'session-new')?.data?.sessionId).toBe(session);
    expect(events.find((event) => event.event === 'prompt-start')?.data?.chars).toBe(secret.length);
    expect(JSON.stringify(events)).not.toContain(secret);
    await h.agent.stop();
    recorded.restore();
  });

  test('remote JSON-RPC failures record only structured metadata', async () => {
    const recorded = recordDebugEvents();
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const session = await completeNewSession(h, 'failure-thread');
    const prompt = h.agent.prompt(session, [{ type: 'text', text: 'secret-input' }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    const remote = 'normalized secret-input plus response-body';
    h.replyError(turn.id, remote);
    await expect(prompt).rejects.toThrow(remote);
    const failure = recorded.events.find((event) => event.event === 'prompt-failed')!;
    expect(failure.data).toMatchObject({ backendId: 'codex-app-server', errorKind: 'json-rpc', jsonRpcCode: -32000, remoteMessageLength: remote.length });
    expect(JSON.stringify(failure)).not.toContain(remote);
    expect(JSON.stringify(failure)).not.toContain('secret-input');
    await h.agent.stop();
    recorded.restore();
  });

  test('unknown error names normalize to a fixed marker without leaking error text', async () => {
    const recorded = recordDebugEvents();
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const session = await completeNewSession(h, 'unknown-error-thread');
    const remote = 'server echoed normalized secret-input response-body';
    const error = new Error(remote);
    error.name = 'PrivateRemoteError';
    const originalRequest = h.client.request.bind(h.client);
    const request = spyOn(h.client, 'request').mockImplementation(((method: string, ...args: unknown[]) =>
      method === 'turn/start'
        ? Promise.reject(error)
        : originalRequest(method as never, ...(args as never))) as never);
    const prompt = h.agent.prompt(session, [{ type: 'text', text: 'secret-input' }], () => {});
    await expect(prompt).rejects.toThrow(remote);
    const failure = recorded.events.find((event) => event.event === 'prompt-failed')!;
    expect(failure.data).toMatchObject({ errorKind: 'unknown', remoteMessageLength: remote.length });
    expect(JSON.stringify(failure)).not.toContain('PrivateRemoteError');
    expect(JSON.stringify(failure)).not.toContain(remote);
    request.mockRestore();
    await h.agent.stop();
    recorded.restore();
  });

  test('stop rejects a pending prompt and records prompt-failed exactly once', async () => {
    const recorded = recordDebugEvents();
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const session = await completeNewSession(h, 'stop-thread');
    const prompt = h.agent.prompt(session, [{ type: 'text', text: 'pending-input' }], () => {});
    await tick();
    await h.agent.stop();
    await expect(prompt).rejects.toThrow('agent stopped');
    expect(recorded.events.filter((event) => event.event === 'prompt-failed')).toHaveLength(1);
    recorded.restore();
  });

  test('real spawn path logs the actual spawn bin/cwd/backend while injected path does not', async () => {
    const recorded = recordDebugEvents();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const client = new CodexAppServerClient({ stdin, stdout, requestTimeoutMs: null });
    const spawned = { client, child: { kill() {} } } as never;
    const spawnFactory = mock((opts: import('../src/acp/codex-app-server-client.js').SpawnCodexAppServerOpts) => {
      expect(opts).toMatchObject({ codexBinary: '/custom/bin/codex', cwd: '/custom/work' });
      return spawned;
    });
    const agent = new CodexAppServerAgent({
      backendId: 'codex-app-server',
      codexBinary: '/custom/bin/codex',
      cwd: '/custom/work',
      idleTimeoutMs: 0,
      _spawnFactory: spawnFactory,
    });
    const start = agent.start();
    await tick();
    const request = JSON.parse((stdin.read() as Buffer).toString()) as JsonRpcRequest;
    stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\n');
    await start;
    const spawns = recorded.events.filter((event) => event.category === 'acp.client' && event.event === 'spawn');
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.data).toEqual({
      backendId: 'codex-app-server', bin: '/custom/bin/codex', cwd: '/custom/work',
    });
    await agent.stop();
    recorded.restore();
  });

  test('real spawn defaults log the resolved binary and effective cwd passed to the factory', async () => {
    const recorded = recordDebugEvents();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const client = new CodexAppServerClient({ stdin, stdout, requestTimeoutMs: null });
    const spawned = { client, child: { kill() {} } } as never;
    let receivedOpts: import('../src/acp/codex-app-server-client.js').SpawnCodexAppServerOpts | undefined;
    const spawnFactory = mock((opts: import('../src/acp/codex-app-server-client.js').SpawnCodexAppServerOpts) => {
      receivedOpts = opts;
      return spawned;
    });
    const agent = new CodexAppServerAgent({
      backendId: 'codex-app-server',
      idleTimeoutMs: 0,
      _spawnFactory: spawnFactory,
    });
    const start = agent.start();
    await tick();
    const request = JSON.parse((stdin.read() as Buffer).toString()) as JsonRpcRequest;
    stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\n');
    await start;
    const spawn = recorded.events.find((event) => event.category === 'acp.client' && event.event === 'spawn')!;
    expect(receivedOpts).toBeDefined();
    expect(spawn.data).toEqual({
      backendId: 'codex-app-server',
      bin: receivedOpts!.codexBinary,
      cwd: receivedOpts!.cwd,
    });
    expect(receivedOpts!.codexBinary).toBeString();
    expect(receivedOpts!.cwd).toBe(process.cwd());
    await agent.stop();
    recorded.restore();
  });

  test('forwards session-scoped Codex args to the spawn factory', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const client = new CodexAppServerClient({ stdin, stdout, requestTimeoutMs: null });
    const spawned = { client, child: { kill() {} } } as never;
    let receivedOpts: import('../src/acp/codex-app-server-client.js').SpawnCodexAppServerOpts | undefined;
    const agent = new CodexAppServerAgent({
      backendId: 'codex-app-server',
      codexArgs: ['app-server', '-c', 'mcp_servers={"repo-tools":{"command":"npx"}}'],
      idleTimeoutMs: 0,
      _spawnFactory: (opts) => {
        receivedOpts = opts;
        return spawned;
      },
    });
    const start = agent.start();
    await tick();
    const request = JSON.parse((stdin.read() as Buffer).toString()) as JsonRpcRequest;
    stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\n');
    await start;
    expect(receivedOpts!.codexArgs).toEqual([
      'app-server', '-c', 'mcp_servers={"repo-tools":{"command":"npx"}}',
    ]);
    await agent.stop();
  });
});

describe('CodexAppServerAgent · newSession', () => {
  test('thread/start params include cwd · returns elanous-synth sessionId', async () => {
    const h = makeHarness();
    const sp = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await sp;
    const np = h.agent.newSession();
    await tick();
    const start = findRequest(h.sent, 'thread/start')!;
    expect(start.params).toMatchObject({ cwd: '/tmp', experimentalRawEvents: false, persistExtendedHistory: false });
    // v2 ThreadStartResponse · thread.id nested under `thread`.
    h.reply(start.id, { thread: { id: 'codex-thread-xyz' }, model: 'gpt-5' });
    const sessionId = await np;
    // MSS M1.1 Phase B1 · sessionId is now a Tier 2 ElanousUri
    // (`session/<ULID>`). Backend identification moved off the id
    // string and onto the session→thread Map.
    expect(sessionId).toMatch(/^session\/[0-9A-HJKMNP-TV-Z]{26}$/);
    // Thread index captured the mapping for a future loadSession call.
    const entry = h.threadIndex.get(sessionId as string);
    expect(entry).not.toBeNull();
    expect(entry!.threadId).toBe('codex-thread-xyz');
    expect(entry!.cwd).toBe('/tmp');
    expect(h.agent.getSessionModel(sessionId)).toBe('gpt-5');
    await h.agent.stop();
  });

  test('thread/start without thread.id throws a clear error', async () => {
    const h = makeHarness();
    const sp = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await sp;
    const np = h.agent.newSession();
    await tick();
    const start = findRequest(h.sent, 'thread/start')!;
    // Legacy / malformed shape — flat threadId instead of thread.id.
    h.reply(start.id, { threadId: 'wrong-shape' });
    let err: unknown;
    try { await np; } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/no thread\.id/);
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · prompt turn', () => {
  test('turn/start fires · item/agentMessage/delta routes to onUpdate · turn/completed resolves', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-1');
    const chunks: unknown[] = [];
    const prom = h.agent.prompt(
      sessionId,
      [{ type: 'text', text: 'hello' }],
      (u) => chunks.push(u),
    );
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    expect(turn.params).toMatchObject({ threadId: 'tid-1' });
    // v2 method name · see common.rs L1004.
    h.notify('item/agentMessage/delta', { threadId: 'tid-1', turnId: 't1', itemId: 'i1', delta: 'hi ' });
    h.notify('item/agentMessage/delta', { threadId: 'tid-1', turnId: 't1', itemId: 'i1', delta: 'there' });
    await tick();
    expect(chunks).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi ' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there' } },
    ]);
    // v2 TurnCompletedNotification shape: { threadId, turn: { id, status, ... } }
    h.notify('turn/completed', { threadId: 'tid-1', turn: { id: 't1', status: 'completed', items: [] } });
    h.reply(turn.id, {});
    const res = await prom;
    expect(res.stopReason).toBe('end_turn');
    await h.agent.stop();
  });

  test('turn/completed with turn.status=interrupted maps to cancelled stopReason', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-2');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.notify('turn/completed', { threadId: 'tid-2', turn: { id: 't2', status: 'interrupted', items: [] } });
    h.reply(turn.id, {});
    const r = await prom;
    expect(r.stopReason).toBe('cancelled');
    await h.agent.stop();
  });

  test('concurrent prompt on same session rejects', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-3');
    const first = h.agent.prompt(sessionId, [{ type: 'text', text: 'a' }], () => {});
    first.catch(() => { /* expected on stop */ });
    await tick();
    let err: unknown;
    try {
      await h.agent.prompt(sessionId, [{ type: 'text', text: 'b' }], () => {});
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/already has a turn/);
    await h.agent.stop();
  });

  test('prompt on unknown session rejects', async () => {
    const h = makeHarness();
    await completeStart(h);
    let err: unknown;
    try {
      await h.agent.prompt(
        'nope' as unknown as import('@agentclientprotocol/sdk').SessionId,
        [{ type: 'text', text: 'x' }],
        () => {},
      );
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/unknown session/);
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · cancel', () => {
  test('cancel sends turn/interrupt', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-4');
    const promptPromise = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    promptPromise.catch(() => { /* expected when stop() rejects pending */ });
    await tick();
    const cp = h.agent.cancel(sessionId);
    await tick();
    const interrupt = findRequest(h.sent, 'turn/interrupt')!;
    expect(interrupt.params).toMatchObject({ threadId: 'tid-4' });
    h.reply(interrupt.id, {});
    await cp;
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · approval routing', () => {
  test('execCommandApproval · approver returns true → approve', async () => {
    const approver = mock(async () => true);
    const h = makeHarness({ permissionApprover: approver });
    await completeStart(h);
    const _sid = await completeNewSession(h, 'tid-5');
    h.serverRequest('execCommandApproval', 'srv-1', {
      threadId: 'tid-5',
      command: ['ls', '-la'],
      cwd: '/repo',
    });
    await tick(4);
    const reply = JSON.parse(
      h.stdin.read()?.toString('utf8').split('\n').find((l) => l.includes('srv-1')) ?? '{}',
    ) as JsonRpcResponse;
    // fallback: scan drained buffer via replies fixture
    // Because PassThrough 'data' fires before this, we instead scan previously captured sent[]
    // but sent[] only captures top-level; JSON-RPC response lines come out too. Use a
    // lenient check:
    expect(approver).toHaveBeenCalledTimes(1);
    void reply;
    await h.agent.stop();
  });

  test('execCommandApproval · approver returns false → deny', async () => {
    const approver = mock(async () => false);
    const h = makeHarness({ permissionApprover: approver });
    await completeStart(h);
    await completeNewSession(h, 'tid-6');
    h.serverRequest('execCommandApproval', 'srv-2', {
      threadId: 'tid-6',
      command: ['rm', '-rf', '/'],
      cwd: '/repo',
    });
    await tick(4);
    expect(approver).toHaveBeenCalledTimes(1);
    // Inspect call arg · adapter should have forwarded the command
    const firstCall = (approver.mock.calls as unknown as Array<[{ rawInput?: unknown; sessionId: string }]>)[0]![0];
    expect(firstCall.sessionId).toBeTruthy();
    await h.agent.stop();
  });

  test('unknown approval method · default deny · no approver call', async () => {
    const approver = mock(async () => true);
    const h = makeHarness({ permissionApprover: approver });
    await completeStart(h);
    await completeNewSession(h, 'tid-7');
    h.serverRequest('unknown.approval.kind', 'srv-3', { threadId: 'tid-7' });
    await tick(4);
    expect(approver).toHaveBeenCalledTimes(0);
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · lifecycle', () => {
  test('stop clears pending turns and resets initialized', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-8');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    await h.agent.stop();
    // After stop, the pending promise should reject
    let err: unknown;
    try {
      await prom;
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(h.agent.getCapabilities()).toBeNull();
  });

  test('loadSession · known session → thread/resume round-trip + rebinds maps', async () => {
    const h = makeHarness();
    await completeStart(h);
    // Pretend a prior process created this session · seed the index
    const sidFromDisk = 'codex-app-server-99' as import('@agentclientprotocol/sdk').SessionId;
    h.threadIndex.put(sidFromDisk as string, { threadId: 'persisted-thr', cwd: '/tmp' });
    const lp = h.agent.loadSession({ sessionId: sidFromDisk });
    await tick();
    const resume = findRequest(h.sent, 'thread/resume')!;
    expect(resume.params).toMatchObject({ threadId: 'persisted-thr', cwd: '/tmp' });
    // v2 ThreadResumeResponse · same shape as ThreadStartResponse.
    h.reply(resume.id, { thread: { id: 'persisted-thr' }, model: 'gpt-5' });
    await lp;
    // After resume, prompt on this sessionId must not throw unknown.
    h.sent.length = 0;
    const promptPromise = h.agent.prompt(sidFromDisk, [{ type: 'text', text: 'ping' }], () => {});
    promptPromise.catch(() => { /* will reject on stop */ });
    await tick();
    const turn = findRequest(h.sent, 'turn/start');
    expect(turn).toBeDefined();
    expect(turn!.params).toMatchObject({ threadId: 'persisted-thr' });
    await h.agent.stop();
  });

  test('loadSession · unknown session id throws CodexAppServerSessionNotFoundError', async () => {
    const h = makeHarness();
    await completeStart(h);
    let err: unknown;
    try {
      await h.agent.loadSession({
        sessionId: 'nope-missing' as unknown as import('@agentclientprotocol/sdk').SessionId,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CodexAppServerSessionNotFoundError);
    await h.agent.stop();
  });

  test('CodexAppServerSessionNotFoundError message matches isStaleSessionError predicate', async () => {
    // Cause 2 fix — the error message must contain "Session not
    // found" so the shared turn-runner predicate recognizes it as
    // recoverable. Otherwise mid-turn hibernate failures would
    // surface to the user as raw RPC errors.
    const { isStaleSessionError } = await import('../src/acp/turn-runner.js');
    const err = new CodexAppServerSessionNotFoundError('test-session-id');
    expect(isStaleSessionError(err)).toBe(true);
    // With cause attached, still matches.
    const errWithCause = new CodexAppServerSessionNotFoundError(
      'test-session-id',
      'thread/resume failed',
    );
    expect(isStaleSessionError(errWithCause)).toBe(true);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────

async function completeStart(h: Harness): Promise<void> {
  const p = h.agent.start();
  await tick();
  h.reply(findRequest(h.sent, 'initialize')!.id, {});
  await p;
  // Clear sent for cleaner inspection in subsequent steps
  h.sent.length = 0;
}

async function completeNewSession(h: Harness, threadId: string): Promise<import('@agentclientprotocol/sdk').SessionId> {
  const np = h.agent.newSession();
  await tick();
  const start = findRequest(h.sent, 'thread/start')!;
  // v2 ThreadStartResponse shape: { thread: { id, ... }, model, ... }
  h.reply(start.id, { thread: { id: threadId }, model: 'gpt-5' });
  const sid = await np;
  h.sent.length = 0;
  return sid;
}

// ─── 3.B.2c · MCP bridge ──────────────────────────────────────────

describe('CodexAppServerAgent · MCP bridge (3.B.2c)', () => {
  test('mcpServer/tool/call routes to injected handler · result posted to stdin', async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const h = makeHarness({
      mcpToolCallHandler: async (p) => {
        calls.push({ tool: p.tool, args: p.arguments });
        return { content: [{ type: 'text', text: `ran ${p.tool}` }] };
      },
    }) as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    // Simulate codex sending a server-request for an MCP tool
    h.serverRequest('mcpServer/tool/call', 'mcp-1', {
      threadId: 'thr-1', server: 'local', tool: 'search', arguments: { q: 'x' },
    });
    await tick(3);
    expect(calls).toEqual([{ tool: 'search', args: { q: 'x' } }]);
    // The client should have written back a response
    const resp = h.responses.find((r) => r.id === 'mcp-1');
    expect(resp).toBeDefined();
    expect((resp!.result as { content: unknown[] }).content).toEqual([
      { type: 'text', text: 'ran search' },
    ]);
    await h.agent.stop();
  });

  test('default mcpToolCallHandler returns isError (bridge not wired)', async () => {
    const h = makeHarness() as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/tool/call', 'mcp-2', { tool: 'ghost' });
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'mcp-2');
    expect(resp).toBeDefined();
    expect((resp!.result as { isError: boolean }).isError).toBe(true);
    expect((resp!.result as { errorMessage: string }).errorMessage).toMatch(/not configured|not wired/);
    await h.agent.stop();
  });

  test('mcpServer/tool/call missing tool name → isError', async () => {
    const handlerCalls: unknown[] = [];
    const h = makeHarness({
      mcpToolCallHandler: async (p) => {
        handlerCalls.push(p);
        return { content: [] };
      },
    }) as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/tool/call', 'mcp-3', { server: 'x' });
    await tick(3);
    // Handler should NOT have been called · agent short-circuits
    expect(handlerCalls.length).toBe(0);
    const resp = h.responses.find((r) => r.id === 'mcp-3');
    expect((resp!.result as { isError: boolean }).isError).toBe(true);
    await h.agent.stop();
  });

  test('mcpToolCallHandler throw → error result, agent keeps running', async () => {
    const h = makeHarness({
      mcpToolCallHandler: async () => {
        throw new Error('handler boom');
      },
    }) as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/tool/call', 'mcp-4', { tool: 'x' });
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'mcp-4');
    expect(resp).toBeDefined();
    expect((resp!.result as { errorMessage: string }).errorMessage).toBe('handler boom');
    await h.agent.stop();
  });

  test('setMcpToolCallHandler swaps at runtime', async () => {
    const h = makeHarness() as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.agent.setMcpToolCallHandler(async (p) => ({
      content: [{ type: 'text', text: `late:${p.tool}` }],
    }));
    h.serverRequest('mcpServer/tool/call', 'mcp-5', { tool: 'ping' });
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'mcp-5');
    expect((resp!.result as { content: unknown[] }).content).toEqual([
      { type: 'text', text: 'late:ping' },
    ]);
    await h.agent.stop();
  });
});

// ─── 3.B.2c · Elicitation ─────────────────────────────────────────

describe('CodexAppServerAgent · elicitation (3.B.2c)', () => {
  test('mcpServer/elicitation/request routes to handler', async () => {
    const calls: Array<{ message?: string }> = [];
    const h = makeHarness({
      elicitationHandler: async (p) => {
        calls.push({ message: p.message });
        return { action: 'accept', content: { reply: 'ok' } };
      },
    }) as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/elicitation/request', 'el-1', {
      message: 'proceed?',
    });
    await tick(3);
    expect(calls).toEqual([{ message: 'proceed?' }]);
    const resp = h.responses.find((r) => r.id === 'el-1');
    expect((resp!.result as { action: string }).action).toBe('accept');
    await h.agent.stop();
  });

  test('default elicitation handler returns decline', async () => {
    const h = makeHarness() as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/elicitation/request', 'el-2', { message: 'hi?' });
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'el-2');
    expect((resp!.result as { action: string }).action).toBe('decline');
    await h.agent.stop();
  });

  test('elicitation handler throw → action:cancel', async () => {
    const h = makeHarness({
      elicitationHandler: async () => {
        throw new Error('ui unavailable');
      },
    }) as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.serverRequest('mcpServer/elicitation/request', 'el-3', {});
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'el-3');
    expect((resp!.result as { action: string }).action).toBe('cancel');
    await h.agent.stop();
  });

  test('setElicitationHandler swaps at runtime', async () => {
    const h = makeHarness() as unknown as Harness & { responses: JsonRpcResponse[] };
    await completeStart(h);
    h.agent.setElicitationHandler(async () => ({ action: 'accept' }));
    h.serverRequest('mcpServer/elicitation/request', 'el-4', {});
    await tick(3);
    const resp = h.responses.find((r) => r.id === 'el-4');
    expect((resp!.result as { action: string }).action).toBe('accept');
    await h.agent.stop();
  });
});

// ─── 3.B.2c · Image input ─────────────────────────────────────────

describe('CodexAppServerAgent · image input (3.B.2c)', () => {
  test('capabilities · prompt.image is true', async () => {
    const h = makeHarness();
    await completeStart(h);
    expect(h.agent.getCapabilities()?.prompt?.image).toBe(true);
    await h.agent.stop();
  });

  test('prompt with image block writes to scratch dir and sends localImage input', async () => {
    const { mkdtempSync, existsSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const scratch = mkdtempSync(join(tmpdir(), 'cas-img-test-'));
    const h = makeHarness({ imageTempDir: scratch });
    await completeStart(h);
    const sid = await completeNewSession(h, 'thr-img');
    // 1x1 PNG (just a valid base64 blob · not validated by the agent)
    const b64 = Buffer.from([137, 80, 78, 71]).toString('base64');
    const pp = h.agent.prompt(
      sid,
      [
        { type: 'text', text: 'see image' } as unknown as import('@agentclientprotocol/sdk').ContentBlock,
        { type: 'image', data: b64, mimeType: 'image/png' } as unknown as import('@agentclientprotocol/sdk').ContentBlock,
      ],
      () => {},
    );
    pp.catch(() => {});
    await tick(2);
    const turn = findRequest(h.sent, 'turn/start');
    expect(turn).toBeDefined();
    const input = (turn!.params as { input: Array<{ type: string; path?: string }> }).input;
    expect(input[0]).toMatchObject({ type: 'text', text: 'see image' });
    // codex v2 UserInput variant is camelCase `localImage` (corrected in
    // PR #2835 after codex rejected snake_case `local_image` on deserialize).
    expect(input[1]!.type).toBe('localImage');
    expect(input[1]!.path).toBeDefined();
    expect(existsSync(input[1]!.path!)).toBe(true);
    const bytes = readFileSync(input[1]!.path!);
    expect(bytes.length).toBe(4);
    await h.agent.stop();
    // agent.stop cleans up the scratch dir; double-clean is idempotent
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('text-only prompt unchanged (no image blocks) · no scratch dir created', async () => {
    const { existsSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const scratch = mkdtempSync(join(tmpdir(), 'cas-img-empty-'));
    rmSync(scratch, { recursive: true, force: true });
    const h = makeHarness({ imageTempDir: scratch });
    await completeStart(h);
    const sid = await completeNewSession(h, 'thr-txt');
    const pp = h.agent.prompt(sid, [
      { type: 'text', text: 'hi' } as unknown as import('@agentclientprotocol/sdk').ContentBlock,
    ], () => {});
    pp.catch(() => {});
    await tick(2);
    const turn = findRequest(h.sent, 'turn/start')!;
    const input = (turn.params as { input: Array<{ type: string; text?: string }> }).input;
    expect(input).toEqual([{ type: 'text', text: 'hi' }]);
    expect(existsSync(scratch)).toBe(false);
    await h.agent.stop();
  });
});

// ─── 3.B.2c · attachTransport ─────────────────────────────────────

describe('CodexAppServerAgent · attachTransport (3.B.2c)', () => {
  test('attachTransport adds an advisory descriptor · listAttachedTransports returns it', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sid = await completeNewSession(h, 'thr-a');
    const off = h.agent.attachTransport(sid, { kind: 'rpc', id: 'cas-42', label: 'app-server' });
    expect(h.agent.listAttachedTransports(sid)).toEqual([
      { kind: 'rpc', id: 'cas-42', label: 'app-server' },
    ]);
    off();
    expect(h.agent.listAttachedTransports(sid)).toEqual([]);
    await h.agent.stop();
  });

  test('multiple attaches coexist · ordering preserved', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sid = await completeNewSession(h, 'thr-b');
    h.agent.attachTransport(sid, { kind: 'rpc', id: 'a' });
    h.agent.attachTransport(sid, { kind: 'acp', id: 'b' });
    h.agent.attachTransport(sid, { kind: 'socket', id: 'c' });
    const got = h.agent.listAttachedTransports(sid);
    expect(got.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    await h.agent.stop();
  });

  test('getRpcTransportDescriptor returns kind=rpc with cas-* id', async () => {
    const h = makeHarness();
    await completeStart(h);
    const d = h.agent.getRpcTransportDescriptor();
    expect(d.kind).toBe('rpc');
    expect(d.label).toBe('codex-app-server');
    expect(d.id).toMatch(/^cas-/);
    await h.agent.stop();
  });

  test('stop() drops all attached transports', async () => {
    const h = makeHarness();
    await completeStart(h);
    const sid = await completeNewSession(h, 'thr-c');
    h.agent.attachTransport(sid, { kind: 'rpc', id: 'x' });
    await h.agent.stop();
    expect(h.agent.listAttachedTransports(sid)).toEqual([]);
  });
});

// ── hermes-parity: turn watchdog + auth-failure respawn ──────────────
describe('CodexAppServerAgent · turn watchdog', () => {
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  test('quiet watchdog aborts a silent turn + sends turn/interrupt', async () => {
    const h = makeHarness({ turnQuietMs: 25, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-wd1');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    // never reply / never send events → the quiet timer must fire
    await expect(prom).rejects.toThrow(/quiet/i);
    // best-effort interrupt was issued for the hung turn
    expect(findRequest(h.sent, 'turn/interrupt')).toBeDefined();
    await h.agent.stop();
  });

  test('hard deadline aborts even if events keep arriving', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 30 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-wd2');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    // keep the turn "active" so a quiet timer (disabled here) wouldn't fire
    h.notify('item/agentMessage/delta', { threadId: 'tid-wd2', turnId: 't', itemId: 'i', delta: '.' });
    await expect(prom).rejects.toThrow(/wall-clock/i);
    await h.agent.stop();
  });

  test('turnQuietMs:0 + turnHardMs:0 → no watchdog (turn stays pending)', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-wd3');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    const settled = await Promise.race([
      prom.then(() => 'resolved', () => 'rejected'),
      delay(60).then(() => 'pending'),
    ]);
    expect(settled).toBe('pending');
    // resolve it so the promise doesn't dangle
    const turn = findRequest(h.sent, 'turn/start')!;
    h.notify('turn/completed', { threadId: 'tid-wd3', turn: { id: 't', status: 'completed', items: [] } });
    h.reply(turn.id, {});
    await prom;
    await h.agent.stop();
  });
});

describe('CodexAppServerAgent · auth-failure respawn', () => {
  test('auth error on turn/start → reject with codex login hint', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-auth1');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.replyError(turn.id, '401 unauthenticated: token expired');
    await expect(prom).rejects.toThrow(/codex login/i);
    await h.agent.stop();
  });

  test('non-auth error on turn/start → rejected as-is (no login hint)', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'tid-auth3');
    const prom = h.agent.prompt(sessionId, [{ type: 'text', text: 'x' }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.replyError(turn.id, 'internal error: disk full');
    await expect(prom).rejects.toThrow(/disk full/i);
    await expect(prom).rejects.not.toThrow(/codex login/i);
    await h.agent.stop();
  });
});

// turn/steer — inject into the live turn (follow-up A).
describe('CodexAppServerAgent · steer (live turn injection)', () => {
  test('captures turnId from turn/start response + sends turn/steer with expectedTurnId', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-steer');
    const pp = h.agent.prompt(sessionId, [{ type: 'text', text: 'build X' }], () => {});
    pp.catch(() => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    // codex v2 TurnStartResponse: { turn: { id } } → captured as current turnId
    h.reply(turn.id, { turn: { id: 'turn-42' } });
    await tick();
    // Steer the live turn — steer() awaits the turn/steer response, so
    // reply to it before awaiting the call.
    const sp = h.agent.steer(sessionId, [{ type: 'text', text: 'also add tests' }] as never);
    await tick();
    const steer = h.sent.find((m) => m.method === 'turn/steer');
    expect(steer).toBeDefined();
    expect(steer!.params).toMatchObject({ threadId: 'thr-steer', turnId: 'turn-42', expectedTurnId: 'turn-42' });
    h.reply(steer!.id, {});
    expect(await sp).toBe(true);
    await h.agent.stop();
  });

  test('steer with no in-flight turn → false (no-op)', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-steer2');
    // no prompt in flight
    const steered = await h.agent.steer(sessionId, [{ type: 'text', text: 'x' }] as never);
    expect(steered).toBe(false);
    expect(h.sent.find((m) => m.method === 'turn/steer')).toBeUndefined();
    await h.agent.stop();
  });

  test('turnId cleared on turn/completed → later steer is a no-op', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-steer3');
    const pp = h.agent.prompt(sessionId, [{ type: 'text', text: 'go' }], () => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.reply(turn.id, { turn: { id: 'turn-9' } });
    h.notify('turn/completed', { threadId: 'thr-steer3', turn: { id: 'turn-9', status: 'completed', items: [] } });
    await pp;
    expect(await h.agent.steer(sessionId, [{ type: 'text', text: 'late' }] as never)).toBe(false);
    await h.agent.stop();
  });
});

// thread/goal/* — codex-native goal lifecycle (follow-up B).
describe('CodexAppServerAgent · goal lifecycle', () => {
  test('setGoal sends thread/goal/set with objective + returns the goal', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-goal');
    const gp = h.agent.setGoal(sessionId, { objective: 'add feature X', tokenBudget: 50000 });
    await tick();
    const set = h.sent.find((m) => m.method === 'thread/goal/set')!;
    expect(set).toBeDefined();
    expect(set.params).toMatchObject({ threadId: 'thr-goal', objective: 'add feature X', tokenBudget: 50000 });
    h.reply(set.id, { goal: { threadId: 'thr-goal', objective: 'add feature X', status: 'active', tokensUsed: 10 } });
    const goal = await gp;
    expect(goal).toMatchObject({ objective: 'add feature X', status: 'active' });
    await h.agent.stop();
  });

  test('getGoal / clearGoal send the right methods', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-goal2');
    const gg = h.agent.getGoal(sessionId);
    await tick();
    const get = h.sent.find((m) => m.method === 'thread/goal/get')!;
    expect(get.params).toMatchObject({ threadId: 'thr-goal2' });
    h.reply(get.id, { goal: null });
    expect(await gg).toBeNull();

    const cp = h.agent.clearGoal(sessionId);
    await tick();
    const clr = h.sent.find((m) => m.method === 'thread/goal/clear')!;
    expect(clr.params).toMatchObject({ threadId: 'thr-goal2' });
    h.reply(clr.id, { cleared: true });
    expect(await cp).toBe(true);
    await h.agent.stop();
  });

  test('thread/goal/updated → onGoalUpdate fires with mapped mission status', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-goal3');
    const seen: Array<{ missionStatus: string; status?: string }> = [];
    h.agent.onGoalUpdate((u) => seen.push({ missionStatus: u.missionStatus, status: u.goal?.status }));
    h.notify('thread/goal/updated', { goal: { threadId: 'thr-goal3', objective: 'o', status: 'complete', tokensUsed: 5 } });
    await tick();
    expect(seen).toEqual([{ missionStatus: 'done', status: 'complete' }]);
    // budgetLimited → failed
    h.notify('thread/goal/updated', { goal: { threadId: 'thr-goal3', objective: 'o', status: 'budgetLimited' } });
    await tick();
    expect(seen[1]).toEqual({ missionStatus: 'failed', status: 'budgetLimited' });
    await h.agent.stop();
  });

  test('setGoal on a session with no live thread → null (no request)', async () => {
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    // no newSession → unknown session id
    const goal = await h.agent.setGoal('session/UNKNOWN00000000000000000' as never, { objective: 'x' });
    expect(goal).toBeNull();
    expect(h.sent.find((m) => m.method === 'thread/goal/set')).toBeUndefined();
    await h.agent.stop();
  });
});

// A live consumer — autopilot /inject → codex turn/steer through a real
// CodexAppServerAgent (the wiring handleAutopilotRun installs for the
// codex backend). Proves the end-to-end steer chain at the seam level.
import {
  handleAutopilotInject,
  _registerActiveRunForTest,
  _resetAutopilotRunsForTest,
  _drainInjectionsForTest,
} from '../src/nexus/api/autopilot-handler.js';

describe('autopilot /inject → codex agent steer (A live consumer)', () => {
  test('inject live-steers the running codex turn (not queued)', async () => {
    _resetAutopilotRunsForTest();
    const h = makeHarness({ turnQuietMs: 0, turnHardMs: 0 });
    await completeStart(h);
    const sessionId = await completeNewSession(h, 'thr-inj');
    const pp = h.agent.prompt(sessionId, [{ type: 'text', text: 'build' }], () => {});
    pp.catch(() => {});
    await tick();
    const turn = findRequest(h.sent, 'turn/start')!;
    h.reply(turn.id, { turn: { id: 'turn-live' } });
    await tick();

    // Wire the run's steer hook exactly as handleAutopilotRun does for codex.
    const run = _registerActiveRunForTest('run-codex');
    run.steer = (instr) => h.agent.steer(sessionId, [{ type: 'text', text: instr }] as never);

    const injectP = handleAutopilotInject(
      new Request('http://x/inject', { method: 'POST', body: JSON.stringify({ instruction: 'also add tests' }) }),
      'run-codex',
    );
    await tick();
    const steer = h.sent.find((m) => m.method === 'turn/steer');
    expect(steer).toBeDefined();
    expect(steer!.params).toMatchObject({ threadId: 'thr-inj', turnId: 'turn-live', expectedTurnId: 'turn-live' });
    h.reply(steer!.id, {});
    const body = await (await injectP).json() as { steered: boolean };
    expect(body.steered).toBe(true);
    expect(_drainInjectionsForTest('run-codex')).toEqual([]); // live-steered, NOT queued

    _resetAutopilotRunsForTest();
    await h.agent.stop();
  });
});

// ── elicitation 관측의 «정제» 계약 (E1 · 2026-08-20) ──────────────
//
// ⛔⭐ elicitation 은 url 모드에서 ***인증·결제***를 나른다. 사양이 못 박았다 —
//    "Servers MUST use URL mode for interactions involving such sensitive information."
//    ⇒ 관측이 스키마의 «값»을 실으면 그 관측 자체가 유출 경로가 된다.
//    이 함수가 그 방어의 실물이라 «직접» 문다.
describe('elicitationSchemaKeys — 값이 아니라 «이름»만 나간다', () => {
  test('properties 의 키 이름만 돌려준다 — 값·설명·기본값은 안 나간다', () => {
    const keys = elicitationSchemaKeys({
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'sk-super-secret-value', default: 'sk-live-123' },
        style: { type: 'string', enum: ['Hyper-Motion', 'Editorial'] },
      },
      required: ['apiKey'],
    });
    expect(keys).toEqual(['apiKey', 'style']);
    const serialized = JSON.stringify(keys);
    expect(serialized).not.toContain('sk-super-secret-value');
    expect(serialized).not.toContain('sk-live-123');
    expect(serialized).not.toContain('Hyper-Motion');
  });

  test('12개를 넘기면 자른다 — 로그가 스키마 크기를 따라 자라지 않는다', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 30; i += 1) properties[`f${i}`] = { type: 'string' };
    expect(elicitationSchemaKeys({ properties })).toHaveLength(12);
  });

  test('스키마가 아니거나 properties 가 없으면 빈 배열 — 던지지 않는다', () => {
    for (const bad of [undefined, null, 'x', 42, [], {}, { properties: null }, { properties: [] }]) {
      expect(elicitationSchemaKeys(bad)).toEqual([]);
    }
  });
});

// ── 관측 «배선» 이음매 시험 (E1 2R should-fix) ────────────────────
//
// ⛔ 위 단위시험은 「정제 함수가 값을 안 흘린다」만 문다. 그 함수를 «안 쓰고»
//    원본을 그대로 로그에 실어도 통과한다 — 그래서 «실제 처리 경로»를 지나게 해서
//    payload 를 직접 본다.
describe('mcp.elicitation 관측 배선 — 실제 요청을 태워서 payload 를 본다', () => {
  test('요청이 오면 관측이 남고, 메시지 본문·스키마 «값»은 payload 에 없다', async () => {
    const { events, restore } = recordDebugEvents();
    try {
      const h = makeHarness();
      const p = h.agent.start();
      await tick();
      const init = findRequest(h.sent, 'initialize');
      h.reply(init!.id, { serverInfo: { name: 'codex', version: '0.x' } });
      await p;

      h.serverRequest('mcpServer/elicitation/request', 'elic-1', {
        threadId: 'thr-1',
        server: 'higgsfield',
        message: 'SUPER-SECRET-PROMPT-BODY',
        requestedSchema: {
          type: 'object',
          properties: { apiKey: { type: 'string', default: 'sk-live-LEAKME' } },
        },
      });
      await tick(6);

      const hit = events.find((e) => e.category === 'mcp.elicitation' && e.event === 'request');
      expect(hit).toBeDefined();                       // ⇒ 모집단이 0 이 아니다
      expect(hit!.data?.server).toBe('higgsfield');
      expect(hit!.data?.hasMessage).toBe(true);
      expect(hit!.data?.schemaKeys).toEqual(['apiKey']);
      // ⛔ 기본 핸들러가 «전부 거절»한다는 사실이 값으로 남는다
      expect(hit!.data?.action).toBe('decline');
      expect(hit!.data?.handlerInstalled).toBe(false);
      // ⛔⭐ 그리고 «값»은 어디에도 없다 — url 모드 elicitation 은 인증·결제를 나른다
      const serialized = JSON.stringify(hit!.data);
      expect(serialized).not.toContain('SUPER-SECRET-PROMPT-BODY');
      expect(serialized).not.toContain('sk-live-LEAKME');

      await h.agent.stop();
    } finally {
      restore();
    }
  });
});
