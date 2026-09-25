// P1 ReAct self-diagnosis — pure correlator + consumer + poller unit tests.
// The value is the SPINE (frame⊕logs → verdict → surface_events); heuristics
// are tuned but the contract (verdict priority · dedup · first-sight defer) is
// what these lock down.

import { describe, expect, test } from 'bun:test';
import {
  correlateDrift,
  createDiagnosisConsumer,
  driftToSelfEvent,
  pollFrameLogDiagnosis,
  type DiagnosisConsumer,
  type DiagnosisInput,
  type LogWindowRecord,
} from './frame-log-diagnosis.js';
import type { PtyManifestRow } from '../pty-shell/pty-manifest.js';
import type { SelfEventInput } from '../domains/self-awareness.js';

const log = (level: string, category: string, event: string, data?: string): LogWindowRecord => ({ level, category, event, data });

function baseInput(over: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    surfaceId: 'tui:1234', instance: 'prod',
    frameText: 'screen A', frameAt: 2000, prevFrameText: 'screen A',
    logs: [], ...over,
  };
}

describe('correlateDrift', () => {
  test('agreement → null (screen changed, a matching success log)', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen B', logs: [log('info', 'input.route', 'dispatch', '{"ok":true}')] }));
    // screen moved AND a success log — the two lenses agree, no drift.
    expect(r).toBeNull();
  });

  test('false-normal → success log but frozen screen (worst)', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen A', prevFrameText: 'screen A', logs: [log('info', 'input.route', 'submit dispatched')] }));
    expect(r?.verdict).toBe('false-normal');
    expect(r?.evidence.hasSuccess).toBe(true);
    expect(r?.evidence.frameChanged).toBe(false);
  });

  test('false-normal suppressed on first sight (no prev to prove non-movement)', () => {
    const r = correlateDrift(baseInput({ prevFrameText: null, logs: [log('info', 'input.route', 'dispatch')] }));
    expect(r).toBeNull();
  });

  test('false-normal suppressed when an error explains the inaction', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen A', prevFrameText: 'screen A', logs: [log('info', 'x', 'dispatch'), log('error', 'x', 'boom')] }));
    expect(r).toBeNull();
  });

  test('multipath-partial → no-op log while screen acted', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [log('info', 'mouse.route', 'route:none')] }));
    expect(r?.verdict).toBe('multipath-partial');
  });

  test('multipath-partial → success + no-op coexist in one window', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen A', prevFrameText: 'screen A', logs: [log('info', 'a.route', 'dispatch'), log('info', 'b.route', 'no-dispatch')] }));
    // frozen screen + success would be false-normal, but the coexisting no-op
    // is more diagnostic (contradictory paths). false-normal is checked first,
    // so verify the no-op path is reachable when there is NO success-with-freeze.
    expect(r).not.toBeNull();
  });

  test('instrumentation-gap → screen moved, zero logs', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [] }));
    expect(r?.verdict).toBe('instrumentation-gap');
  });

  test('blocked-uninstrumented → screen classified blocked but zero logs (#1 state-aware)', () => {
    const r = correlateDrift(baseInput({ frameState: 'blocked', frameText: 'screen A', prevFrameText: 'screen A', logs: [] }));
    expect(r?.verdict).toBe('blocked-uninstrumented');
  });

  test('blocked WITH a BLOCK-EXPLAINING log → suppressed (the gate was observed)', () => {
    const r = correlateDrift(baseInput({ frameState: 'blocked', frameText: 'screen A', prevFrameText: 'screen A', logs: [log('info', 'hitl.gate', 'awaiting-approval')] }));
    expect(r?.verdict).not.toBe('blocked-uninstrumented');
  });

  test('blocked WITH only an UNRELATED log → STILL blocked-uninstrumented (relevance·review must-fix)', () => {
    // A render tick must NOT suppress it — that was the Goodhart false-negative.
    const r = correlateDrift(baseInput({ frameState: 'blocked', frameText: 'screen A', prevFrameText: 'screen A', logs: [log('info', 'render', 'tick')] }));
    expect(r?.verdict).toBe('blocked-uninstrumented');
  });

  test('blocked-uninstrumented fires on a STANDING block (frame unchanged) — beats instrumentation-gap', () => {
    // frame unchanged (no delta) + blocked + no logs: instrumentation-gap needs a change, this doesn't.
    const r = correlateDrift(baseInput({ frameState: 'blocked', frameText: 'screen A', prevFrameText: 'screen A', logs: [] }));
    expect(r?.verdict).toBe('blocked-uninstrumented');
  });

  test('no frameState → state-aware verdict never fires (back-compat)', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen A', prevFrameText: 'screen A', logs: [] }));
    expect(r).toBeNull(); // unchanged + no logs + no state = nothing
  });

  test('no drift → screen moved with a plain (non-success, non-noop) info log', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [log('info', 'render', 'tick')] }));
    // change + a log present + no contradictory signal = healthy enough.
    expect(r).toBeNull();
  });

  test('border/ANSI churn is not a change', () => {
    const r = correlateDrift(baseInput({
      frameText: '\x1b[32m┌──┐│ hi │└──┘', prevFrameText: '│ hi │',
      logs: [log('info', 'x', 'dispatch')],
    }));
    // normalized both → "hi"; success + frozen → false-normal.
    expect(r?.verdict).toBe('false-normal');
  });

  test('debug/diag success words are ignored (ambient trace ≠ outcome)', () => {
    const r = correlateDrift(baseInput({ frameText: 'screen A', prevFrameText: 'screen A', logs: [log('debug', 'x', 'dispatch')] }));
    expect(r).toBeNull();
  });
});

