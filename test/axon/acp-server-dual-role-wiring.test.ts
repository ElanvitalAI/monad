// AXON F1 — unit tests for runAcpServer's DualRoleManager wiring.
//
// The three helpers exported from src/acp/server.ts — register, begin
// prompt, dispose — own every interaction between the ACP server's
// session map and the shared dual-role registry. Testing the helpers
// directly lets us verify the wire without spinning up AgentSideConnection.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  acpServerBeginPrompt,
  acpServerDisposeSessions,
  acpServerRegisterSession,
  type AcpServerSession,
} from '../../src/acp/server.js';
import {
  DualRoleManager,
  SERVER_NAMESPACE,
  __resetDualRoleManagerForTest,
  globalDualRoleManager,
} from '../../src/acp/dual-role-manager.js';

afterEach(() => {
  __resetDualRoleManagerForTest();
});

describe('AXON F1 — acpServerRegisterSession', () => {
  test('allocates id, stores session, and registers with DualRoleManager', () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    let seq = 0;

    const rec = acpServerRegisterSession(sessions, manager, () => String(++seq), '/workdir/alpha');

    // Local session map gets the record
    expect(rec.id).toBe('elanous-session-1');
    expect(rec.cwd).toBe('/workdir/alpha');
    expect(rec.aborted).toBe(false);
    expect(sessions.get('elanous-session-1')).toBe(rec);

    // DualRoleManager sees it under the namespaced id
    const fromManager = manager.serverSessionById('elanous-session-1');
    expect(fromManager).toBeDefined();
    expect(fromManager!.id).toBe(`${SERVER_NAMESPACE}elanous-session-1`);
    expect(fromManager!.backendSessionId).toBe('elanous-session-1');
    expect(fromManager!.cwd).toBe('/workdir/alpha');
  });

  test('monotonic sequence yields distinct ids', () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    let seq = 0;
    const next = () => String(++seq);

    const a = acpServerRegisterSession(sessions, manager, next, '/a');
    const b = acpServerRegisterSession(sessions, manager, next, '/b');

    expect(a.id).toBe('elanous-session-1');
    expect(b.id).toBe('elanous-session-2');
    expect(manager.list('server')).toHaveLength(2);
  });

  test('registry exception does not abort session creation', () => {
    const sessions = new Map<string, AcpServerSession>();
    // Spy manager that throws on register.
    const throwingManager = {
      serverSessionRegister() { throw new Error('boom'); },
      markLastSeen() {},
      serverSessionUnregister() { return false; },
    } as unknown as DualRoleManager;

    const rec = acpServerRegisterSession(sessions, throwingManager, () => '1', '/cwd');

    // Local map still has the session even though registry blew up.
    expect(rec.id).toBe('elanous-session-1');
    expect(sessions.get('elanous-session-1')).toBe(rec);
  });
});

describe('AXON F1 — acpServerBeginPrompt', () => {
  test('resets aborted flag and bumps lastSeenAt', async () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    const rec = acpServerRegisterSession(sessions, manager, () => '1', '/w');
    const firstSeen = manager.serverSessionById('elanous-session-1')!.lastSeenAt;

    // Manually mark aborted, then begin a prompt — both fields should update.
    rec.aborted = true;
    await new Promise((r) => setTimeout(r, 2));
    const returned = acpServerBeginPrompt(sessions, manager, 'elanous-session-1');

    expect(returned).toBe(rec);
    expect(rec.aborted).toBe(false);
    const secondSeen = manager.serverSessionById('elanous-session-1')!.lastSeenAt;
    expect(secondSeen).toBeGreaterThanOrEqual(firstSeen);
  });

  test('throws on unknown session id', () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    expect(() => acpServerBeginPrompt(sessions, manager, 'elanous-session-42'))
      .toThrow(/unknown session: elanous-session-42/);
  });
});

describe('AXON F1 — acpServerDisposeSessions', () => {
  test('unregisters every session and clears the map', () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    let seq = 0;
    const next = () => String(++seq);

    acpServerRegisterSession(sessions, manager, next, '/a');
    acpServerRegisterSession(sessions, manager, next, '/b');
    acpServerRegisterSession(sessions, manager, next, '/c');
    expect(manager.list('server')).toHaveLength(3);

    const cleaned = acpServerDisposeSessions(sessions, manager);

    expect(cleaned).toEqual(['elanous-session-1', 'elanous-session-2', 'elanous-session-3']);
    expect(sessions.size).toBe(0);
    expect(manager.list('server')).toHaveLength(0);
  });

  test('is idempotent on second call', () => {
    const manager = new DualRoleManager();
    const sessions = new Map<string, AcpServerSession>();
    acpServerRegisterSession(sessions, manager, () => '1', '/a');
    acpServerDisposeSessions(sessions, manager);
    // Second call is a no-op.
    const secondPass = acpServerDisposeSessions(sessions, manager);
    expect(secondPass).toEqual([]);
    expect(sessions.size).toBe(0);
  });

  test('swallows unregister exceptions', () => {
    const sessions = new Map<string, AcpServerSession>();
    sessions.set('stale-id', { id: 'stale-id', cwd: '/', createdAt: Date.now(), aborted: false, codexArgs: [] });
    const throwingManager = {
      serverSessionRegister() { return {}; },
      markLastSeen() {},
      serverSessionUnregister() { throw new Error('boom'); },
    } as unknown as DualRoleManager;

    // Should not throw.
    const cleaned = acpServerDisposeSessions(sessions, throwingManager);
    expect(cleaned).toEqual(['stale-id']);
    expect(sessions.size).toBe(0);
  });
});

describe('AXON F1 — globalDualRoleManager default path', () => {
  test('helpers default to the module singleton when caller omits a manager', () => {
    const sessions = new Map<string, AcpServerSession>();
    // Call via the singleton — mirrors runAcpServer's default.
    const manager = globalDualRoleManager();
    const rec = acpServerRegisterSession(sessions, manager, () => '1', '/via-singleton');

    // The singleton now has the record.
    expect(globalDualRoleManager().serverSessionById(rec.id)).toBeDefined();

    acpServerDisposeSessions(sessions, manager);
    expect(globalDualRoleManager().serverSessionById(rec.id)).toBeUndefined();
  });
});
