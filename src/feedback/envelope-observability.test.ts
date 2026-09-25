import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { debug } from '../debug/log.js';
import {
  createSeqTracker,
  makeEnvelope,
  shouldPersistEnvelopeObservation,
} from './envelope.js';

type LogFn = typeof debug.log;
type LoggedEvent = { category: string; event: string; data: unknown };

const logged: LoggedEvent[] = [];
let originalLog: LogFn;
let originalEnabledDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  originalLog = debug.log.bind(debug) as LogFn;
  originalEnabledDescriptor = Object.getOwnPropertyDescriptor(debug, 'enabled');
  Object.defineProperty(debug, 'enabled', { configurable: true, value: false });
  (debug as { log: LogFn }).log = ((category: string, event: string, data?: unknown) => {
    logged.push({ category, event, data });
  }) as LogFn;
});

afterAll(() => {
  (debug as { log: LogFn }).log = originalLog;
  if (originalEnabledDescriptor) {
    Object.defineProperty(debug, 'enabled', originalEnabledDescriptor);
  } else {
    delete (debug as { enabled?: boolean }).enabled;
  }
});

function emit(kind: Parameters<typeof shouldPersistEnvelopeObservation>[0]) {
  return makeEnvelope({
    kind,
    sessionId: 'session-1',
    blockId: 'block-42',
    phase: 'delta',
    payload: {},
    parentToolCallId: 'parent-tool-7',
    asciiFallback: ['first', 'second'],
    now: () => 123,
  }, createSeqTracker());
}

describe('envelope file-sink observability', () => {
  it('persists each low-frequency progress and planning kind', () => {
    expect(shouldPersistEnvelopeObservation('agent.plan')).toBe(true);
    expect(shouldPersistEnvelopeObservation('mission.update')).toBe(true);
    expect(shouldPersistEnvelopeObservation('tool.progress')).toBe(true);
    expect(shouldPersistEnvelopeObservation('tool.diff')).toBe(true);
    expect(shouldPersistEnvelopeObservation('agent.status')).toBe(true);
  });

  it('keeps the high-volume kinds behind the existing debug gate', () => {
    expect(shouldPersistEnvelopeObservation('debug.line')).toBe(false);
    expect(shouldPersistEnvelopeObservation('tool.search-hit')).toBe(false);
  });

  it('distinguishes persisted kinds from high-volume kinds', () => {
    const values = [
      shouldPersistEnvelopeObservation('agent.plan'),
      shouldPersistEnvelopeObservation('mission.update'),
      shouldPersistEnvelopeObservation('tool.progress'),
      shouldPersistEnvelopeObservation('tool.diff'),
      shouldPersistEnvelopeObservation('agent.status'),
      shouldPersistEnvelopeObservation('debug.line'),
      shouldPersistEnvelopeObservation('tool.search-hit'),
    ];

    expect(values.filter(Boolean)).not.toHaveLength(0);
    expect(values.filter((value) => !value)).not.toHaveLength(0);
  });

  it('emits a persisted kind with debug disabled and preserves the event contract', () => {
    logged.length = 0;

    const envelope = emit('agent.plan');

    expect(logged).toEqual([{
      category: 'feedback.envelope.emit',
      event: 'block-42',
      data: {
        kind: 'agent.plan',
        phase: 'delta',
        seq: 1,
        asciiLines: 2,
        parent: 'parent-tool-7',
      },
    }]);
    expect(envelope).toMatchObject({
      envelopeVersion: 1,
      sessionId: 'session-1',
      blockId: 'block-42',
      parentToolCallId: 'parent-tool-7',
      kind: 'agent.plan',
      phase: 'delta',
      emittedAt: 123,
      seq: 1,
      payload: {},
      asciiFallback: ['first', 'second'],
    });
  });

  it('does not emit a high-volume kind while debug is disabled', () => {
    logged.length = 0;

    emit('debug.line');

    expect(logged).toHaveLength(0);
  });
});
