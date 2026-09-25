// cv-3 β-4 (Round 2 · 2026-05-08) — confirm.ts audit emission.
//
// Verifies that requestConfirmation emits an audit entry through the
// registered hook on every code path: race winner, all-failed, and
// timeout fallback. Also confirms the emission is fire-and-forget
// (a slow / throwing hook never blocks or breaks the race resolution).

import { describe, it, expect, afterEach } from 'bun:test';
import {
  requestConfirmation,
  type ConfirmChannel,
} from '../src/hitl/confirm.js';
import {
  registerHitlAuditHook,
  type HitlAuditEntry,
} from '../src/hitl/audit-log.js';

afterEach(() => {
  registerHitlAuditHook(null);
});

function captureAudit(): {
  audits: HitlAuditEntry[];
  flush: () => Promise<void>;
} {
  const audits: HitlAuditEntry[] = [];
  registerHitlAuditHook((e) => {
    audits.push(e);
  });
  // confirm.ts schedules audit via Promise.resolve(hook(entry)) —
  // a single microtask flush suffices.
  const flush = async () => { await new Promise((r) => setTimeout(r, 0)); };
  return { audits, flush };
}

describe('confirm.ts audit emission — race winner', () => {
  it('emits an audit entry tagged with the winning channel + answer', async () => {
    const { audits, flush } = captureAudit();
    const fast: ConfirmChannel = {
      name: 'pushcut',
      async request() { return true; },
      cancel() {},
    };
    const slow: ConfirmChannel = {
      name: 'telegram',
      request() { return new Promise(() => { /* never resolves */ }); },
      cancel() {},
    };
    const r = await requestConfirmation({
      prompt: 'Approve workflow X?',
      channels: [fast, slow],
      requestId: 'req-1',
      agentKind: 'workflow',
      runId: 'run-99',
    });
    await flush();
    expect(r.answer).toBe(true);
    expect(r.channel).toBe('pushcut');
    expect(audits).toHaveLength(1);
    expect(audits[0].requestId).toBe('req-1');
    expect(audits[0].channel).toBe('pushcut');
    expect(audits[0].answer).toBe(true);
    expect(audits[0].prompt).toBe('Approve workflow X?');
    expect(audits[0].agentKind).toBe('workflow');
    expect(audits[0].runId).toBe('run-99');
    expect(audits[0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(typeof audits[0].ts).toBe('number');
  });

  it('synthesizes a requestId when caller did not supply one', async () => {
    const { audits, flush } = captureAudit();
    const ch: ConfirmChannel = {
      name: 'pushcut',
      async request() { return false; },
      cancel() {},
    };
    await requestConfirmation({ prompt: 'No id', channels: [ch] });
    await flush();
    expect(audits).toHaveLength(1);
    expect(audits[0].requestId).toMatch(/^hitl-\d+/);
  });
});

describe('confirm.ts audit emission — fallback paths', () => {
  it('emits "all-failed" when every channel opts out (returns null)', async () => {
    const { audits, flush } = captureAudit();
    const ch: ConfirmChannel = {
      name: 'pushcut',
      async request() { return null; },
      cancel() {},
    };
    const r = await requestConfirmation({
      prompt: 'Q',
      channels: [ch],
      requestId: 'req-fail',
      timeoutMs: 60_000, // long enough that all-failed wins first
    });
    await flush();
    expect(r.channel).toBe('all-failed');
    expect(audits).toHaveLength(1);
    expect(audits[0].channel).toBe('all-failed');
    expect(audits[0].requestId).toBe('req-fail');
    expect(audits[0].answer).toBe(false);
  });

  it('emits "timeout" when the race times out', async () => {
    const { audits, flush } = captureAudit();
    const slow: ConfirmChannel = {
      name: 'telegram',
      request() { return new Promise(() => { /* never resolves */ }); },
      cancel() {},
    };
    const r = await requestConfirmation({
      prompt: 'Q',
      channels: [slow],
      timeoutMs: 5,
      requestId: 'req-timeout',
    });
    await flush();
    expect(r.channel).toBe('timeout');
    expect(audits).toHaveLength(1);
    expect(audits[0].channel).toBe('timeout');
    expect(audits[0].requestId).toBe('req-timeout');
  });

  it('emits "all-failed" when the delivery filter excludes every channel', async () => {
    const { audits, flush } = captureAudit();
    const ch: ConfirmChannel = {
      name: 'pushcut',
      async request() { return true; },
      cancel() {},
    };
    await requestConfirmation({
      prompt: 'Q',
      channels: [ch],
      delivery: 'discord' as never,    // no match
      requestId: 'req-filtered',
    });
    await flush();
    expect(audits).toHaveLength(1);
    expect(audits[0].channel).toBe('all-failed');
  });
});

describe('confirm.ts audit emission — fire-and-forget safety', () => {
  it('a throwing audit hook does not break the race resolution', async () => {
    registerHitlAuditHook(() => { throw new Error('audit boom'); });
    const ch: ConfirmChannel = {
      name: 'pushcut',
      async request() { return true; },
      cancel() {},
    };
    const r = await requestConfirmation({ prompt: 'Q', channels: [ch] });
    expect(r.answer).toBe(true);
    expect(r.channel).toBe('pushcut');
  });

  it('an audit hook returning a rejected promise is swallowed', async () => {
    registerHitlAuditHook(async () => {
      throw new Error('async audit boom');
    });
    const ch: ConfirmChannel = {
      name: 'telegram',
      async request() { return false; },
      cancel() {},
    };
    const r = await requestConfirmation({ prompt: 'Q', channels: [ch] });
    expect(r.answer).toBe(false);
    expect(r.channel).toBe('telegram');
    // Allow the swallow to land on the next microtask
    await new Promise((res) => setTimeout(res, 0));
  });

  it('no hook registered → still works (no audit emitted)', async () => {
    // explicit clear (afterEach also clears, but be defensive)
    registerHitlAuditHook(null);
    const ch: ConfirmChannel = {
      name: 'pushcut',
      async request() { return true; },
      cancel() {},
    };
    const r = await requestConfirmation({ prompt: 'Q', channels: [ch] });
    expect(r.channel).toBe('pushcut');
  });
});
