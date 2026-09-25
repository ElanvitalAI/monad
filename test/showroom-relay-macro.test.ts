// Showroom v2 · /relay macro tests.
//
// Covers PLAN §D8 — sequential plan-build-review · broadcast fan-out
// · explicit `<from> -> <toA>,<toB>` · per-step audit · failed steps
// non-aborting.

import { describe, test, expect } from 'bun:test';
import { executeRelaySlash } from '../src/showroom/relay-macro.js';
import { AgentRoomRegistry } from '../src/agent-room/registry.js';
import type { AgentRoomInstance } from '../src/agent-room/types.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type { ControlAuditEvent } from '../src/control-audit-log.js';
import type { SnapshotResult } from '../src/capture/providers/types.js';

function fakeRoom(
  registry: AgentRoomRegistry,
  members: Array<{ brand: string; roleHint?: 'plan' | 'exec' | 'review' | 'reflect' }>,
): AgentRoomInstance {
  const room: AgentRoomInstance = {
    id: registry.nextId(),
    windowId: 9,
    preset: members.length === 2 ? 'two-split' : members.length === 3 ? 'three-split' : 'four-quad',
    members: members.map((m, i) => ({
      sessionId: `sess-${i}`,
      paneId: `pane-${i}`,
      brand: m.brand,
      ...(m.roleHint ? { roleHint: m.roleHint } : {}),
      launchedAt: i + 1,
    })),
    createdAt: Date.now(),
    dispose: async () => {},
  };
  registry.register(room);
  return room;
}

function fakeSession(
  id: string,
  brand: string,
  onSend?: (m: string) => void,
): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand },
    transports: [{ kind: 'pty' as const, id: `pty-${id}`, label: brand }],
    state: () => ({ status: 'running' as const }),
    async send(m) { onSend?.(m); },
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

function makeInjectDeps(sessions: Record<string, EmbodiedAgentSession>) {
  const audits: ControlAuditEvent[] = [];
  const approverReqs: ConfirmOpts[] = [];
  return {
    audits,
    approverReqs,
    deps: {
      registry: { async snapshot(): Promise<SnapshotResult> {
        return {
          sourceId: 'vw-pane:9/pane-0',
          format: 'text',
          body: 'relay content',
          bytes: 13,
          dims: { cols: 80, rows: 24 },
          capturedAt: 1_700_000_000_000,
          warnings: [],
        };
      } },
      lookupSession: (id: string) =>
        sessions[id] ? { session: sessions[id]! } : undefined,
      approver: async (req: ConfirmOpts): Promise<ConfirmResult> => {
        approverReqs.push(req);
        return { answer: true, channel: 'terminal' as const, elapsedMs: 1 };
      },
      audit: (ev: ControlAuditEvent) => { audits.push(ev); },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('/relay · plan-build-review', () => {
  test('3-step macro · all approved', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'claude', roleHint: 'plan' },
      { brand: 'codex',  roleHint: 'exec' },
      { brand: 'gemini', roleHint: 'review' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    const captured: string[] = [];
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand, (msg) => {
        captured.push(msg);
      });
    }
    const { audits, deps } = makeInjectDeps(sessions);

    const r = await executeRelaySlash(
      { name: 'relay', args: ['plan-build-review'] },
      { registry: reg, injectDeps: deps },
    );

    expect(r?.ok).toBe(true);
    // 2 hops · plan→exec then exec→review.
    expect(captured.length).toBe(2);
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/2 step/);
    expect(text).toMatch(/✓ step 0/);
    expect(text).toMatch(/✓ step 1/);
  });

  test('rejects rooms with fewer than 3 panes', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'claude' }, { brand: 'codex' }]);
    const r = await executeRelaySlash(
      { name: 'relay', args: ['plan-build-review'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/needs 3\+/);
  });
});

describe('/relay · broadcast', () => {
  test('lane 0 → all others', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' }, { brand: 'gemini' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    const sendCounts: Record<string, number> = {};
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand, () => {
        sendCounts[m.sessionId] = (sendCounts[m.sessionId] ?? 0) + 1;
      });
    }
    const { deps } = makeInjectDeps(sessions);

    const r = await executeRelaySlash(
      { name: 'relay', args: ['broadcast'] },
      { registry: reg, injectDeps: deps },
    );
    expect(r?.ok).toBe(true);
    // lane 0 = source · should not have received
    expect(sendCounts[room.members[0]!.sessionId]).toBeUndefined();
    expect(sendCounts[room.members[1]!.sessionId]).toBe(1);
    expect(sendCounts[room.members[2]!.sessionId]).toBe(1);
  });

  test('--from <lane> sets explicit source', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' }, { brand: 'gemini' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    const sendCounts: Record<string, number> = {};
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand, () => {
        sendCounts[m.sessionId] = (sendCounts[m.sessionId] ?? 0) + 1;
      });
    }
    const { deps } = makeInjectDeps(sessions);

    const r = await executeRelaySlash(
      { name: 'relay', args: ['broadcast', '--from', '1'] },
      { registry: reg, injectDeps: deps },
    );
    expect(r?.ok).toBe(true);
    expect(sendCounts[room.members[1]!.sessionId]).toBeUndefined();
    expect(sendCounts[room.members[0]!.sessionId]).toBe(1);
    expect(sendCounts[room.members[2]!.sessionId]).toBe(1);
  });
});

