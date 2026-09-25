// ── Presentation P1 · plugin-isolation.test ──
//
// installPluginSlice + uninstallPluginSlice 가 flat namespace 로
// plugin state 를 격리. PLAN §6.3 — 3 cases.

import { describe, test, expect } from 'bun:test';
import {
  createStore,
  installPluginSlice,
  uninstallPluginSlice,
} from '../../src/state/store.js';

interface S {
  plugins: Record<string, unknown>;
  other: string;
}

function mkStore(): ReturnType<typeof createStore<S>> {
  return createStore<S>({ plugins: {}, other: 'init' });
}

describe('plugin slice namespace isolation', () => {
  test('installing slice A does not affect slice B', () => {
    const store = mkStore();
    installPluginSlice(store, 'plugin-a', { x: 1 });
    installPluginSlice(store, 'plugin-b', { y: 2 });
    const state = store.getState();
    expect(state.plugins['plugin-a']).toEqual({ x: 1 });
    expect(state.plugins['plugin-b']).toEqual({ y: 2 });
  });

  test('install preserves existing non-plugin state', () => {
    const store = mkStore();
    store.setState({ other: 'changed' });
    installPluginSlice(store, 'plugin-a', { x: 1 });
    expect(store.getState().other).toBe('changed');
  });

  test('uninstall removes slice + re-install starts fresh', () => {
    const store = mkStore();
    installPluginSlice(store, 'plugin-a', { x: 1 });
    uninstallPluginSlice(store, 'plugin-a');
    expect(store.getState().plugins['plugin-a']).toBeUndefined();
    installPluginSlice(store, 'plugin-a', { x: 99 });
    expect(store.getState().plugins['plugin-a']).toEqual({ x: 99 });
  });

  test('uninstall non-existent plugin is a no-op', () => {
    const store = mkStore();
    expect(() => uninstallPluginSlice(store, 'never-installed')).not.toThrow();
  });

  test('subscribers to plugin slices fire only on their slice change', () => {
    const store = mkStore();
    installPluginSlice(store, 'plugin-a', { x: 1 });
    installPluginSlice(store, 'plugin-b', { y: 10 });
    let aCalls = 0;
    let bCalls = 0;
    store.subscribe(
      (s) => s.plugins['plugin-a'],
      () => { aCalls += 1; },
    );
    store.subscribe(
      (s) => s.plugins['plugin-b'],
      () => { bCalls += 1; },
    );
    // 'plugin-a' 를 updated 하면 aCalls 만 fire · bCalls skip
    installPluginSlice(store, 'plugin-a', { x: 2 });
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(0);
  });

  test('installPluginSlice throws on store without plugins field', () => {
    const wrongStore = createStore<{ foo: number }>({ foo: 0 });
    expect(() => installPluginSlice(
      wrongStore as unknown as Parameters<typeof installPluginSlice>[0],
      'x',
      {},
    )).toThrow(/plugins is missing/);
  });
});
