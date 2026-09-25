import { describe, expect, test } from 'bun:test';
import { createPaneKeyRouter } from '../src/widget-routing/widget-key-router.js';
import type { Key } from '../src/tui.js';

function mkKey(name: string, extra: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...extra };
}

describe('PaneKeyRouter', () => {
  test('dispatch without registration returns passthrough', async () => {
    const router = createPaneKeyRouter();
    const result = await router.dispatch('browser', mkKey('j'));
    expect(result).toBe('passthrough');
  });

  test('dispatch invokes the registered handler and forwards the key', async () => {
    const router = createPaneKeyRouter();
    let seenKey: Key | null = null;
    router.register('log', (k) => {
      seenKey = k;
      return 'consumed';
    });
    const key = mkKey('k', { shift: true });
    const result = await router.dispatch('log', key);
    expect(result).toBe('consumed');
    expect(seenKey).toBe(key);
  });

  test('handler may return a Promise and router awaits it', async () => {
    const router = createPaneKeyRouter();
    router.register('log', async () => {
      await Promise.resolve();
      return 'consumed';
    });
    const result = await router.dispatch('log', mkKey('j'));
    expect(result).toBe('consumed');
  });

  test('handler may return quit for app-exit signals', async () => {
    const router = createPaneKeyRouter();
    router.register('preview', () => 'quit');
    const result = await router.dispatch('preview', mkKey('q', { ctrl: true }));
    expect(result).toBe('quit');
  });

  test('handler may return passthrough to decline the key', async () => {
    // Handlers that inspect state and opt out (e.g. the preview branch
    // when term.isAlive is false) can return passthrough so the caller
    // treats the dispatch as a no-op.
    const router = createPaneKeyRouter();
    router.register('preview', () => 'passthrough');
    const result = await router.dispatch('preview', mkKey('j'));
    expect(result).toBe('passthrough');
  });

  test('second registration for the same pane replaces the handler', async () => {
    const router = createPaneKeyRouter();
    router.register('log', () => 'passthrough');
    router.register('log', () => 'consumed');
    const result = await router.dispatch('log', mkKey('j'));
    expect(result).toBe('consumed');
  });

  test('registered() returns pane ids with handlers', () => {
    const router = createPaneKeyRouter();
    router.register('log', () => 'consumed');
    router.register('browser', () => 'consumed');
    expect(router.registered().sort()).toEqual(['browser', 'log']);
  });

  test('has() reflects registration state', () => {
    const router = createPaneKeyRouter();
    expect(router.has('log')).toBe(false);
    router.register('log', () => 'consumed');
    expect(router.has('log')).toBe(true);
  });

  test('dispatching with no handlers is safe for multiple panes', async () => {
    const router = createPaneKeyRouter();
    expect(await router.dispatch('a', mkKey('j'))).toBe('passthrough');
    expect(await router.dispatch('b', mkKey('k'))).toBe('passthrough');
    expect(router.registered()).toEqual([]);
  });
});
