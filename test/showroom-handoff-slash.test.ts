// Showroom v2 · /lane (handoff) slash tests.
//
// Covers PLAN §D7 — lane address resolution, --as flag, --room flag,
// duplicate-lane rejection, room-not-found error, audit shim's
// lane-aware detail.

import { describe, test, expect } from 'bun:test';
import {
  executeHandoffSlash,
  resolveLaneAddress,
} from '../src/showroom/handoff-slash.js';
import {
  AgentRoomRegistry,
  type AgentRoomSnapshot,
} from '../src/agent-room/registry.js';
import type { AgentRoomInstance } from '../src/agent-room/types.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type { ControlAuditEvent } from '../src/control-audit-log.js';
import type { SnapshotResult } from '../src/capture/providers/types.js';

// ─── Stubs ────────────────────────────────────────────────────────

function fakeRoom(
  registry: AgentRoomRegistry,
  members: Array<{ brand: string; roleHint?: 'plan' | 'exec' | 'review' | 'reflect' }>,
): AgentRoomInstance {
  const room: AgentRoomInstance = {
    id: registry.nextId(),
    windowId: 7,
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

function fakeSnap(): SnapshotResult {
  return {
    sourceId: 'vw-pane:7/pane-0',
    format: 'text',
    body: 'lane content',
    bytes: 12,
    dims: { cols: 80, rows: 24 },
    capturedAt: 1_700_000_000_000,
    warnings: [],
  };
}

interface InjectDepsOverride {
  sessions: Record<string, EmbodiedAgentSession>;
  audits: ControlAuditEvent[];
  approverReqs: ConfirmOpts[];
}

function mkInjectDeps(): InjectDepsOverride {
  return { sessions: {}, audits: [], approverReqs: [] };
}

function injectDeps(o: InjectDepsOverride) {
  return {
    registry: { async snapshot() { return fakeSnap(); } },
    lookupSession: (id: string) =>
      o.sessions[id] ? { session: o.sessions[id]! } : undefined,
    approver: async (req: ConfirmOpts): Promise<ConfirmResult> => {
      o.approverReqs.push(req);
      return { answer: true, channel: 'terminal' as const, elapsedMs: 1 };
    },
    audit: (ev: ControlAuditEvent) => { o.audits.push(ev); },
  };
}

// ─── Tests · resolveLaneAddress ───────────────────────────────────

describe('resolveLaneAddress', () => {
  const registry = new AgentRoomRegistry();
  const room = fakeRoom(registry, [
    { brand: 'codex', roleHint: 'plan' },
    { brand: 'claude', roleHint: 'exec' },
    { brand: 'gemini', roleHint: 'review' },
  ]);
  const snap: AgentRoomSnapshot = {
    id: room.id, windowId: room.windowId, preset: room.preset,
    members: room.members, createdAt: room.createdAt,
  };

  test('integer index 0', () => {
    const r = resolveLaneAddress(snap, '0');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.member.brand).toBe('codex');
  });

  test('integer out of range', () => {
    const r = resolveLaneAddress(snap, '5');
    expect('error' in r).toBe(true);
  });

  test('role hint plan', () => {
    const r = resolveLaneAddress(snap, 'plan');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.index).toBe(0);
  });

  test('build alias resolves to exec', () => {
    const r = resolveLaneAddress(snap, 'build');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.member.roleHint).toBe('exec');
  });

  test('brand match', () => {
    const r = resolveLaneAddress(snap, 'gemini');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.index).toBe(2);
  });

  test('case-insensitive brand', () => {
    const r = resolveLaneAddress(snap, 'GEMINI');
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.member.brand).toBe('gemini');
  });

  test('no match → error', () => {
    const r = resolveLaneAddress(snap, 'mistral');
    expect('error' in r).toBe(true);
  });

  test('empty address → error', () => {
    const r = resolveLaneAddress(snap, '');
    expect('error' in r).toBe(true);
  });
});

// ─── Tests · /lane slash ─────────────────────────────────────────

