// MSS M3 Signal Bus — cascade-zyu W3 Y1.

import { describe, expect, test } from 'bun:test';
import {
  SignalBus,
  _resetSignalBus,
  signalBus,
  tierAtLeast,
  type SignalEnvelope,
} from '../src/signal-bus/index.js';

describe('tierAtLeast', () => {
  test('rank ordering', () => {
    expect(tierAtLeast('critical', 'emergency')).toBe(true);
    expect(tierAtLeast('threshold', 'emergency')).toBe(false);
    expect(tierAtLeast('info', 'info')).toBe(true);
  });
});

describe('SignalBus subscribe + emit', () => {
  test('subscriber receives matching tier + source', () => {
    const bus = new SignalBus();
    const received: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'patcher.*',
      minTier: 'threshold',
      handler: (env) => { received.push(env); },
    });
    bus.emit({ source: 'patcher.batch_ready', tier: 'threshold', message: 'go' });
    bus.emit({ source: 'patcher.heartbeat', tier: 'info', message: 'beat' });
    bus.emit({ source: 'thinker.proposal', tier: 'emergency', message: 'p' });
    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe('patcher.batch_ready');
  });

  test('exact source match works without glob', () => {
    const bus = new SignalBus();
    const received: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: 'exact.match',
      minTier: 'info',
      handler: (env) => { received.push(env); },
    });
    bus.emit({ source: 'exact.match', tier: 'info', message: 'm' });
    bus.emit({ source: 'exact.matcher', tier: 'info', message: 'm' });
    expect(received).toHaveLength(1);
  });

  test('higher-tier signals reach lower-tier subscribers', () => {
    const bus = new SignalBus();
    const received: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: '*',
      minTier: 'info',
      handler: (env) => { received.push(env); },
    });
    bus.emit({ source: 'x', tier: 'critical', message: 'c' });
    bus.emit({ source: 'x', tier: 'trace', message: 't' });
    expect(received).toHaveLength(1);
    expect(received[0]?.tier).toBe('critical');
  });

  test('unsubscribe stops delivery', () => {
    const bus = new SignalBus();
    const received: SignalEnvelope[] = [];
    const off = bus.subscribe({
      sourceGlob: '*',
      minTier: 'info',
      handler: (env) => { received.push(env); },
    });
    bus.emit({ source: 'a', tier: 'info', message: 'm' });
    off();
    bus.emit({ source: 'a', tier: 'info', message: 'm' });
    expect(received).toHaveLength(1);
  });

  test('handler errors do not crash the bus', () => {
    const bus = new SignalBus();
    bus.subscribe({
      sourceGlob: '*',
      minTier: 'info',
      handler: () => { throw new Error('boom'); },
    });
    expect(() => bus.emit({ source: 'a', tier: 'info', message: 'm' })).not.toThrow();
  });
});

describe('SignalBus dedupe', () => {
  test('dedupeKey suppresses identical-key emits within window', () => {
    const bus = new SignalBus({ dedupeWindowMs: 60_000 });
    const received: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: '*', minTier: 'info',
      handler: (env) => { received.push(env); },
    });
    const first = bus.emit({
      source: 'a', tier: 'threshold', message: 'm', dedupeKey: 'k1',
    });
    const second = bus.emit({
      source: 'a', tier: 'threshold', message: 'm', dedupeKey: 'k1',
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(received).toHaveLength(1);
  });

  test('no dedupeKey → no suppression', () => {
    const bus = new SignalBus();
    const received: SignalEnvelope[] = [];
    bus.subscribe({
      sourceGlob: '*', minTier: 'info',
      handler: (env) => { received.push(env); },
    });
    bus.emit({ source: 'a', tier: 'info', message: 'm' });
    bus.emit({ source: 'a', tier: 'info', message: 'm' });
    expect(received).toHaveLength(2);
  });
});

describe('SignalBus recent ring', () => {
  test('recent returns the last N envelopes', () => {
    const bus = new SignalBus({ ringCapacity: 4 });
    for (let i = 0; i < 6; i++) {
      bus.emit({ source: 's', tier: 'info', message: `m${i}` });
    }
    const recent = bus.recent({ limit: 4 });
    expect(recent).toHaveLength(4);
    expect(recent[3]?.message).toBe('m5');
  });

  test('recent filters by min tier', () => {
    const bus = new SignalBus();
    bus.emit({ source: 's', tier: 'info', message: 'i' });
    bus.emit({ source: 's', tier: 'emergency', message: 'e' });
    bus.emit({ source: 's', tier: 'critical', message: 'c' });
    const recent = bus.recent({ tier: 'emergency' });
    expect(recent).toHaveLength(2);
  });
});

describe('singleton seam', () => {
  test('_resetSignalBus returns a fresh bus', () => {
    signalBus().emit({ source: 'a', tier: 'info', message: 'm' });
    const fresh = _resetSignalBus();
    expect(fresh.recent({ limit: 10 })).toHaveLength(0);
  });
});
