// runAcpTurn recovery flow tests — L2 (capability-aware persistence)
// + L3 (loadSession-first validation).
//
// We don't spawn real ACP backends. The agent-manager singleton is
// monkey-patched to return a stub agent that exposes the minimal
// surface runAcpTurn touches: getCapabilities, newSession,
// loadSession, prompt, cancel. The singleton's `drop` is observed so
// we can assert that recovery clears the cached agent on the right
// errors.
//
// Path coverage:
//   1. capability=true · stored id + loadSession ok → uses stored id,
//      validation runs once (not on follow-up turn)
//   2. capability=true · stored id + loadSession stale → drops store
//      entry, mints new, prompt runs against fresh id
//   3. capability=true · stored id + loadSession non-stale error →
//      propagates to caller, no fallback
//   4. capability=false (ephemeral) · first turn mints + caches
//      in-memory, second turn reuses without writing to store
//   5. capability=false · cross-process style: clearing the
//      ephemeral cache (simulating restart) makes the next turn
//      mint fresh — and the store was never touched

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  isStaleSessionError,
  runAcpTurn,
  _resetTurnRunnerCachesForTests,
} from '../src/acp/turn-runner';
import {
  ACP_SESSION_EPOCH,
  globalAcpSessionStore,
  _resetAcpSessionStoreForTests,
} from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CRITICAL: redirect XDG_CONFIG_HOME to a per-test tmpdir so the
// global session-store singleton writes to a throwaway location
// instead of the user's real ~/.config/elanous/acp-sessions.json.
// Without this, every store.set() in these tests would pollute the
// user's actual session file (we discovered this the hard way on
// 2026-05-02 — `stored-sess-1`, `persisted-id`, `fresh-100` test
// fixtures leaked into the live store).
const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
const ORIGINAL_ELANOUS_STATE_DIR = process.env.ELANOUS_STATE_DIR;
let testConfigDir: string | null = null;

interface StubAgentSpec {
  loadSessionCapability: boolean;
  loadSessionImpl?: (sessionId: string) => Promise<void>;
  newSessionImpl?: () => Promise<string>;
  promptImpl?: () => Promise<{ stopReason: string }>;
}

interface StubAgent {
  getCapabilities(): { loadSession: boolean };
  newSession(): Promise<string>;
  loadSession(req: { sessionId: string; cwd?: string }): Promise<void>;
  prompt(...args: unknown[]): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  calls: {
    newSession: number;
    loadSession: Array<{ sessionId: string }>;
    prompt: Array<{ sessionId: string }>;
  };
}

function makeStubAgent(spec: StubAgentSpec): StubAgent {
  const calls: StubAgent['calls'] = {
    newSession: 0,
    loadSession: [],
    prompt: [],
  };
  let nextSessionId = 100;
  return {
    getCapabilities: () => ({ loadSession: spec.loadSessionCapability }),
    async newSession() {
      calls.newSession += 1;
      if (spec.newSessionImpl) return spec.newSessionImpl();
      return `fresh-${nextSessionId++}`;
    },
    async loadSession(req) {
      calls.loadSession.push({ sessionId: req.sessionId });
      if (spec.loadSessionImpl) await spec.loadSessionImpl(req.sessionId);
    },
    async prompt(sessionId: unknown) {
      calls.prompt.push({ sessionId: String(sessionId) });
      if (spec.promptImpl) return spec.promptImpl();
      return { stopReason: 'end_turn' };
    },
    async cancel() { /* noop */ },
    calls,
  };
}

// ── Singleton plumbing ──────────────────────────────────────────────
//
// runAcpTurn pulls the agent from `globalAcpAgentManager().getAgent(...)`.
// We rebuild the singleton with a custom .getAgent implementation per
// test by replacing it on the prototype-free object. `drop` is a no-op
// here because we don't actually run a subprocess, but it must exist so
// the recovery branch in runAcpTurn can call it without throwing.

let dropCalled = 0;

function installAgentSingleton(stub: StubAgent): void {
  // We bypass the AcpAgentManager class entirely — runAcpTurn only
  // calls `getAgent` and `drop` on the singleton, so a duck-typed
  // replacement is enough.
  const fakeManager = {
    getAgent: async () => stub as unknown,
    drop: () => { dropCalled += 1; },
  };
  // The singleton is obtained via globalAcpAgentManager() — we can't
  // intercept that without a direct override. Instead, we set the
  // module-internal cache by importing a reset+seed helper. The
  // current module exposes _resetAcpAgentManagerForTests but no
  // seeder, so we monkey-patch the global lazily via a Proxy trick:
  // reset to null, then on first getAgent call from runAcpTurn, the
  // factory rebuilds the singleton — at which point we mutate it.
  _resetAcpAgentManagerForTests();
  // Direct approach — replace the singleton's internals via the
  // module's exported globalAcpAgentManager() factory once it
  // constructs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as {
    globalAcpAgentManager: () => Record<string, unknown>;
  };
  const live = mod.globalAcpAgentManager();
  live['getAgent'] = fakeManager.getAgent;
  live['drop'] = fakeManager.drop;
}

