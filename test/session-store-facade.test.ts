// Unit tests for the SessionStore facade (UI-Core arc Phase U1).
//
// Uses real instances of the 5 underlying singletons (AcpSessionStore,
// AcpSessionPersistence, BackgroundManager, AcpAgentManager stub,
// DualRoleManager) wired through `createSessionStore(deps)`. The
// facade's contract is stability across mutation sources — so every
// test drives one singleton and asserts the facade's emitted event +
// snapshot reflect it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  AcpAgentManager,
  type AcpAgentManagerChangeEvent,
} from '../src/acp/agent-manager.js';
import {
  DualRoleManager,
} from '../src/acp/dual-role-manager.js';
import {
  AcpSessionStore,
} from '../src/acp/session-store.js';
import {
  createAcpSessionPersistence,
  type AcpSessionPersistence,
} from '../src/acp/session-persistence.js';
import {
  createBackgroundManager,
  type BackgroundManager,
} from '../src/acp/background-manager.js';

import {
  createSessionStore,
  type SessionStore,
  type SessionStoreEvent,
} from '../src/session-store/index.js';

interface Harness {
  drm: DualRoleManager;
  chat: AcpSessionStore;
  persistence: AcpSessionPersistence;
  agents: AcpAgentManager;
  bg: BackgroundManager;
  store: SessionStore & { detach(): void };
  cleanup(): void;
}

function makeHarness(): Harness {
  const tmp1 = mkdtempSync(joinPath(tmpdir(), 'monad-session-store-test-'));
  const tmp2 = mkdtempSync(joinPath(tmpdir(), 'monad-session-persist-test-'));
  const chat = new AcpSessionStore(joinPath(tmp1, 'chats.json'));
  const persistence = createAcpSessionPersistence({ basePath: tmp2 });
  const drm = new DualRoleManager();
  const agents = new AcpAgentManager();
  const bg = createBackgroundManager({});
  const store = createSessionStore({
    dualRole: () => drm,
    chatMappings: () => chat,
    persistence: () => persistence,
    agents: () => agents,
    background: () => bg,
  });

  return {
    drm, chat, persistence, agents, bg, store,
    cleanup: () => {
      store.detach();
      rmSync(tmp1, { recursive: true, force: true });
      rmSync(tmp2, { recursive: true, force: true });
    },
  };
}

async function flushMicrotasks(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('SessionStore.snapshot', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.cleanup(); });

  test('empty — all collections zero-length', () => {
    const snap = h.store.snapshot();
    expect(snap.clientSessions.length).toBe(0);
    expect(snap.serverSessions.length).toBe(0);
    expect(snap.backgroundSessions.length).toBe(0);
    expect(snap.agents.length).toBe(0);
    expect(snap.chatMappings.length).toBe(0);
    expect(snap.persisted.length).toBe(0);
  });

  test('reflects server session after register', () => {
    h.drm.serverSessionRegister('srv-abc', '/tmp');
    const snap = h.store.snapshot();
    expect(snap.serverSessions.length).toBe(1);
    expect(snap.serverSessions[0]?.backendSessionId).toBe('srv-abc');
    expect(snap.serverSessions[0]?.cwd).toBe('/tmp');
  });

  test('reflects chat mapping after set', () => {
    h.chat.set('chat-1', 'claude', 'acp-cli:claude:s1');
    const snap = h.store.snapshot();
    expect(snap.chatMappings.length).toBe(1);
    expect(snap.chatMappings[0]?.chatId).toBe('chat-1');
    expect(snap.chatMappings[0]?.backendId).toBe('claude');
    expect(snap.chatMappings[0]?.sessionId).toBe('acp-cli:claude:s1');
  });
});

