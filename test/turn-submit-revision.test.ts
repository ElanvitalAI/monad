import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { TurnSubmitRevisionAbortError, abortTurnSubmitOnRecentQuickPass } from '../src/input/turn-submit-revision.js';

describe('abortTurnSubmitOnRecentQuickPass', () => {
  test('throws when a matching unconsumed quick-pass signal is recent', () => {
    const now = new Date().toISOString();
    const bus = createControlSignalBus(() => now);
    bus.emit({
      kind: 'turn-submit-abort',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
    });

    expect(() => abortTurnSubmitOnRecentQuickPass({
      signalBus: bus,
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
      signalKinds: ['turn-submit-abort'],
      windowMs: 5_000,
    })).toThrow(TurnSubmitRevisionAbortError);
  });

  test('ignores consumed or stale quick-pass signals', () => {
    const now = new Date().toISOString();
    const bus = createControlSignalBus(() => now);
    const first = bus.emit({
      kind: 'turn-submit-abort',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
    });
    bus.consumeQuickPass(first.id);

    expect(() => abortTurnSubmitOnRecentQuickPass({
      signalBus: bus,
      scope: { channel: 'daemon-public', surface: 'daemon-prompt' },
      signalKinds: ['turn-submit-abort'],
      windowMs: 5_000,
    })).not.toThrow();
  });
});
