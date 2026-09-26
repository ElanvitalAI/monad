// Unit tests for ACP follow-up #1 — Auto-persist on turn-end.
//
// Covers:
//   - DRM end_turn → persist called with accumulated history
//   - DRM non-end_turn stopReason → no persist
//   - BG terminal state → persist called with initialMessage + fullOutput
//   - BG intermediate state (running → waiting) → no persist
//   - mode 'off' → no subscription
//   - dispose() unsubscribes cleanly

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
  wireAutoPersist,
  defaultAcpAutoPersistMode,
} from '../src/acp/auto-persist.js';
import {
  DualRoleManager,
  __resetDualRoleManagerForTest,
} from '../src/acp/dual-role-manager.js';
import {
  createBackgroundManager,
  type BackgroundManager,
  type BackgroundSessionRecord,
} from '../src/acp/background-manager.js';
import type { AcpSessionPersistence, PersistedAcpSession } from '../src/acp/session-persistence.js';

function makeFakePersistence(): {
  persistence: AcpSessionPersistence;
  persisted: Array<Parameters<AcpSessionPersistence['persist']>[0]>;
} {
  const persisted: Array<Parameters<AcpSessionPersistence['persist']>[0]> = [];
  const persistence: AcpSessionPersistence = {
    basePath: '/fake',
    persist: mock((input: Parameters<AcpSessionPersistence['persist']>[0]) => {
      persisted.push(input);
      return {
        ...input,
        createdAt: input.createdAt ?? 0,
        lastSeenAt: 0,
      } as PersistedAcpSession;
    }),
    load: mock(() => null),
    list: mock(() => []),
    remove: mock(() => false),
  };
  return { persistence, persisted };
}

function makeFakeAgent(opts: {
  stopReason?: string;
  protocolVersion?: number;
  textChunks?: string[];
} = {}) {
  const stopReason = opts.stopReason ?? 'end_turn';
  const chunks = opts.textChunks ?? [];
  return {
    newSession: mock(async () => 'backend-' + Math.random().toString(36).slice(2, 8)),
    prompt: mock(async (_sid: string, _blocks: unknown, onUpdate: any) => {
      for (const t of chunks) {
        onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
      }
      return { stopReason };
    }),
    cancel: mock(async () => {}),
    getCapabilities: () => opts.protocolVersion !== undefined
      ? { protocolVersion: opts.protocolVersion }
      : null,
  };
}

// Fresh manager per test to avoid cross-test state bleed — the
// module-level __resetDualRoleManagerForTest only swaps the singleton,
// but wireAutoPersist takes the DRM instance by argument.
function makeDrm(agent: ReturnType<typeof makeFakeAgent>): DualRoleManager {
  const drm = new DualRoleManager();
  drm.__setAgentFactoryForTest(async () => agent as any);
  return drm;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('defaultAcpAutoPersistMode', () => {
  test("is always 'auto' — the ELANOUS_ACP_PERSIST_MODE off-switch was graduated (2026-09-26)", () => {
    process.env.ELANOUS_ACP_PERSIST_MODE = 'off';
    try { expect(defaultAcpAutoPersistMode()).toBe('auto'); } finally { delete process.env.ELANOUS_ACP_PERSIST_MODE; }
  });
});

describe('wireAutoPersist · mode', () => {
  test("mode 'off' returns handle without subscribing", async () => {
    const { persistence, persisted } = makeFakePersistence();
    const agent = makeFakeAgent();
    const drm = makeDrm(agent);
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'off' });
    expect(handle.mode).toBe('off');

    // Run a full turn · no persist should fire.
    const record = await drm.clientSessionCreate({ backendId: 'claude', cwd: '/x' });
    await drm.clientSessionSend({ sessionId: record.id, message: 'hi' });
    await flush();
    expect(persisted).toHaveLength(0);
    handle.dispose();
  });

  test("mode 'auto' subscribes + persists on end_turn", async () => {
    const { persistence, persisted } = makeFakePersistence();
    const agent = makeFakeAgent({
      stopReason: 'end_turn',
      protocolVersion: 1,
      textChunks: ['hello ', 'world'],
    });
    const drm = makeDrm(agent);
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });

    const record = await drm.clientSessionCreate({ backendId: 'claude', cwd: '/p' });
    await drm.clientSessionSend({ sessionId: record.id, message: 'question' });
    await flush();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.sessionId).toBe(record.id);
    expect(persisted[0]!.backendId).toBe('claude');
    expect(persisted[0]!.cwd).toBe('/p');
    expect(persisted[0]!.protocolVersion).toBe(1);
    expect(persisted[0]!.history).toEqual([
      { type: 'text', text: 'question' },
      { type: 'text', text: 'hello world' },
    ]);
    expect(persisted[0]!.planSnapshot).toBeNull();
    expect(persisted[0]!.toolCalls).toEqual([]);
    handle.dispose();
  });
});

