// M1 (2026-04-28) — codex-app-server plan mode (collaborationMode + planMode CAP).
//
// Verifies:
//   - CAPS.planMode flips ON.
//   - newSession captures the server-supplied model from thread/start.
//   - loadSession captures the model from thread/resume.
//   - setSessionMode('plan') + known model → turn/start carries
//     `collaborationMode: { mode: 'plan', settings: { model } }`.
//   - setSessionMode('plan') + unknown model → collaborationMode is
//     OMITTED (graceful fallback to server default).
//   - setSessionMode('default') (or unset) → collaborationMode omitted.
//   - getSessionMode + getSessionModel readback.

import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  CodexAppServerAgent,
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

function makeMemThreadIndex(seed?: { synthId: string; threadId: string; cwd: string }): CasThreadIndex {
  const map = new Map<string, CasThreadIndexEntry>();
  if (seed) {
    map.set(seed.synthId, {
      ...seed,
      createdAt: Date.now(),
      lastTurnAt: Date.now(),
    });
  }
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
}

function makeHarness(seed?: { synthId: string; threadId: string; cwd: string }): Harness {
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
  const agent = new CodexAppServerAgent({
    backendId: 'codex-app-server',
    cwd: '/tmp',
    _clientForTesting: client,
    _threadIndexForTesting: makeMemThreadIndex(seed),
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
  };
}

async function tick(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function findRequest(sent: JsonRpcRequest[], method: string): JsonRpcRequest | undefined {
  return sent.find((m) => m.method === method);
}

async function bringUp(
  h: Harness,
  opts: { model?: string } = {},
): Promise<{ sessionId: string; threadId: string }> {
  const startP = h.agent.start();
  await tick();
  const initReq = findRequest(h.sent, 'initialize');
  h.reply(initReq!.id, {});
  await startP;

  const sessP = h.agent.newSession();
  await tick();
  const startReq = findRequest(h.sent, 'thread/start');
  const threadId = 'th-1';
  h.reply(
    startReq!.id,
    opts.model
      ? { thread: { id: threadId }, model: opts.model }
      : { thread: { id: threadId } },
  );
  const sessionId = await sessP;
  return { sessionId: sessionId as unknown as string, threadId };
}

// ─── Capability flag ──────────────────────────────────────────────────

describe('CodexAppServerAgent · M1 · capability flag', () => {
  test('getCapabilities().planMode === true after start', async () => {
    const h = makeHarness();
    const p = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await p;
    const caps = h.agent.getCapabilities();
    expect(caps).not.toBeNull();
    expect(caps!.planMode).toBe(true);
    await h.agent.stop();
  });

  test('getCapabilities() before start returns null (mode flag included)', () => {
    const h = makeHarness();
    expect(h.agent.getCapabilities()).toBeNull();
  });
});

// ─── Model capture ────────────────────────────────────────────────────

describe('CodexAppServerAgent · M1 · model capture', () => {
  test('newSession captures `model` from thread/start response', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h, { model: 'gpt-5-codex' });
    expect(h.agent.getSessionModel(sessionId as unknown as Parameters<typeof h.agent.getSessionModel>[0])).toBe('gpt-5-codex');
    await h.agent.stop();
  });

  test('newSession without model in response leaves it undefined', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    expect(h.agent.getSessionModel(sessionId as unknown as Parameters<typeof h.agent.getSessionModel>[0])).toBeUndefined();
    await h.agent.stop();
  });

  test('loadSession refreshes the captured model from thread/resume response', async () => {
    const seed = { synthId: 'session/cas-1', threadId: 'th-existing', cwd: '/tmp' };
    const h = makeHarness(seed);
    const startP = h.agent.start();
    await tick();
    h.reply(findRequest(h.sent, 'initialize')!.id, {});
    await startP;

    const loadP = h.agent.loadSession({
      sessionId: seed.synthId as unknown as Parameters<typeof h.agent.loadSession>[0]['sessionId'],
    });
    await tick();
    const resumeReq = findRequest(h.sent, 'thread/resume');
    h.reply(resumeReq!.id, { thread: { id: seed.threadId }, model: 'gpt-5-resumed' });
    await loadP;
    expect(h.agent.getSessionModel(seed.synthId as unknown as Parameters<typeof h.agent.getSessionModel>[0])).toBe('gpt-5-resumed');
    await h.agent.stop();
  });
});

// ─── setSessionMode + getSessionMode round-trip ──────────────────────

