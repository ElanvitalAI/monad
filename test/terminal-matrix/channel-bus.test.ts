import { describe, expect, test } from 'bun:test';
import { ChannelBus, type ChannelMessage } from '../../src/terminal-matrix/channel-bus.js';

describe('ChannelBus', () => {
  test('publish delivers to every subscriber of that channel', () => {
    const bus = new ChannelBus();
    const received: ChannelMessage[] = [];
    bus.subscribe('k8s:logs', (m) => received.push(m));
    bus.subscribe('k8s:logs', (m) => received.push(m));
    const n = bus.publish('k8s:logs', { from: 'term:1', payload: 'line' });
    expect(n).toBe(2);
    expect(received).toHaveLength(2);
    expect(received.every(m => m.payload === 'line')).toBe(true);
  });

  test('subscribers on other channels are untouched', () => {
    const bus = new ChannelBus();
    const other: ChannelMessage[] = [];
    bus.subscribe('other', (m) => other.push(m));
    bus.subscribe('k8s:logs', () => {});
    bus.publish('k8s:logs', { from: 'term:1', payload: 'x' });
    expect(other).toHaveLength(0);
  });

  test('unsubscribe removes the callback', () => {
    const bus = new ChannelBus();
    const hits: number[] = [];
    const sub = bus.subscribe('c', () => { hits.push(1); });
    bus.publish('c', { from: 't', payload: '' });
    sub.unsubscribe();
    bus.publish('c', { from: 't', payload: '' });
    expect(hits).toEqual([1]);
  });

  test('publish on empty channel returns 0', () => {
    const bus = new ChannelBus();
    expect(bus.publish('nobody', { from: 't', payload: '' })).toBe(0);
  });

  test('stats track publishes + subscriber count', () => {
    const bus = new ChannelBus();
    bus.subscribe('c', () => {});
    bus.subscribe('c', () => {});
    bus.publish('c', { from: 't', payload: '1' });
    bus.publish('c', { from: 't', payload: '2' });
    const s = bus.statsFor('c');
    expect(s.subscriberCount).toBe(2);
    expect(s.publishedCount).toBe(2);
    expect(s.lastPublishAt).not.toBeNull();
  });

  test('channels() enumerates subscribed + previously-published topics', () => {
    const bus = new ChannelBus();
    bus.subscribe('alpha', () => {});
    bus.publish('beta', { from: 't', payload: '' });
    expect(bus.channels()).toEqual(['alpha', 'beta']);
  });

  test('subscriber errors are isolated per-callback', () => {
    const bus = new ChannelBus();
    let a = 0, c = 0;
    bus.subscribe('c', () => { a += 1; });
    bus.subscribe('c', () => { throw new Error('b'); });
    bus.subscribe('c', () => { c += 1; });
    const n = bus.publish('c', { from: 't', payload: '' });
    expect(a).toBe(1);
    expect(c).toBe(1);
    // Delivered count excludes the thrower.
    expect(n).toBe(2);
  });

  test('meta + explicit at propagate through messages', () => {
    const bus = new ChannelBus();
    let got: ChannelMessage | null = null;
    bus.subscribe('c', (m) => { got = m; });
    bus.publish('c', { from: 't', payload: 'p', meta: { severity: 'warn' }, at: 42 });
    expect(got).not.toBeNull();
    expect(got!.at).toBe(42);
    expect(got!.meta?.severity).toBe('warn');
  });

  test('reset() clears subscribers and stats', () => {
    const bus = new ChannelBus();
    bus.subscribe('c', () => {});
    bus.publish('c', { from: 't', payload: '' });
    bus.reset();
    expect(bus.channels()).toEqual([]);
    expect(bus.statsFor('c').subscriberCount).toBe(0);
    expect(bus.statsFor('c').publishedCount).toBe(0);
    expect(bus.statsFor('c').replayBuffered).toBe(0);
  });
});