describe('DRM turn-end persistence · stopReason filter', () => {
  let persistence: AcpSessionPersistence;
  let persisted: Array<Parameters<AcpSessionPersistence['persist']>[0]>;
  let drm: DualRoleManager;
  let bg: BackgroundManager;
  let handle: ReturnType<typeof wireAutoPersist>;

  beforeEach(() => {
    const fake = makeFakePersistence();
    persistence = fake.persistence;
    persisted = fake.persisted;
    bg = createBackgroundManager();
  });
  afterEach(() => {
    handle?.dispose();
    __resetDualRoleManagerForTest();
  });

  test('cancelled stopReason → no persist', async () => {
    const agent = makeFakeAgent({ stopReason: 'cancelled' });
    drm = makeDrm(agent);
    handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'hi' });
    await flush();
    expect(persisted).toHaveLength(0);
  });

  test('max_tokens stopReason → no persist', async () => {
    const agent = makeFakeAgent({ stopReason: 'max_tokens' });
    drm = makeDrm(agent);
    handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'hi' });
    await flush();
    expect(persisted).toHaveLength(0);
  });

  test('empty agent text → history omits empty agent block', async () => {
    const agent = makeFakeAgent({ stopReason: 'end_turn', textChunks: [] });
    drm = makeDrm(agent);
    handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'u' });
    await flush();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.history).toEqual([{ type: 'text', text: 'u' }]);
  });

  test('protocolVersion defaults to 1 when agent caps absent', async () => {
    const agent = makeFakeAgent({ stopReason: 'end_turn' });
    drm = makeDrm(agent);
    handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'u' });
    await flush();
    expect(persisted[0]!.protocolVersion).toBe(1);
  });
});

describe('BG state-change persistence', () => {
  test('terminal state triggers persist with initialMessage + fullOutput', async () => {
    const { persistence, persisted } = makeFakePersistence();
    const drm = new DualRoleManager();
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });

    let resolveTurn!: (result: { stopReason: any }) => void;
    const turnPromise = new Promise<{ stopReason: any }>((res) => { resolveTurn = res; });
    let feed: ((text: string) => void) = () => {};
    const record = bg.start({
      clientSessionId: 'acp-cli:claude:live',
      backendSessionId: 'live',
      backendId: 'claude',
      cwd: '/work',
      initialMessage: 'analyze repo',
      turnPromise,
      registerChunk: (f) => { feed = f; },
      registerApprovalSignal: () => {},
    });
    feed('part-1 ');
    feed('part-2');
    resolveTurn({ stopReason: 'end_turn' });
    await flush();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.sessionId).toBe(record.id);
    expect(persisted[0]!.backendId).toBe('claude');
    expect(persisted[0]!.cwd).toBe('/work');
    expect(persisted[0]!.history).toEqual([
      { type: 'text', text: 'analyze repo' },
      { type: 'text', text: 'part-1 part-2' },
    ]);
    handle.dispose();
  });

  test('intermediate waiting_for_confirmation does NOT persist', async () => {
    const { persistence, persisted } = makeFakePersistence();
    const drm = new DualRoleManager();
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });

    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    let signalWaiting: (() => void) = () => {};
    bg.start({
      clientSessionId: 'acp-cli:claude:wait',
      backendSessionId: 'wait',
      backendId: 'claude',
      cwd: '',
      initialMessage: 'start',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: (w) => { signalWaiting = w; },
    });
    signalWaiting();
    await flush();
    expect(persisted).toHaveLength(0);
    handle.dispose();
  });

  test('cancelled state persists (unlike DRM cancelled) — BG history still valuable', async () => {
    const { persistence, persisted } = makeFakePersistence();
    const drm = new DualRoleManager();
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });

    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    let feed: ((text: string) => void) = () => {};
    const record = bg.start({
      clientSessionId: 'acp-cli:claude:cx',
      backendSessionId: 'cx',
      backendId: 'claude',
      cwd: '/work',
      initialMessage: 'long task',
      turnPromise,
      registerChunk: (f) => { feed = f; },
      registerApprovalSignal: () => {},
    });
    feed('partial progress');
    await bg.cancel(record.id, async () => {});
    await flush();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.history).toEqual([
      { type: 'text', text: 'long task' },
      { type: 'text', text: 'partial progress' },
    ]);
    handle.dispose();
  });

  test('origin flows into persisted record', async () => {
    const { persistence, persisted } = makeFakePersistence();
    const drm = new DualRoleManager();
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });

    let resolveTurn!: (r: { stopReason: any }) => void;
    const turnPromise = new Promise<{ stopReason: any }>((res) => { resolveTurn = res; });
    bg.start({
      clientSessionId: 'acp-cli:claude:o',
      backendSessionId: 'o',
      backendId: 'claude',
      cwd: '/o',
      initialMessage: 'orig',
      origin: 'telegram:42',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    resolveTurn({ stopReason: 'end_turn' });
    await flush();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.origin).toBe('telegram:42');
    handle.dispose();
  });
});

