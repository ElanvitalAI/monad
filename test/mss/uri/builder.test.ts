import { describe, test, expect } from 'bun:test';
import {
  asAgentUri,
  asMemoryUri,
  asElanousUri,
  asSessionUri,
  asSignalUri,
  joinElanousUri,
  newElanousUri,
  toTier1,
  toTier2,
  toTier3,
} from '../../../src/mss/uri/builder.js';
import { parseElanousUri } from '../../../src/mss/uri/parser.js';
import type { ElanousUri } from '../../../src/mss/uri/brand.js';

describe('mss uri builder', () => {
  describe('newElanousUri', () => {
    test('fresh kind + ULID → Tier 2 shape', () => {
      const uri = newElanousUri('session');
      expect(uri.startsWith('session/')).toBe(true);
      const parsed = parseElanousUri(uri);
      expect(parsed?.tier).toBe(2);
      expect(parsed?.segments[0]?.kind).toBe('session');
      expect(parsed?.segments[0]?.id).toHaveLength(26);
    });

    test('with parent appends segment', () => {
      const parent = newElanousUri('session');
      const child = newElanousUri('msg', parent);
      const parsed = parseElanousUri(child);
      expect(parsed?.segments).toHaveLength(2);
      expect(parsed?.segments[0]?.kind).toBe('session');
      expect(parsed?.segments[1]?.kind).toBe('msg');
    });

    test('unknown kind throws', () => {
      expect(() => newElanousUri('nope' as 'session')).toThrow('Unknown EntityKind');
    });
  });

  describe('joinElanousUri', () => {
    test('Tier 2 parent → Tier 2 child', () => {
      const parent = newElanousUri('session');
      const child = joinElanousUri(parent, 'block');
      expect(parseElanousUri(child)?.tier).toBe(2);
    });

    test('Tier 3 parent with fragment — fragment preserved after join', () => {
      const elanousId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const parent = asElanousUri(`elanous://local/${elanousId}/session/01ARZ3NDEKTSV4RRFFQ69G5FA1#anchor`);
      const child = joinElanousUri(parent, 'msg', '01ARZ3NDEKTSV4RRFFQ69G5FA2');
      expect(child).toContain('/msg/01ARZ3NDEKTSV4RRFFQ69G5FA2');
      expect(child).toMatch(/#anchor$/);
    });

    test('joining onto Tier 1 throws', () => {
      const short = asElanousUri('ses_01HYZA');
      expect(() => joinElanousUri(short, 'msg')).toThrow(/Tier 1/);
    });

    test('explicit id respected', () => {
      const parent = newElanousUri('session');
      const child = joinElanousUri(parent, 'msg', 'fixed-id');
      expect(child).toContain('/msg/fixed-id');
    });
  });

  describe('toTier1 / toTier2 / toTier3 round-trip', () => {
    test('Tier 2 → Tier 3 → Tier 2', () => {
      const t2 = newElanousUri('session');
      const t3 = toTier3(t2, 'local', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
      const t2b = toTier2(asElanousUri(t3));
      expect(t2b).toBe(t2 as string);
    });

    test('Tier 1 from Tier 2 uses abbreviation when available', () => {
      const t2 = newElanousUri('session');
      const short = toTier1(t2);
      expect(short).toMatch(/^ses_[0-9A-Z]{6}$/);
    });

    test('Tier 1 uses full kind when no abbreviation registered', () => {
      const t2 = newElanousUri('block');
      expect(toTier1(t2)).toMatch(/^block_[0-9A-Z]{6}$/);
    });

    test('toTier1 with custom length 4-12 clamped', () => {
      const t2 = newElanousUri('session');
      expect(toTier1(t2, 4)).toMatch(/^ses_[0-9A-Z]{4}$/);
      expect(toTier1(t2, 12)).toMatch(/^ses_[0-9A-Z]{12}$/);
      expect(toTier1(t2, 100)).toMatch(/^ses_[0-9A-Z]{12}$/);
      expect(toTier1(t2, 0)).toMatch(/^ses_[0-9A-Z]{4}$/);
    });

    test('toTier2 on Tier 1 throws (registry lookup required)', () => {
      expect(() => toTier2(asElanousUri('ses_01HYZA'))).toThrow(/registry/);
    });

    test('toTier3 preserves query + fragment', () => {
      const elanousId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const t3 = asElanousUri(`elanous://local/${elanousId}/msg/01ARZ3NDEKTSV4RRFFQ69G5FA2?role=user#L5`);
      const again = toTier3(t3, 'local', elanousId);
      expect(again).toContain('role=user');
      expect(again).toContain('#L5');
    });

    test('toTier1 collapses to the leaf segment kind', () => {
      const parent = newElanousUri('session');
      const child = joinElanousUri(parent, 'msg');
      const short = toTier1(child);
      expect(short.startsWith('msg_')).toBe(true);
    });
  });

  describe('asXUri — runtime validation + brand', () => {
    test('asElanousUri round-trips a valid URI', () => {
      const s = 'session/01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const branded = asElanousUri(s);
      expect(branded as string).toBe(s);
    });

    test('asSessionUri requires session segment', () => {
      expect(() => asSessionUri('agent/pfc' as string)).toThrow(/SessionUri/);
      expect(() => asSessionUri('session/01AR')).not.toThrow();
    });

    test('asAgentUri requires agent segment', () => {
      expect(() => asAgentUri('session/01AR')).toThrow(/AgentUri/);
      expect(() => asAgentUri('agent/pfc')).not.toThrow();
    });

    test('asMemoryUri accepts stm/ltm/sensory', () => {
      expect(() => asMemoryUri('stm/01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toThrow();
      expect(() => asMemoryUri('ltm/01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toThrow();
      expect(() => asMemoryUri('sensory/01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toThrow();
      expect(() => asMemoryUri('agent/pfc')).toThrow(/MemoryUri/);
    });

    test('asSignalUri requires signal segment', () => {
      expect(() => asSignalUri('signal/01ARZ3NDEKTSV4RRFFQ69G5FAV')).not.toThrow();
      expect(() => asSignalUri('agent/pfc')).toThrow(/SignalUri/);
    });

    test('asElanousUri on invalid throws', () => {
      expect(() => asElanousUri('not a uri at all')).toThrow(/Invalid ElanousUri/);
    });
  });

  describe('monotonicity', () => {
    test('rapid newElanousUri within same ms yields distinct ids', () => {
      const a = newElanousUri('msg');
      const b = newElanousUri('msg');
      expect(a).not.toBe(b);
      const aId = parseElanousUri(a)!.segments[0]!.id;
      const bId = parseElanousUri(b)!.segments[0]!.id;
      expect(aId).not.toBe(bId);
    });
  });

  describe('branded type compile-time guards', () => {
    test('ElanousUri is assignable from runtime validator only (type-level)', () => {
      // This is a runtime-compiled test — the real compile-time guard runs in tsc.
      // We exercise it here by feeding the branded output back into a function
      // that accepts ElanousUri.
      const wantsElanousUri = (u: ElanousUri): string => u as string;
      const v = newElanousUri('session');
      expect(typeof wantsElanousUri(v)).toBe('string');
    });
  });
});
