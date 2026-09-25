// ── B3 brand propagation tests (MSS M1.1 Phase B3) ──
//
// Covers the Phase B3 narrowing:
//   • DualRoleManager emits DualRoleChangeEvents with SessionUri
//   • subagent-meta readSubagentMeta brands the parsed ids
//   • turn-runner inFlightTurns value sessionId is SessionUri

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  DualRoleManager,
  type DualRoleChangeEvent,
} from '../../../src/acp/dual-role-manager.js';
import {
  readSubagentMeta,
  writeSubagentMeta,
  SUBAGENT_SESSION_INFO_META_KEY,
} from '../../../src/acp/subagent-meta.js';
import type { SessionUri } from '../../../src/mss/uri/brand.js';
import { unsafeBrandSessionUri } from '../../../src/mss/uri/brand.js';

describe('DualRoleManager · event payload narrowing', () => {
  let drm: DualRoleManager;
  let events: DualRoleChangeEvent[];
  let unsub: (() => void) | null;

  beforeEach(() => {
    drm = new DualRoleManager();
    events = [];
    unsub = drm.onChange((ev) => events.push(ev));
  });

  afterEach(() => {
    if (unsub) unsub();
    unsub = null;
  });

  test('server-registered event carries a SessionUri-branded sessionId', () => {
    drm.serverSessionRegister('back-sess-1', '/tmp');
    const ev = events.find(e => e.kind === 'server-registered');
    expect(ev).toBeDefined();
    if (ev?.kind === 'server-registered') {
      const sid: SessionUri = ev.sessionId;
      expect(typeof sid).toBe('string');
      expect(sid.length).toBeGreaterThan(0);
    }
  });

  test('server-unregistered event sessionId is branded', () => {
    drm.serverSessionRegister('back-sess-2', '/tmp');
    const registered = events.find(e => e.kind === 'server-registered');
    expect(registered).toBeDefined();
    // Remove via the namespaced id emitted on registration.
    if (registered?.kind === 'server-registered') {
      const removed = drm.serverSessionUnregister(registered.sessionId);
      expect(removed).toBe(true);
      const un = events.find(e => e.kind === 'server-unregistered');
      expect(un).toBeDefined();
      if (un?.kind === 'server-unregistered') {
        const sid: SessionUri = un.sessionId;
        expect(sid).toBe(registered.sessionId);
      }
    }
  });
});

describe('subagent-meta · SessionUri narrowing', () => {
  test('readSubagentMeta brands both parentSessionId and sessionId', () => {
    const raw: Record<string, unknown> = {
      [SUBAGENT_SESSION_INFO_META_KEY]: {
        parentSessionId: 'legacy-parent-id',
        sessionId: 'legacy-child-id',
      },
    };
    const info = readSubagentMeta(raw);
    expect(info).not.toBeNull();
    if (info) {
      // Compile-only: types are SessionUri.
      const p: SessionUri = info.parentSessionId;
      const c: SessionUri = info.sessionId;
      expect(p).toBe('legacy-parent-id' as SessionUri);
      expect(c).toBe('legacy-child-id' as SessionUri);
    }
  });

  test('readSubagentMeta preserves outputIndex', () => {
    const raw: Record<string, unknown> = {
      [SUBAGENT_SESSION_INFO_META_KEY]: {
        parentSessionId: 'p',
        sessionId: 's',
        outputIndex: 42,
      },
    };
    const info = readSubagentMeta(raw);
    expect(info?.outputIndex).toBe(42);
  });

  test('readSubagentMeta returns null for malformed input', () => {
    expect(readSubagentMeta(null)).toBeNull();
    expect(readSubagentMeta(undefined)).toBeNull();
    expect(readSubagentMeta({})).toBeNull();
    expect(readSubagentMeta({
      [SUBAGENT_SESSION_INFO_META_KEY]: { parentSessionId: '' },
    })).toBeNull();
    expect(readSubagentMeta({
      [SUBAGENT_SESSION_INFO_META_KEY]: { parentSessionId: 'p', sessionId: 42 },
    })).toBeNull();
  });

  test('writeSubagentMeta round-trips a branded info through readSubagentMeta', () => {
    const input = {
      parentSessionId: unsafeBrandSessionUri('session/01HZAAAAAAAAAAAAAAAAAAAAAA'),
      sessionId: unsafeBrandSessionUri('session/01HZBBBBBBBBBBBBBBBBBBBBBB'),
      outputIndex: 7,
    };
    const meta = writeSubagentMeta(input);
    const decoded = readSubagentMeta(meta);
    expect(decoded).toEqual(input);
  });
});