beforeEach(() => {
  dropCalled = 0;
  // Per-test tmpdir for the global session-store. The store
  // constructor reads $XDG_CONFIG_HOME on first instantiation, and
  // _resetAcpSessionStoreForTests() forces re-instantiation, so
  // setting the env BEFORE reset gives us a fresh isolated path.
  testConfigDir = mkdtempSync(join(tmpdir(), 'turn-runner-config-'));
  process.env.XDG_CONFIG_HOME = testConfigDir;
  delete process.env.ELANOUS_STATE_DIR;
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
});

afterEach(() => {
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
  if (testConfigDir) {
    try { rmSync(testConfigDir, { recursive: true, force: true }); } catch { /* noop */ }
    testConfigDir = null;
  }
  if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  if (ORIGINAL_ELANOUS_STATE_DIR === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = ORIGINAL_ELANOUS_STATE_DIR;
});

describe('runAcpTurn · L3 · loadSession-first validation (capability=true)', () => {
  test('stored id + loadSession ok → reuses id, validates once across turns', async () => {
    // Seed the (XDG-isolated) global store with a "from prior process"
    // id that the agent confirms is alive on loadSession.
    globalAcpSessionStore().set('chat-A', 'codex', 'stored-sess-1');

    const agent = makeStubAgent({ loadSessionCapability: true });
    installAgentSingleton(agent);

    const r1 = await runAcpTurn({
      backendId: 'codex',
      promptText: 'hello',
      chatId: 'chat-A',
    });
    expect(r1.stopReason).toBe('end_turn');
    expect(agent.calls.loadSession.length).toBe(1);
    expect(agent.calls.loadSession[0]!.sessionId).toBe('stored-sess-1');
    expect(agent.calls.newSession).toBe(0);
    expect(agent.calls.prompt[0]!.sessionId).toBe('stored-sess-1');

    // Second turn — we already validated; loadSession must NOT be
    // called again on the hot path.
    const r2 = await runAcpTurn({
      backendId: 'codex',
      promptText: 'follow-up',
      chatId: 'chat-A',
    });
    expect(r2.stopReason).toBe('end_turn');
    expect(agent.calls.loadSession.length).toBe(1); // unchanged
    expect(agent.calls.prompt.length).toBe(2);
  });

  test('alias and canonical records resolve to the canonical session in both file orders', async () => {
    const storeDir = join(testConfigDir!, 'elanous');
    mkdirSync(storeDir, { recursive: true });
    const updatedAt = new Date().toISOString();
    const alias = { chatId: 'chat-alias', backendId: 'codex', sessionId: 'alias-session', updatedAt, mintedEpoch: ACP_SESSION_EPOCH, turnCount: 0 };
    const canonical = { chatId: 'chat-alias', backendId: 'codex-app-server', sessionId: 'canonical-session', updatedAt, mintedEpoch: ACP_SESSION_EPOCH, turnCount: 0 };
    const storePath = join(storeDir, 'acp-sessions.json');

    for (const records of [[alias, canonical], [canonical, alias]]) {
      writeFileSync(storePath, JSON.stringify(records));
      _resetAcpSessionStoreForTests();
      expect(globalAcpSessionStore().get('chat-alias', 'codex')).toBe('canonical-session');
      expect(globalAcpSessionStore().list()).toHaveLength(1);
    }

    const agent = makeStubAgent({ loadSessionCapability: true });
    installAgentSingleton(agent);
    await runAcpTurn({ backendId: 'codex', promptText: 'hello', chatId: 'chat-alias' });

    expect(agent.calls.loadSession).toEqual([{ sessionId: 'canonical-session' }]);
    expect(globalAcpSessionStore().get('chat-alias', 'codex-app-server')).toBe('canonical-session');
  });

  test('drops invalid timestamps before canonical selection regardless of file order', () => {
    const storeDir = join(testConfigDir!, 'elanous');
    mkdirSync(storeDir, { recursive: true });
    const valid = { chatId: 'chat-invalid-date', backendId: 'codex-app-server', sessionId: 'valid-session', updatedAt: '2026-08-28T00:00:00.000Z', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 0 };
    const invalid = { chatId: 'chat-invalid-date', backendId: 'codex-app-server', sessionId: 'invalid-session', updatedAt: 'not-a-date', mintedEpoch: ACP_SESSION_EPOCH, turnCount: 0 };
    const storePath = join(storeDir, 'acp-sessions.json');

    for (const records of [[invalid, valid], [valid, invalid]]) {
      writeFileSync(storePath, JSON.stringify(records));
      _resetAcpSessionStoreForTests();
      expect(globalAcpSessionStore().get('chat-invalid-date', 'codex')).toBe('valid-session');
      expect(globalAcpSessionStore().list()).toHaveLength(1);
    }
  });

  test('stored id + loadSession throws stale → drops + mints + prompt against fresh id', async () => {
    const live = globalAcpSessionStore();
    live.set('chat-B', 'codex', 'stale-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw new Error('codex-app-server · unknown session stale-id');
      },
    });
    installAgentSingleton(agent);

    const r = await runAcpTurn({
      backendId: 'codex',
      promptText: 'hi',
      chatId: 'chat-B',
    });
    expect(r.stopReason).toBe('end_turn');
    expect(agent.calls.loadSession.length).toBe(1);
    expect(agent.calls.newSession).toBe(1);
    expect(agent.calls.prompt.length).toBe(1);
    // Prompt must have used the freshly-minted id, NOT the stale one.
    expect(agent.calls.prompt[0]!.sessionId).not.toBe('stale-id');
    expect(agent.calls.prompt[0]!.sessionId.startsWith('fresh-')).toBe(true);
    // Store must reflect the fresh id, not the stale one.
    expect(globalAcpSessionStore().get('chat-B', 'codex')).toBe(
      agent.calls.prompt[0]!.sessionId,
    );
  });

  test('stored id + loadSession throws non-stale (e.g. 401) → propagates', async () => {
    const live = globalAcpSessionStore();
    live.set('chat-C', 'codex', 'persisted-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw new Error('Unauthorized: invalid API key');
      },
    });
    installAgentSingleton(agent);

    await expect(
      runAcpTurn({ backendId: 'codex', promptText: 'x', chatId: 'chat-C' }),
    ).rejects.toThrow(/Unauthorized/);
    expect(agent.calls.newSession).toBe(0);
    expect(agent.calls.prompt.length).toBe(0);
    // Store entry untouched — non-stale errors must not drop state.
    expect(globalAcpSessionStore().get('chat-C', 'codex')).toBe('persisted-id');
  });

  test('claude-code-acp JSON-RPC stale shape (data.details) is recognized', async () => {
    const live = globalAcpSessionStore();
    live.set('chat-D', 'claude', 'sdk-stale-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw Object.assign(new Error('Internal error'), {
          code: -32603,
          data: { details: 'Session not found' },
        });
      },
    });
    installAgentSingleton(agent);

    const r = await runAcpTurn({
      backendId: 'claude',
      promptText: 'hi',
      chatId: 'chat-D',
    });
    expect(r.stopReason).toBe('end_turn');
    expect(agent.calls.newSession).toBe(1);
  });
});