describe('ChannelBus replay buffer (U3)', () => {
  test('publish buffers into per-channel ring; statsFor exposes size', () => {
    const bus = new ChannelBus();
    for (let i = 0; i < 5; i++) {
      bus.publish('logs', { from: 't', payload: `line ${i}` });
    }
    expect(bus.statsFor('logs').replayBuffered).toBe(5);
  });

  test('subscribe({replay: true}) delivers buffered messages before returning', () => {
    const bus = new ChannelBus();
    bus.publish('logs', { from: 't', payload: 'first' });
    bus.publish('logs', { from: 't', payload: 'second' });
    const seen: ChannelMessage[] = [];
    bus.subscribe('logs', (m) => seen.push(m), { replay: true });
    expect(seen.map(m => m.payload)).toEqual(['first', 'second']);
  });

  test('subscribe({replay: true, replayLimit: N}) caps the backlog', () => {
    const bus = new ChannelBus();
    for (let i = 0; i < 10; i++) bus.publish('logs', { from: 't', payload: `L${i}` });
    const seen: ChannelMessage[] = [];
    bus.subscribe('logs', (m) => seen.push(m), { replay: true, replayLimit: 3 });
    // Most recent 3.
    expect(seen.map(m => m.payload)).toEqual(['L7', 'L8', 'L9']);
  });

  test('subscribe without replay does NOT see the backlog', () => {
    const bus = new ChannelBus();
    bus.publish('logs', { from: 't', payload: 'old' });
    const seen: ChannelMessage[] = [];
    bus.subscribe('logs', (m) => seen.push(m));
    expect(seen).toEqual([]);
  });

  test('replay subscribers still receive subsequent live publishes', () => {
    const bus = new ChannelBus();
    bus.publish('c', { from: 't', payload: 'past' });
    const seen: string[] = [];
    bus.subscribe('c', (m) => seen.push(m.payload as string), { replay: true });
    bus.publish('c', { from: 't', payload: 'future' });
    expect(seen).toEqual(['past', 'future']);
  });

  test('replay buffer is bounded by defaultReplayLimit (drops oldest)', () => {
    const bus = new ChannelBus({ defaultReplayLimit: 3 });
    for (let i = 0; i < 10; i++) bus.publish('c', { from: 't', payload: `L${i}` });
    const seen: string[] = [];
    bus.subscribe('c', (m) => seen.push(m.payload as string), { replay: true });
    expect(seen).toEqual(['L7', 'L8', 'L9']);
  });

  test('setReplayLimit(0) disables replay + drops buffer', () => {
    const bus = new ChannelBus();
    bus.publish('c', { from: 't', payload: 'before' });
    bus.setReplayLimit('c', 0);
    expect(bus.statsFor('c').replayBuffered).toBe(0);
    bus.publish('c', { from: 't', payload: 'after' });
    const seen: string[] = [];
    bus.subscribe('c', (m) => seen.push(m.payload as string), { replay: true });
    expect(seen).toEqual([]); // replay disabled for this channel
  });

  test('setReplayLimit trims existing buffer when lowered', () => {
    const bus = new ChannelBus();
    for (let i = 0; i < 10; i++) bus.publish('c', { from: 't', payload: `L${i}` });
    bus.setReplayLimit('c', 2);
    const seen: string[] = [];
    bus.subscribe('c', (m) => seen.push(m.payload as string), { replay: true });
    expect(seen).toEqual(['L8', 'L9']);
  });

  test('snapshot() returns buffered messages without subscribing', () => {
    const bus = new ChannelBus();
    bus.publish('c', { from: 't', payload: 'one' });
    bus.publish('c', { from: 't', payload: 'two' });
    const snap = bus.snapshot('c');
    expect(snap.map(m => m.payload)).toEqual(['one', 'two']);
    expect(bus.statsFor('c').subscriberCount).toBe(0); // not subscribed
  });

  test('snapshot honours limit', () => {
    const bus = new ChannelBus();
    for (let i = 0; i < 5; i++) bus.publish('c', { from: 't', payload: `L${i}` });
    expect(bus.snapshot('c', 2).map(m => m.payload)).toEqual(['L3', 'L4']);
  });

  test('reset clears replay + limit overrides', () => {
    const bus = new ChannelBus();
    bus.publish('c', { from: 't', payload: 'x' });
    bus.setReplayLimit('c', 5);
    bus.reset();
    expect(bus.snapshot('c')).toEqual([]);
  });

  test('old subscribe(channel, cb, label) string signature still works', () => {
    const bus = new ChannelBus();
    const seen: ChannelMessage[] = [];
    const sub = bus.subscribe('c', (m) => seen.push(m), 'my-label');
    expect(sub.label).toBe('my-label');
    bus.publish('c', { from: 't', payload: '' });
    expect(seen).toHaveLength(1);
  });
});
