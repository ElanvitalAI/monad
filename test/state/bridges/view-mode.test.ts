// ── U-0 · bridgeViewModeToContextKeys + publishViewMode tests ──
//
// One-way sync: store.ui.viewMode → CKS.viewModeKind.
// Tests lock the init-sync, forward propagation, idempotence, dispose
// teardown, and the publishViewMode helper's short-circuit behavior.

import { describe, test, expect } from 'bun:test';
import { createStore } from '../../../src/state/store.js';
import { defaultElanousState, type ElanousState } from '../../../src/state/types.js';
import {
  bridgeViewModeToContextKeys,
  publishViewMode,
} from '../../../src/state/bridges/view-mode.js';
import { createContextKeyService } from '../../../src/input-core/context-keys.js';
import type { ViewMode } from '../../../src/input-core/view-mode.js';

function mkStore() {
  return createStore<ElanousState>(defaultElanousState());
}

describe('bridgeViewModeToContextKeys · init sync', () => {
  test('no viewMode in store → CKS.viewModeKind stays null', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    expect(ck.keys.viewModeKind).toBe(null);
    dispose();
  });

  test('store.ui.viewMode set before attach → CKS gets init-sync', () => {
    const store = mkStore();
    store.setState((s) => ({
      ui: { ...s.ui, viewMode: { kind: 'streaming' } satisfies ViewMode },
    }));
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    expect(ck.keys.viewModeKind).toBe('streaming');
    dispose();
  });

  test('CKS already has matching value → no update fires on attach', () => {
    const store = mkStore();
    store.setState((s) => ({
      ui: { ...s.ui, viewMode: { kind: 'modal', modalId: 'x' } satisfies ViewMode },
    }));
    let fires = 0;
    const ck = createContextKeyService({ viewModeKind: 'modal' });
    ck.subscribe((_keys, changed) => { if (changed.length > 0) fires++; });
    const dispose = bridgeViewModeToContextKeys(store, ck);
    expect(fires).toBe(0);
    dispose();
  });
});

describe('bridgeViewModeToContextKeys · forward sync', () => {
  test('store publishes streaming → CKS.viewModeKind updates', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    expect(ck.keys.viewModeKind).toBe(null);

    publishViewMode(store, { kind: 'streaming' });
    expect(ck.keys.viewModeKind).toBe('streaming');
    dispose();
  });

  test('kind unchanged but discriminator differs → no CKS fire (kind-level sync only)', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    publishViewMode(store, { kind: 'modal', modalId: 'a' });
    expect(ck.keys.viewModeKind).toBe('modal');

    let fires = 0;
    ck.subscribe((_keys, changed) => { if (changed.includes('viewModeKind')) fires++; });
    publishViewMode(store, { kind: 'modal', modalId: 'b' });
    expect(fires).toBe(0); // kind still 'modal' · CKS already matches
    dispose();
  });

  test('kind transition → exactly one CKS fire', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    publishViewMode(store, { kind: 'streaming' });

    let fires = 0;
    ck.subscribe((_keys, changed) => { if (changed.includes('viewModeKind')) fires++; });
    publishViewMode(store, { kind: 'input' });
    expect(fires).toBe(1);
    expect(ck.keys.viewModeKind).toBe('input');
    dispose();
  });
});

describe('bridgeViewModeToContextKeys · dispose', () => {
  test('dispose stops forward propagation', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    publishViewMode(store, { kind: 'streaming' });
    expect(ck.keys.viewModeKind).toBe('streaming');

    dispose();
    publishViewMode(store, { kind: 'input' });
    expect(ck.keys.viewModeKind).toBe('streaming'); // frozen after dispose
  });

  test('dispose is idempotent', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeViewModeToContextKeys(store, ck);
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('publishViewMode', () => {
  test('no-op when structurally equal to current (same kind · same discriminator)', () => {
    const store = mkStore();
    publishViewMode(store, { kind: 'modal', modalId: 'x' });
    let fires = 0;
    store.subscribe(
      (s) => (s.ui as { viewMode?: ViewMode }).viewMode,
      (_n, _p) => { fires++; },
    );
    publishViewMode(store, { kind: 'modal', modalId: 'x' }); // same
    expect(fires).toBe(0);
  });

  test('writes when kind differs', () => {
    const store = mkStore();
    publishViewMode(store, { kind: 'modal', modalId: 'x' });
    publishViewMode(store, { kind: 'input' });
    const ui = store.getState().ui as { viewMode?: ViewMode };
    expect(ui.viewMode).toEqual({ kind: 'input' });
  });

  test('writes when modal id differs', () => {
    const store = mkStore();
    publishViewMode(store, { kind: 'modal', modalId: 'a' });
    publishViewMode(store, { kind: 'modal', modalId: 'b' });
    const ui = store.getState().ui as { viewMode?: ViewMode };
    expect(ui.viewMode).toEqual({ kind: 'modal', modalId: 'b' });
  });

  test('preserves unrelated ui fields', () => {
    const store = mkStore();
    store.setState((s) => ({ ui: { ...s.ui, themeName: 'dracula' } }));
    publishViewMode(store, { kind: 'streaming' });
    expect(store.getState().ui.themeName).toBe('dracula');
  });
});
