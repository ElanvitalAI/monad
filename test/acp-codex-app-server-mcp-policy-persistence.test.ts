// M4'.1 (2026-04-28) — MCP policy persistence (in-memory + thread-index).
//
// Verifies:
//   - thread-index entry shape extension (mcpPolicy?: optional)
//   - setSessionMcpPolicy auto-persists to thread-index
//   - clearing (mode='allow-all' / undefined) removes persisted snapshot
//   - loadSession restores persisted policy into in-memory map
//   - ensureSessionResumed (after hibernate) restores persisted policy
//   - backward-compat: legacy entry without mcpPolicy decodes normally

import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  CodexAppServerAgent,
  type CodexMcpSessionPolicy,
} from '../src/acp/codex-app-server-agent.js';
import { CodexAppServerClient } from '../src/acp/codex-app-server-client.js';
import type {
  CasThreadIndex,
  CasThreadIndexEntry,
  CasThreadMcpPolicySnapshot,
} from '../src/acp/codex-app-server-thread-index.js';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../src/acp/codex-app-server-proto.js';

// In-memory thread index that records all setMcpPolicy calls so tests
// can assert the persistence path was hit (not just the in-memory Map).
function makeMemThreadIndex(seedEntries: CasThreadIndexEntry[] = []): CasThreadIndex & {
  setMcpPolicyCalls: Array<[string, CasThreadMcpPolicySnapshot | null]>;
} {
  const map = new Map<string, CasThreadIndexEntry>();
  for (const e of seedEntries) map.set(e.synthId, e);
  const setMcpPolicyCalls: Array<[string, CasThreadMcpPolicySnapshot | null]> = [];
  return {
    setMcpPolicyCalls,
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
        ...(input.mcpPolicy !== undefined ? { mcpPolicy: input.mcpPolicy } : {}),
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
      setMcpPolicyCalls.push([id, policy]);
      const e = map.get(id);
      if (!e) return null;
      const updated: CasThreadIndexEntry = policy === null
        ? (() => {
            const { mcpPolicy: _drop, ...rest } = e;
            void _drop;
            return rest;
          })()
        : { ...e, mcpPolicy: policy };
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
  index: ReturnType<typeof makeMemThreadIndex>;
}

function makeHarness(seed: CasThreadIndexEntry[] = []): Harness {
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
      } catch { /* swallow */ }
    }
  });
  const client = new CodexAppServerClient({
    stdin,
    stdout,
    requestTimeoutMs: null,
  });
  const index = makeMemThreadIndex(seed);
  const agent = new CodexAppServerAgent({
    backendId: 'codex-app-server',
    cwd: '/tmp',
    _clientForTesting: client,
    _threadIndexForTesting: index,
  });
  return {
    agent,
    client,
    sent,
    index,
    reply(id, result) {
      const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      stdout.write(JSON.stringify(resp) + '\n');
    },
    notify(method, params) {
      const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
      stdout.write(JSON.stringify(notif) + '\n');
    },
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
  const threadId = 'th-1';
  h.reply(findRequest(h.sent, 'thread/start')!.id, { thread: { id: threadId } });
  const sessionId = await sessP;
  return { sessionId: sessionId as unknown as string, threadId };
}

// ─── setSessionMcpPolicy persistence path ────────────────────────────

describe('M4\'.1 · setSessionMcpPolicy persistence', () => {
  test('setting allow-list policy auto-persists snapshot', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    const policy: CodexMcpSessionPolicy = { mode: 'allow-list', tools: ['github/*'] };
    h.agent.setSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0], policy);
    expect(h.index.setMcpPolicyCalls).toHaveLength(1);
    expect(h.index.setMcpPolicyCalls[0][0]).toBe(sessionId);
    expect(h.index.setMcpPolicyCalls[0][1]).toEqual({ mode: 'allow-list', tools: ['github/*'] });
    // Entry on disk reflects.
    const entry = h.index.get(sessionId);
    expect(entry?.mcpPolicy).toEqual({ mode: 'allow-list', tools: ['github/*'] });
    await h.agent.stop();
  });

  test('clearing (allow-all) removes persisted snapshot', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['x/y'] },
    );
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-all' },
    );
    expect(h.index.setMcpPolicyCalls.map((c) => c[1])).toEqual([
      { mode: 'block-list', tools: ['x/y'] },
      null,
    ]);
    expect(h.index.get(sessionId)?.mcpPolicy).toBeUndefined();
    await h.agent.stop();
  });

  test('clearing (undefined) removes persisted snapshot', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['x/y'] },
    );
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      undefined,
    );
    expect(h.index.setMcpPolicyCalls).toHaveLength(2);
    expect(h.index.setMcpPolicyCalls[1][1]).toBeNull();
    await h.agent.stop();
  });

  test('block-list policy persists with tools list', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['github/delete_repo', 'github/force_push'] },
    );
    const entry = h.index.get(sessionId);
    expect(entry?.mcpPolicy).toEqual({
      mode: 'block-list',
      tools: ['github/delete_repo', 'github/force_push'],
    });
    await h.agent.stop();
  });
});

// ─── loadSession restores persisted policy ────────────────────────────

