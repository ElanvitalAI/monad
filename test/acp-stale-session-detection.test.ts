// Stale-session error detection unit tests for runAcpTurn's retry
// path. Covers the three error shapes seen in practice:
//   1. Native Error.message — codex-app-server "unknown session <id>"
//   2. JSON-RPC error with data.details — claude-code-acp "Session not
//      found" buried under generic "Internal error" message
//   3. AcpLoadSessionUnsupportedError — peer doesn't support loadSession
//
// Plus negative cases (real subprocess crashes, network errors, etc.)
// that must NOT trigger retry — otherwise we'd loop on truly broken
// backends.

import { describe, test, expect } from 'bun:test';
import { isStaleSessionError } from '../src/acp/turn-runner';

describe('isStaleSessionError — positive cases (retry should fire)', () => {
  test('codex-app-server style — Error.message includes "unknown session"', () => {
    const err = new Error('codex-app-server · unknown session stale-synth-id');
    expect(isStaleSessionError(err)).toBe(true);
  });

  test('claude-code-acp style — JSON-RPC error with data.details = "Session not found"', () => {
    const err = {
      code: -32603,
      message: 'Internal error',
      data: { details: 'Session not found' },
    };
    expect(isStaleSessionError(err)).toBe(true);
  });

  test('claude-code-acp style — same payload wrapped in Error', () => {
    const err = Object.assign(new Error('Internal error'), {
      code: -32603,
      data: { details: 'Session not found' },
    });
    expect(isStaleSessionError(err)).toBe(true);
  });

  test('AcpLoadSessionUnsupportedError style', () => {
    const err = new Error("peer 'claude' did not advertise loadSession capability");
    expect(isStaleSessionError(err)).toBe(true);
  });

  test('case-insensitive: "SESSION NOT FOUND"', () => {
    expect(isStaleSessionError(new Error('SESSION NOT FOUND'))).toBe(true);
  });

  test('extra whitespace tolerated: "session  not  found"', () => {
    expect(isStaleSessionError(new Error('session  not  found'))).toBe(true);
  });

  test('plain string error', () => {
    expect(isStaleSessionError('unknown session abc')).toBe(true);
  });

  test('falls through to JSON.stringify when message + data.details miss but raw payload has signal', () => {
    // Pathological shape: signal lives in a nested non-standard field.
    // The JSON.stringify fallback catches it so we don't silently miss
    // a stale-session error that buried itself somewhere unexpected.
    const err = { foo: { bar: 'session not found' } };
    expect(isStaleSessionError(err)).toBe(true);
  });
});

describe('isStaleSessionError — negative cases (retry must NOT fire)', () => {
  test('subprocess crashed (ECONNRESET style)', () => {
    expect(isStaleSessionError(new Error('socket hang up'))).toBe(false);
  });

  test('agent.prompt timeout', () => {
    expect(isStaleSessionError(new Error('request timed out after 60s'))).toBe(false);
  });

  test('LLM provider 401 unauthorized', () => {
    const err = { code: 401, message: 'Unauthorized: invalid API key' };
    expect(isStaleSessionError(err)).toBe(false);
  });

  test('null / undefined / empty', () => {
    expect(isStaleSessionError(null)).toBe(false);
    expect(isStaleSessionError(undefined)).toBe(false);
    expect(isStaleSessionError('')).toBe(false);
  });

  test('error mentions "session" but not in stale context', () => {
    // "session limit" or "session expired" — these COULD be stale
    // in some backends but our pattern intentionally only matches
    // explicit "not found" / "unknown" / "loadSession" signals to
    // avoid false positives. Tighten if a real backend ever needs it.
    expect(isStaleSessionError(new Error('rate limit: too many sessions'))).toBe(false);
  });

  test('circular object — JSON.stringify fallback fails silently, message-only check still works', () => {
    const err: Record<string, unknown> = { message: 'rate limit' };
    err['self'] = err;  // circular
    // No stale signal in message → false. Critical: must not throw.
    expect(() => isStaleSessionError(err)).not.toThrow();
    expect(isStaleSessionError(err)).toBe(false);
  });
});
