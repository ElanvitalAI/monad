// M4' (2026-04-28) — codex-app-server per-session MCP policy gating.
//
// Verifies the host-side policy gate. codex v2 protocol has no per-
// conversation MCP override RPC (verified vs codex-rs spec at PLAN
// §2.2), so monad enforces tool allow/block at the
// `mcpServer/tool/call` server-request boundary.

import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  CodexAppServerAgent,
  evaluateMcpPolicy,
  matchesMcpPattern,
  type CodexMcpToolCallHandler,
} from '../src/acp/codex-app-server-agent.js';
import { CodexAppServerClient } from '../src/acp/codex-app-server-client.js';
import type {
  CasThreadIndex,
  CasThreadIndexEntry,
} from '../src/acp/codex-app-server-thread-index.js';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../src/acp/codex-app-server-proto.js';

// ─── Test harness ─────────────────────────────────────────────────────

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
  agent: CodexAppServerAgent;
  client: CodexAppServerClient;
  sent: JsonRpcRequest[];
  reply(id: string | number, result: unknown): void;
  notify(method: string, params: unknown): void;
  request(id: string | number, method: string, params: unknown): void;
  toolCalls: Array<Parameters<CodexMcpToolCallHandler>[0]>;
}

function makeHarness(): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: JsonRpcRequest[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object' && 'method' in obj) {
          sent.push(obj as JsonRpcRequest);
        }
      } catch {
        /* swallow */
      }
    }
  });
  const client = new CodexAppServerClient({
    stdin,
    stdout,
    requestTimeoutMs: null,
  });
  const toolCalls: Array<Parameters<CodexMcpToolCallHandler>[0]> = [];
  const handler: CodexMcpToolCallHandler = async (params) => {
    toolCalls.push(params);
    return { content: [{ type: 'text', text: 'ok' }] };
  };
  const agent = new CodexAppServerAgent({
    backendId: 'codex-app-server',
    cwd: '/tmp',
    mcpToolCallHandler: handler,
    _clientForTesting: client,
    _threadIndexForTesting: makeMemThreadIndex(),
  });
  return {
    agent,
    client,
    sent,
    reply(id, result) {
      const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      stdout.write(JSON.stringify(resp) + '\n');
    },
    notify(method, params) {
      const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
      stdout.write(JSON.stringify(notif) + '\n');
    },
    request(id, method, params) {
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      stdout.write(JSON.stringify(req) + '\n');
    },
    toolCalls,
  };
}

async function tick(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function findRequest(sent: JsonRpcRequest[], method: string): JsonRpcRequest | undefined {
  return sent.find((m) => m.method === method);
}

async function bringUp(h: Harness): Promise<{ sessionId: string; threadId: string }> {
  const startP = h.agent.start();
  await tick();
  h.reply(findRequest(h.sent, 'initialize')!.id, {});
  await startP;

  const sessP = h.agent.newSession();
  await tick();
  const startReq = findRequest(h.sent, 'thread/start');
  const threadId = 'th-1';
  h.reply(startReq!.id, { thread: { id: threadId } });
  const sessionId = await sessP;
  return { sessionId: sessionId as unknown as string, threadId };
}

// ─── Pure helpers ─────────────────────────────────────────────────────

describe('M4 · matchesMcpPattern (pure)', () => {
  test('exact match', () => {
    expect(matchesMcpPattern('github/create_issue', 'github/create_issue')).toBe(true);
  });

  test('server wildcard', () => {
    expect(matchesMcpPattern('github/anything', 'github/*')).toBe(true);
    expect(matchesMcpPattern('github/x/y', 'github/*')).toBe(true);
  });

  test('global wildcard', () => {
    expect(matchesMcpPattern('any/thing', '*')).toBe(true);
  });

  test('non-match', () => {
    expect(matchesMcpPattern('github/create_issue', 'gitlab/create_issue')).toBe(false);
    expect(matchesMcpPattern('github/create_issue', 'github/close_issue')).toBe(false);
  });
});

describe('M4 · evaluateMcpPolicy (pure)', () => {
  test('undefined policy = allow', () => {
    expect(evaluateMcpPolicy(undefined, 'github/x')).toBeNull();
  });

  test('allow-all = always allow', () => {
    expect(evaluateMcpPolicy({ mode: 'allow-all' }, 'github/x')).toBeNull();
  });

  test('allow-list match → allow', () => {
    expect(
      evaluateMcpPolicy({ mode: 'allow-list', tools: ['github/x'] }, 'github/x'),
    ).toBeNull();
  });

  test('allow-list miss → block with diagnostic', () => {
    const reason = evaluateMcpPolicy(
      { mode: 'allow-list', tools: ['github/x'] },
      'github/y',
    );
    expect(reason).toContain('not in this session\'s allow-list');
  });

  test('block-list match → block', () => {
    const reason = evaluateMcpPolicy(
      { mode: 'block-list', tools: ['github/dangerous'] },
      'github/dangerous',
    );
    expect(reason).toContain('blocked for this session');
  });

  test('block-list miss → allow', () => {
    expect(
      evaluateMcpPolicy({ mode: 'block-list', tools: ['github/dangerous'] }, 'github/safe'),
    ).toBeNull();
  });

  test('block-list with server wildcard', () => {
    const reason = evaluateMcpPolicy(
      { mode: 'block-list', tools: ['github/*'] },
      'github/anything',
    );
    expect(reason).toContain('blocked');
  });
});

// ─── Public API ───────────────────────────────────────────────────────

describe('M4 · setSessionMcpPolicy / getSessionMcpPolicy', () => {
  test('default policy is undefined (= allow-all)', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();
    await h.agent.stop();
  });

  test('round-trip preserves policy shape', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    const policy = { mode: 'allow-list' as const, tools: ['github/*'] };
    h.agent.setSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0], policy);
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toEqual(policy);
    await h.agent.stop();
  });

  test('setSessionMcpPolicy(undefined) clears the entry', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['github/x'] },
    );
    h.agent.setSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0], undefined);
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();
    await h.agent.stop();
  });

  test('mode=allow-all is treated as no-policy (deletes entry)', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-all' },
    );
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();
    await h.agent.stop();
  });

  test('setSessionMcpPolicy for unknown sessionId silently records', () => {
    const h = makeHarness();
    const fake = 'session/never' as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0];
    h.agent.setSessionMcpPolicy(fake, { mode: 'block-list', tools: ['x/y'] });
    expect(h.agent.getSessionMcpPolicy(fake as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0]))
      .toEqual({ mode: 'block-list', tools: ['x/y'] });
  });
});