describe('M4\'.1 · loadSession restoration', () => {
  test('loadSession seeds in-memory policy from persisted snapshot', async () => {
    const seedEntry: CasThreadIndexEntry = {
      synthId: 'session/persisted-1',
      threadId: 'th-persisted',
      cwd: '/tmp',
      createdAt: Date.now() - 1000,
      lastTurnAt: Date.now() - 500,
      mcpPolicy: { mode: 'allow-list', tools: ['filesystem/*'] },
    };
    const h = makeHarness([seedEntry]);
    const startP = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await startP;

    // Pre-load: in-memory map empty for this session.
    expect(h.agent.getSessionMcpPolicy(seedEntry.synthId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();

    const loadP = h.agent.loadSession({
      sessionId: seedEntry.synthId as unknown as Parameters<typeof h.agent.loadSession>[0]['sessionId'],
    });
    await tick();
    h.reply(findRequest(h.sent, 'thread/resume')!.id, { thread: { id: seedEntry.threadId } });
    await loadP;

    // Policy now seeded in-memory.
    const policy = h.agent.getSessionMcpPolicy(seedEntry.synthId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0]);
    expect(policy).toEqual({ mode: 'allow-list', tools: ['filesystem/*'] });
    await h.agent.stop();
  });

  test('loadSession does NOT overwrite an already-set in-memory policy', async () => {
    const seedEntry: CasThreadIndexEntry = {
      synthId: 'session/persisted-2',
      threadId: 'th-persisted-2',
      cwd: '/tmp',
      createdAt: Date.now(),
      lastTurnAt: Date.now(),
      mcpPolicy: { mode: 'allow-list', tools: ['old/policy'] },
    };
    const h = makeHarness([seedEntry]);
    const startP = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await startP;

    // Caller sets a fresh policy BEFORE loadSession.
    h.agent.setSessionMcpPolicy(
      seedEntry.synthId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list', tools: ['new/policy'] },
    );

    const loadP = h.agent.loadSession({
      sessionId: seedEntry.synthId as unknown as Parameters<typeof h.agent.loadSession>[0]['sessionId'],
    });
    await tick();
    h.reply(findRequest(h.sent, 'thread/resume')!.id, { thread: { id: seedEntry.threadId } });
    await loadP;

    // The fresh policy wins · loadSession restoration is "fill if empty".
    const policy = h.agent.getSessionMcpPolicy(seedEntry.synthId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0]);
    expect(policy).toEqual({ mode: 'block-list', tools: ['new/policy'] });
    await h.agent.stop();
  });

  test('loadSession on entry without mcpPolicy leaves in-memory empty (backward-compat)', async () => {
    const seedEntry: CasThreadIndexEntry = {
      synthId: 'session/legacy',
      threadId: 'th-legacy',
      cwd: '/tmp',
      createdAt: Date.now(),
      lastTurnAt: Date.now(),
      // no mcpPolicy field — pre-M4'.1 entry shape
    };
    const h = makeHarness([seedEntry]);
    const startP = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await startP;

    const loadP = h.agent.loadSession({
      sessionId: seedEntry.synthId as unknown as Parameters<typeof h.agent.loadSession>[0]['sessionId'],
    });
    await tick();
    h.reply(findRequest(h.sent, 'thread/resume')!.id, { thread: { id: seedEntry.threadId } });
    await loadP;

    expect(h.agent.getSessionMcpPolicy(seedEntry.synthId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();
    await h.agent.stop();
  });
});

// ─── ensureSessionResumed (post-hibernate) restoration ───────────────

describe('M4\'.1 · ensureSessionResumed restoration after hibernate', () => {
  test('host-restart equivalent (cleared in-memory map) restores policy via loadSession', async () => {
    const h = makeHarness();
    const { sessionId, threadId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-list', tools: ['safe/*'] },
    );

    // Simulate host restart shape — the on-disk thread-index entry still
    // has the persisted policy, but the in-memory Map starts empty.
    // This is exactly what happens when a fresh CodexAppServerAgent is
    // constructed against an existing thread-index file. We don't tear
    // down the test harness's client (would require spawn-factory
    // setup); we just clear the in-memory state and verify loadSession
    // re-seeds from disk.
    (h.agent as unknown as { sessionMcpPolicies: Map<unknown, unknown> }).sessionMcpPolicies.clear();
    (h.agent as unknown as { currentDaemonSessions: Set<unknown> }).currentDaemonSessions.delete(sessionId);
    expect(h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0])).toBeUndefined();

    // loadSession round-trips through thread-index → restoration path.
    const loadP = h.agent.loadSession({
      sessionId: sessionId as unknown as Parameters<typeof h.agent.loadSession>[0]['sessionId'],
    });
    await tick();
    const resumeReq = findRequest(h.sent, 'thread/resume');
    expect(resumeReq).toBeDefined();
    h.reply(resumeReq!.id, { thread: { id: threadId } });
    await loadP;

    const policy = h.agent.getSessionMcpPolicy(sessionId as unknown as Parameters<typeof h.agent.getSessionMcpPolicy>[0]);
    expect(policy).toEqual({ mode: 'allow-list', tools: ['safe/*'] });
    await h.agent.stop();
  });
});

// ─── persisted snapshot shape integrity ──────────────────────────────

describe('M4\'.1 · persisted snapshot integrity', () => {
  test('snapshot tools array is COPIED (no aliasing risk)', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    const tools = ['github/x'];
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'allow-list', tools },
    );
    // Mutate caller's array — shouldn't affect persisted entry.
    tools.push('hacked/tool');
    const entry = h.index.get(sessionId);
    expect(entry?.mcpPolicy?.tools).toEqual(['github/x']);
    await h.agent.stop();
  });

  test('snapshot mode preserved verbatim', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMcpPolicy(
      sessionId as unknown as Parameters<typeof h.agent.setSessionMcpPolicy>[0],
      { mode: 'block-list' },
    );
    const entry = h.index.get(sessionId);
    expect(entry?.mcpPolicy?.mode).toBe('block-list');
    expect(entry?.mcpPolicy?.tools).toBeUndefined();
    await h.agent.stop();
  });
});
