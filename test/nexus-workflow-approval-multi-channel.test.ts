// BACKLOG #4 — verify the workflow approval race fan-out
// (PWA registry vs HITL channels) resolves to the first winner +
// cancels the loser cleanly.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  registerDefaultConfirmChannels,
  type ConfirmChannel,
  type ConfirmRequest,
  type HitlAnswer,
} from '../src/hitl/confirm.js';
import {
  _resetApprovalsForTest,
  listPendingApprovals,
  resolveApproval,
  rejectApproval,
} from '../src/nexus/api/workflow-approvals.js';
import { runApprovalAcrossChannels } from '../src/nexus/api/workflow-approval-multi-channel.js';

// ── Test channel helpers ────────────────────────────────────────────

interface TestChannel extends ConfirmChannel {
  /** Resolve the channel's pending request from the test side. */
  fire(answer: HitlAnswer | null): void;
  /** Spy: was cancel() called? */
  cancelled: boolean;
  /** Spy: how many requests were made? */
  requestCount: number;
}

function makeTestChannel(name: string): TestChannel {
  let resolver: ((a: HitlAnswer | null) => void) | null = null;
  const ch: TestChannel = {
    name,
    cancelled: false,
    requestCount: 0,
    async request(_req: ConfirmRequest) {
      ch.requestCount += 1;
      return new Promise<HitlAnswer | null>((resolve) => {
        resolver = resolve;
      });
    },
    cancel() {
      ch.cancelled = true;
      if (resolver) {
        resolver(null);
        resolver = null;
      }
    },
    fire(answer: HitlAnswer | null) {
      if (!resolver) throw new Error(`channel ${name} has no pending request to fire`);
      const r = resolver;
      resolver = null;
      r(answer);
    },
  };
  return ch;
}

beforeEach(() => {
  _resetApprovalsForTest();
  registerDefaultConfirmChannels([]);
});

afterEach(() => {
  _resetApprovalsForTest();
  registerDefaultConfirmChannels([]);
});

// ── PWA-only path (no HITL channels wired) ─────────────────────────

describe('runApprovalAcrossChannels — PWA-only path (no channels)', () => {
  it('resolves with PWA response when /approve fires', async () => {
    const promise = runApprovalAcrossChannels({
      runId: 'run-A',
      message: 'approve me',
    });

    // Wait one tick so registerApproval registered the entry.
    await new Promise((r) => setTimeout(r, 10));
    expect(listPendingApprovals().map((p) => p.runId)).toContain('run-A');

    resolveApproval('run-A', 'LGTM');
    expect(await promise).toBe('LGTM');
  });

  it('resolves with undefined when /approve has no body', async () => {
    const promise = runApprovalAcrossChannels({ runId: 'run-B', message: 'go?' });
    await new Promise((r) => setTimeout(r, 10));
    resolveApproval('run-B', undefined);
    expect(await promise).toBeUndefined();
  });

  it('rejects when PWA /reject fires', async () => {
    const promise = runApprovalAcrossChannels({ runId: 'run-C', message: 'no?' });
    await new Promise((r) => setTimeout(r, 10));
    rejectApproval('run-C', 'wrong env');
    await expect(promise).rejects.toThrow();
  });

  it('does not leak entries — pending list empty after resolve', async () => {
    const promise = runApprovalAcrossChannels({ runId: 'run-D', message: 'cleanup?' });
    await new Promise((r) => setTimeout(r, 10));
    resolveApproval('run-D', 'OK');
    await promise;
    expect(listPendingApprovals().find((p) => p.runId === 'run-D')).toBeUndefined();
  });
});

// ── HITL wins ──────────────────────────────────────────────────────

describe('runApprovalAcrossChannels — HITL channel wins', () => {
  it('returns approved-marker when single HITL channel answers true first', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({ runId: 'run-E', message: 'race me' });
    await new Promise((r) => setTimeout(r, 10));
    expect(pushcut.requestCount).toBe(1);
    expect(listPendingApprovals().map((p) => p.runId)).toContain('run-E');

    pushcut.fire(true);
    expect(await promise).toBe('approved (channel:pushcut)');

    // PWA path was rejected by the bridge to clear the pending entry
    await new Promise((r) => setTimeout(r, 10));
    expect(listPendingApprovals().find((p) => p.runId === 'run-E')).toBeUndefined();
  });

  it('throws when HITL channel answers false', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({ runId: 'run-F', message: 'reject me' });
    await new Promise((r) => setTimeout(r, 10));
    pushcut.fire(false);
    await expect(promise).rejects.toThrow(/rejected via pushcut/);
  });

  it('first non-null channel wins when multiple wired (Promise.race semantics)', async () => {
    const pushcut = makeTestChannel('pushcut');
    const telegram = makeTestChannel('telegram');
    registerDefaultConfirmChannels([pushcut, telegram]);

    const promise = runApprovalAcrossChannels({ runId: 'run-G', message: 'two?' });
    await new Promise((r) => setTimeout(r, 10));
    expect(pushcut.requestCount).toBe(1);
    expect(telegram.requestCount).toBe(1);

    // telegram answers first
    telegram.fire(true);
    expect(await promise).toBe('approved (channel:telegram)');
  });
});

// ── PWA wins (channels still pending) ──────────────────────────────

