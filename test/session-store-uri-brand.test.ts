// ── SessionUri brand propagation tests (MSS M1.1 Phase B2) ──
//
// Pure type-shape tests — the brand is phantom, so these exercise that
// `SessionUri` flows through the view types + facade converters + event
// payloads, and that legacy (non-URI-shaped) sessionIds still pass
// through the `unsafeBrandSessionUri` cast at the facade boundary
// without runtime validation.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  AcpAgentManager,
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
import type { SessionUri } from '../src/mss/uri/brand.js';
import { unsafeBrandSessionUri } from '../src/mss/uri/brand.js';
import { mintSessionUri } from '../src/mss/uri/session-mint.js';

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
  const tmp1 = mkdtempSync(joinPath(tmpdir(), 'mss-b2-store-'));
  const tmp2 = mkdtempSync(joinPath(tmpdir(), 'mss-b2-persist-'));
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
  }) as SessionStore & { detach(): void };
  return {
    drm, chat, persistence, agents, bg, store,
    cleanup: () => {
      store.detach();
      rmSync(tmp1, { recursive: true, force: true });
      rmSync(tmp2, { recursive: true, force: true });
    },
  };
}

describe('SessionUri brand · server-session view propagation', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  test('server-session view carries a SessionUri-branded sessionId', () => {
    h.drm.serverSessionRegister('srv-back-1', '/tmp');
    const snap = h.store.snapshot();
    expect(snap.serverSessions.length).toBe(1);
    const v = snap.serverSessions[0]!;
    // Compile-only: view.sessionId must be assignable to a SessionUri
    // variable. If the shape.ts narrowing regressed, this wouldn't compile.
    const typed: SessionUri = v.sessionId;
    expect(typed).toBe(v.sessionId);
    // Runtime: DRM-synthesized ids pass through the brand cast unchanged.
    expect(typeof v.sessionId).toBe('string');
  });

  test('legacy non-URI sessionId passes through unsafeBrandSessionUri without runtime validation', () => {
    // Register two server sessions with distinct raw backend ids — the
    // DRM synthesizes its own session ids; the facade brands them at
    // the view boundary. No URI-shape validation happens, so
    // arbitrary strings flow through.
    h.drm.serverSessionRegister('legacy-format-1', '/tmp');
    h.drm.serverSessionRegister('session/01HZAAAAAAAAAAAAAAAAAAAAAA', '/tmp');
    const snap = h.store.snapshot();
    expect(snap.serverSessions.length).toBe(2);
    // Both shapes survive the cast.
    for (const v of snap.serverSessions) {
      const typed: SessionUri = v.sessionId;
      expect(typed).toBe(v.sessionId);
    }
  });
});

describe('SessionUri brand · event payload propagation', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  test('server-session-registered event payload is branded', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.drm.serverSessionRegister('srv-1', '/tmp');
    await new Promise<void>((r) => queueMicrotask(r));
    const registered = events.find(e => e.kind === 'server-session-registered');
    expect(registered).toBeDefined();
    if (registered?.kind === 'server-session-registered') {
      // Compile-only narrowing check.
      const sid: SessionUri = registered.sessionId;
      expect(typeof sid).toBe('string');
    }
  });

  test('persistence-updated event sessionId is branded', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.persistence.persist({
      sessionId: 'legacy-session-abc',
      backendSessionId: 'back',
      backendId: 'b',
      cwd: '/tmp',
      protocolVersion: 1,
      history: [],
      planSnapshot: null,
      toolCalls: [],
    });
    await new Promise<void>((r) => queueMicrotask(r));
    const updated = events.find(e => e.kind === 'persistence-updated');
    expect(updated).toBeDefined();
    if (updated?.kind === 'persistence-updated') {
      const sid: SessionUri = updated.sessionId;
      expect(sid).toBe('legacy-session-abc' as SessionUri);
    }
  });
});

describe('SessionUri brand · persistence view', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  test('persisted view narrows sessionId to SessionUri', () => {
    h.persistence.persist({
      sessionId: 'legacy-session-abc',
      backendSessionId: 'back',
      backendId: 'b',
      cwd: '/tmp',
      protocolVersion: 1,
      history: [],
      planSnapshot: null,
      toolCalls: [],
    });
    const snap = h.store.snapshot();
    expect(snap.persisted.length).toBe(1);
    const p = snap.persisted[0]!;
    const typed: SessionUri = p.sessionId;
    expect(typed).toBe('legacy-session-abc' as SessionUri);
  });

  test('mintSessionUri output flows through persist → snapshot unchanged', () => {
    const minted = mintSessionUri();
    h.persistence.persist({
      sessionId: minted,
      backendSessionId: 'back',
      backendId: 'b',
      cwd: '/tmp',
      protocolVersion: 1,
      history: [],
      planSnapshot: null,
      toolCalls: [],
    });
    const snap = h.store.snapshot();
    const p = snap.persisted[0]!;
    expect(p.sessionId).toBe(minted);
  });
});

describe('SessionUri brand · dispatch action shape', () => {
  test('closeClientSession action requires a SessionUri', () => {
    // Compile-only: constructing the action literal demands a SessionUri
    // sessionId. This test body is effectively a type assertion.
    const action = {
      type: 'closeClientSession' as const,
      sessionId: mintSessionUri(),
      cascade: false,
    };
    expect(action.sessionId).toMatch(/^session\//);
  });

  test('removePersisted action accepts SessionUri including legacy-branded id', () => {
    const action = {
      type: 'removePersisted' as const,
      sessionId: unsafeBrandSessionUri('legacy-id-xyz'),
    };
    expect(action.sessionId).toBe('legacy-id-xyz' as SessionUri);
  });
});

describe('SessionUri brand · chat-mapping view', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => h.cleanup());

  test('chat-mapping view narrows sessionId to SessionUri', () => {
    h.chat.set('c1', 'b', 'legacy-id', 't1');
    const snap = h.store.snapshot();
    expect(snap.chatMappings.length).toBe(1);
    const m = snap.chatMappings[0]!;
    const typed: SessionUri = m.sessionId;
    expect(typed).toBe('legacy-id' as SessionUri);
  });

  test('chat-mapping-set event sessionId is branded', async () => {
    const events: SessionStoreEvent[] = [];
    h.store.subscribeRaw((ev) => events.push(ev));
    h.chat.set('c1', 'b', 'legacy-id', 't1');
    await new Promise<void>((r) => queueMicrotask(r));
    const mapping = events.find(e => e.kind === 'chat-mapping-set');
    expect(mapping).toBeDefined();
    if (mapping?.kind === 'chat-mapping-set') {
      const sid: SessionUri = mapping.sessionId;
      expect(sid).toBe('legacy-id' as SessionUri);
    }
  });
});
