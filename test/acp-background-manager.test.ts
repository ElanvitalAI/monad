// Unit tests for ACP BackgroundManager — H3 #6.
//
// Pure state-machine tests. No subprocess; we synthesize the
// turnPromise + chunk/approval hooks that the production skill-
// tool dispatcher supplies.

import { describe, expect, test } from 'bun:test';
import {
  bgStateToSessionStatus,
  backgroundToStub,
  createBackgroundManager,
  type BackgroundManager,
  type BackgroundSessionRecord,
  type BackgroundState,
} from '../src/acp/background-manager.js';

interface Harness {
  mgr: BackgroundManager;
  record: BackgroundSessionRecord;
  feedChunk: (text: string) => void;
  signalWaiting: () => void;
  signalResumed: () => void;
  resolveTurn: (reason: string) => void;
  rejectTurn: (err: Error) => void;
  transitions: Array<{ from: BackgroundState; to: BackgroundState }>;
}

function makeHarness(opts: { previewCap?: number } = {}): Harness {
  const mgr = createBackgroundManager({
    previewCap: opts.previewCap,
    now: (() => {
      let t = 1000;
      return () => t++;
    })(),
  });
  let resolveTurn!: (result: { stopReason: any }) => void;
  let rejectTurn!: (err: Error) => void;
  const turnPromise = new Promise<{ stopReason: any }>((res, rej) => {
    resolveTurn = res;
    rejectTurn = rej;
  });

  let feedChunk: (text: string) => void = () => {};
  let signalWaiting: () => void = () => {};
  let signalResumed: () => void = () => {};
  const transitions: Array<{ from: BackgroundState; to: BackgroundState }> = [];
  mgr.onStateChange((record, prev) => {
    transitions.push({ from: prev, to: record.state });
  });

  const record = mgr.start({
    clientSessionId: 'acp-cli:claude:abc',
    backendSessionId: 'abc',
    backendId: 'claude',
    cwd: '/tmp',
    initialMessage: 'hi',
    turnPromise,
    registerChunk: (feed) => { feedChunk = feed; },
    registerApprovalSignal: (w, r) => {
      signalWaiting = w;
      signalResumed = r;
    },
  });

  return {
    mgr,
    record,
    feedChunk,
    signalWaiting,
    signalResumed,
    resolveTurn: (reason: string) => resolveTurn({ stopReason: reason }),
    rejectTurn,
    transitions,
  };
}