describe('CodexAppServerAgent · M1 · setSessionMode', () => {
  test('default getSessionMode is "default" before any setter call', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    expect(h.agent.getSessionMode(sessionId as unknown as Parameters<typeof h.agent.getSessionMode>[0])).toBe('default');
    await h.agent.stop();
  });

  test('setSessionMode("plan") + getSessionMode round-trip', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');
    expect(h.agent.getSessionMode(sessionId as unknown as Parameters<typeof h.agent.getSessionMode>[0])).toBe('plan');
    await h.agent.stop();
  });

  test('setSessionMode("default") clears a previous override', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'default');
    expect(h.agent.getSessionMode(sessionId as unknown as Parameters<typeof h.agent.getSessionMode>[0])).toBe('default');
    await h.agent.stop();
  });
});

// ─── turn/start collaborationMode injection ──────────────────────────

describe('CodexAppServerAgent · M1 · collaborationMode on turn/start', () => {
  test('mode=default omits collaborationMode field', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h, { model: 'gpt-5' });
    const p = h.agent.prompt(
      sessionId as unknown as Parameters<typeof h.agent.prompt>[0],
      [{ type: 'text', text: 'hi' }],
      () => undefined,
    );
    await tick();
    const turn = findRequest(h.sent, 'turn/start');
    expect(turn).toBeDefined();
    expect((turn!.params as { collaborationMode?: unknown }).collaborationMode).toBeUndefined();
    h.reply(turn!.id, { turnId: 't1' });
    p.catch(() => undefined);
    await h.agent.stop();
  });

  test('mode=plan + known model attaches collaborationMode envelope', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h, { model: 'gpt-5-codex' });
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');

    const p = h.agent.prompt(
      sessionId as unknown as Parameters<typeof h.agent.prompt>[0],
      [{ type: 'text', text: 'plan this' }],
      () => undefined,
    );
    await tick();
    const turn = findRequest(h.sent, 'turn/start');
    expect(turn).toBeDefined();
    const cm = (turn!.params as {
      collaborationMode?: { mode: string; settings: { model: string } };
    }).collaborationMode;
    expect(cm).toBeDefined();
    expect(cm!.mode).toBe('plan');
    expect(cm!.settings.model).toBe('gpt-5-codex');
    h.reply(turn!.id, { turnId: 't1' });
    p.catch(() => undefined);
    await h.agent.stop();
  });

  test('mode=plan + UNKNOWN model omits collaborationMode (graceful fallback)', async () => {
    const h = makeHarness();
    // No model in thread/start response.
    const { sessionId } = await bringUp(h);
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');
    expect(h.agent.getSessionModel(sessionId as unknown as Parameters<typeof h.agent.getSessionModel>[0])).toBeUndefined();

    const p = h.agent.prompt(
      sessionId as unknown as Parameters<typeof h.agent.prompt>[0],
      [{ type: 'text', text: 'still plan?' }],
      () => undefined,
    );
    await tick();
    const turn = findRequest(h.sent, 'turn/start');
    expect((turn!.params as { collaborationMode?: unknown }).collaborationMode).toBeUndefined();
    h.reply(turn!.id, { turnId: 't1' });
    p.catch(() => undefined);
    await h.agent.stop();
  });

  test('toggling back to default omits collaborationMode on next prompt', async () => {
    const h = makeHarness();
    const { sessionId } = await bringUp(h, { model: 'gpt-5' });
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');

    // First prompt — plan.
    const p1 = h.agent.prompt(
      sessionId as unknown as Parameters<typeof h.agent.prompt>[0],
      [{ type: 'text', text: 'go plan' }],
      () => undefined,
    );
    await tick();
    const t1 = findRequest(h.sent, 'turn/start');
    expect((t1!.params as { collaborationMode?: unknown }).collaborationMode).toBeDefined();
    h.reply(t1!.id, { turnId: 't1' });
    h.notify('turn/completed', { threadId: 'th-1', turn: { status: 'completed' } });
    await tick();
    p1.catch(() => undefined);

    // Toggle off + second prompt.
    h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'default');
    const sentBefore = h.sent.length;
    const p2 = h.agent.prompt(
      sessionId as unknown as Parameters<typeof h.agent.prompt>[0],
      [{ type: 'text', text: 'go default' }],
      () => undefined,
    );
    await tick();
    const newReqs = h.sent.slice(sentBefore);
    const t2 = newReqs.find((r) => r.method === 'turn/start');
    expect(t2).toBeDefined();
    expect((t2!.params as { collaborationMode?: unknown }).collaborationMode).toBeUndefined();
    h.reply(t2!.id, { turnId: 't2' });
    p2.catch(() => undefined);
    await h.agent.stop();
  });

  test('setSessionMode for an unknown sessionId is silently recorded', () => {
    const h = makeHarness();
    const fakeId = 'session/never-spawned' as unknown as Parameters<typeof h.agent.setSessionMode>[0];
    h.agent.setSessionMode(fakeId, 'plan');
    expect(h.agent.getSessionMode(fakeId as unknown as Parameters<typeof h.agent.getSessionMode>[0])).toBe('plan');
  });
});
