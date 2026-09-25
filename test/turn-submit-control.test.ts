import { describe, expect, it } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { createDashboardChatMainTurnSubmit } from '../src/dashboard/input/chat-main-submit-intent-runtime.js';
import {
  emitTurnSubmitBeginSignal,
  emitTurnSubmitQuickPassSignal,
} from '../src/input/turn-submit-control.js';

describe('emitTurnSubmitQuickPassSignal', () => {
  it('emits canonical begin signals from turn submits', () => {
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const submit = createDashboardChatMainTurnSubmit({
      kind: 'submit-turn',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-chat-main',
        transcriptSource: 'voice',
      },
      text: 'hello first',
      route: 'plain',
    });

    const signal = emitTurnSubmitBeginSignal({
      submit,
      signalBus: bus,
      urgency: 'priority',
      scope: {
        channel: 'dashboard',
        surface: 'chat-main',
      },
    });

    expect(signal).toEqual(expect.objectContaining({
      kind: 'turn-submit-begin',
      urgency: 'priority',
      source: expect.objectContaining({
        kind: 'voice',
        channel: 'dashboard',
      }),
      payload: expect.objectContaining({
        submitTarget: 'plain',
        submitSourceKind: 'voice',
      }),
    }));
    expect(bus.get(signal.id)).toEqual(signal);
  });

  it('emits canonical preempt-output quick-pass signals from turn submits', () => {
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const submit = createDashboardChatMainTurnSubmit({
      kind: 'submit-turn',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-chat-main',
        transcriptSource: 'voice',
      },
      text: 'interrupt now',
      route: 'plain',
    });

    const signal = emitTurnSubmitQuickPassSignal({
      submit,
      signalBus: bus,
      scope: {
        channel: 'dashboard',
        surface: 'chat-main',
      },
    });

    expect(signal).toEqual(expect.objectContaining({
      kind: 'turn-submit-preempt-output',
      urgency: 'quick-pass',
      source: expect.objectContaining({
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-chat-main',
      }),
      scope: expect.objectContaining({
        channel: 'dashboard',
        surface: 'chat-main',
      }),
      payload: expect.objectContaining({
        submitTarget: 'plain',
        submitSourceKind: 'voice',
      }),
    }));
    expect(bus.get(signal.id)).toEqual(signal);
  });
});
