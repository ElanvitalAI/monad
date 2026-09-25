// FU8 PR #1 — `createDispatchOutcomeRecorder` 3-sink fan-out.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDispatchOutcomeRecorder } from '../../src/dispatch/dispatch-emit';
import type { DispatchRunRecord } from '../../src/dispatch/dispatch-metrics';
import { _resetSignalBus } from '../../src/signal-bus/bus';
import { _resetUserIntentLogger } from '../../src/user-intent/logger';
import type { SignalEnvelope } from '../../src/signal-bus/types';
import type { UserIntentEvent } from '../../src/user-intent/types';

function makeRecord(over: Partial<DispatchRunRecord> = {}): DispatchRunRecord {
  return {
    at: '2026-05-12T10:00:00.000Z',
    taskId: 'task:abc',
    outcome: 'launched',
    reason: 'ok',
    axes: { inSleepWindow: false, idle: true, resourceOk: true, priorityBoosted: false },
    slotId: 'awake',
    ...over,
  };
}

let writeRows: DispatchRunRecord[];
let bus: ReturnType<typeof _resetSignalBus>;
let intent: ReturnType<typeof _resetUserIntentLogger>;
let intentEvents: UserIntentEvent[];

beforeEach(() => {
  writeRows = [];
  bus = _resetSignalBus();
  intent = _resetUserIntentLogger();
  intent.setSinks([{
    name: 'capture',
    write: (ev) => { intentEvents.push(ev); },
  }]);
  intentEvents = [];
});

afterEach(() => {
  _resetSignalBus();
  _resetUserIntentLogger();
});

describe('createDispatchOutcomeRecorder · 3-sink fan-out', () => {
  test('fires D8 row + signal-bus + intent emit for a launched outcome', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'dispatch.*',
      minTier: 'info',
      handler: (env) => { captured.push(env); },
    });
    const record = createDispatchOutcomeRecorder({
      writeRow: (r) => { writeRows.push(r); },
      bus,
      intent,
    });
    record(makeRecord());
    expect(writeRows).toHaveLength(1);
    expect(writeRows[0]!.outcome).toBe('launched');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.source).toBe('dispatch.launched');
    expect(captured[0]!.tier).toBe('info');
    expect(captured[0]!.payload?.taskId).toBe('task:abc');
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.intent.kind).toBe('system.dispatch.launched');
    expect(intentEvents[0]!.intent.target).toEqual({ kind: 'task', id: 'task:abc' });
  });

  test('errored outcome bumps signal-bus tier to `threshold`', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({ sourceGlob: 'dispatch.*', minTier: 'threshold', handler: (e) => { captured.push(e); } });
    const record = createDispatchOutcomeRecorder({
      writeRow: (r) => { writeRows.push(r); },
      bus,
      intent,
    });
    record(makeRecord({ outcome: 'errored', reason: 'launch-threw:oom' }));
    expect(captured).toHaveLength(1);
    expect(captured[0]!.tier).toBe('threshold');
    expect(intentEvents[0]!.intent.kind).toBe('system.dispatch.errored');
  });

  test('per-sink failure does not cascade to the other sinks', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({ sourceGlob: 'dispatch.*', minTier: 'info', handler: (e) => { captured.push(e); } });
    const record = createDispatchOutcomeRecorder({
      writeRow: () => { throw new Error('disk full'); },
      bus,
      intent,
    });
    expect(() => record(makeRecord())).not.toThrow();
    expect(writeRows).toHaveLength(0);
    // Signal + intent still fired despite the write failure.
    expect(captured).toHaveLength(1);
    expect(intentEvents).toHaveLength(1);
  });

  test('each of deferred / rejected / launched produces a matching signal source', () => {
    const captured: SignalEnvelope[] = [];
    bus.subscribe({ sourceGlob: 'dispatch.*', minTier: 'info', handler: (e) => { captured.push(e); } });
    const record = createDispatchOutcomeRecorder({
      writeRow: (r) => { writeRows.push(r); },
      bus,
      intent,
    });
    record(makeRecord({ outcome: 'launched' }));
    record(makeRecord({ outcome: 'deferred', reason: 'sleep-window:night' }));
    record(makeRecord({ outcome: 'rejected', reason: 'concurrency-cap' }));
    expect(captured.map((s) => s.source)).toEqual([
      'dispatch.launched',
      'dispatch.deferred',
      'dispatch.rejected',
    ]);
    expect(intentEvents.map((e) => e.intent.kind)).toEqual([
      'system.dispatch.launched',
      'system.dispatch.deferred',
      'system.dispatch.rejected',
    ]);
  });
});
