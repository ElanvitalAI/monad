// Step 5 PR γ — env-resolver deprecation warning + per-key cache.
//
// Verifies:
//   - Warning emitted once per key (subsequent reads silent).
//   - Empty/whitespace env never warns (treated as absent).
//   - Unknown keys don't warn (only the curated set fires).
//   - Trim semantics match existing remote-target.ts behavior.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  __resetEnvWarnings,
  readDeprecatedEnv,
  warnDeprecatedEnv,
} from '../src/control-client/env-resolver.js';

let stderrCapture: string[] = [];
let originalWrite: typeof process.stderr.write;

beforeEach(() => {
  __resetEnvWarnings();
  stderrCapture = [];
  originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    if (typeof chunk === 'string') stderrCapture.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  // Snapshot + clear test-relevant envs to avoid cross-test bleed.
  delete process.env.MONAD_REMOTE;
  delete process.env.MONAD_TOKEN;
  delete process.env.MONAD_RESUME_SESSION;
  delete process.env.MONAD_TELEGRAM_VIA_DAEMON;
  delete process.env.MONAD_DISCORD_VIA_DAEMON;
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

describe('warnDeprecatedEnv', () => {
  test('warns once per key, then silent', () => {
    warnDeprecatedEnv('MONAD_REMOTE');
    warnDeprecatedEnv('MONAD_REMOTE');
    warnDeprecatedEnv('MONAD_REMOTE');

    const warnings = stderrCapture.filter((s) => s.includes('MONAD_REMOTE'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('deprecated');
  });

  test('different keys warn independently', () => {
    warnDeprecatedEnv('MONAD_REMOTE');
    warnDeprecatedEnv('MONAD_RESUME_SESSION');
    warnDeprecatedEnv('MONAD_REMOTE'); // already warned, no-op

    expect(stderrCapture.filter((s) => s.includes('MONAD_REMOTE')).length).toBe(1);
    expect(stderrCapture.filter((s) => s.includes('MONAD_RESUME_SESSION')).length).toBe(1);
  });

  test('unknown key is no-op', () => {
    warnDeprecatedEnv('MONAD_NOT_REAL');
    expect(stderrCapture).toEqual([]);
  });
});

describe('readDeprecatedEnv', () => {
  test('returns null + wasSet:false when env is unset', () => {
    const r = readDeprecatedEnv('MONAD_REMOTE');
    expect(r.value).toBeNull();
    expect(r.wasSet).toBe(false);
    expect(stderrCapture).toEqual([]);
  });

  test('warns when env is set with non-empty value', () => {
    process.env.MONAD_REMOTE = 'host:31415';
    const r = readDeprecatedEnv('MONAD_REMOTE');
    expect(r.value).toBe('host:31415');
    expect(r.wasSet).toBe(true);
    expect(stderrCapture.length).toBeGreaterThan(0);
  });

  test('empty string env is treated as absent — no warning', () => {
    process.env.MONAD_REMOTE = '';
    const r = readDeprecatedEnv('MONAD_REMOTE');
    expect(r.value).toBeNull();
    expect(r.wasSet).toBe(true);
    expect(stderrCapture).toEqual([]);
  });

  test('whitespace-only env is treated as absent — no warning', () => {
    process.env.MONAD_REMOTE = '   \n  ';
    const r = readDeprecatedEnv('MONAD_REMOTE');
    expect(r.value).toBeNull();
    expect(stderrCapture).toEqual([]);
  });

  test('trims trailing whitespace', () => {
    process.env.MONAD_REMOTE = '  host:31415  \n';
    const r = readDeprecatedEnv('MONAD_REMOTE');
    expect(r.value).toBe('host:31415');
  });

  test('repeat reads of the same key only warn once', () => {
    process.env.MONAD_REMOTE = 'host:31415';
    readDeprecatedEnv('MONAD_REMOTE');
    readDeprecatedEnv('MONAD_REMOTE');
    readDeprecatedEnv('MONAD_REMOTE');
    const warnings = stderrCapture.filter((s) => s.includes('MONAD_REMOTE'));
    expect(warnings.length).toBe(1);
  });
});

// ── Step 5 follow-up · PR β (2026-04-28) ──────────────────────────
// `MONAD_DISCORD_VIA_DAEMON` joined the deprecation list to mirror
// telegram. The 5-key matrix (REMOTE / TOKEN / RESUME / TELEGRAM /
// DISCORD) all behave identically — these tests pin the new entry.

describe('readDeprecatedEnv · MONAD_DISCORD_VIA_DAEMON (Step 5 follow-up)', () => {
  test('warns when env is set', () => {
    process.env.MONAD_DISCORD_VIA_DAEMON = '1';
    const r = readDeprecatedEnv('MONAD_DISCORD_VIA_DAEMON');
    expect(r.value).toBe('1');
    expect(r.wasSet).toBe(true);
    const warnings = stderrCapture.filter((s) => s.includes('MONAD_DISCORD_VIA_DAEMON'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('deprecated');
    expect(warnings[0]).toContain('control plane registry');
  });

  test('telegram + discord warnings are independent (one per key)', () => {
    process.env.MONAD_TELEGRAM_VIA_DAEMON = '1';
    process.env.MONAD_DISCORD_VIA_DAEMON = '1';
    readDeprecatedEnv('MONAD_TELEGRAM_VIA_DAEMON');
    readDeprecatedEnv('MONAD_DISCORD_VIA_DAEMON');
    readDeprecatedEnv('MONAD_TELEGRAM_VIA_DAEMON');
    readDeprecatedEnv('MONAD_DISCORD_VIA_DAEMON');
    expect(stderrCapture.filter((s) => s.includes('MONAD_TELEGRAM_VIA_DAEMON')).length).toBe(1);
    expect(stderrCapture.filter((s) => s.includes('MONAD_DISCORD_VIA_DAEMON')).length).toBe(1);
  });
});
