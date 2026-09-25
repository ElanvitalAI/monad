import { describe, expect, it } from 'bun:test';

import {
  compareSignalUrgency,
  createControlSignalBus,
  defaultControlSignalBus,
  isQuickPassSignal,
  _resetDefaultControlSignalBusForTesting,
} from '../src/input/control-signal.js';

describe('control signal alpha', () => {
  it('orders urgency from background to critical', () => {
    expect(compareSignalUrgency('background', 'normal')).toBeLessThan(0);
    expect(compareSignalUrgency('quick-pass', 'priority')).toBeGreaterThan(0);
    expect(compareSignalUrgency('critical', 'critical')).toBe(0);
  });

  it('identifies quick-pass and critical as preemptive classes', () => {
    expect(isQuickPassSignal({ urgency: 'quick-pass' })).toBe(true);
    expect(isQuickPassSignal({ urgency: 'critical' })).toBe(true);
    expect(isQuickPassSignal({ urgency: 'priority' })).toBe(false);
  });

  it('emits, filters, promotes, and consumes quick-pass signals', () => {
    let seen = 0;
    const bus = createControlSignalBus(() => '2026-04-30T12:00:00.000Z');
    const stop = bus.subscribe(
      { minUrgency: 'quick-pass', sessionId: 'sess-1' },
      () => { seen += 1; },
    );

    const signal = bus.emit({
      kind: 'voice-barge-in',
      urgency: 'priority',
      source: 'sensor',
      scope: { sessionId: 'sess-1' },
      mayPreempt: true,
    });
    expect(seen).toBe(0);

    const promoted = bus.promote(signal.id, 'quick-pass');
    expect(promoted?.urgency).toBe('quick-pass');
    expect(seen).toBe(1);

    const consumed = bus.consumeQuickPass(signal.id);
    expect(consumed?.consumedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(bus.consumeQuickPass(signal.id)).toBeNull();

    stop();
    bus.clear();
  });

  it('exposes a resettable default singleton bus', () => {
    _resetDefaultControlSignalBusForTesting();
    const a = defaultControlSignalBus();
    const b = defaultControlSignalBus();
    expect(a).toBe(b);
    _resetDefaultControlSignalBusForTesting();
    const c = defaultControlSignalBus();
    expect(c).not.toBe(a);
  });
});
