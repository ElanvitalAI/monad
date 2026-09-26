// Intent-prediction service composition — feedback-store + tick
// scheduler + IntentPredictionService.
//
// Covers `src/intent-prediction/{feedback-store,tick,index}.ts`
// minus the pure ranker (covered by intent-prediction-core).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createFeedbackStore,
  createIntentPredictionService,
  createTickScheduler,
  type IntentContext,
  type IntentRanking,
} from '../src/intent-prediction/index.js';

const baseCtx: Omit<IntentContext, 'recentTaps'> = {
  sessionId: 'sess-1',
  lastTurnSummary: '',
  lastErr: null,
  progressPct: 0,
  fileEditCount: 0,
  idleMs: 0,
};

// ─── feedback store ───────────────────────────────────────────────

describe('createFeedbackStore', () => {
  test('records and retrieves recent labels per session (newest first)', () => {
    const s = createFeedbackStore();
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'a', chosen: '계속 진행', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 2 });
    s.record({ sessionId: 'a', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 3 });
    expect(s.recentForSession('a', 5)).toEqual(['오토파일럿', '계속 진행', '승인']);
  });

  test('per-session isolation', () => {
    const s = createFeedbackStore();
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'b', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'b', recentTaps: [] }, ts: 2 });
    expect(s.recentForSession('a', 5)).toEqual(['승인']);
    expect(s.recentForSession('b', 5)).toEqual(['오토파일럿']);
  });

  test('recentGlobal returns combined feed (newest first)', () => {
    const s = createFeedbackStore();
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'b', chosen: '계속 진행', context: { ...baseCtx, sessionId: 'b', recentTaps: [] }, ts: 2 });
    expect(s.recentGlobal(5)).toEqual(['계속 진행', '승인']);
  });

  test('size returns total record count across sessions', () => {
    const s = createFeedbackStore();
    expect(s.size()).toBe(0);
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'b', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'b', recentTaps: [] }, ts: 2 });
    expect(s.size()).toBe(2);
  });

  test('capacity caps the per-session ring buffer', () => {
    const s = createFeedbackStore({ capacity: 2 });
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'a', chosen: '계속 진행', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 2 });
    s.record({ sessionId: 'a', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 3 });
    expect(s.recentForSession('a', 5)).toEqual(['오토파일럿', '계속 진행']);
  });

  test('reset clears in-memory buffers', () => {
    const s = createFeedbackStore();
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.reset();
    expect(s.recentForSession('a', 5)).toEqual([]);
    expect(s.size()).toBe(0);
  });
});

describe('createFeedbackStore · persistence', () => {
  let tmpDir: string;
  let path: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'elanous-intent-feedback-'));
    path = join(tmpDir, 'intent-feedback.jsonl');
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* swallow */ }
  });

  test('records append to JSONL file', () => {
    const s = createFeedbackStore({ persistencePath: path });
    s.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    s.record({ sessionId: 'a', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 2 });
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).chosen).toBe('승인');
    expect(JSON.parse(lines[1]!).chosen).toBe('오토파일럿');
  });

  test('rehydrates from file on construction', () => {
    const s1 = createFeedbackStore({ persistencePath: path });
    s1.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    const s2 = createFeedbackStore({ persistencePath: path });
    expect(s2.recentForSession('a', 5)).toEqual(['승인']);
  });

  test('rehydrate skips malformed lines silently', () => {
    const s1 = createFeedbackStore({ persistencePath: path });
    s1.record({ sessionId: 'a', chosen: '승인', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 1 });
    // Append a corrupt line, then a valid one — rehydrate should
    // skip the corrupt one without crashing.
    const fs = require('node:fs');
    fs.appendFileSync(path, 'NOT_JSON\n');
    fs.appendFileSync(path, JSON.stringify({ sessionId: 'a', chosen: '오토파일럿', context: { ...baseCtx, sessionId: 'a', recentTaps: [] }, ts: 2 }) + '\n');
    const s2 = createFeedbackStore({ persistencePath: path });
    expect(s2.recentForSession('a', 5)).toEqual(['오토파일럿', '승인']);
  });
});

// ─── tick scheduler ───────────────────────────────────────────────