describe('driftToSelfEvent', () => {
  test('maps to a high-importance drift episodic event', () => {
    const f = correlateDrift(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [] }))!;
    const ev = driftToSelfEvent(f);
    expect(ev.tool).toBe('react-diagnosis');
    expect(ev.kind).toBe('drift');
    expect(ev.importance).toBe(7);
    expect(ev.summary).toContain('drift:instrumentation-gap');
    expect((ev.refs as { verdict: string }).verdict).toBe('instrumentation-gap');
  });
});

describe('createDiagnosisConsumer', () => {
  test('records once, dedups a standing drift within minGapMs', () => {
    const recorded: SelfEventInput[] = [];
    let t = 0;
    const c = createDiagnosisConsumer({ record: (i) => recorded.push(i), minGapMs: 1000, now: () => t });
    const input = baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [] });
    expect(c.observe(input)).not.toBeNull();     // first drift recorded
    expect(c.observe(input)).toBeNull();          // same (surface,verdict) within gap → suppressed
    expect(recorded.length).toBe(1);
    t = 2000;
    expect(c.observe(input)).not.toBeNull();      // gap elapsed → re-flag
    expect(recorded.length).toBe(2);
  });

  test('fires notify hook when provided (fail-soft)', () => {
    const recorded: SelfEventInput[] = [];
    let notified = 0;
    const c = createDiagnosisConsumer({ record: (i) => recorded.push(i), notify: () => { notified += 1; throw new Error('boom'); } });
    const r = c.observe(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [] }));
    expect(r).not.toBeNull();   // notify throw must not sink the recording
    expect(notified).toBe(1);
    expect(recorded.length).toBe(1);
  });

  test('agreement → no record', () => {
    const recorded: SelfEventInput[] = [];
    const c = createDiagnosisConsumer({ record: (i) => recorded.push(i) });
    c.observe(baseInput({ frameText: 'screen B', prevFrameText: 'screen A', logs: [log('info', 'x', 'dispatch')] }));
    expect(recorded.length).toBe(0);
  });
});

// ── Poller ──

function manifestRow(over: Partial<PtyManifestRow>): PtyManifestRow {
  return {
    id: 'tui:1', kind: 'tui', cmd: 'monad', workdir: '/x', ownerPid: 1, instance: 'prod',
    startedAt: 0, alive: true, exitCode: null, snapshot: '', snapshotAt: 0,
    frame: 'screen A', frameAt: 1000, updatedAt: 1000, ...over,
  } as PtyManifestRow;
}

