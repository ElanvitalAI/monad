import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { shouldStopTurnOutputSink } from '../src/input/turn-output-sink-policy.js';

describe('shouldStopTurnOutputSink', () => {
  test('stops when a recent matching output-sink-stop quick-pass exists', () => {
    const now = new Date().toISOString();
    const bus = createControlSignalBus(() => now);
    bus.emit({
      kind: 'output-sink-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      payload: { sinkKind: 'picture' },
    });

    expect(shouldStopTurnOutputSink({
      signalBus: bus,
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      sinkKind: 'picture',
      windowMs: 5_000,
    })).toBe(true);
  });

  test('does not stop when the signal targets a different sink kind', () => {
    const now = new Date().toISOString();
    const bus = createControlSignalBus(() => now);
    bus.emit({
      kind: 'output-sink-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      payload: { sinkKind: 'video' },
    });

    expect(shouldStopTurnOutputSink({
      signalBus: bus,
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      sinkKind: 'picture',
      windowMs: 5_000,
    })).toBe(false);
  });
});
