// ── Retry policy + doom-loop · Coding Pipeline P3 tests ──
//
// Module unit tests. Integration-level checks (tracker wiring into
// streamLLMWithTools) are covered by manual verification in CAPABILITIES
// since streamLLMWithTools needs heavy provider mocking.

import { describe, expect, test } from 'bun:test';

import {
  DoomLoopTracker,
  fingerprintError,
  decideRetry,
  parseRetryAfter,
  backoffMs,
  type RetryContext,
} from '../src/session-runtime/retry-policy.js';

describe('fingerprintError', () => {
  test('same Error class + message + tool yields same fingerprint', () => {
    const err1 = new Error('File not found: /a/b');
    const err2 = new Error('File not found: /a/b');
    expect(fingerprintError(err1, 'Read')).toBe(fingerprintError(err2, 'Read'));
  });

  test('tool name is part of the identity', () => {
    const err = new Error('Failed');
    expect(fingerprintError(err, 'Read')).not.toBe(fingerprintError(err, 'Edit'));
  });

  test('lowercases and collapses whitespace in the first line only', () => {
    const err1 = new Error('  Failed:   X\n\n    at stack');
    const err2 = new Error('failed: x');
    expect(fingerprintError(err1)).toBe(fingerprintError(err2));
  });

  test('error code is included when present', () => {
    const e1 = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const e2 = Object.assign(new Error('timeout'), { code: 'ECONNRESET' });
    expect(fingerprintError(e1)).not.toBe(fingerprintError(e2));
  });

  test('plain-string error is supported', () => {
    expect(fingerprintError('something broke')).toContain('msg=something broke');
  });

  test('serializes message-less package failures with root text and detail structure', () => {
    const first = { error: 'request rejected', details: [{ field: 'path', issue: 'missing' }] };
    const second = { error: 'request rejected', details: [{ field: 'path', issue: 'forbidden' }] };
    const firstFingerprint = fingerprintError(first, 'Read');
    expect(firstFingerprint).toContain('msg={"details":[{"field":"path","issue":"missing"}],"error":"request rejected"}');
    expect(firstFingerprint).not.toBe(fingerprintError(second, 'Read'));
    expect(firstFingerprint).toMatch(/^tool=Read\|class=object\|msg=/);
  });

  test('reads inherited and accessor-exposed messages', () => {
    const inherited = Object.create({ message: 'inherited failure' }) as object;
    const accessor = Object.defineProperty({}, 'message', {
      get: () => 'accessor failure', enumerable: true,
    });
    expect(fingerprintError(inherited)).toContain('msg=inherited failure');
    expect(fingerprintError(accessor)).toContain('msg=accessor failure');
  });

  test('falls back to structured failure data when a message accessor throws', () => {
    const first = Object.defineProperties({}, {
      message: { get: () => { throw new Error('message accessor unavailable'); }, enumerable: true },
      error: { value: 'request rejected', enumerable: true },
      details: { value: [{ field: 'path', issue: 'missing' }], enumerable: true },
    });
    const second = Object.defineProperties({}, {
      message: { get: () => { throw new Error('message accessor unavailable'); }, enumerable: true },
      error: { value: 'request rejected', enumerable: true },
      details: { value: [{ field: 'path', issue: 'forbidden' }], enumerable: true },
    });
    expect(() => fingerprintError(first, 'Read')).not.toThrow();
    expect(fingerprintError(first, 'Read')).toContain('"details":[{"field":"path","issue":"missing"}]');
    expect(fingerprintError(first, 'Read')).not.toBe(fingerprintError(second, 'Read'));
  });

  test('treats empty messages as message-less structured failures', () => {
    const first = { message: '', error: 'request rejected', details: [{ field: 'path', issue: 'missing' }] };
    const second = { message: '', error: 'request rejected', details: [{ field: 'path', issue: 'forbidden' }] };
    expect(fingerprintError(first, 'Read')).toContain('"details":[{"field":"path","issue":"missing"}]');
    expect(fingerprintError(first, 'Read')).not.toBe(fingerprintError(second, 'Read'));
  });

  test('null/undefined does not throw', () => {
    expect(() => fingerprintError(null)).not.toThrow();
    expect(() => fingerprintError(undefined)).not.toThrow();
  });

  test('truncates very long messages to 200 chars', () => {
    const longMsg = 'x'.repeat(500);
    const fp = fingerprintError(new Error(longMsg));
    expect(fp.length).toBeLessThan(300);
  });
});