describe('/relay · explicit fan-out', () => {
  test('0 -> 1,2', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' }, { brand: 'gemini' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    const sendCounts: Record<string, number> = {};
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand, () => {
        sendCounts[m.sessionId] = (sendCounts[m.sessionId] ?? 0) + 1;
      });
    }
    const { deps } = makeInjectDeps(sessions);

    const r = await executeRelaySlash(
      { name: 'relay', args: ['0', '->', '1,2'] },
      { registry: reg, injectDeps: deps },
    );
    expect(r?.ok).toBe(true);
    expect(sendCounts[room.members[1]!.sessionId]).toBe(1);
    expect(sendCounts[room.members[2]!.sessionId]).toBe(1);
  });

  test('source matching target rejects', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await executeRelaySlash(
      { name: 'relay', args: ['0', '->', '0'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
  });
});

describe('/relay watch · sub-commands (Arc 4)', () => {
  test('watch help', async () => {
    const r = await executeRelaySlash({ name: 'relay', args: ['watch', 'help'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/auto-propose handoffs/);
  });

  test('watch start with no live room → error', async () => {
    // Pass an empty registry orchestrator stub that surfaces the error.
    const r = await executeRelaySlash(
      { name: 'relay', args: ['watch', 'start'] },
      {
        orchestrator: {
          start: async () => ({ ok: false, message: 'no live room' }),
          stop: async () => ({ ok: false, message: '' }),
          status: () => ({ active: false, watcherCount: 0, proposalsSeen: 0, dispatched: 0, denied: 0 }),
        },
      },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/no live room/);
  });

  test('watch start ok', async () => {
    const r = await executeRelaySlash(
      { name: 'relay', args: ['watch', 'start'] },
      {
        orchestrator: {
          start: async () => ({ ok: true, message: 'auto-relay watching room-1 · 2 lanes' }),
          stop: async () => ({ ok: false, message: '' }),
          status: () => ({ active: true, roomId: 'room-1', watcherCount: 2, proposalsSeen: 0, dispatched: 0, denied: 0 }),
        },
      },
    );
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/auto-relay watching room-1/);
  });

  test('watch status idle', async () => {
    const r = await executeRelaySlash(
      { name: 'relay', args: ['watch', 'status'] },
      {
        orchestrator: {
          start: async () => ({ ok: false, message: '' }),
          stop: async () => ({ ok: false, message: '' }),
          status: () => ({ active: false, watcherCount: 0, proposalsSeen: 0, dispatched: 0, denied: 0 }),
        },
      },
    );
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/idle/);
  });

  test('watch status active with counts', async () => {
    const r = await executeRelaySlash(
      { name: 'relay', args: ['watch', 'status'] },
      {
        orchestrator: {
          start: async () => ({ ok: false, message: '' }),
          stop: async () => ({ ok: false, message: '' }),
          status: () => ({
            active: true, roomId: 'room-2', watcherCount: 3,
            proposalsSeen: 5, dispatched: 4, denied: 1,
          }),
        },
      },
    );
    expect(r?.ok).toBe(true);
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/watching room-2/);
    expect(text).toMatch(/3 lane/);
    expect(text).toMatch(/proposals=5/);
    expect(text).toMatch(/dispatched=4/);
    expect(text).toMatch(/denied=1/);
  });

  test('watch unknown sub → error', async () => {
    const r = await executeRelaySlash(
      { name: 'relay', args: ['watch', 'bogus'] },
      {
        orchestrator: {
          start: async () => ({ ok: false, message: '' }),
          stop: async () => ({ ok: false, message: '' }),
          status: () => ({ active: false, watcherCount: 0, proposalsSeen: 0, dispatched: 0, denied: 0 }),
        },
      },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/unknown sub/);
  });
});

describe('/relay · errors', () => {
  test('no live room', async () => {
    const reg = new AgentRoomRegistry();
    const r = await executeRelaySlash(
      { name: 'relay', args: ['plan-build-review'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/no live agent room/);
  });

  test('unknown macro', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await executeRelaySlash(
      { name: 'relay', args: ['bogus-macro'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/unknown macro/);
  });

  test('mis-routed slash name → null', async () => {
    const r = await executeRelaySlash({ name: 'route', args: [] });
    expect(r).toBeNull();
  });

  test('help', async () => {
    const r = await executeRelaySlash({ name: 'relay', args: ['help'] });
    expect(r?.ok).toBe(true);
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/multi-lane handoff macros/);
    expect(text).toMatch(/plan-build-review/);
    expect(text).toMatch(/broadcast/);
  });
});