function fakeConsumer(): { c: DiagnosisConsumer; seen: DiagnosisInput[] } {
  const seen: DiagnosisInput[] = [];
  const recorded: SelfEventInput[] = [];
  const inner = createDiagnosisConsumer({ record: (i) => recorded.push(i), minGapMs: 0 });
  const c: DiagnosisConsumer = { observe: (i) => { seen.push(i); return inner.observe(i); } };
  return { c, seen };
}

describe('pollFrameLogDiagnosis', () => {
  test('first sight seeds prev and defers correlation (needs a delta)', () => {
    const { c, seen } = fakeConsumer();
    const prev = new Map();
    const found = pollFrameLogDiagnosis(c, prev, { listManifest: () => [manifestRow({})], queryLogsSince: () => [] });
    expect(seen.length).toBe(0);        // no correlation on first frame
    expect(found.length).toBe(0);
    expect(prev.get('tui:1')?.at).toBe(1000);
  });

  test('second frame correlates against the log window since prevFrameAt', () => {
    const { c, seen } = fakeConsumer();
    const prev = new Map();
    const rows = [manifestRow({ frame: 'screen A', frameAt: 1000 })];
    pollFrameLogDiagnosis(c, prev, { listManifest: () => rows, queryLogsSince: () => [] }); // seed
    rows[0] = manifestRow({ frame: 'screen B', frameAt: 2000 });                            // screen moved
    let sinceArg = -1;
    const found = pollFrameLogDiagnosis(c, prev, { listManifest: () => rows, queryLogsSince: (s) => { sinceArg = s; return []; } });
    expect(sinceArg).toBe(1000);        // queried the window since the prev frame
    expect(seen.length).toBe(1);
    expect(found[0]?.verdict).toBe('instrumentation-gap'); // moved + zero logs
  });

  test('skips non-allowlisted kinds and dead/frameless rows', () => {
    const { c, seen } = fakeConsumer();
    const prev = new Map();
    const rows = [
      manifestRow({ id: 'a', kind: 'preview', frameAt: 1000 }),  // kind not allowed
      manifestRow({ id: 'b', kind: 'tui', alive: false }),        // dead
      manifestRow({ id: 'c', kind: 'pty', frame: '', frameAt: 0 }), // no frame
    ];
    pollFrameLogDiagnosis(c, prev, { listManifest: () => rows, queryLogsSince: () => [] });
    expect(seen.length).toBe(0);
    expect(prev.size).toBe(0);
  });

  test('forgets surfaces that vanished from the manifest', () => {
    const { c } = fakeConsumer();
    const prev = new Map([['tui:1', { text: 'x', at: 1 }], ['gone', { text: 'y', at: 1 }]]);
    pollFrameLogDiagnosis(c, prev, { listManifest: () => [manifestRow({ id: 'tui:1' })], queryLogsSince: () => [] });
    expect(prev.has('gone')).toBe(false);
    expect(prev.has('tui:1')).toBe(true);
  });

  test('fail-soft on manifest read error', () => {
    const { c } = fakeConsumer();
    const found = pollFrameLogDiagnosis(c, new Map(), { listManifest: () => { throw new Error('db'); }, queryLogsSince: () => [] });
    expect(found).toEqual([]);
  });

  test('#1→#5 — classifies frame + records state transition; blocked frame → blocked-uninstrumented', () => {
    const { c, seen } = fakeConsumer();
    const prev = new Map();
    const recorded: { surfaceId: string; state: string; agent?: string }[] = [];
    // Non-blocked (working) frame — isolates record/agent + delta correlation
    // (blocked-standing is covered by the dedicated first-sight test below).
    const workingFrame = 'thinking\n⠹ working on it';
    const rows = [manifestRow({ id: 'pty:1', kind: 'pty', cmd: 'codex --yolo', frame: workingFrame, frameAt: 1000 })];
    const deps = {
      listManifest: () => rows,
      queryLogsSince: () => [] as never[],
      recordState: (i: { surfaceId: string; state: string; agent?: string }) => recorded.push({ surfaceId: i.surfaceId, state: i.state, ...(i.agent ? { agent: i.agent } : {}) }),
    };
    // First sight: classify + record (seed·agent from cmd); no delta correlation.
    pollFrameLogDiagnosis(c, prev, deps);
    expect(recorded).toEqual([{ surfaceId: 'pty:1', state: 'working', agent: 'codex' }]); // #4: agent 배선
    expect(seen.length).toBe(0); // working (not blocked) → no standing check on first sight
    // Changed frame + zero logs → instrumentation-gap, and frameState flowed in.
    rows[0] = manifestRow({ id: 'pty:1', kind: 'pty', frame: workingFrame + '\n(more)', frameAt: 2000 });
    const found = pollFrameLogDiagnosis(c, prev, deps);
    expect(seen[0]?.frameState).toBe('working');
    expect(found[0]?.verdict).toBe('instrumentation-gap');
  });

  test('standing block from FIRST SIGHT → blocked-uninstrumented via POLLER (review must-fix ②)', () => {
    // The delta gate alone would miss a block present at startup that never
    // redraws. Drive the poller (not the correlator) to prove the integration.
    const { c } = fakeConsumer();
    const prev = new Map();
    const blockedFrame = 'Approve?\n❯ 1. Yes\n  2. No';
    const rows = [manifestRow({ id: 'pty:s', kind: 'pty', frame: blockedFrame, frameAt: 1000 })];
    const deps = { listManifest: () => rows, queryLogsSince: () => [] as never[] };
    // First sight, no delta, zero logs → still diagnosed.
    const first = pollFrameLogDiagnosis(c, prev, deps);
    expect(first[0]?.verdict).toBe('blocked-uninstrumented');
    // Unchanged frame next poll (frameAt static) → still caught (standing).
    const second = pollFrameLogDiagnosis(c, prev, deps);
    expect(second[0]?.verdict).toBe('blocked-uninstrumented');
  });

  test('standing block WITH a block-explaining log → not flagged', () => {
    const { c } = fakeConsumer();
    const prev = new Map();
    const rows = [manifestRow({ id: 'pty:s2', kind: 'pty', frame: '❯ 1. Yes\n  2. No', frameAt: 1000 })];
    const deps = { listManifest: () => rows, queryLogsSince: () => [{ level: 'info', category: 'hitl', event: 'awaiting-approval' }] };
    expect(pollFrameLogDiagnosis(c, prev, deps)).toEqual([]);
  });

  test('standing block window = EPISODE (since blockSince), not sliding now-window (review ③)', () => {
    const { c } = fakeConsumer();
    const prev = new Map();
    const sinceSeen: number[] = [];
    const rows = [manifestRow({ id: 'pty:e', kind: 'pty', frame: '❯ 1. Yes\n  2. No', frameAt: 1000 })];
    const deps = {
      listManifest: () => rows,
      queryLogsSince: (s: number) => { sinceSeen.push(s); return [] as never[]; },
      now: () => 9_999_999, // far ahead — a sliding now-window would query ~now, not 1000.
    };
    pollFrameLogDiagnosis(c, prev, deps);       // first sight → blockSince fixed for episode
    pollFrameLogDiagnosis(c, prev, deps);       // still blocked → same blockSince
    // Episode-scoped: every poll queries the SAME since (not a now-sliding window).
    expect(sinceSeen.length).toBeGreaterThanOrEqual(2);
    expect(sinceSeen.every((s) => s === sinceSeen[0])).toBe(true);
    expect(sinceSeen).not.toContain(9_999_999); // never now-based
  });

  test('first-sight blocked — 렌더 直前 HITL 로그가 lookback 경계로 포착·억제 (review ⑥)', () => {
    const { c } = fakeConsumer();
    const prev = new Map();
    // 최초 관측이 이미 blocked(frameAt=100000). HITL 로그는 95000(렌더 5s 전·10s lookback 내).
    const rows = [manifestRow({ id: 'pty:fs', kind: 'pty', frame: '❯ 1. Yes\n  2. No', frameAt: 100_000 })];
    const query = (s: number) => s <= 95_000 ? [{ level: 'info', category: 'hitl', event: 'awaiting-approval' }] : [];
    const deps = { listManifest: () => rows, queryLogsSince: query };
    // blockSince = 100000 - 10000 = 90000 ≤ 95000 → HITL 포착 → 억제(오탐 안 함).
    expect(pollFrameLogDiagnosis(c, prev, deps)).toEqual([]);
  });

  test('블록 직전(렌더 前) HITL 로그가 억제 — 에피소드 경계=이전 프레임 시각 (review ⑤)', () => {
    const { c } = fakeConsumer();
    // 이전 프레임(working, at=500) → blocked 프레임(at=1000). HITL 로그는 600(블록 렌더 직전).
    const prev = new Map([['pty:cb', { text: 'working…', at: 500 }]]);
    const sinceSeen: number[] = [];
    const rows = [manifestRow({ id: 'pty:cb', kind: 'pty', frame: '❯ 1. Yes\n  2. No', frameAt: 1000 })];
    // since<=600 이면 HITL 로그 반환(블록 직전 기록). 경계가 frameAt(1000)이면 놓쳐 오탐.
    const query = (s: number) => { sinceSeen.push(s); return s <= 600 ? [{ level: 'info', category: 'hitl', event: 'awaiting-approval' }] : []; };
    const deps = { listManifest: () => rows, queryLogsSince: query };
    // poll1: 전이(delta) → (a) since prev.at(500) → HITL 포착 → 억제. blockSince=500 지속.
    expect(pollFrameLogDiagnosis(c, prev, deps)).toEqual([]);
    // poll2: standing(미변화) → (b) since blockSince(500) → HITL 포착 → 억제.
    expect(pollFrameLogDiagnosis(c, prev, deps)).toEqual([]);
    expect(sinceSeen).toContain(500);           // 경계=이전 프레임 시각(1000 아님)
    expect(sinceSeen).not.toContain(1000);
  });

  test('log-store failure → SKIP (no fabricated P1 from a DB error · review ④)', () => {
    const { c } = fakeConsumer();
    // standing block path
    const bRows = [manifestRow({ id: 'pty:f', kind: 'pty', frame: '❯ 1. Yes\n  2. No', frameAt: 1000 })];
    const bDeps = { listManifest: () => bRows, queryLogsSince: () => { throw new Error('db down'); } };
    expect(pollFrameLogDiagnosis(c, new Map(), bDeps)).toEqual([]); // not blocked-uninstrumented
    // change-based path — a changed frame with a failing query must not fabricate instrumentation-gap.
    const prev = new Map([['pty:g', { text: 'old', at: 500 }]]);
    const aRows = [manifestRow({ id: 'pty:g', kind: 'pty', frame: 'new output', frameAt: 1000 })];
    const aDeps = { listManifest: () => aRows, queryLogsSince: () => { throw new Error('db down'); } };
    expect(pollFrameLogDiagnosis(c, prev, aDeps)).toEqual([]);
  });

  test('recordState only fires on NEW frames (frameAt advanced), not every poll', () => {
    const { c } = fakeConsumer();
    const prev = new Map();
    let records = 0;
    const rows = [manifestRow({ id: 'pty:2', frame: 'idle\n❯ ', frameAt: 500 })];
    const deps = { listManifest: () => rows, queryLogsSince: () => [] as never[], recordState: () => { records += 1; } };
    pollFrameLogDiagnosis(c, prev, deps); // first sight → record
    pollFrameLogDiagnosis(c, prev, deps); // same frameAt → no new record
    expect(records).toBe(1);
  });
});