describe('/lane slash · happy path', () => {
  test('lane 0 → 1 succeeds (PTY target)', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex', roleHint: 'plan' },
      { brand: 'claude', roleHint: 'exec' },
    ]);
    const o = mkInjectDeps();
    let captured: string | undefined;
    o.sessions[room.members[1]!.sessionId] = fakeSession(
      room.members[1]!.sessionId, 'claude',
      (m) => { captured = m; },
    );
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '1'] },
      { registry: reg, injectDeps: injectDeps(o) },
    );
    expect(r?.ok).toBe(true);
    expect(captured).toBeDefined();
    expect(o.audits.length).toBeGreaterThan(0);
    // Audit detail enriched with lane info via shim.
    const audit = o.audits[0]!;
    const detail = audit.detail as Record<string, unknown>;
    expect(detail.lane).toBeDefined();
    const lane = detail.lane as Record<string, unknown>;
    expect(lane.via).toBe('showroom-handoff');
    expect(lane.fromLane).toBe(0);
    expect(lane.toLane).toBe(1);
    expect(lane.fromBrand).toBe('codex');
    expect(lane.toBrand).toBe('claude');
  });

  test('role hints work · plan → exec', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'claude', roleHint: 'plan' },
      { brand: 'codex', roleHint: 'exec' },
    ]);
    const o = mkInjectDeps();
    o.sessions[room.members[1]!.sessionId] = fakeSession(
      room.members[1]!.sessionId, 'codex',
    );
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['plan', 'exec'] },
      { registry: reg, injectDeps: injectDeps(o) },
    );
    expect(r?.ok).toBe(true);
  });

  test('--as system-note wraps body', async () => {
    const reg = new AgentRoomRegistry();
    const room = fakeRoom(reg, [
      { brand: 'codex' },
      { brand: 'claude' },
    ]);
    const o = mkInjectDeps();
    let captured: string | undefined;
    o.sessions[room.members[1]!.sessionId] = fakeSession(
      room.members[1]!.sessionId, 'claude',
      (m) => { captured = m; },
    );
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '1', '--as', 'system-note'] },
      { registry: reg, injectDeps: injectDeps(o) },
    );
    expect(r?.ok).toBe(true);
    expect(captured).toContain('[Context');
  });
});

describe('/lane slash · errors', () => {
  test('no live room → error', async () => {
    const reg = new AgentRoomRegistry();
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '1'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/no live agent room/);
  });

  test('non-existent --room → error', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '1', '--room', 'room-bogus'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/no live room with id/);
  });

  test('same lane both sides → error', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '0'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/same session/);
  });

  test('invalid --as → error', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [{ brand: 'codex' }, { brand: 'claude' }]);
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['0', '1', '--as', 'bogus'] },
      { registry: reg },
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/must be one of/);
  });

  test('mis-routed slash name → null', async () => {
    const r = await executeHandoffSlash({ name: 'route', args: [] });
    expect(r).toBeNull();
  });
});

describe('/lane slash · sub-commands', () => {
  test('help', async () => {
    const r = await executeHandoffSlash({ name: 'lane', args: ['help'] });
    expect(r?.ok).toBe(true);
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/cross-lane context inject/);
    expect(text).toMatch(/HITL approver/);
  });

  test('list shows live rooms with lane index map', async () => {
    const reg = new AgentRoomRegistry();
    fakeRoom(reg, [
      { brand: 'codex', roleHint: 'plan' },
      { brand: 'claude', roleHint: 'exec' },
    ]);
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['list'] }, { registry: reg },
    );
    expect(r?.ok).toBe(true);
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/\[0\] codex \[plan\]/);
    expect(text).toMatch(/\[1\] claude \[exec\]/);
  });

  test('list with no rooms', async () => {
    const reg = new AgentRoomRegistry();
    const r = await executeHandoffSlash(
      { name: 'lane', args: ['list'] }, { registry: reg },
    );
    expect(r?.ok).toBe(true);
    expect(r?.logLines[0]).toMatch(/no live agent rooms/);
  });
});
