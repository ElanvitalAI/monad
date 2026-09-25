import { describe, expect, it } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { createControlSignalObserver } from '../src/input/control-signal-observer.js';

describe('control signal observer', () => {
  it('stores recent signals and filters by scope/kind', () => {
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const observer = createControlSignalObserver(bus, { maxEntries: 3 });

    bus.emit({
      kind: 'turn-submit-begin',
      urgency: 'normal',
      source: 'system',
      scope: { channel: 'daemon-http', surface: 'daemon-prompt' },
    });
    bus.emit({
      kind: 'turn-submit-preempt-output',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { channel: 'dashboard', surface: 'chat-main' },
      mayPreempt: true,
    });
    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'system',
      scope: { channel: 'dashboard', surface: 'voice-chat' },
      mayPreempt: true,
    });
    bus.emit({
      kind: 'turn-submit-begin',
      urgency: 'priority',
      source: 'tool',
      scope: { channel: 'telegram', surface: 'daemon-session', sessionId: 'sess-1' },
    });

    expect(observer.list()).toHaveLength(3);
    expect(observer.countsByKind()).toEqual({
      'turn-submit-preempt-output': 1,
      'voice-chat-stop': 1,
      'turn-submit-begin': 1,
    });
    expect(observer.latest({ kind: 'turn-submit-begin' })).toEqual(expect.objectContaining({
      scope: expect.objectContaining({
        channel: 'telegram',
        sessionId: 'sess-1',
      }),
      urgency: 'priority',
    }));
    expect(observer.list({ channel: 'dashboard' })).toHaveLength(2);

    observer.detach();
  });
});
