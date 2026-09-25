import { describe, test, expect } from 'bun:test';
import { isUlid, parseMonadUri } from '../../../src/mss/uri/parser.js';

describe('mss uri parser', () => {
  describe('Tier 1 — short form', () => {
    test('valid kind_suffix', () => {
      const p = parseMonadUri('ses_01HYZA');
      expect(p).toEqual({
        tier: 1,
        segments: [{ kind: 'session', id: '01HYZA' }],
      });
    });

    test('accepts alternative kind aliases only if in ENTITY_KINDS', () => {
      // `msg` is an entity kind per PLAN §7.1
      expect(parseMonadUri('msg_042B7F')?.tier).toBe(1);
    });

    test('rejects unknown kind', () => {
      expect(parseMonadUri('foo_01HYZA')).toBeNull();
    });

    test('rejects too-short suffix', () => {
      expect(parseMonadUri('session_01A')).toBeNull();
    });
  });

  describe('Tier 2 — local entity path', () => {
    test('single segment', () => {
      const p = parseMonadUri('session/01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(p?.tier).toBe(2);
      expect(p?.segments).toEqual([{ kind: 'session', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }]);
    });

    test('multi-segment chain', () => {
      const p = parseMonadUri('session/01ARZ3NDEKTSV4RRFFQ69G5FAV/msg/01ARZ3NDEKTSV4RRFFQ69G5FA2');
      expect(p?.tier).toBe(2);
      expect(p?.segments).toHaveLength(2);
      expect(p?.segments[0]?.kind).toBe('session');
      expect(p?.segments[1]?.kind).toBe('msg');
    });

    test('rejects odd-count segments', () => {
      expect(parseMonadUri('session/01AR/msg')).toBeNull();
    });

    test('rejects unknown kind', () => {
      expect(parseMonadUri('unknownkind/01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull();
    });
  });

  describe('Tier 3 — distributed', () => {
    const monadId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

    test('host + monadId + simple path', () => {
      const p = parseMonadUri(`monad://local/${monadId}/agent/pfc`);
      expect(p?.tier).toBe(3);
      expect(p?.host).toBe('local');
      expect(p?.monadId).toBe(monadId);
      expect(p?.segments).toEqual([{ kind: 'agent', id: 'pfc' }]);
    });

    test('multi-segment entity path', () => {
      const p = parseMonadUri(`monad://mac.tailnet/${monadId}/session/01AR/msg/01AS`);
      expect(p?.tier).toBe(3);
      expect(p?.host).toBe('mac.tailnet');
      expect(p?.segments).toHaveLength(2);
    });

    test('with fragment', () => {
      const p = parseMonadUri(`monad://local/${monadId}/block/01AR#L42`);
      expect(p?.fragment).toBe('L42');
    });

    test('with query params', () => {
      const p = parseMonadUri(`monad://local/${monadId}/msg/01AR?role=user&range=10-20`);
      expect(p?.query).toEqual({ role: 'user', range: '10-20' });
    });

    test('rejects missing monad-id', () => {
      expect(parseMonadUri('monad://local/agent/pfc')).toBeNull();
    });

    test('rejects non-ULID monad-id', () => {
      expect(parseMonadUri('monad://local/not-a-ulid/agent/pfc')).toBeNull();
    });

    test('rejects empty scheme segment', () => {
      expect(parseMonadUri('monad:///' + monadId + '/agent/pfc')).toBeNull();
    });

    test('URL-encoded query values decoded', () => {
      const p = parseMonadUri(`monad://local/${monadId}/msg/01AR?label=hello%20world`);
      expect(p?.query).toEqual({ label: 'hello world' });
    });
  });

  describe('invalid', () => {
    test('empty string → null', () => {
      expect(parseMonadUri('')).toBeNull();
    });

    test('null/undefined → null (defensive)', () => {
      // @ts-expect-error runtime guard
      expect(parseMonadUri(undefined)).toBeNull();
    });

    test('non-ULID id in Tier 2 still accepted if entity-id regex matches', () => {
      // semantic-slug ids are allowed per §7.1
      expect(parseMonadUri('pack/kr.semiconductor.equipment')?.tier).toBe(2);
    });
  });

  describe('isUlid', () => {
    test('26-char Crockford base32 → true', () => {
      expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    });

    test('lowercase → false', () => {
      expect(isUlid('01arz3ndektsv4rrffq69g5fav')).toBe(false);
    });

    test('25 chars → false', () => {
      expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false);
    });
  });
});