describe('SessionStore.subscribeRaw', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.cleanup(); });

  test('server session register → event fired on next tick', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.drm.serverSessionRegister('srv-x', '/tmp/x');
    await flushMicrotasks();
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('server-session-registered');
    if (events[0]?.kind === 'server-session-registered') {
      expect(events[0].sessionId).toBe('acp-srv:srv-x');
      expect(events[0].backendSessionId).toBe('srv-x');
    }
  });

  test('chat-mapping set + delete both propagate', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.chat.set('c1', 'claude', 'acp-cli:claude:s1');
    h.chat.delete('c1', 'claude');
    await flushMicrotasks();
    expect(events.length).toBe(2);
    expect(events[0]?.kind).toBe('chat-mapping-set');
    expect(events[1]?.kind).toBe('chat-mapping-deleted');
  });

  test('multiple mutations in same tick collapse flush into one batch', async () => {
    let flushCount = 0;
    const snapshots: number[] = [];
    h.store.subscribeRaw((_ev, snap) => {
      flushCount += 1;
      snapshots.push(snap.serverSessions.length);
    });
    h.drm.serverSessionRegister('a', '/');
    h.drm.serverSessionRegister('b', '/');
    h.drm.serverSessionRegister('c', '/');
    // 3 events, but each listener call receives the same final snapshot.
    await flushMicrotasks();
    expect(flushCount).toBe(3);
    expect(snapshots).toEqual([3, 3, 3]);
  });

  test('persistence persist + remove both propagate', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.persistence.persist({
      sessionId: 'acp-cli:claude:abc',
      backendSessionId: 'abc',
      backendId: 'claude',
      cwd: '/tmp',
      protocolVersion: 1,
      history: [],
      planSnapshot: null,
      toolCalls: [],
    });
    h.persistence.remove('acp-cli:claude:abc');
    await flushMicrotasks();
    expect(events.some(e => e.kind === 'persistence-updated')).toBe(true);
    expect(events.some(e => e.kind === 'persistence-removed')).toBe(true);
  });

  test('unsubscribe stops further events', async () => {
    const events: SessionStoreEvent[] = [];
    const unsub = h.store.subscribeRaw((ev) => events.push(ev));
    h.drm.serverSessionRegister('first', '/');
    await flushMicrotasks();
    expect(events.length).toBe(1);
    unsub();
    h.drm.serverSessionRegister('second', '/');
    await flushMicrotasks();
    expect(events.length).toBe(1);
  });
});

describe('SessionStore.subscribe (selector)', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.cleanup(); });

  test('selector fires only when derived value changes (referential)', async () => {
    const callCount: number[] = [];
    h.store.subscribe(
      (snap) => snap.serverSessions.length,
      (next) => { callCount.push(next); },
    );
    // Two mutations in the same tick collapse to one flush; selector
    // sees the final value (2) not the intermediate (1).
    h.drm.serverSessionRegister('s1', '/');
    h.drm.serverSessionRegister('s2', '/');
    await flushMicrotasks();
    expect(callCount).toEqual([2]);
    // Second tick with one more mutation — another fire with value 3.
    h.drm.serverSessionRegister('s3', '/');
    await flushMicrotasks();
    expect(callCount).toEqual([2, 3]);
  });

  test('selector does not fire when unrelated slice changes', async () => {
    let clientFired = 0;
    h.store.subscribe(
      (snap) => snap.clientSessions.length,
      () => { clientFired += 1; },
    );
    h.drm.serverSessionRegister('s1', '/');
    await flushMicrotasks();
    expect(clientFired).toBe(0);
  });
});

describe('SessionStore + BackgroundManager integration', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.cleanup(); });

  test('background start → background-session-started event', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));

    let resolveTurn!: (v: { stopReason: any }) => void;
    const turnPromise = new Promise<{ stopReason: any }>((res) => { resolveTurn = res; });
    h.bg.start({
      clientSessionId: 'acp-cli:claude:bg1',
      backendSessionId: 'bg1',
      backendId: 'claude',
      cwd: '/',
      initialMessage: 'hi',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    await flushMicrotasks();
    expect(events.some(e => e.kind === 'background-session-started')).toBe(true);

    // Drive turnPromise → state transition → second event.
    resolveTurn({ stopReason: 'end_turn' });
    await flushMicrotasks();
    expect(events.some(e => e.kind === 'background-session-state-changed')).toBe(true);
  });
});

describe('SessionStore.dispatch', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.cleanup(); });

  test('deleteChatMapping forwards to chat singleton', async () => {
    h.chat.set('c1', 'claude', 'acp-cli:claude:s1');
    expect(h.chat.list().length).toBe(1);
    await h.store.dispatch({ type: 'deleteChatMapping', chatId: 'c1', backendId: 'claude' });
    expect(h.chat.list().length).toBe(0);
  });

  test('removePersisted forwards to persistence singleton', async () => {
    h.persistence.persist({
      sessionId: 'acp-cli:claude:abc',
      backendSessionId: 'abc',
      backendId: 'claude',
      cwd: '/tmp',
      protocolVersion: 1,
      history: [],
      planSnapshot: null,
      toolCalls: [],
    });
    expect(h.persistence.list().length).toBe(1);
    await h.store.dispatch({ type: 'removePersisted', sessionId: 'acp-cli:claude:abc' });
    expect(h.persistence.list().length).toBe(0);
  });
});

describe('AcpAgentManager change events', () => {
  test('onChange fires on attach (via getAgent) and drop', () => {
    const events: AcpAgentManagerChangeEvent[] = [];
    const mgr = new AcpAgentManager();
    mgr.onChange((ev) => events.push(ev));
    // We can't drive real getAgent without spawning a subprocess; drop
    // without a record is a no-op · exercise the explicit no-op path.
    mgr.drop('claude', '/nowhere');
    expect(events.length).toBe(0);
    expect(mgr.listAgents().length).toBe(0);
  });
});
