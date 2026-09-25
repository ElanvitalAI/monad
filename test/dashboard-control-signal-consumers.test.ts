import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { attachDashboardQuickPassConsumers } from '../src/dashboard/input/control-signal-consumers.js';

describe('attachDashboardQuickPassConsumers', () => {
  test('cancels output for voice-chat stop and chat-main preempt signals', async () => {
    const bus = createControlSignalBus(() => '2026-04-30T00:00:00.000Z');
    const seen: string[] = [];
    let cancels = 0;
    attachDashboardQuickPassConsumers({
      signalBus: bus,
      cancelOutput: () => { cancels += 1; },
      onConsumed: ({ kind, surface }) => { seen.push(`${kind}:${surface}`); },
    });

    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });
    bus.emit({
      kind: 'turn-submit-preempt-output',
      urgency: 'quick-pass',
      source: 'sensor',
      scope: { surface: 'chat-main', channel: 'dashboard' },
    });
    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'normal',
      source: 'sensor',
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });

    await Promise.resolve();
    expect(cancels).toBe(2);
    expect(seen).toEqual([
      'voice-chat-stop:voice-chat',
      'turn-submit-preempt-output:chat-main',
    ]);
  });
});