// ─── Wire path: tool call handler with policy ─────────────────────────

describe('M4 · mcpServer/tool/call gate', () => {
  test('allow-all (no policy) → handler invoked', async () => {
    const h = makeHarness();
    const { threadId } = await bringUp(h);
    h.request('rq-1', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      tool: 'create_issue',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(1);
    expect(h.toolCalls[0].tool).toBe('create_issue');
    await h.agent.stop();
  });

  test('allow-list miss → handler NOT invoked (policy short-circuits)', async () => {
    const h = makeHarness();
    const { sessionId, threadId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-list', tools: ['github/create_issue'] },
    );
    h.request('rq-2', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      tool: 'delete_repo', // not in allow-list
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(0);
    await h.agent.stop();
  });

  test('allow-list match → handler invoked', async () => {
    const h = makeHarness();
    const { sessionId, threadId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-list', tools: ['github/create_issue'] },
    );
    h.request('rq-3', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      tool: 'create_issue',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(1);
    await h.agent.stop();
  });

  test('block-list match → handler NOT invoked', async () => {
    const h = makeHarness();
    const { sessionId, threadId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['github/delete_repo'] },
    );
    h.request('rq-4', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      tool: 'delete_repo',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(0);
    await h.agent.stop();
  });

  test('server wildcard in allow-list matches every tool on that server', async () => {
    const h = makeHarness();
    const { sessionId, threadId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-list', tools: ['github/*'] },
    );
    h.request('rq-5', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      tool: 'arbitrary_op',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(1);
    h.request('rq-6', 'mcpServer/tool/call', {
      threadId,
      server: 'gitlab',
      tool: 'something',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(1); // not bumped
    await h.agent.stop();
  });

  test('unknown threadId → policy lookup falls through to allow-all', async () => {
    const h = makeHarness();
    await bringUp(h);
    h.request('rq-7', 'mcpServer/tool/call', {
      threadId: 'unknown-thread',
      server: 'github',
      tool: 'create_issue',
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(1);
    await h.agent.stop();
  });

  test('missing tool name still rejected (existing contract preserved)', async () => {
    const h = makeHarness();
    const { threadId } = await bringUp(h);
    h.request('rq-8', 'mcpServer/tool/call', {
      threadId,
      server: 'github',
      // no tool
    });
    await tick(5);
    expect(h.toolCalls.length).toBe(0);
    await h.agent.stop();
  });
});

describe('M4 · stop() lifecycle', () => {
  test('stop() clears all session policies', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['x/y'] },
    );
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeDefined();
    await h.agent.stop();
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();
  });
});
