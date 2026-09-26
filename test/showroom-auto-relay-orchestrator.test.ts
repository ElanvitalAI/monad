// Showroom v2 Arc 4 · auto-relay orchestrator integration tests.
//
// End-to-end (with stubs):
//   - start → no live room → error
//   - start with live room → watchers attach to lanes with observers
//   - lane idle → policy proposes → approver yes → dispatch called
//   - lane idle → approver no → no dispatch · denied count++
//   - room dispose → orchestrator self-stops
//   - already-watching → second start rejects

import { describe, test, expect } from 'bun:test';
import {
  createAutoRelayOrchestrator,
} from '../src/showroom/auto-relay/orchestrator.js';
import { AgentRoomRegistry } from '../src/agent-room/registry.js';
import type { TransportObserver } from '../src/agent/transport-observer.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type {
  AgentRoomInstance,
  AgentRoomMemberInstance,
} from '../src/agent-room/types.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type {
  LaneIdleEvent,
  LaneWatcher,
  LaneWatcherOpts,
} from '../src/showroom/auto-relay/lane-watcher.js';

// ─── Stub watcher factory · captures onIdle so tests can fire ────

interface StubWatcherTrigger {
  readonly sessionId: string;
  fire(idleMs?: number, totalBytes?: number): void;
}

function makeStubWatcher(): {
  startWatcher: (opts: LaneWatcherOpts) => LaneWatcher;
  triggers: StubWatcherTrigger[];
} {
  const triggers: StubWatcherTrigger[] = [];
  const startWatcher = (opts: LaneWatcherOpts): LaneWatcher => {
    triggers.push({
      sessionId: opts.sessionId,
      fire(idleMs = 2500, totalBytes = 100) {
        opts.onIdle({ sessionId: opts.sessionId, idleMs, totalBytes } as LaneIdleEvent);
      },
    });
    return {
      sessionId: opts.sessionId,
      state: () => 'idle' as const,
      stop: async () => {},
    };
  };
  return { startWatcher, triggers };
}

// ─── helpers ──────────────────────────────────────────────────────

function fakeRoom(
  registry: AgentRoomRegistry,
  members: Array<{
    sessionId: string; brand: string;
    roleHint?: AgentRoomMemberInstance['roleHint'];
  }>,
): AgentRoomInstance {
  const room: AgentRoomInstance = {
    id: registry.nextId(),
    windowId: 1,
    preset: members.length === 2 ? 'two-split' : 'three-split',
    members: members.map((m, i) => ({
      sessionId: m.sessionId,
      paneId: `p-${i}`,
      brand: m.brand,
      ...(m.roleHint ? { roleHint: m.roleHint } : {}),
      launchedAt: i,
    })),
    createdAt: Date.now(),
    dispose: async () => {},
  };
  registry.register(room);
  return room;
}

function fakeObserver(initialBytes = 0): TransportObserver & {
  setBytes(n: number): void;
} {
  let body = 'x'.repeat(initialBytes);
  const obs = {
    snapshotChannels(): { [k: string]: string } {
      return body.length > 0 ? { stream: body } : {};
    },
    setBytes(n: number) { body = 'x'.repeat(n); },
    activeChannels: () => [] as readonly string[],
    ingest: () => {},
    dispose: () => {},
  };
  return obs as unknown as TransportObserver & { setBytes(n: number): void };
}

function fakeSession(id: string): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'stub' },
    transports: [{ kind: 'pty' as const, id: `pty-${id}` }],
    state: () => ({ status: 'running' as const }),
    send: async () => {},
    interrupt: async () => {},
    snapshot: async () => '',
    dispose: async () => {},
  };
}

// ─── tests ────────────────────────────────────────────────────────

describe('orchestrator · start/stop preconditions', () => {
  test('start with no live room → error', async () => {
    const reg = new AgentRoomRegistry();
    const o = createAutoRelayOrchestrator({ registry: reg });
    const r = await o.start();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no live agent room/);
  });

  test('start with explicit unknown roomId → error', async () => {
    const reg = new AgentRoomRegistry();
    const o = createAutoRelayOrchestrator({ registry: reg });
    const r = await o.start('room-bogus');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no live room with id/);
  });

  test('start succeeds when latest room exists', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { sessionId: 's0', brand: 'codex' },
      { sessionId: 's1', brand: 'claude' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      idleMs: 200, pollMs: 100,
    });
    const r = await o.start();
    expect(r.ok).toBe(true);
    expect(r.message).toContain(room.id);
    expect(r.message).toMatch(/2 lane/);
    const status = o.status();
    expect(status.active).toBe(true);
    expect(status.watcherCount).toBe(2);

    await o.stop();
    expect(o.status().active).toBe(false);
  });

  test('second start without stop → error', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { sessionId: 's0', brand: 'codex' },
      { sessionId: 's1', brand: 'claude' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
    });
    const r1 = await o.start();
    expect(r1.ok).toBe(true);
    const r2 = await o.start();
    expect(r2.ok).toBe(false);
    expect(r2.message).toMatch(/already watching/);
    await o.stop();
  });

  test('lanes without observer are skipped', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { sessionId: 's0', brand: 'codex' },
      { sessionId: 's1', brand: 'elanous' }, // ACP-only · no observer
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0),
      // s1 → undefined
    };
    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: () => undefined,
    });
    const r = await o.start();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/1 lane/);
    expect(r.message).toMatch(/1 skipped/);
    await o.stop();
  });
});

