// M3-3 (Phase 3) — Session-scoped tier override store tests.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  _resetSessionTierOverridesForTesting,
  clearSessionTierOverride,
  getSessionTierOverride,
  listSessionTierOverrides,
  setSessionTierOverride,
} from '../../src/model-tier/index.js';
import { resolveSttTier, resolveLlmTier, resolveTtsTier } from '../../src/model-tier/index.js';

beforeEach(() => {
  _resetSessionTierOverridesForTesting();
});

describe('M3-3 · session override store', () => {
  test('set + get round-trips', () => {
    setSessionTierOverride('sess-A', {
      stt: 'loaded',
      llm: 'best',
      tts: 'best',
      monthlyUsdCap: 20,
      rationale: 'medical_dictation preset',
    });
    const ov = getSessionTierOverride('sess-A');
    expect(ov?.stt).toBe('loaded');
    expect(ov?.llm).toBe('best');
    expect(ov?.monthlyUsdCap).toBe(20);
    expect(typeof ov?.installedAt).toBe('number');
    expect(typeof ov?.expiresAt).toBe('number');
  });

  test('missing session returns undefined', () => {
    expect(getSessionTierOverride('sess-missing')).toBeUndefined();
  });

  test('expired override auto-clears on read', () => {
    setSessionTierOverride('sess-B', { stt: 'budget', rationale: 'x' }, {
      ttlMs: 1,
      now: () => 1000,
    });
    // Read with a clock that has moved past the TTL.
    const ov = getSessionTierOverride('sess-B', { now: () => 2000 });
    expect(ov).toBeUndefined();
    expect(listSessionTierOverrides()).toEqual([]);
  });

  test('TTL = Infinity → never expires', () => {
    setSessionTierOverride('sess-C', { stt: 'best', rationale: 'pin' }, {
      ttlMs: Number.POSITIVE_INFINITY,
      now: () => 0,
    });
    const ov = getSessionTierOverride('sess-C', { now: () => 1e15 });
    expect(ov?.stt).toBe('best');
  });

  test('clearSessionTierOverride returns true if it existed', () => {
    setSessionTierOverride('sess-D', { stt: 'better', rationale: '' });
    expect(clearSessionTierOverride('sess-D')).toBe(true);
    expect(clearSessionTierOverride('sess-D')).toBe(false);
  });
});

describe('M3-3 · resolver consults session override', () => {
  test('STT: override wins over user-config surface', () => {
    setSessionTierOverride('sess-S', { stt: 'loaded', rationale: 'medical' });
    // Even with a user-config surface override saying budget, session wins.
    const r = resolveSttTier({ voice: { stt: 'budget' } }, { sessionId: 'sess-S' });
    expect(r.tier).toBe('loaded');
    expect(r.source).toBe('session-override');
  });

  test('STT: no override + no sessionId → falls through to user-config', () => {
    setSessionTierOverride('sess-S', { stt: 'loaded', rationale: 'x' });
    const r = resolveSttTier({ voice: { stt: 'best' } });
    expect(r.tier).toBe('best');
    expect(r.source).toBe('user-config-surface');
  });

  test('STT: sessionId given but no override → falls through to user-config', () => {
    const r = resolveSttTier({ voice: { stt: 'budget' } }, { sessionId: 'sess-empty' });
    expect(r.tier).toBe('budget');
    expect(r.source).toBe('user-config-surface');
  });

  test('LLM: override wins · provider preserved', () => {
    setSessionTierOverride('sess-L', { llm: 'best', rationale: 'NL switch' });
    const r = resolveLlmTier({ llm: 'budget' }, 'anthropic', { sessionId: 'sess-L' });
    expect(r.tier).toBe('best');
    expect(r.source).toBe('session-override');
    expect(r.provider).toBe('anthropic');
  });

  test('TTS: override wins', () => {
    setSessionTierOverride('sess-T', { tts: 'loaded', rationale: 'x' });
    const r = resolveTtsTier({ voice: { tts: 'budget' } }, { sessionId: 'sess-T' });
    expect(r.tier).toBe('loaded');
    expect(r.source).toBe('session-override');
  });
});