describe('wireAutoPersist · dispose', () => {
  test('dispose unsubscribes both DRM and BG', async () => {
    const { persistence, persisted } = makeFakePersistence();
    const agent = makeFakeAgent({ stopReason: 'end_turn' });
    const drm = makeDrm(agent);
    const bg = createBackgroundManager();
    const handle = wireAutoPersist({ drm, bg, persistence, mode: 'auto' });
    handle.dispose();

    // DRM turn · no persist post-dispose.
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'hi' });
    await flush();
    expect(persisted).toHaveLength(0);

    // BG terminal · no persist post-dispose.
    let resolveTurn!: (r: { stopReason: any }) => void;
    const turnPromise = new Promise<{ stopReason: any }>((res) => { resolveTurn = res; });
    bg.start({
      clientSessionId: 'acp-cli:claude:d',
      backendSessionId: 'd',
      backendId: 'claude',
      cwd: '/x',
      initialMessage: 'init',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    resolveTurn({ stopReason: 'end_turn' });
    await flush();
    expect(persisted).toHaveLength(0);
  });
});

describe('DualRoleManager · onTurnEnd infra', () => {
  test('listener receives record + history + stopReason', async () => {
    const agent = makeFakeAgent({ stopReason: 'end_turn', textChunks: ['out'] });
    const drm = makeDrm(agent);
    const events: Array<{ sessionId: string; stopReason: string; historyLen: number }> = [];
    drm.onTurnEnd((ev) => {
      events.push({
        sessionId: ev.record.id,
        stopReason: String(ev.stopReason),
        historyLen: ev.history.length,
      });
    });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'ask' });
    await flush();
    expect(events).toEqual([{ sessionId: rec.id, stopReason: 'end_turn', historyLen: 2 }]);
  });

  test('throwing listener does not derail the turn', async () => {
    const agent = makeFakeAgent({ stopReason: 'end_turn' });
    const drm = makeDrm(agent);
    drm.onTurnEnd(() => { throw new Error('boom'); });
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await expect(
      drm.clientSessionSend({ sessionId: rec.id, message: 'hi' }),
    ).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  test('unsubscribe stops further events', async () => {
    const agent = makeFakeAgent({ stopReason: 'end_turn' });
    const drm = makeDrm(agent);
    const events: string[] = [];
    const unsub = drm.onTurnEnd((ev) => events.push(ev.record.id));
    const rec = await drm.clientSessionCreate({ backendId: 'claude' });
    await drm.clientSessionSend({ sessionId: rec.id, message: 'a' });
    unsub();
    await drm.clientSessionSend({ sessionId: rec.id, message: 'b' });
    expect(events).toHaveLength(1);
  });
});
