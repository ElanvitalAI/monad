import { describe, expect, it } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { maybeEmitDashboardSubmitQuickPass } from '../src/dashboard/input/chat-main-submit-control.js';
import { createDashboardChatMainTurnSubmit } from '../src/dashboard/input/chat-main-submit-intent-runtime.js';

describe('maybeEmitDashboardSubmitQuickPass', () => {
  it('does nothing when output is not speaking', () => {
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const emitted = maybeEmitDashboardSubmitQuickPass({
      submit: createDashboardChatMainTurnSubmit({
        kind: 'submit-turn',
        source: { kind: 'keyboard', surface: 'dashboard-chat-main' },
        text: 'hello',
        route: 'plain',
      }),
      isOutputSpeaking: false,
      signalBus: bus,
    });

    expect(emitted).toBe(false);
    expect(bus.list()).toHaveLength(0);
  });

  it('emits a quick-pass preemption signal when output is speaking', () => {
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const emitted = maybeEmitDashboardSubmitQuickPass({
      submit: createDashboardChatMainTurnSubmit({
        kind: 'submit-turn',
        source: {
          kind: 'voice',
          channel: 'dashboard',
          surface: 'dashboard-chat-main',
          transcriptSource: 'voice',
        },
        text: 'interrupt now',
        route: 'plain',
      }),
      isOutputSpeaking: true,
      signalBus: bus,
    });

    expect(emitted).toBe(true);
    expect(bus.list()).toHaveLength(1);
    expect(bus.list()[0]).toEqual(expect.objectContaining({
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
  });
});
