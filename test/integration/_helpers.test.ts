// M7 (2026-04-28) — unit tests for Tier 1 helper module.
//
// The integration scenario files themselves are env-gated (only run
// when `MONAD_CODEX_TIER1_SMOKE=1`). These unit tests verify the
// gate + detection logic itself runs every test cycle so a regression
// in skip-logic doesn't go unnoticed.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  tier1GateEnabled,
  detectCodexBinary,
  tier1SkipReason,
  logSkipReason,
  _resetBinaryCacheForTests,
} from './_helpers.js';

describe('M7 · Tier 1 helpers · env gate', () => {
  afterEach(() => {
    _resetBinaryCacheForTests();
  });

  test('tier1GateEnabled false when env unset', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    delete process.env.MONAD_CODEX_TIER1_SMOKE;
    try {
      expect(tier1GateEnabled()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });

  test('tier1GateEnabled true when env=1', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    process.env.MONAD_CODEX_TIER1_SMOKE = '1';
    try {
      expect(tier1GateEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MONAD_CODEX_TIER1_SMOKE;
      else process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });

  test('tier1GateEnabled true when env=true (case-insensitive)', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    process.env.MONAD_CODEX_TIER1_SMOKE = 'True';
    try {
      expect(tier1GateEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MONAD_CODEX_TIER1_SMOKE;
      else process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });

  test('tier1GateEnabled false for non-truthy strings', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    process.env.MONAD_CODEX_TIER1_SMOKE = 'no';
    try {
      expect(tier1GateEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MONAD_CODEX_TIER1_SMOKE;
      else process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });
});

describe('M7 · Tier 1 helpers · binary detection', () => {
  afterEach(() => {
    _resetBinaryCacheForTests();
  });

  test('detectCodexBinary returns string OR null (no throw)', () => {
    const result = detectCodexBinary();
    expect(typeof result === 'string' || result === null).toBe(true);
    if (typeof result === 'string') {
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test('detectCodexBinary cached on second call', () => {
    const first = detectCodexBinary();
    const second = detectCodexBinary();
    expect(first).toBe(second);
  });

  test('_resetBinaryCacheForTests clears the cache', () => {
    detectCodexBinary();
    _resetBinaryCacheForTests();
    // Second call after reset works without throwing.
    expect(() => detectCodexBinary()).not.toThrow();
  });
});

describe('M7 · Tier 1 helpers · skipReason composition', () => {
  afterEach(() => {
    _resetBinaryCacheForTests();
  });

  test('skipReason mentions env when env unset', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    delete process.env.MONAD_CODEX_TIER1_SMOKE;
    try {
      const reason = tier1SkipReason();
      expect(reason).toContain('MONAD_CODEX_TIER1_SMOKE');
    } finally {
      if (prev !== undefined) process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });

  test('skipReason null when env set AND binary present', () => {
    const prev = process.env.MONAD_CODEX_TIER1_SMOKE;
    process.env.MONAD_CODEX_TIER1_SMOKE = '1';
    try {
      const binary = detectCodexBinary();
      const reason = tier1SkipReason();
      if (binary !== null) {
        expect(reason).toBeNull();
      } else {
        expect(reason).toContain('codex binary');
      }
    } finally {
      if (prev === undefined) delete process.env.MONAD_CODEX_TIER1_SMOKE;
      else process.env.MONAD_CODEX_TIER1_SMOKE = prev;
    }
  });
});

describe('M7 · Tier 1 helpers · logSkipReason', () => {
  test('logSkipReason no-op when reason is null', () => {
    // Pure smoke — should not throw, no observable side-effect we can
    // assert without console capture. Capability stub preserved here so
    // a future test can swap console.log + assert it was called once.
    expect(() => logSkipReason('S1', null)).not.toThrow();
  });

  test('logSkipReason prints when reason provided', () => {
    const captured: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    };
    try {
      logSkipReason('S1', 'env unset');
    } finally {
      console.log = orig;
    }
    expect(captured.length).toBe(1);
    expect(captured[0]).toContain('Tier 1');
    expect(captured[0]).toContain('S1');
    expect(captured[0]).toContain('env unset');
  });
});