describe('orchestrator · pipeline (idle → propose → approve → dispatch)', () => {
  async function flush() {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => queueMicrotask(r));
  }

  test('full happy path · approver yes → dispatch ok · stats++', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { sessionId: 's0', brand: 'claude', roleHint: 'plan' },
      { sessionId: 's1', brand: 'codex',  roleHint: 'exec' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const watcher = makeStubWatcher();
    const dispatchedCalls: string[][] = [];
    const approverCalls: ConfirmOpts[] = [];

    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      startWatcher: watcher.startWatcher,
      approver: async (req): Promise<ConfirmResult> => {
        approverCalls.push(req);
        return { answer: true, channel: 'terminal', elapsedMs: 1 };
      },
      dispatchHandoff: async (args) => {
        dispatchedCalls.push([...args]);
        return { ok: true };
      },
    });

    await o.start();
    expect(watcher.triggers.length).toBe(2);

    // Fire idle on lane 0 directly.
    watcher.triggers[0]!.fire(2500, 50);
    await flush();

    expect(approverCalls.length).toBe(1);
    expect(approverCalls[0]?.prompt).toMatch(/claude.*idle/);
    expect(approverCalls[0]?.prompt).toMatch(/Relay to codex/);

    expect(dispatchedCalls.length).toBe(1);
    expect(dispatchedCalls[0]).toContain('0');
    expect(dispatchedCalls[0]).toContain('1');
    expect(dispatchedCalls[0]).toContain('--room');
    expect(dispatchedCalls[0]).toContain(room.id);

    const s = o.status();
    expect(s.proposalsSeen).toBe(1);
    expect(s.dispatched).toBe(1);
    expect(s.denied).toBe(0);

    await o.stop();
  });

  test('approver no → no dispatch · denied count', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { sessionId: 's0', brand: 'claude' },
      { sessionId: 's1', brand: 'codex' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const watcher = makeStubWatcher();
    const dispatchedCalls: unknown[] = [];

    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      startWatcher: watcher.startWatcher,
      approver: async (): Promise<ConfirmResult> => ({
        answer: false, channel: 'terminal', elapsedMs: 1,
      }),
      dispatchHandoff: async (args) => {
        dispatchedCalls.push(args); return { ok: true };
      },
    });

    await o.start();
    watcher.triggers[0]!.fire();
    await flush();

    expect(dispatchedCalls.length).toBe(0);
    const s = o.status();
    expect(s.proposalsSeen).toBe(1);
    expect(s.dispatched).toBe(0);
    expect(s.denied).toBe(1);

    await o.stop();
  });

  test('terminal role (review in 3-pane) → no proposal', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { sessionId: 's0', brand: 'claude', roleHint: 'plan' },
      { sessionId: 's1', brand: 'codex',  roleHint: 'exec' },
      { sessionId: 's2', brand: 'gemini', roleHint: 'review' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0), s2: fakeObserver(0),
    };
    const watcher = makeStubWatcher();
    const dispatchedCalls: unknown[] = [];
    const approverCalls: ConfirmOpts[] = [];

    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      startWatcher: watcher.startWatcher,
      approver: async (req) => {
        approverCalls.push(req);
        return { answer: true, channel: 'terminal' as const, elapsedMs: 1 };
      },
      dispatchHandoff: async (args) => {
        dispatchedCalls.push(args); return { ok: true };
      },
    });

    await o.start();
    // Lane 2 (review) goes idle · terminal role · no proposal.
    watcher.triggers[2]!.fire();
    await flush();

    expect(approverCalls.length).toBe(0);
    expect(dispatchedCalls.length).toBe(0);
    expect(o.status().proposalsSeen).toBe(0);

    await o.stop();
  });

  test('proposalInFlight gate — second idle dropped while first awaits approver', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { sessionId: 's0', brand: 'codex' },
      { sessionId: 's1', brand: 'claude' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const watcher = makeStubWatcher();
    let resolveApprover: ((r: ConfirmResult) => void) = () => {};
    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      startWatcher: watcher.startWatcher,
      approver: () => new Promise<ConfirmResult>((r) => { resolveApprover = r; }),
      dispatchHandoff: async () => ({ ok: true }),
    });

    await o.start();
    watcher.triggers[0]!.fire();
    // Yield enough for handleIdle's sync prologue to run + approver
    // promise to be created.
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => queueMicrotask(r));
    expect(o.status().proposalsSeen).toBe(1);

    // Second fire while first proposal is awaiting approver → dropped.
    watcher.triggers[1]!.fire();
    for (let i = 0; i < 3; i++) await new Promise<void>((r) => queueMicrotask(r));
    expect(o.status().proposalsSeen).toBe(1); // still 1

    // Resolve the first approver.
    resolveApprover({ answer: true, channel: 'terminal', elapsedMs: 1 });
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => queueMicrotask(r));
    expect(o.status().dispatched).toBe(1);

    await o.stop();
  });
});

describe('orchestrator · room dispose auto-cleanup', () => {
  test('registry dispose event tears down watcher', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { sessionId: 's0', brand: 'codex' },
      { sessionId: 's1', brand: 'claude' },
    ]);
    const observers: Record<string, TransportObserver> = {
      s0: fakeObserver(0), s1: fakeObserver(0),
    };
    const watcher = makeStubWatcher();
    const o = createAutoRelayOrchestrator({
      registry: reg,
      findObserver: (id) => observers[id],
      findSession: (id) => ({
        session: fakeSession(id), windowId: 1, paneId: 'p', ptyId: 'pty',
      }),
      startWatcher: watcher.startWatcher,
    });
    await o.start();
    expect(o.status().active).toBe(true);

    await reg.dispose(room.id);
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => queueMicrotask(r));

    expect(o.status().active).toBe(false);
  });
});
