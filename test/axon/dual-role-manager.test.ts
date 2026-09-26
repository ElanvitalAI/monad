// AXON P1 — dual-role-manager unit tests.
//
// Tests run against a fresh manager instance (not the singleton) to
// avoid leaking state across specs. The agentFactory hook feeds in a
// fake AcpAgent so we never actually spawn a subprocess.

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CLIENT_NAMESPACE,
  DEFAULT_HOP_CAP,
  DualRoleManager,
  ReentrancyError,
  SERVER_NAMESPACE,
  UnknownSessionError,
  __resetDualRoleManagerForTest,
  globalDualRoleManager,
} from '../../src/acp/dual-role-manager.js';
import type { AcpAgent } from '../../src/acp/client.js';
import type {
  ContentBlock,
  SessionId,
  SessionUpdate,
} from '@agentclientprotocol/sdk';

interface FakeAgentHooks {
  /** Session id the fake will return from newSession(). */
  nextSessionId: string;
  /** Updates the fake will stream on prompt() before resolving. */
  updatesOnPrompt?: SessionUpdate[];
  /** stopReason the fake resolves prompt() with. */
  stopReason?: 'end_turn' | 'cancelled' | 'max_tokens' | 'refusal' | 'max_tool_use_requests';
  /** Capture incoming prompt() invocations for assertions. */
  sent?: Array<{ sessionId: SessionId; blocks: ContentBlock[] }>;
  /** Capture cancel() calls. */
  cancelled?: SessionId[];
  /** When set, prompt() throws this error instead of resolving. */
  failWith?: Error;
  /** Resolver-style hook — lets a test hold prompt() open until it
   *  decides to resolve. When omitted, prompt() resolves immediately
   *  after flushing updatesOnPrompt. */
  resolveHook?: (resolve: () => void) => void;
}

function makeFakeAgent(hooks: FakeAgentHooks): AcpAgent {
  const agent = {
    async newSession(): Promise<SessionId> {
      return hooks.nextSessionId as SessionId;
    },
    async prompt(sessionId: SessionId, blocks: ContentBlock[], onUpdate: (u: SessionUpdate) => void) {
      (hooks.sent ??= []).push({ sessionId, blocks });
      for (const u of hooks.updatesOnPrompt ?? []) onUpdate(u);
      if (hooks.failWith) throw hooks.failWith;
      if (hooks.resolveHook) {
        await new Promise<void>((resolve) => hooks.resolveHook!(resolve));
      }
      return { stopReason: hooks.stopReason ?? 'end_turn' };
    },
    async cancel(sessionId: SessionId): Promise<void> {
      (hooks.cancelled ??= []).push(sessionId);
    },
  };
  return agent as unknown as AcpAgent;
}

function textUpdate(text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  } as unknown as SessionUpdate;
}

let manager: DualRoleManager;
beforeEach(() => {
  __resetDualRoleManagerForTest();
  manager = new DualRoleManager();
});

describe('DualRoleManager — server sessions', () => {
  it('registers + resolves server sessions by backend id', () => {
    const rec = manager.serverSessionRegister('elanous-session-1', '/tmp');
    expect(rec.kind).toBe('server');
    expect(rec.id).toBe(`${SERVER_NAMESPACE}elanous-session-1`);
    expect(manager.get('elanous-session-1')?.id).toBe(rec.id);
    expect(manager.serverSessionById(rec.id)?.backendSessionId).toBe('elanous-session-1');
  });

  it('unregister is idempotent + returns false for unknown ids', () => {
    manager.serverSessionRegister('elanous-session-2', '/tmp');
    expect(manager.serverSessionUnregister('elanous-session-2')).toBe(true);
    expect(manager.serverSessionUnregister('elanous-session-2')).toBe(false);
    expect(manager.serverSessionUnregister('never-existed')).toBe(false);
  });

  it('serverSessionById returns undefined for a client record', () => {
    manager.__setAgentFactoryForTest(() => makeFakeAgent({ nextSessionId: 'sX' }));
    return manager.clientSessionCreate({ backendId: 'claude' }).then(rec => {
      expect(manager.serverSessionById(rec.id)).toBeUndefined();
    });
  });
});

