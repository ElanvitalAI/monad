// ── Presentation P1.5 · bridgeContextKeysToStore ──
//
// Bidirectional sync between a ElanousState store's ui.context slot and
// a legacy ContextKeyService. Tests per HANDOFF §3 · 12 case.

import { describe, test, expect } from 'bun:test';
import { createStore } from '../../../src/state/store.js';
import { defaultElanousState, type ElanousState } from '../../../src/state/types.js';
import { bridgeContextKeysToStore } from '../../../src/state/bridges/context-keys.js';
import {
  createContextKeyService,
  INITIAL_CONTEXT_KEYS,
} from '../../../src/input-core/context-keys.js';

type CKRecord = Record<string, unknown>;

function mkStore() {
  return createStore<ElanousState>(defaultElanousState());
}

function getCtx(store: ReturnType<typeof mkStore>): CKRecord {
  const ui = store.getState().ui as CKRecord;
  return (ui.context as CKRecord | undefined) ?? {};
}

describe('bridgeContextKeysToStore · initial sync', () => {
  test('pushes CK keys into store.ui.context on attach', () => {
    const store = mkStore();
    const ck = createContextKeyService({ focusMode: 'input', pickerOpen: true });
    const dispose = bridgeContextKeysToStore(store, ck);

    const ctx = getCtx(store);
    expect(ctx.focusMode).toBe('input');
    expect(ctx.pickerOpen).toBe(true);
    // default values also mirrored so resolvers get a complete snapshot
    expect(ctx.popupOpen).toBe(false);
    expect(ctx.themeName).toBe(null);

    dispose();
  });

  test('already-in-sync state does not rewrite store.ui.context', () => {
    const store = mkStore();
    // Pre-seed store with the full CK snapshot so initial sync is a no-op.
    store.setState((s) => ({
      ui: { ...s.ui, context: { ...INITIAL_CONTEXT_KEYS } },
    }));
    const ctxBefore = getCtx(store);

    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    const ctxAfter = getCtx(store);
    // Same snapshot · pushed zero diffs · ref may or may not match,
    // but values must be identical.
    expect(ctxAfter).toEqual(ctxBefore);

    dispose();
  });
});

describe('bridgeContextKeysToStore · forward (CK → store)', () => {
  test('ContextKeys.update propagates to store.ui.context', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    ck.update({ focusMode: 'modal', modalTopTier: 'picker' });

    const ctx = getCtx(store);
    expect(ctx.focusMode).toBe('modal');
    expect(ctx.modalTopTier).toBe('picker');

    dispose();
  });

  test('CK no-op update does not rewrite store', () => {
    const store = mkStore();
    const ck = createContextKeyService({ focusMode: 'pane' });
    bridgeContextKeysToStore(store, ck);

    let fires = 0;
    store.subscribe(
      (s) => (s.ui as CKRecord).context as CKRecord | undefined,
      () => { fires += 1; },
    );

    // same value → CK's internal equality check swallows → no fire
    ck.update({ focusMode: 'pane' });
    expect(fires).toBe(0);
  });

  test('multiple CK updates each trigger one store write', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    let fires = 0;
    store.subscribe(
      (s) => (s.ui as CKRecord).context as CKRecord | undefined,
      () => { fires += 1; },
    );

    ck.update({ pickerOpen: true });
    ck.update({ popupOpen: true });
    ck.update({ dialogOpen: true });

    expect(fires).toBe(3);
    const ctx = getCtx(store);
    expect(ctx.pickerOpen).toBe(true);
    expect(ctx.popupOpen).toBe(true);
    expect(ctx.dialogOpen).toBe(true);

    dispose();
  });
});

describe('bridgeContextKeysToStore · reverse (store → CK)', () => {
  test('store.setState(ui.context.k=v) propagates to ContextKeys', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    const events: Array<{ changed: readonly string[]; value: unknown }> = [];
    ck.subscribe((keys, changed) => {
      if (changed.length === 0) return; // prime
      events.push({ changed: [...changed], value: keys.focusMode });
    });

    store.setState((s) => ({
      ui: {
        ...s.ui,
        context: {
          ...((s.ui as CKRecord).context as CKRecord | undefined ?? {}),
          focusMode: 'terminal',
        },
      },
    }));

    expect(ck.keys.focusMode).toBe('terminal');
    expect(events.some((e) => e.changed.includes('focusMode'))).toBe(true);

    dispose();
  });

  test('unknown keys in store.ui.context are not forwarded to CK', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    store.setState((s) => ({
      ui: {
        ...s.ui,
        context: {
          ...((s.ui as CKRecord).context as CKRecord | undefined ?? {}),
          notAContextKey: 'ignored',
        },
      },
    }));

    // ContextKeys shape has exactly the typed keys · unknown slipped
    // through the bridge MUST NOT pollute CK's snapshot.
    expect('notAContextKey' in (ck.keys as unknown as CKRecord)).toBe(false);

    dispose();
  });
});

