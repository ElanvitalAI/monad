// ── PX-6 P3+P4: pane namespace + FocusCoordinator ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  FocusCoordinator,
  encodePluginPaneId,
  decodePluginPaneId,
  isPluginPaneId,
  detectPaneCollisions,
} from '../src/plugins/core/focus';

describe('PX-6 P3 — pane namespace', () => {
  test('encode/decode round-trip', () => {
    const encoded = encodePluginPaneId('hello', 'status');
    expect(encoded).toBe('plugin:hello:status');
    expect(decodePluginPaneId(encoded)).toEqual({ pluginId: 'hello', localId: 'status' });
  });

  test('decode rejects non-plugin paneIds', () => {
    expect(decodePluginPaneId('browser')).toBeNull();
    expect(decodePluginPaneId('plugin:nope')).toBeNull();
  });

  test('isPluginPaneId discriminates', () => {
    expect(isPluginPaneId('plugin:a:b')).toBe(true);
    expect(isPluginPaneId('browser')).toBe(false);
  });

  test('detectPaneCollisions finds duplicate paneIds', () => {
    const collisions = detectPaneCollisions([
      { pluginId: 'a', paneId: 'plugin:a:status' },
      { pluginId: 'b', paneId: 'plugin:a:status' },
      { pluginId: 'c', paneId: 'plugin:c:log' },
    ]);
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.paneId).toBe('plugin:a:status');
    expect(collisions[0]!.pluginIds.sort()).toEqual(['a', 'b']);
  });

  test('no collisions → empty array', () => {
    const collisions = detectPaneCollisions([
      { pluginId: 'a', paneId: 'plugin:a:x' },
      { pluginId: 'b', paneId: 'plugin:b:x' },
    ]);
    expect(collisions.length).toBe(0);
  });
});

describe('PX-6 P4 — FocusCoordinator', () => {
  let fc: FocusCoordinator;
  beforeEach(() => { fc = new FocusCoordinator(); });

  test('initial owner null; claim flips owner', async () => {
    expect(fc.currentOwner()).toBeNull();
    await fc.claim('a');
    expect(fc.currentOwner()).toBe('a');
    expect(fc.isOwner('a')).toBe(true);
  });

  test('double claim by same plugin resolves idempotently', async () => {
    await fc.claim('a');
    await fc.claim('a');   // no-op
    expect(fc.currentOwner()).toBe('a');
  });

  test('claim while busy queues FIFO; release grants next', async () => {
    await fc.claim('a');
    const pB = fc.claim('b');   // queued
    const pC = fc.claim('c');   // queued
    expect(fc.queueLength()).toBe(2);
    fc.release('a');
    await pB;
    expect(fc.currentOwner()).toBe('b');
    fc.release('b');
    await pC;
    expect(fc.currentOwner()).toBe('c');
  });

  test('release by non-owner is a no-op', async () => {
    await fc.claim('a');
    fc.release('stranger');
    expect(fc.currentOwner()).toBe('a');
  });

  test('forceRelease rejects pending claims', async () => {
    await fc.claim('a');
    const pB = fc.claim('b');
    fc.forceRelease('crash');
    expect(fc.currentOwner()).toBeNull();
    await expect(pB).rejects.toThrow(/crash/);
  });

  test('dispose force-releases + prevents new claims', async () => {
    await fc.claim('a');
    fc.dispose();
    await expect(fc.claim('b')).rejects.toThrow(/disposed/);
  });

  test('isOwner returns false for non-owner even after queue drain', async () => {
    await fc.claim('a');
    expect(fc.isOwner('b')).toBe(false);
    fc.release('a');
    expect(fc.isOwner('a')).toBe(false);
  });

  test('queueLength reflects pending claims', async () => {
    await fc.claim('a');
    void fc.claim('b');
    void fc.claim('c');
    void fc.claim('d');
    expect(fc.queueLength()).toBe(3);
  });

  test('release drains chained queue in order', async () => {
    const order: string[] = [];
    await fc.claim('a');
    const pB = fc.claim('b').then(() => order.push('b'));
    const pC = fc.claim('c').then(() => order.push('c'));
    fc.release('a');
    await pB;
    fc.release('b');
    await pC;
    expect(order).toEqual(['b', 'c']);
  });
});