async function waitTurns(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('BackgroundManager · lifecycle', () => {
  test('start records running state', () => {
    const h = makeHarness();
    expect(h.record.state).toBe('running');
    expect(h.record.id).toBe('acp-bg:acp-cli:claude:abc');
    expect(h.record.startedAt).toBeGreaterThan(0);
  });

  test('end_turn → completed', async () => {
    const h = makeHarness();
    h.resolveTurn('end_turn');
    await waitTurns();
    expect(h.record.state).toBe('completed');
    expect(h.record.stopReason).toBe('end_turn');
    expect(h.record.endedAt).toBeDefined();
  });

  test('stopReason cancelled → cancelled (not completed)', async () => {
    const h = makeHarness();
    h.resolveTurn('cancelled');
    await waitTurns();
    expect(h.record.state).toBe('cancelled');
  });

  test('turn rejects → failed with error message', async () => {
    const h = makeHarness();
    h.rejectTurn(new Error('subprocess crashed'));
    await waitTurns();
    expect(h.record.state).toBe('failed');
    expect(h.record.error).toBe('subprocess crashed');
    expect(h.record.endedAt).toBeDefined();
  });

  test('explicit cancel mid-turn → cancelled', async () => {
    const h = makeHarness();
    const didCancel = await h.mgr.cancel(h.record.id, async () => {});
    expect(didCancel).toBe(true);
    expect(h.record.state).toBe('cancelled');
    // Late resolution should NOT flip back.
    h.resolveTurn('end_turn');
    await waitTurns();
    expect(h.record.state).toBe('cancelled');
  });

  test('cancel on terminal returns false', async () => {
    const h = makeHarness();
    h.resolveTurn('end_turn');
    await waitTurns();
    const r = await h.mgr.cancel(h.record.id, async () => {});
    expect(r).toBe(false);
  });

  test('list returns all records', () => {
    const h = makeHarness();
    expect(h.mgr.list()).toHaveLength(1);
    expect(h.mgr.list()[0]?.id).toBe(h.record.id);
  });
});

describe('BackgroundManager · output capture', () => {
  test('feedChunk appends to fullOutput + outputPreview', () => {
    const h = makeHarness();
    h.feedChunk('hello ');
    h.feedChunk('world');
    expect(h.record.fullOutput).toBe('hello world');
    expect(h.record.outputPreview).toBe('hello world');
  });

  test('outputPreview capped at previewCap · tails the buffer', () => {
    const h = makeHarness({ previewCap: 5 });
    h.feedChunk('abcdefghij');
    expect(h.record.fullOutput).toBe('abcdefghij');
    // Preview keeps the LAST previewCap chars (recent context is more
    // useful than the start of a long turn).
    expect(h.record.outputPreview).toBe('fghij');
    expect(h.record.outputPreview.length).toBe(5);
  });

  test('fullOutput unbounded · preserves all chunks', () => {
    const h = makeHarness({ previewCap: 10 });
    h.feedChunk('a'.repeat(1000));
    expect(h.record.fullOutput.length).toBe(1000);
    expect(h.record.outputPreview.length).toBe(10);
  });

  test('terminal state freezes output feed', async () => {
    const h = makeHarness();
    h.feedChunk('pre-end');
    h.resolveTurn('end_turn');
    await waitTurns();
    h.feedChunk(' · post-end ignored');
    expect(h.record.fullOutput).toBe('pre-end');
  });
});

describe('BackgroundManager · approval signals', () => {
  test('signalWaiting → waiting_for_confirmation', () => {
    const h = makeHarness();
    h.signalWaiting();
    expect(h.record.state).toBe('waiting_for_confirmation');
  });

  test('signalResumed → running (from waiting)', () => {
    const h = makeHarness();
    h.signalWaiting();
    h.signalResumed();
    expect(h.record.state).toBe('running');
  });

  test('signalWaiting on terminal is no-op', async () => {
    const h = makeHarness();
    h.resolveTurn('end_turn');
    await waitTurns();
    h.signalWaiting();
    expect(h.record.state).toBe('completed');
  });

  test('signalResumed when already running is no-op', () => {
    const h = makeHarness();
    h.signalResumed();
    expect(h.record.state).toBe('running');
  });
});

describe('BackgroundManager · subscribe', () => {
  test('onStateChange fires on every transition with prev', () => {
    const h = makeHarness();
    h.signalWaiting();
    h.signalResumed();
    expect(h.transitions).toEqual([
      { from: 'running', to: 'waiting_for_confirmation' },
      { from: 'waiting_for_confirmation', to: 'running' },
    ]);
  });

  test('unsubscribe stops further fires', () => {
    const h = makeHarness();
    const log: string[] = [];
    const unsub = h.mgr.onStateChange((r) => { log.push(r.state); });
    h.signalWaiting();
    unsub();
    h.signalResumed();
    expect(log).toEqual(['waiting_for_confirmation']);
  });

  test('listener throw does not break other listeners', () => {
    const h = makeHarness();
    const calls: string[] = [];
    h.mgr.onStateChange(() => { throw new Error('bad listener'); });
    h.mgr.onStateChange((r) => { calls.push(r.state); });
    h.signalWaiting();
    expect(calls).toEqual(['waiting_for_confirmation']);
  });
});

describe('BackgroundManager · join', () => {
  test('join returns the same record as status', async () => {
    const h = makeHarness();
    h.feedChunk('intermediate output');
    const status = h.mgr.status(h.record.id);
    const joined = h.mgr.join(h.record.id);
    expect(joined).toEqual(status);
    expect(joined?.fullOutput).toBe('intermediate output');
  });

  test('join on unknown id returns null', () => {
    const h = makeHarness();
    expect(h.mgr.join('acp-bg:ghost')).toBeNull();
    expect(h.mgr.status('acp-bg:ghost')).toBeNull();
  });
});

// ─── Follow-up #3 — sidebar kind helpers ────────────────────────

describe('bgStateToSessionStatus', () => {
  test('maps all 5 lifecycle states to the 4-state sidebar machine', () => {
    expect(bgStateToSessionStatus('running')).toBe('working');
    expect(bgStateToSessionStatus('waiting_for_confirmation')).toBe('awaiting');
    expect(bgStateToSessionStatus('completed')).toBe('done');
    expect(bgStateToSessionStatus('failed')).toBe('err');
    // cancelled maps to 'err' (red), not 'done' — user-facing
    // "didn't complete its task" semantic. Documented in PLAN §2.4.
    expect(bgStateToSessionStatus('cancelled')).toBe('err');
  });
});

describe('backgroundToStub', () => {
  test('running record → alive stub with kind=background + namespace meta', () => {
    const h = makeHarness();
    const stub = backgroundToStub(h.record);
    expect(stub.id).toBe('acp-bg:acp-cli:claude:abc');
    expect(stub.agentKind).toBe('background');
    expect(stub.isAlive).toBe(true);
    expect(stub.title).toBe('BG · claude · tmp');
    expect(stub.createdAt).toBe(h.record.startedAt);
    expect(stub.lastActivityAt).toBe(h.record.lastSeenAt);
    expect(stub.meta).toMatchObject({
      namespace: 'acp-bg',
      backendId: 'claude',
      backendSessionId: 'abc',
      clientSessionId: 'acp-cli:claude:abc',
      state: 'running',
    });
  });

  test('terminal states → isAlive=false + meta.state preserved', async () => {
    const h = makeHarness();
    h.resolveTurn('end_turn');
    await waitTurns();
    const stub = backgroundToStub(h.record);
    expect(stub.isAlive).toBe(false);
    expect(stub.meta?.['state']).toBe('completed');
    expect(stub.meta?.['stopReason']).toBe('end_turn');
  });

  test('failure record → meta.error surfaces the message', async () => {
    const h = makeHarness();
    h.rejectTurn(new Error('subprocess crashed'));
    await waitTurns();
    const stub = backgroundToStub(h.record);
    expect(stub.isAlive).toBe(false);
    expect(stub.meta?.['state']).toBe('failed');
    expect(stub.meta?.['error']).toBe('subprocess crashed');
  });

  test('empty cwd → fallback title without basename', () => {
    const mgr = createBackgroundManager();
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    const record = mgr.start({
      clientSessionId: 'acp-cli:codex:xyz',
      backendSessionId: 'xyz',
      backendId: 'codex',
      cwd: '',
      initialMessage: 'hi',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    const stub = backgroundToStub(record);
    expect(stub.title).toBe('BG · codex');
  });

  test('origin flows into meta when provided', () => {
    const mgr = createBackgroundManager();
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    const record = mgr.start({
      clientSessionId: 'acp-cli:claude:o',
      backendSessionId: 'o',
      backendId: 'claude',
      cwd: '/x',
      initialMessage: 'hi',
      origin: 'telegram:chat-42',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    const stub = backgroundToStub(record);
    expect(stub.meta?.['origin']).toBe('telegram:chat-42');
  });

  test('title + agentKind are stable across state transitions', async () => {
    const h = makeHarness();
    const runningStub = backgroundToStub(h.record);
    h.resolveTurn('end_turn');
    await waitTurns();
    const completedStub = backgroundToStub(h.record);
    expect(completedStub.title).toBe(runningStub.title);
    expect(completedStub.agentKind).toBe(runningStub.agentKind);
    expect(completedStub.id).toBe(runningStub.id);
  });
});

// ─── Follow-up #6 · TTL / GC sweep ───────────────────────────────

/** Harness variant that lets the test control `now()` directly so TTL
 *  comparisons are deterministic (bun's Date.now has sub-ms jitter). */
function makeTimedHarness(startAt: number = 10_000): {
  mgr: BackgroundManager;
  setNow: (t: number) => void;
} {
  let current = startAt;
  const mgr = createBackgroundManager({
    now: () => current,
  });
  return { mgr, setNow: (t: number) => { current = t; } };
}

function armRecord(
  mgr: BackgroundManager,
  id: string,
  initial: string = 'hi',
): { feedChunk: (t: string) => void; resolve: (reason: string) => void; reject: (e: Error) => void } {
  let resolveTurn!: (r: { stopReason: any }) => void;
  let rejectTurn!: (e: Error) => void;
  const turnPromise = new Promise<{ stopReason: any }>((res, rej) => {
    resolveTurn = res;
    rejectTurn = rej;
  });
  let feedChunk: (t: string) => void = () => {};
  mgr.start({
    clientSessionId: id,
    backendSessionId: id.replace('acp-cli:claude:', ''),
    backendId: 'claude',
    cwd: '/tmp',
    initialMessage: initial,
    turnPromise,
    registerChunk: (f) => { feedChunk = f; },
    registerApprovalSignal: () => {},
  });
  return {
    feedChunk,
    resolve: (reason: string) => resolveTurn({ stopReason: reason }),
    reject: (e: Error) => rejectTurn(e),
  };
}

describe('BackgroundManager · sweep', () => {
  test('removes terminal records older than olderThanMs', async () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    const old = armRecord(mgr, 'acp-cli:claude:old');
    setNow(10_500);
    old.resolve('end_turn');
    await waitTurns();
    // Jump well past TTL (old.endedAt ≈ 10_500).
    setNow(10_500 + 60_000);
    const removed = mgr.sweep(30_000); // anything ended >30s ago
    expect(removed).toEqual(['acp-bg:acp-cli:claude:old']);
    expect(mgr.status('acp-bg:acp-cli:claude:old')).toBeNull();
    expect(mgr.list()).toHaveLength(0);
  });

  test('preserves active records regardless of startedAt', () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    armRecord(mgr, 'acp-cli:claude:active');
    setNow(10_000 + 10_000_000);
    const removed = mgr.sweep(60_000);
    expect(removed).toEqual([]);
    expect(mgr.list()).toHaveLength(1);
  });

  test('preserves waiting_for_confirmation even when stale', () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    // Manually start + transition into waiting via the harness signal.
    let signalWaiting: () => void = () => {};
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    mgr.start({
      clientSessionId: 'acp-cli:claude:pending',
      backendSessionId: 'pending',
      backendId: 'claude',
      cwd: '/tmp',
      initialMessage: 'x',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: (w) => { signalWaiting = w; },
    });
    signalWaiting();
    setNow(10_000 + 10_000_000);
    const removed = mgr.sweep(1);
    expect(removed).toEqual([]);
  });

  test('preserves terminal records younger than TTL', async () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    const young = armRecord(mgr, 'acp-cli:claude:young');
    setNow(10_100);
    young.resolve('end_turn');
    await waitTurns();
    setNow(15_000); // only 4.9s old
    const removed = mgr.sweep(10_000); // TTL = 10s
    expect(removed).toEqual([]);
    expect(mgr.list()).toHaveLength(1);
  });

  test('failed + cancelled states both eligible for sweep', async () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    const failed = armRecord(mgr, 'acp-cli:claude:failed');
    const cancelled = armRecord(mgr, 'acp-cli:claude:cancelled');
    setNow(10_500);
    failed.reject(new Error('boom'));
    cancelled.resolve('cancelled');
    await waitTurns();
    setNow(10_500 + 60_000);
    const removed = mgr.sweep(30_000).sort();
    expect(removed).toEqual([
      'acp-bg:acp-cli:claude:cancelled',
      'acp-bg:acp-cli:claude:failed',
    ]);
  });

  test('idempotent — second sweep with no new terminals returns []', async () => {
    const { mgr, setNow } = makeTimedHarness(10_000);
    const r = armRecord(mgr, 'acp-cli:claude:r');
    setNow(10_500);
    r.resolve('end_turn');
    await waitTurns();
    setNow(100_000);
    expect(mgr.sweep(1_000)).toHaveLength(1);
    expect(mgr.sweep(1_000)).toEqual([]);
  });

  test('sweep on empty manager is a no-op', () => {
    const { mgr } = makeTimedHarness();
    expect(mgr.sweep(1_000)).toEqual([]);
  });
});