describe('bridgeContextKeysToStore · loop prevention', () => {
  test('CK → store → CK does not re-fire CK', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    let ckFires = 0;
    ck.subscribe((_keys, changed) => {
      if (changed.length === 0) return; // prime
      ckFires += 1;
    });

    ck.update({ pickerOpen: true });

    // Expected flow:
    //   1. user ck.update → fires CK subscribers (ckFires = 1)
    //   2. bridge forwards to store
    //   3. store subscribe fires bridge, but CK already has pickerOpen=true
    //      → equality skip · no second CK update
    expect(ckFires).toBe(1);

    dispose();
  });

  test('store → CK → store does not re-fire store subscriber infinitely', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    let storeFires = 0;
    store.subscribe(
      (s) => ((s.ui as CKRecord).context as CKRecord | undefined)?.popupOpen,
      () => { storeFires += 1; },
    );

    store.setState((s) => ({
      ui: {
        ...s.ui,
        context: {
          ...((s.ui as CKRecord).context as CKRecord | undefined ?? {}),
          popupOpen: true,
        },
      },
    }));

    // Expected flow:
    //   1. user setState → store fires subscribers (storeFires = 1)
    //   2. bridge forwards to CK
    //   3. CK fires bridge's subscriber, but store already has
    //      popupOpen=true → equality skip · no second store write
    expect(storeFires).toBe(1);

    dispose();
  });
});

describe('bridgeContextKeysToStore · dispose', () => {
  test('dispose detaches both directions', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    dispose();

    // After dispose, neither direction should bridge further writes.
    ck.update({ focusMode: 'terminal' });
    expect(getCtx(store).focusMode).not.toBe('terminal');

    store.setState((s) => ({
      ui: {
        ...s.ui,
        context: {
          ...((s.ui as CKRecord).context as CKRecord | undefined ?? {}),
          focusMode: 'modal',
        },
      },
    }));
    expect(ck.keys.focusMode).not.toBe('modal');
  });

  test('double dispose is a no-op', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('bridgeContextKeysToStore · multi-key + defaults', () => {
  test('single CK.update with multiple keys writes one coherent patch', () => {
    const store = mkStore();
    const ck = createContextKeyService();
    const dispose = bridgeContextKeysToStore(store, ck);

    let ctxFires = 0;
    let lastContextRef: CKRecord | undefined;
    store.subscribe(
      (s) => (s.ui as CKRecord).context as CKRecord | undefined,
      (next) => {
        ctxFires += 1;
        lastContextRef = next;
      },
    );

    ck.update({
      pickerOpen: true,
      popupOpen: true,
      dialogOpen: true,
      focusMode: 'modal',
    });

    // CK fires one subscriber event per update() call · bridge writes
    // one setState · store subscriber fires once.
    expect(ctxFires).toBe(1);
    expect(lastContextRef?.pickerOpen).toBe(true);
    expect(lastContextRef?.popupOpen).toBe(true);
    expect(lastContextRef?.dialogOpen).toBe(true);
    expect(lastContextRef?.focusMode).toBe('modal');

    dispose();
  });

  test('store-side undefined value on a known key does not reset CK', () => {
    const store = mkStore();
    const ck = createContextKeyService({ focusMode: 'input' });
    const dispose = bridgeContextKeysToStore(store, ck);

    store.setState((s) => ({
      ui: {
        ...s.ui,
        context: {
          ...((s.ui as CKRecord).context as CKRecord | undefined ?? {}),
          focusMode: undefined,
        },
      },
    }));

    // ContextKeys.update skips undefined · bridge forwards nothing.
    // CK retains its last value · no implicit "delete" semantic.
    expect(ck.keys.focusMode).toBe('input');

    dispose();
  });
});