describe('runApprovalAcrossChannels — PWA wins despite wired channels', () => {
  it('PWA /approve wins even when HITL channels are still pending', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({ runId: 'run-H', message: 'pwa-first' });
    await new Promise((r) => setTimeout(r, 10));
    expect(pushcut.requestCount).toBe(1); // channel was asked

    resolveApproval('run-H', 'pwa-wins');
    expect(await promise).toBe('pwa-wins');
    // The channel's pending request is left unresolved (will time out
    // per its own logic). We don't enforce cancel here — see comment
    // in runApprovalAcrossChannels.
  });

  it('PWA /reject wins even when HITL is racing', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({ runId: 'run-I', message: 'pwa-rejects' });
    await new Promise((r) => setTimeout(r, 10));
    rejectApproval('run-I', 'nope');
    await expect(promise).rejects.toThrow(/nope/);
  });
});

// ── Channel returns null ───────────────────────────────────────────

describe('runApprovalAcrossChannels — channel opts out (returns null)', () => {
  it('null from the only channel keeps PWA waiting', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({ runId: 'run-J', message: 'opt out' });
    await new Promise((r) => setTimeout(r, 10));
    pushcut.fire(null); // channel says "I can't deliver"

    // PWA still pending — promise must not resolve until PWA fires.
    await new Promise((r) => setTimeout(r, 30));
    expect(listPendingApprovals().map((p) => p.runId)).toContain('run-J');

    // Now PWA fires
    resolveApproval('run-J', 'pwa-eventually');
    expect(await promise).toBe('pwa-eventually');
  });
});

// ── HITL timeout doesn't kill PWA path ─────────────────────────────

describe('runApprovalAcrossChannels — HITL timeout', () => {
  it('HITL timeout does NOT prevent PWA from later winning', async () => {
    // Channel that never resolves → triggers HITL timeout
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);

    const promise = runApprovalAcrossChannels({
      runId: 'run-K',
      message: 'wait for me',
      hitlTimeoutMs: 30,           // tiny timeout for fast test
    });

    // Let HITL timeout fire (channel never .fire() called)
    await new Promise((r) => setTimeout(r, 60));

    // PWA still pending
    expect(listPendingApprovals().map((p) => p.runId)).toContain('run-K');

    // PWA answers — promise should resolve to PWA's answer
    resolveApproval('run-K', 'pwa-wins-after-hitl-timeout');
    expect(await promise).toBe('pwa-wins-after-hitl-timeout');
  });
});

// ── BACKLOG #4 (2026-05-11) · `delivery` filter ────────────────────

describe('runApprovalAcrossChannels — delivery filter', () => {
  it('delivery=pushcut excludes the PWA registry path', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);
    const promise = runApprovalAcrossChannels({
      runId: 'run-D1',
      message: 'pushcut only',
      delivery: 'pushcut',
    });
    // PWA registry should NOT have a pending entry for this run.
    expect(listPendingApprovals().find((p) => p.runId === 'run-D1')).toBeUndefined();
    pushcut.fire(true);
    expect(await promise).toBe('approved (channel:pushcut)');
  });

  it('delivery=pushcut filters out non-matching channels', async () => {
    const pushcut = makeTestChannel('pushcut');
    const telegram = makeTestChannel('telegram');
    registerDefaultConfirmChannels([pushcut, telegram]);
    const promise = runApprovalAcrossChannels({
      runId: 'run-D2',
      message: 'pushcut only',
      delivery: 'pushcut',
    });
    // Wait a tick for the racers to subscribe.
    await new Promise((r) => setTimeout(r, 5));
    // Telegram should NOT have received a request — it was filtered.
    expect(telegram.requestCount).toBe(0);
    expect(pushcut.requestCount).toBe(1);
    pushcut.fire(true);
    expect(await promise).toBe('approved (channel:pushcut)');
  });

  it('delivery=modal still includes PWA path + every HITL channel', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);
    const promise = runApprovalAcrossChannels({
      runId: 'run-D3',
      message: 'modal too',
      delivery: 'modal',
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(listPendingApprovals().find((p) => p.runId === 'run-D3')).toBeDefined();
    resolveApproval('run-D3', 'pwa-wins');
    expect(await promise).toBe('pwa-wins');
  });

  it('delivery=pushcut throws when no matching channel configured', async () => {
    registerDefaultConfirmChannels([makeTestChannel('telegram')]);
    await expect(
      runApprovalAcrossChannels({
        runId: 'run-D4',
        message: 'pushcut only',
        delivery: 'pushcut',
      }),
    ).rejects.toThrow(/no matching HITL channel/);
  });

  it('delivery=pushcut throws on all-channel timeout (PWA excluded)', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);
    await expect(
      runApprovalAcrossChannels({
        runId: 'run-D5',
        message: 'short',
        delivery: 'pushcut',
        hitlTimeoutMs: 30,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('omitted delivery preserves existing all-surfaces race behaviour', async () => {
    const pushcut = makeTestChannel('pushcut');
    registerDefaultConfirmChannels([pushcut]);
    const promise = runApprovalAcrossChannels({
      runId: 'run-D6',
      message: 'classic',
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(listPendingApprovals().find((p) => p.runId === 'run-D6')).toBeDefined();
    expect(pushcut.requestCount).toBe(1);
    pushcut.fire(true);
    expect(await promise).toBe('approved (channel:pushcut)');
  });
});