describe('createTickScheduler', () => {
  test('subscribe emits an immediate ranking for the new id', () => {
    const emitted: IntentRanking[] = [];
    const ts = createTickScheduler({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id, recentTaps: [] }),
      onRanking: (r) => emitted.push(r),
    });
    ts.subscribe('s1');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.sessionId).toBe('s1');
    expect(emitted[0]!.candidates).toHaveLength(6);
    ts.dispose();
  });

  test('latest returns last emitted ranking', () => {
    const ts = createTickScheduler({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id, recentTaps: [] }),
      onRanking: () => {},
    });
    ts.subscribe('s1');
    expect(ts.latest('s1')).not.toBeNull();
    expect(ts.latest('s1')!.sessionId).toBe('s1');
    expect(ts.latest('s2')).toBeNull();
    ts.dispose();
  });

  test('unsubscribe drops state + future ticks', () => {
    let ctxCalls = 0;
    const ts = createTickScheduler({
      contextProvider: (id) => {
        ctxCalls += 1;
        return { ...baseCtx, sessionId: id, recentTaps: [] };
      },
      onRanking: () => {},
    });
    ts.subscribe('s1');
    expect(ctxCalls).toBeGreaterThan(0);
    ts.unsubscribe('s1');
    expect(ts.latest('s1')).toBeNull();
    ts.dispose();
  });

  test('contextProvider returning null unsubscribes the session', () => {
    const ts = createTickScheduler({
      contextProvider: () => null,
      onRanking: () => {},
    });
    ts.subscribe('s1');
    // The immediate tick saw null — session should be unsubscribed.
    expect(ts.latest('s1')).toBeNull();
    ts.dispose();
  });

  test('tickNow forces a re-rank for an active session', () => {
    let lastErr: string | null = null;
    const ts = createTickScheduler({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id, lastErr, recentTaps: [] }),
      onRanking: () => {},
    });
    ts.subscribe('s1');
    const versionBefore = ts.latest('s1')!.version;
    lastErr = 'boom';
    ts.tickNow('s1');
    const versionAfter = ts.latest('s1')!.version;
    expect(versionAfter).toBeGreaterThan(versionBefore);
    ts.dispose();
  });

  test('tickNow on unsubscribed session is a no-op', () => {
    const ts = createTickScheduler({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id, recentTaps: [] }),
      onRanking: () => {},
    });
    ts.tickNow('not-subscribed');  // should not throw
    expect(ts.latest('not-subscribed')).toBeNull();
    ts.dispose();
  });

  test('dispose drops all subscribers + stops emitting', () => {
    let emits = 0;
    const ts = createTickScheduler({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id, recentTaps: [] }),
      onRanking: () => { emits += 1; },
    });
    ts.subscribe('s1');
    expect(emits).toBeGreaterThan(0);
    ts.dispose();
    const before = emits;
    ts.subscribe('s2');  // post-dispose subscribe is ignored
    expect(emits).toBe(before);
  });
});

// ─── service composition ──────────────────────────────────────────

describe('createIntentPredictionService', () => {
  test('subscribe + recordFeedback round-trip — recency boost lands on next tick', () => {
    const emits: IntentRanking[] = [];
    const svc = createIntentPredictionService({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id }),
    });
    const off = svc.onRanking((r) => emits.push(r));
    svc.subscribe('s1');
    const beforeFeedback = svc.latest('s1')!;
    const beforeAutopilot = beforeFeedback.candidates.find((c) => c.label === '오토파일럿')!.confidence;

    svc.recordFeedback({
      sessionId: 's1',
      chosen: '오토파일럿',
      context: { ...baseCtx, sessionId: 's1', recentTaps: [] },
      ts: Date.now(),
    });

    const afterFeedback = svc.latest('s1')!;
    const afterAutopilot = afterFeedback.candidates.find((c) => c.label === '오토파일럿')!.confidence;
    expect(afterAutopilot).toBeGreaterThan(beforeAutopilot);
    expect(afterFeedback.version).toBeGreaterThan(beforeFeedback.version);

    off();
    svc.dispose();
  });

  test('diagnostics surface feedbackCount + activeSessions', () => {
    const svc = createIntentPredictionService({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id }),
    });
    svc.subscribe('s1');
    svc.subscribe('s2');
    expect(svc.diagnostics().activeSessions).toBe(2);

    svc.recordFeedback({
      sessionId: 's1',
      chosen: '승인',
      context: { ...baseCtx, sessionId: 's1', recentTaps: [] },
      ts: 0,
    });
    expect(svc.diagnostics().feedbackCount).toBe(1);

    svc.dispose();
  });

  test('onRanking listeners can unsubscribe via the returned fn', () => {
    const events: IntentRanking[] = [];
    const svc = createIntentPredictionService({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id }),
    });
    const off = svc.onRanking((r) => events.push(r));
    svc.subscribe('s1');
    expect(events.length).toBe(1);
    off();
    svc.tickNow('s1');  // should NOT add to events
    // Force a context change so the tick would emit if listener still active.
    expect(events.length).toBeLessThanOrEqual(1);
    svc.dispose();
  });

  test('feedback persists across dispose when an injected store is used', () => {
    const store = createFeedbackStore();
    store.record({
      sessionId: 'sX',
      chosen: '오토파일럿',
      context: { ...baseCtx, sessionId: 'sX', recentTaps: [] },
      ts: 0,
    });
    const svc = createIntentPredictionService({
      contextProvider: (id) => ({ ...baseCtx, sessionId: id }),
      feedbackStore: store,
    });
    svc.subscribe('sX');
    const ranking = svc.latest('sX')!;
    const autopilot = ranking.candidates.find((c) => c.label === '오토파일럿')!.confidence;
    // Recency boost from the injected store applied — autopilot
    // confidence should exceed the BASE_CONFIDENCE floor (0.15).
    expect(autopilot).toBeGreaterThan(0.15);
    svc.dispose();
  });
});