describe('runAcpTurn · L2 · ephemeral cache (capability=false)', () => {
  test('first turn mints + caches in-memory · store untouched', async () => {
    const agent = makeStubAgent({ loadSessionCapability: false });
    installAgentSingleton(agent);

    const r = await runAcpTurn({
      backendId: 'gemini',
      promptText: 'hi',
      chatId: 'chat-E',
    });
    expect(r.stopReason).toBe('end_turn');
    expect(agent.calls.newSession).toBe(1);
    // Critical: store must NOT have a record for unresumable backends.
    expect(globalAcpSessionStore().get('chat-E', 'gemini')).toBeNull();
  });

  test('second turn reuses cached id without minting', async () => {
    const agent = makeStubAgent({ loadSessionCapability: false });
    installAgentSingleton(agent);

    await runAcpTurn({ backendId: 'gemini', promptText: 'a', chatId: 'chat-F' });
    await runAcpTurn({ backendId: 'gemini', promptText: 'b', chatId: 'chat-F' });
    expect(agent.calls.newSession).toBe(1);
    expect(agent.calls.prompt.length).toBe(2);
    expect(agent.calls.prompt[0]!.sessionId).toBe(agent.calls.prompt[1]!.sessionId);
    // loadSession must never have been called for an ephemeral backend.
    expect(agent.calls.loadSession.length).toBe(0);
  });

  test('simulated restart (cache cleared) → fresh mint, store still untouched', async () => {
    const agent = makeStubAgent({ loadSessionCapability: false });
    installAgentSingleton(agent);

    await runAcpTurn({ backendId: 'gemini', promptText: '1', chatId: 'chat-G' });
    expect(agent.calls.newSession).toBe(1);

    // Simulate process restart by clearing the in-process caches.
    _resetTurnRunnerCachesForTests();

    await runAcpTurn({ backendId: 'gemini', promptText: '2', chatId: 'chat-G' });
    expect(agent.calls.newSession).toBe(2);
    // Store still empty — the whole point of L2.
    expect(globalAcpSessionStore().get('chat-G', 'gemini')).toBeNull();
  });
});