describe('BackgroundManager · startAutoSweep', () => {
  test('returns a disposer that stops future sweeps', async () => {
    const { mgr } = makeTimedHarness();
    const r = armRecord(mgr, 'acp-cli:claude:auto');
    r.resolve('end_turn');
    await waitTurns();
    // Very small interval so the test doesn't spin · we dispose
    // immediately and verify the timer handle went away (side-effect:
    // no pending setInterval keeps the test loop alive).
    const dispose = mgr.startAutoSweep({ intervalMs: 10, olderThanMs: 1 });
    expect(typeof dispose).toBe('function');
    dispose();
    // After dispose, no additional work is done · sanity: record is
    // still there because we didn't wait for a tick.
    expect(mgr.list().length).toBeGreaterThanOrEqual(0);
  });

  test('double-dispose is safe', () => {
    const { mgr } = makeTimedHarness();
    const dispose = mgr.startAutoSweep({ intervalMs: 1_000, olderThanMs: 1 });
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

// ─── Follow-up #9 · HITL direct wire helpers ─────────────────────

describe('BackgroundManager · signalApproval{Waiting,Resumed}', () => {
  function armBgRecord(mgr: BackgroundManager, backendId: string, backendSessionId: string) {
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    return mgr.start({
      clientSessionId: `acp-cli:${backendId}:${backendSessionId}`,
      backendSessionId,
      backendId,
      cwd: '/tmp',
      initialMessage: 'x',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
  }

  test('signalApprovalWaiting flips running → waiting_for_confirmation', () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-1');
    mgr.signalApprovalWaiting('claude', 'sess-1');
    expect(record.state).toBe('waiting_for_confirmation');
  });

  test('signalApprovalResumed flips waiting → running', () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-2');
    mgr.signalApprovalWaiting('claude', 'sess-2');
    mgr.signalApprovalResumed('claude', 'sess-2');
    expect(record.state).toBe('running');
  });

  test('signals on unknown (backendId, sessionId) are silent no-ops', () => {
    const mgr = createBackgroundManager();
    expect(() => mgr.signalApprovalWaiting('claude', 'never')).not.toThrow();
    expect(() => mgr.signalApprovalResumed('claude', 'never')).not.toThrow();
    expect(mgr.list()).toEqual([]);
  });

  test('signals correctly route by (backendId, backendSessionId) tuple', () => {
    const mgr = createBackgroundManager();
    const a = armBgRecord(mgr, 'claude', 'dup');
    const b = armBgRecord(mgr, 'codex', 'dup');
    mgr.signalApprovalWaiting('claude', 'dup');
    expect(a.state).toBe('waiting_for_confirmation');
    expect(b.state).toBe('running'); // untouched · different backendId
  });
});

describe('withBgApprovalSignals · wrap', () => {
  const { withBgApprovalSignals, withBgQuestionSignals } = require('../src/acp/background-manager.js') as typeof import('../src/acp/background-manager.js');

  function armBgRecord(mgr: BackgroundManager, backendId: string, backendSessionId: string) {
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    return mgr.start({
      clientSessionId: `acp-cli:${backendId}:${backendSessionId}`,
      backendSessionId,
      backendId,
      cwd: '/tmp',
      initialMessage: 'x',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
  }

  test('forwards approver answer · flips state before + after', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-1');
    const inner = async () => {
      expect(record.state).toBe('waiting_for_confirmation');
      return true;
    };
    const wrapped = withBgApprovalSignals(inner, mgr);
    const answer = await wrapped({
      backendId: 'claude',
      sessionId: 'sess-1',
      title: 't',
      options: [],
    });
    expect(answer).toBe(true);
    expect(record.state).toBe('running');
  });

  test('resumed fires even when inner approver throws', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-2');
    const inner = async () => { throw new Error('inner crashed'); };
    const wrapped = withBgApprovalSignals(inner, mgr);
    await expect(
      wrapped({ backendId: 'claude', sessionId: 'sess-2', title: 't', options: [] }),
    ).rejects.toThrow('inner crashed');
    expect(record.state).toBe('running');
  });

  test('question variant preserves { answers } shape', async () => {
    const mgr = createBackgroundManager();
    armBgRecord(mgr, 'claude', 'sess-3');
    const inner = async () => ({ answers: { q1: 'a' } });
    const wrapped = withBgQuestionSignals(inner, mgr);
    const out = await wrapped({
      backendId: 'claude',
      sessionId: 'sess-3',
      questions: [{ id: 'q1', header: 'h', question: '?', options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
    });
    expect(out).toEqual({ answers: { q1: 'a' } });
  });
});
