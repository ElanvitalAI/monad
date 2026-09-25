// ── T6 (Phase 3 Bundle 1) — capability-grant-store + slash tests ──

import { describe, expect, test } from 'bun:test';
import {
  createCapabilityGrantStore,
  executeGrantSlash,
  type CapabilityGrant,
  type GrantedAction,
} from '../src/conductor/capability-grant-store';

function makeGrant(opts: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    persona: opts.persona ?? 'alice',
    action: opts.action ?? 'read',
    grantedAt: opts.grantedAt ?? '2026-05-01T00:00:00Z',
    ...(opts.shellId !== undefined ? { shellId: opts.shellId } : {}),
    ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
    ...(opts.grantedBy !== undefined ? { grantedBy: opts.grantedBy } : {}),
  };
}

describe('createCapabilityGrantStore — basic', () => {
  test('grant + isGranted exact match', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    expect(s.isGranted('a', 'read')).toBe(true);
    expect(s.isGranted('a', 'write')).toBe(false);
    expect(s.isGranted('b', 'read')).toBe(false);
  });

  test('grant scoped to shellId', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'write', shellId: 'shell-1' }));
    expect(s.isGranted('a', 'write', 'shell-1')).toBe(true);
    expect(s.isGranted('a', 'write', 'shell-2')).toBe(false);
    expect(s.isGranted('a', 'write')).toBe(false);
  });

  test('global grant matches when shellId queried', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));  // global
    expect(s.isGranted('a', 'read', 'shell-x')).toBe(true);
  });

  test('grant overwrites duplicate', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read', note: 'first' }));
    s.grant(makeGrant({ persona: 'a', action: 'read', note: 'second' }));
    const list = s.list({ persona: 'a' });
    expect(list).toHaveLength(1);
    expect(list[0]!.note).toBe('second');
  });

  test('revoke by persona only — removes all', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    s.grant(makeGrant({ persona: 'a', action: 'write' }));
    s.grant(makeGrant({ persona: 'b', action: 'read' }));
    expect(s.revoke({ persona: 'a' })).toBe(2);
    expect(s.list({ persona: 'a' })).toHaveLength(0);
    expect(s.list({ persona: 'b' })).toHaveLength(1);
  });

  test('revoke with action filter', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    s.grant(makeGrant({ persona: 'a', action: 'write' }));
    expect(s.revoke({ persona: 'a', action: 'write' })).toBe(1);
    expect(s.list({ persona: 'a' })).toHaveLength(1);
    expect(s.isGranted('a', 'read')).toBe(true);
    expect(s.isGranted('a', 'write')).toBe(false);
  });

  test('revoke non-matching → 0', () => {
    const s = createCapabilityGrantStore();
    expect(s.revoke({ persona: 'nobody' })).toBe(0);
  });

  test('list with filter', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read', shellId: 's1' }));
    s.grant(makeGrant({ persona: 'a', action: 'write', shellId: 's1' }));
    s.grant(makeGrant({ persona: 'b', action: 'read' }));
    expect(s.list({ shellId: 's1' })).toHaveLength(2);
    expect(s.list({ action: 'read' })).toHaveLength(2);
  });
});

describe('createCapabilityGrantStore — expiry', () => {
  test('expired grant returns false on isGranted + auto-prunes', () => {
    let nowMs = 1000;
    const s = createCapabilityGrantStore({
      now: () => new Date(nowMs),
    });
    s.grant(makeGrant({
      persona: 'a',
      action: 'read',
      expiresAt: new Date(2000).toISOString(),
    }));
    expect(s.isGranted('a', 'read')).toBe(true);
    nowMs = 3000;
    expect(s.isGranted('a', 'read')).toBe(false);
    expect(s.list()).toHaveLength(0);
  });

  test('pruneExpired returns expired events', () => {
    let nowMs = 1000;
    const s = createCapabilityGrantStore({ now: () => new Date(nowMs) });
    s.grant(makeGrant({
      persona: 'a',
      action: 'read',
      expiresAt: new Date(2000).toISOString(),
    }));
    nowMs = 5000;
    const events = s.pruneExpired();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('expired');
  });
});

describe('createCapabilityGrantStore — audit log', () => {
  test('audit captures grant + revoke + expired', async () => {
    let nowMs = 1000;
    const s = createCapabilityGrantStore({ now: () => new Date(nowMs) });
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    s.revoke({ persona: 'a' });
    s.grant(makeGrant({
      persona: 'b', action: 'write',
      expiresAt: new Date(2000).toISOString(),
    }));
    nowMs = 3000;
    s.pruneExpired();
    const audit = s.audit();
    expect(audit.map((e) => e.kind)).toEqual(['granted', 'revoked', 'granted', 'expired']);
  });

  test('audit cap drops oldest', () => {
    const s = createCapabilityGrantStore({ auditCap: 3 });
    for (let i = 0; i < 5; i += 1) {
      s.grant(makeGrant({ persona: `p${i}`, action: 'read' }));
    }
    expect(s.audit()).toHaveLength(3);
    expect(s.audit()[0]!.grant.persona).toBe('p2'); // p0,p1 dropped
  });
});

describe('executeGrantSlash', () => {
  test('grant verb — happy path', () => {
    const s = createCapabilityGrantStore();
    const r = executeGrantSlash(
      { verb: 'grant', persona: 'alice', action: 'write', shellId: 'shell-x' },
      { store: s, now: () => '2026-05-01T00:00:00Z' },
    );
    expect(r.ok).toBe(true);
    expect(r.message).toContain('granted alice write');
    expect(r.message).toContain('for shell-x');
    expect(s.isGranted('alice', 'write', 'shell-x')).toBe(true);
  });

  test('grant — missing persona fails', () => {
    const s = createCapabilityGrantStore();
    const r = executeGrantSlash({ verb: 'grant', action: 'read' }, { store: s });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('persona');
  });

  test('grant — invalid action fails', () => {
    const s = createCapabilityGrantStore();
    const r = executeGrantSlash(
      { verb: 'grant', persona: 'a', action: 'invalid-action' as GrantedAction },
      { store: s },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('action');
  });

  test('revoke verb — happy path', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    const r = executeGrantSlash({ verb: 'revoke', persona: 'a' }, { store: s });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('revoked 1');
  });

  test('revoke — no match', () => {
    const s = createCapabilityGrantStore();
    const r = executeGrantSlash({ verb: 'revoke', persona: 'nobody' }, { store: s });
    expect(r.ok).toBe(false);
  });

  test('list verb — empty', () => {
    const r = executeGrantSlash({ verb: 'list' }, { store: createCapabilityGrantStore() });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('현재 grant 가 없습니다');
    expect(r.grants).toEqual([]);
  });

  test('list verb — with grants', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read', shellId: 's1' }));
    s.grant(makeGrant({ persona: 'b', action: 'write' }));
    const r = executeGrantSlash({ verb: 'list' }, { store: s });
    expect(r.ok).toBe(true);
    expect(r.grants).toHaveLength(2);
    expect(r.message).toContain('a · read · [s1]');
    expect(r.message).toContain('b · write · [*]');
  });

  test('list — filtered by persona', () => {
    const s = createCapabilityGrantStore();
    s.grant(makeGrant({ persona: 'a', action: 'read' }));
    s.grant(makeGrant({ persona: 'b', action: 'read' }));
    const r = executeGrantSlash({ verb: 'list', persona: 'a' }, { store: s });
    expect(r.grants).toHaveLength(1);
    expect(r.grants![0]!.persona).toBe('a');
  });
});
