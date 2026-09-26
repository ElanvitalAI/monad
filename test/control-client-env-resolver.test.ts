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
  delete process.env.ELANOUS_REMOTE;
  delete process.env.ELANOUS_TOKEN;
  delete process.env.ELANOUS_RESUME_SESSION;
  delete process.env.ELANOUS_TELEGRAM_VIA_DAEMON;
  delete process.env.ELANOUS_DISCORD_VIA_DAEMON;
});

afterEach(() => {
  process.stderr.write = originalWrite;
});

describe('warnDeprecatedEnv', () => {
  test('warns once per key, then silent', () => {
    warnDeprecatedEnv('ELANOUS_REMOTE');
    warnDeprecatedEnv('ELANOUS_REMOTE');
    warnDeprecatedEnv('ELANOUS_REMOTE');

    const warnings = stderrCapture.filter((s) => s.includes('ELANOUS_REMOTE'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('deprecated');
  });

  test('different keys warn independently', () => {
    warnDeprecatedEnv('ELANOUS_REMOTE');
    warnDeprecatedEnv('ELANOUS_RESUME_SESSION');
    warnDeprecatedEnv('ELANOUS_REMOTE'); // already warned, no-op

    expect(stderrCapture.filter((s) => s.includes('ELANOUS_REMOTE')).length).toBe(1);
    expect(stderrCapture.filter((s) => s.includes('ELANOUS_RESUME_SESSION')).length).toBe(1);
  });

  test('unknown key is no-op', () => {
    warnDeprecatedEnv('ELANOUS_NOT_REAL');
    expect(stderrCapture).toEqual([]);
  });
});

describe('readDeprecatedEnv', () => {
  test('returns null + wasSet:false when env is unset', () => {
    const r = readDeprecatedEnv('ELANOUS_REMOTE');
    expect(r.value).toBeNull();
    expect(r.wasSet).toBe(false);
    expect(stderrCapture).toEqual([]);
  });

  test('warns when env is set with non-empty value', () => {
    process.env.ELANOUS_REMOTE = 'host:31415';
    const r = readDeprecatedEnv('ELANOUS_REMOTE');
    expect(r.value).toBe('host:31415');
    expect(r.wasSet).toBe(true);
    expect(stderrCapture.length).toBeGreaterThan(0);
  });

  test('empty string env is treated as absent — no warning', () => {
    process.env.ELANOUS_REMOTE = '';
    const r = readDeprecatedEnv('ELANOUS_REMOTE');
    expect(r.value).toBeNull();
    expect(r.wasSet).toBe(true);
    expect(stderrCapture).toEqual([]);
  });

  test('whitespace-only env is treated as absent — no warning', () => {
    process.env.ELANOUS_REMOTE = '   \n  ';
    const r = readDeprecatedEnv('ELANOUS_REMOTE');
    expect(r.value).toBeNull();
    expect(stderrCapture).toEqual([]);
  });

  test('trims trailing whitespace', () => {
    process.env.ELANOUS_REMOTE = '  host:31415  \n';
    const r = readDeprecatedEnv('ELANOUS_REMOTE');
    expect(r.value).toBe('host:31415');
  });

  test('repeat reads of the same key only warn once', () => {
    process.env.ELANOUS_REMOTE = 'host:31415';
    readDeprecatedEnv('ELANOUS_REMOTE');
    readDeprecatedEnv('ELANOUS_REMOTE');
    readDeprecatedEnv('ELANOUS_REMOTE');
    const warnings = stderrCapture.filter((s) => s.includes('ELANOUS_REMOTE'));
    expect(warnings.length).toBe(1);
  });
});

// ── Step 5 follow-up · PR β (2026-04-28) ──────────────────────────
// `ELANOUS_DISCORD_VIA_DAEMON` joined the deprecation list to mirror
// telegram. The 5-key matrix (REMOTE / TOKEN / RESUME / TELEGRAM /
// DISCORD) all behave identically — these tests pin the new entry.

describe('readDeprecatedEnv · ELANOUS_DISCORD_VIA_DAEMON (Step 5 follow-up)', () => {
  test('warns when env is set', () => {
    process.env.ELANOUS_DISCORD_VIA_DAEMON = '1';
    const r = readDeprecatedEnv('ELANOUS_DISCORD_VIA_DAEMON');
    expect(r.value).toBe('1');
    expect(r.wasSet).toBe(true);
    const warnings = stderrCapture.filter((s) => s.includes('ELANOUS_DISCORD_VIA_DAEMON'));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('deprecated');
    expect(warnings[0]).toContain('control plane registry');
  });

  test('telegram + discord warnings are independent (one per key)', () => {
    process.env.ELANOUS_TELEGRAM_VIA_DAEMON = '1';
    process.env.ELANOUS_DISCORD_VIA_DAEMON = '1';
    readDeprecatedEnv('ELANOUS_TELEGRAM_VIA_DAEMON');
    readDeprecatedEnv('ELANOUS_DISCORD_VIA_DAEMON');
    readDeprecatedEnv('ELANOUS_TELEGRAM_VIA_DAEMON');
    readDeprecatedEnv('ELANOUS_DISCORD_VIA_DAEMON');
    expect(stderrCapture.filter((s) => s.includes('ELANOUS_TELEGRAM_VIA_DAEMON')).length).toBe(1);
    expect(stderrCapture.filter((s) => s.includes('ELANOUS_DISCORD_VIA_DAEMON')).length).toBe(1);
  });
});
