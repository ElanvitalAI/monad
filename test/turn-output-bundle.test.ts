import { describe, expect, it } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import {
  createTurnOutputBundle,
  runTurnOutputBundleSettle,
} from '../src/input/turn-output-bundle.js';

describe('turn output bundle alpha', () => {
  it('awaits end-turn sinks before notify', async () => {
    const ordering: string[] = [];
    const bundle = createTurnOutputBundle([
      {
        kind: 'text',
        onEndTurn: async () => { ordering.push('text:end'); },
        onCancel: async () => { ordering.push('text:cancel'); },
      },
      {
        kind: 'audio-tts',
        onEndTurn: async () => { ordering.push('audio:end'); },
        onCancel: async () => { ordering.push('audio:cancel'); },
      },
    ]);
    await runTurnOutputBundleSettle({
      bundle,
      settled: 'end_turn',
      cooldownMs: 0,
      notifyDone: (reason) => { ordering.push(`notify:${reason}`); },
      debugPath: 'test',
    });
    expect(ordering).toEqual(['text:end', 'audio:end', 'notify:end_turn']);
  });

  it('downgrades end_turn to cancelled on recent quick-pass', async () => {
    const ordering: string[] = [];
    const signalBus = createControlSignalBus(() => new Date().toISOString());
    signalBus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      mayPreempt: true,
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });
    const bundle = createTurnOutputBundle([
      {
        kind: 'audio-tts',
        onEndTurn: async () => { ordering.push('audio:end'); },
        onCancel: async () => { ordering.push('audio:cancel'); },
      },
    ]);
    const finalReason = await runTurnOutputBundleSettle({
      bundle,
      settled: 'end_turn',
      cooldownMs: 0,
      notifyDone: (reason) => { ordering.push(`notify:${reason}`); },
      debugPath: 'test',
      preSettleQuickPass: {
        signalBus,
        scope: { surface: 'voice-chat', channel: 'dashboard' },
        signalKinds: ['voice-chat-stop'],
      },
    });
    expect(finalReason).toBe('cancelled');
    expect(ordering).toEqual(['audio:cancel', 'notify:cancelled']);
  });
});