describe('isStaleSessionError integration sanity', () => {
  test('the same predicate is used by L3 retry path', () => {
    // Belt-and-suspenders — these are also covered by
    // acp-stale-session-detection.test.ts but we re-assert here so
    // any change to the predicate's import path fails this file too.
    expect(isStaleSessionError(new Error('unknown session abc'))).toBe(true);
    expect(isStaleSessionError({ data: { details: 'Session not found' } })).toBe(true);
    expect(isStaleSessionError(new Error('Unauthorized'))).toBe(false);
  });
});

describe('runAcpTurn · L4 · onRecovery callback', () => {
  test('fires once per turn when stale validation drops the persisted id', async () => {
    globalAcpSessionStore().set('chat-R1', 'codex', 'stale-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw new Error('codex-app-server · unknown session stale-id');
      },
    });
    installAgentSingleton(agent);

    const recoveries: Array<{ reason: string; previousSessionId: string; backendId: string }> = [];
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'hi',
      chatId: 'chat-R1',
      onRecovery: (info) => recoveries.push(info),
    });

    expect(recoveries.length).toBe(1);
    expect(recoveries[0]!.previousSessionId).toBe('stale-id');
    expect(recoveries[0]!.reason).toBe('stale-validation');
    expect(recoveries[0]!.backendId).toBe('codex');
  });

  test('fires once when stale validation and the fresh prompt both discard sessions', async () => {
    globalAcpSessionStore().set('chat-R1-double', 'codex', 'stale-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw new Error('codex-app-server · unknown session stale-id');
      },
      promptImpl: async () => {
        throw new Error('codex-app-server · unknown session fresh-id');
      },
    });
    installAgentSingleton(agent);

    const recoveries: Array<{ reason: string; previousSessionId: string; backendId: string }> = [];
    await expect(
      runAcpTurn({
        backendId: 'codex',
        promptText: 'hi',
        chatId: 'chat-R1-double',
        onRecovery: (info) => recoveries.push(info),
      }),
    ).rejects.toThrow(/unknown session fresh-id/);

    expect(agent.calls.newSession).toBe(1);
    expect(recoveries).toEqual([{ reason: 'stale-validation', previousSessionId: 'stale-id', backendId: 'codex' }]);
  });

  test('reason="unsupported-load-session" when AcpLoadSessionUnsupportedError fires', async () => {
    globalAcpSessionStore().set('chat-R2', 'codex', 'old-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        // Mimic the SDK error class — runAcpTurn detects via
        // err.name + message regex (avoids circular import).
        const e = new Error("peer 'codex' did not advertise loadSession capability");
        e.name = 'AcpLoadSessionUnsupportedError';
        throw e;
      },
    });
    installAgentSingleton(agent);

    const reasons: string[] = [];
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'hi',
      chatId: 'chat-R2',
      onRecovery: (info) => reasons.push(info.reason),
    });
    expect(reasons).toEqual(['unsupported-load-session']);
  });

  test('onRecovery callback errors do not wedge the recovery flow', async () => {
    globalAcpSessionStore().set('chat-R3', 'codex', 'stale-id');

    const agent = makeStubAgent({
      loadSessionCapability: true,
      loadSessionImpl: async () => {
        throw new Error('Session not found');
      },
    });
    installAgentSingleton(agent);

    const r = await runAcpTurn({
      backendId: 'codex',
      promptText: 'hi',
      chatId: 'chat-R3',
      onRecovery: () => { throw new Error('listener crashed'); },
    });
    // Must still complete normally.
    expect(r.stopReason).toBe('end_turn');
    expect(agent.calls.newSession).toBe(1);
  });

  test('onRecovery is NOT called on a clean first turn (no stored id)', async () => {
    const agent = makeStubAgent({ loadSessionCapability: true });
    installAgentSingleton(agent);

    const recoveries: unknown[] = [];
    await runAcpTurn({
      backendId: 'codex',
      promptText: 'hi',
      chatId: 'chat-R4',
      onRecovery: (info) => recoveries.push(info),
    });
    expect(recoveries.length).toBe(0);
  });
});