describe('DoomLoopTracker', () => {
  test('does not fire doom below window size', () => {
    const t = new DoomLoopTracker(3);
    expect(t.record('a')).toBe('normal');
    expect(t.record('a')).toBe('normal');
  });

  test('fires doom on the 3rd identical fingerprint', () => {
    const t = new DoomLoopTracker(3);
    t.record('a');
    t.record('a');
    expect(t.record('a')).toBe('doom');
  });

  test('different fingerprints keep status normal', () => {
    const t = new DoomLoopTracker(3);
    t.record('a');
    t.record('b');
    expect(t.record('a')).toBe('normal');
  });

  test('window slides — old fingerprints age out', () => {
    const t = new DoomLoopTracker(3);
    t.record('a');
    t.record('a');
    t.record('b');  // oldest 'a' still in window (a,a,b)
    expect(t.record('a')).toBe('normal');  // (a,b,a) → no doom
  });

  test('reset clears the window', () => {
    const t = new DoomLoopTracker(3);
    t.record('a');
    t.record('a');
    t.reset();
    expect(t.record('a')).toBe('normal');
  });

  test('default window remains three entries', () => {
    const t = new DoomLoopTracker();
    t.record('a');
    t.record('a');
    expect(t.record('a')).toBe('doom');
  });

  test('windowSize < 2 throws', () => {
    expect(() => new DoomLoopTracker(1)).toThrow();
  });

  test('snapshot returns current fingerprints', () => {
    const t = new DoomLoopTracker(3);
    t.record('a');
    t.record('b');
    const snap = t.snapshot();
    expect(snap.map((s) => s.fingerprint)).toEqual(['a', 'b']);
  });
});

describe('parseRetryAfter', () => {
  test('integer seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
  });
  test('ms suffix', () => {
    expect(parseRetryAfter('2500ms')).toBe(2500);
  });
  test('HTTP-date (future)', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const v = parseRetryAfter(future);
    expect(v).toBeGreaterThan(3000);
    expect(v).toBeLessThan(10_000);
  });
  test('HTTP-date (past) → 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });
  test('bad input → null', () => {
    expect(parseRetryAfter('not a date')).toBe(null);
    expect(parseRetryAfter(undefined)).toBe(null);
  });
  test('clamps to 300s max', () => {
    expect(parseRetryAfter('99999')).toBe(300_000);
  });
});

describe('backoffMs', () => {
  test('attempt 0 at least 500', () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(500);
  });
  test('attempt grows exponentially, clamped at 30s', () => {
    // attempt 10 → 500 * 2^10 = 512000ms → clamp 30000
    const v = backoffMs(10);
    expect(v).toBeLessThanOrEqual(33_000);
    expect(v).toBeGreaterThanOrEqual(27_000);
  });
});

describe('decideRetry', () => {
  const baseCtx = (overrides: Partial<RetryContext> = {}): RetryContext => ({
    attempt: 0,
    doomStatus: 'normal',
    ...overrides,
  });

  test('doom-loop always wins, regardless of error category', () => {
    const d = decideRetry(new Error('rate limit'), baseCtx({ doomStatus: 'doom' }));
    expect(d.action).toBe('auto-undo');
    expect(d.category).toBe('doom-loop');
  });

  test('context window exceeded → abort (no retry)', () => {
    const d = decideRetry(new Error('prompt is too long for context window'), baseCtx());
    expect(d.action).toBe('abort');
    expect(d.category).toBe('context-window-exceeded');
  });

  test('quota → ask-user', () => {
    const d = decideRetry(new Error('quota exceeded'), baseCtx());
    expect(d.action).toBe('ask-user');
    expect(d.category).toBe('quota-exceeded');
  });

  test('status=402 → ask-user (quota bucket)', () => {
    const err = Object.assign(new Error('payment required'), { status: 402 });
    const d = decideRetry(err, baseCtx());
    expect(d.action).toBe('ask-user');
    expect(d.category).toBe('quota-exceeded');
  });

  test('rate-limit: retry with backoff', () => {
    const err = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    const d = decideRetry(err, baseCtx({ attempt: 1 }));
    expect(d.action).toBe('retry');
    expect(d.category).toBe('rate-limit');
    expect(d.delayMs).toBeGreaterThan(0);
  });

  test('rate-limit respects retry-after header', () => {
    const err = Object.assign(new Error('too many requests'), { status: 429 });
    const d = decideRetry(err, baseCtx({ retryAfter: '10' }));
    expect(d.action).toBe('retry');
    expect(d.delayMs).toBe(10_000);
  });

  test('overloaded → retry', () => {
    const d = decideRetry(new Error('the server is overloaded'), baseCtx());
    expect(d.action).toBe('retry');
    expect(d.category).toBe('overloaded');
  });

  test('transient network → retry', () => {
    const err = Object.assign(new Error('ECONNRESET: socket hang up'), { code: 'ECONNRESET' });
    const d = decideRetry(err, baseCtx());
    expect(d.action).toBe('retry');
    expect(d.category).toBe('network-transient');
  });

  test('tool-not-found → abort', () => {
    const d = decideRetry(new Error('No ToolRuntime registered for Foo'), baseCtx());
    expect(d.action).toBe('abort');
    expect(d.category).toBe('tool-not-found');
  });

  test('invalid args → abort (LLM needs to see, not retry)', () => {
    const d = decideRetry(new Error('Invalid argument: path is required'), baseCtx());
    expect(d.action).toBe('abort');
    expect(d.category).toBe('tool-invalid-args');
  });

  test('unknown: first attempt → speculative retry', () => {
    const d = decideRetry(new Error('mystery error'), baseCtx({ attempt: 0 }));
    expect(d.action).toBe('retry');
    expect(d.category).toBe('unknown');
  });

  test('unknown: after first retry → abort', () => {
    const d = decideRetry(new Error('mystery error'), baseCtx({ attempt: 1 }));
    expect(d.action).toBe('abort');
    expect(d.category).toBe('unknown');
  });
});
