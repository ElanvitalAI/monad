// MVP M2.3 — server-side loadSession handler tests.
//
// Drives the helper directly so we test the wire-level behavior
// (session registry mutation + idempotency + unknown-id rejection)
// without spinning up a full ACP transport. The end-to-end variant
// (real client → server `session/load` round-trip) lives in
// `tui-attach-daemon-loadsession.test.ts`.

import { describe, expect, test } from 'bun:test';

import {
  acpServerLoadSession,
  acpServerRegisterSession,
  type AcpServerSession,
} from '../src/acp/server.js';
import { globalDualRoleManager } from '../src/acp/dual-role-manager.js';
import { buildAgentDeclaration } from '../src/acp/capabilities.js';

describe('buildAgentDeclaration() — loadSession default', () => {
  test('declares loadSession: true by default (M2.3)', () => {
    const decl = buildAgentDeclaration();
    expect(decl.loadSession).toBe(true);
  });

  test('explicit loadSession: false suppresses the advertisement', () => {
    const decl = buildAgentDeclaration({ loadSession: false });
    expect(decl.loadSession).toBe(false);
  });
});

describe('acpServerLoadSession()', () => {
  test('registers an existing session id on this connection', () => {
    const sessions = new Map<string, AcpServerSession>();
    const dualRole = globalDualRoleManager();
    const record = acpServerLoadSession(sessions, dualRole, 'elanous-session-7', '/tmp');
    expect(record.id).toBe('elanous-session-7');
    expect(sessions.has('elanous-session-7')).toBe(true);
    expect(sessions.get('elanous-session-7')!.cwd).toBe('/tmp');
  });

  test('rejects double-load on the same connection', () => {
    const sessions = new Map<string, AcpServerSession>();
    const dualRole = globalDualRoleManager();
    acpServerLoadSession(sessions, dualRole, 'dup-id', '/tmp');
    expect(() => acpServerLoadSession(sessions, dualRole, 'dup-id', '/tmp'))
      .toThrow(/already registered/);
  });

  test('coexists with newSession-registered ids on the same connection', () => {
    const sessions = new Map<string, AcpServerSession>();
    const dualRole = globalDualRoleManager();
    let seq = 1;
    const newId = acpServerRegisterSession(
      sessions, dualRole, () => String(seq++), '/cwd-a',
    ).id;
    const loaded = acpServerLoadSession(
      sessions, dualRole, 'external-id-42', '/cwd-b',
    ).id;
    expect(sessions.size).toBe(2);
    expect(newId).toBe('elanous-session-1');
    expect(loaded).toBe('external-id-42');
  });

  test('records cwd from the load request (per-attach metadata)', () => {
    const sessions = new Map<string, AcpServerSession>();
    const record = acpServerLoadSession(sessions, globalDualRoleManager(), 's', '/specific/cwd');
    expect(record.cwd).toBe('/specific/cwd');
    expect(record.aborted).toBe(false);
  });
});