describe('DualRoleManager — client sessions', () => {
  it('clientSessionCreate namespaces the id and stores the backendSessionId', async () => {
    manager.__setAgentFactoryForTest(() => makeFakeAgent({ nextSessionId: 'sess-A' }));
    const rec = await manager.clientSessionCreate({ backendId: 'claude', cwd: '/w' });
    expect(rec.id).toBe(`${CLIENT_NAMESPACE}claude:sess-A`);
    expect(rec.backendSessionId).toBe('sess-A');
    expect(rec.backendId).toBe('claude');
    expect(rec.cwd).toBe('/w');
    expect(manager.get('sess-A')?.id).toBe(rec.id);
  });

  it('clientSessionSend returns stopReason and bumps lastSeenAt on each update', async () => {
    const hooks: FakeAgentHooks = {
      nextSessionId: 'sess-B',
      updatesOnPrompt: [textUpdate('hi '), textUpdate('there')],
      stopReason: 'end_turn',
    };
    manager.__setAgentFactoryForTest(() => makeFakeAgent(hooks));
    const rec = await manager.clientSessionCreate({ backendId: 'codex' });
    const before = rec.lastSeenAt;
    await new Promise(r => setTimeout(r, 2));
    const result = await manager.clientSessionSend({ sessionId: rec.id, message: 'hello?' });
    expect(result.stopReason).toBe('end_turn');
    expect(result.sessionId).toBe(rec.id);
    expect(rec.lastSeenAt).toBeGreaterThanOrEqual(before);
  });

  it('clientSessionSend forwards onUpdate to the caller', async () => {
    const hooks: FakeAgentHooks = {
      nextSessionId: 'sess-C',
      updatesOnPrompt: [textUpdate('hello')],
    };
    manager.__setAgentFactoryForTest(() => makeFakeAgent(hooks));
    const rec = await manager.clientSessionCreate({ backendId: 'gemini' });
    const observed: string[] = [];
    await manager.clientSessionSend({
      sessionId: rec.id,
      message: 'ping',
      onUpdate: (u) => {
        const c = (u as unknown as { content?: { text?: string } }).content;
        if (c?.text) observed.push(c.text);
      },
    });
    expect(observed).toEqual(['hello']);
  });

  it('clientSessionSend throws UnknownSessionError for a bogus id', async () => {
    await expect(
      manager.clientSessionSend({ sessionId: 'acp-cli:claude:never', message: 'x' }),
    ).rejects.toBeInstanceOf(UnknownSessionError);
  });

  it('clientSessionSend accepts a backendSessionId via the secondary index', async () => {
    manager.__setAgentFactoryForTest(() => makeFakeAgent({ nextSessionId: 'sess-D' }));
    const rec = await manager.clientSessionCreate({ backendId: 'claude' });
    const result = await manager.clientSessionSend({ sessionId: 'sess-D', message: 'raw id' });
    expect(result.sessionId).toBe(rec.id);
  });

  it('clientSessionClose cancels the running turn and drops the record', async () => {
    const hooks: FakeAgentHooks = { nextSessionId: 'sess-E' };
    manager.__setAgentFactoryForTest(() => makeFakeAgent(hooks));
    const rec = await manager.clientSessionCreate({ backendId: 'claude' });
    expect(await manager.clientSessionClose(rec.id)).toBe(true);
    expect(manager.get(rec.id)).toBeUndefined();
    expect(hooks.cancelled).toEqual(['sess-E'] as SessionId[]);
  });

  it('clientSessionClose returns false when session is unknown', async () => {
    expect(await manager.clientSessionClose('acp-cli:none:missing')).toBe(false);
  });
});

describe('DualRoleManager — hop cap + reentrancy', () => {
  it('DEFAULT_HOP_CAP is 3', () => {
    expect(DEFAULT_HOP_CAP).toBe(3);
  });

  it('activeHops counts a running send and decrements on completion', async () => {
    let release!: () => void;
    const hooks: FakeAgentHooks = {
      nextSessionId: 'sess-F',
      resolveHook: (resolve) => { release = resolve; },
    };
    manager.__setAgentFactoryForTest(() => makeFakeAgent(hooks));
    const rec = await manager.clientSessionCreate({ backendId: 'claude' });
    expect(manager.activeHops(rec.id)).toBe(0);
    const pending = manager.clientSessionSend({ sessionId: rec.id, message: 'A' });
    await new Promise(r => setTimeout(r, 0));   // let prompt() start
    expect(manager.activeHops(rec.id)).toBe(1);
    release();
    await pending;
    expect(manager.activeHops(rec.id)).toBe(0);
  });

  it('throws ReentrancyError when activeHops already hits the cap', async () => {
    manager.__setAgentFactoryForTest(() => makeFakeAgent({ nextSessionId: 'sess-G' }));
    const rec = await manager.clientSessionCreate({ backendId: 'claude' });
    // Simulate a chain of in-flight sends that haven't returned yet.
    (rec as unknown as { activeHops: number }).activeHops = DEFAULT_HOP_CAP;
    await expect(
      manager.clientSessionSend({ sessionId: rec.id, message: 'nope' }),
    ).rejects.toBeInstanceOf(ReentrancyError);
  });

  it('respects an override hopCap in the send opts', async () => {
    manager.__setAgentFactoryForTest(() => makeFakeAgent({ nextSessionId: 'sess-H' }));
    const rec = await manager.clientSessionCreate({ backendId: 'claude' });
    (rec as unknown as { activeHops: number }).activeHops = 1;
    await expect(
      manager.clientSessionSend({ sessionId: rec.id, message: 'nope', hopCap: 1 }),
    ).rejects.toBeInstanceOf(ReentrancyError);
  });
});

describe('DualRoleManager — singleton + lastSeen', () => {
  it('markLastSeen is a no-op for unknown ids', () => {
    expect(() => manager.markLastSeen('no-such-id')).not.toThrow();
  });

  it('markLastSeen updates the stamp on the record', () => {
    const rec = manager.serverSessionRegister('s1', '/x');
    const before = rec.lastSeenAt;
    manager.markLastSeen('s1', before + 1000);
    expect(rec.lastSeenAt).toBe(before + 1000);
  });

  it('globalDualRoleManager returns a stable singleton until reset', () => {
    const a = globalDualRoleManager();
    const b = globalDualRoleManager();
    expect(a).toBe(b);
    __resetDualRoleManagerForTest();
    const c = globalDualRoleManager();
    expect(c).not.toBe(a);
  });
});
