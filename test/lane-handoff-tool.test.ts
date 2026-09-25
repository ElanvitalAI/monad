// Showroom v2 · LaneHandoff LLM tool tests.
//
// Covers PLAN §D9 — args validation, integer/string lane addresses,
// reason captured in metadata, system error → isError.

import { describe, test, expect } from 'bun:test';
import {
  buildLaneHandoffTool,
  dispatchLaneHandoff,
} from '../src/skills/tools/lane-handoff.js';
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
    windowId: 11,
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

function injectDeps(sessions: Record<string, EmbodiedAgentSession>) {
  const audits: ControlAuditEvent[] = [];
  const approverReqs: ConfirmOpts[] = [];
  return {
    audits, approverReqs,
    deps: {
      registry: { async snapshot(): Promise<SnapshotResult> {
        return {
          sourceId: 'vw-pane:11/pane-0',
          format: 'text',
          body: 'tool body',
          bytes: 9,
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

// ─── Tests ──────────────────────────────────────────────────────

describe('buildLaneHandoffTool', () => {
  test('LLM tool spec shape', () => {
    const t = buildLaneHandoffTool();
    expect(t.name).toBe('LaneHandoff');
    expect(t.description).toMatch(/cross-LLM handoff/);
    expect((t.parameters as Record<string, unknown>)['required']).toEqual(['fromLane', 'toLane']);
  });
});

describe('dispatchLaneHandoff · happy path', () => {
  test('integer lane addresses', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    let captured: string | undefined;
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand, (msg) => {
        captured = msg;
      });
    }
    const { deps } = injectDeps(sessions);

    const r = await dispatchLaneHandoff({
      fromLane: 0, toLane: 1,
    }, { registry: reg, injectDeps: deps });

    expect(r.isError).toBeUndefined();
    expect(r.metadata.ok).toBe(true);
    expect(r.metadata.fromLane).toBe('0');
    expect(r.metadata.toLane).toBe('1');
    expect(captured).toBeDefined();
  });

  test('string lane addresses · brand match', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand);
    }
    const { deps } = injectDeps(sessions);

    const r = await dispatchLaneHandoff({
      fromLane: 'codex', toLane: 'claude',
    }, { registry: reg, injectDeps: deps });

    expect(r.isError).toBeUndefined();
    expect(r.metadata.ok).toBe(true);
  });

  test('reason captured in metadata', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' }, { brand: 'claude' },
    ]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    for (const m of room.members) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand);
    }
    const { deps } = injectDeps(sessions);

    const r = await dispatchLaneHandoff({
      fromLane: 0, toLane: 1, reason: 'plan ready for build',
    }, { registry: reg, injectDeps: deps });

    expect(r.metadata.reason).toBe('plan ready for build');
  });

  test('explicit roomId routes to that room', async () => {
    const reg = new AgentRoomRegistry();
    const r1 = fakeRoom(reg, [{ brand: 'a' }, { brand: 'b' }]);
    const r2 = fakeRoom(reg, [{ brand: 'c' }, { brand: 'd' }]);
    const sessions: Record<string, EmbodiedAgentSession> = {};
    for (const m of [...r1.members, ...r2.members]) {
      sessions[m.sessionId] = fakeSession(m.sessionId, m.brand);
    }
    const { deps } = injectDeps(sessions);

    const r = await dispatchLaneHandoff({
      fromLane: 0, toLane: 1, roomId: r1.id,
    }, { registry: reg, injectDeps: deps });

    expect(r.metadata.ok).toBe(true);
    expect(r.metadata.roomId).toBe(r1.id);
  });
});

describe('dispatchLaneHandoff · errors', () => {
  test('missing fromLane', async () => {
    const r = await dispatchLaneHandoff({ toLane: 1 });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/fromLane required/);
  });

  test('missing toLane', async () => {
    const r = await dispatchLaneHandoff({ fromLane: 0 });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/toLane required/);
  });

  test('invalid as', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await dispatchLaneHandoff({
      fromLane: 0, toLane: 1, as: 'bogus',
    }, { registry: reg });
    expect(r.isError).toBe(true);
  });

  test('no live room → isError set', async () => {
    const reg = new AgentRoomRegistry();
    const r = await dispatchLaneHandoff({
      fromLane: 0, toLane: 1,
    }, { registry: reg });
    expect(r.isError).toBe(true);
  });
});
