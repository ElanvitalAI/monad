// ── U-1 · bridgeWidgetHostFocusToStore tests ──
//
// One-way sync: widget-host.focusedId → store.ui.focusedWidgetId.
// Init sync, forward propagation, dispose teardown, idempotence,
// dispose-cascade event, and equality short-circuit.

import { describe, test, expect, beforeEach } from 'bun:test';
import { createStore } from '../../../src/state/store.js';
import { defaultElanousState, type ElanousState } from '../../../src/state/types.js';
import { bridgeWidgetHostFocusToStore } from '../../../src/state/bridges/widget-host-focus.js';
import { WidgetHost } from '../../../src/widgets/host.js';
import type { WidgetDef } from '../../../src/widgets/types.js';

const fakeDef: WidgetDef<{ count: number }> = {
  type: 'fake',
  description: 'test fixture',
  defaultCharacter: 'F',
  initialState: () => ({ count: 0 }),
  render: () => [''],
};

function mkStore() {
  return createStore<ElanousState>(defaultElanousState());
}

function mkHost(): WidgetHost {
  const host = new WidgetHost({ log: () => {}, requestRender: () => {} });
  host.register(fakeDef);
  return host;
}

function getFocus(store: ReturnType<typeof mkStore>): string | null {
  const ui = store.getState().ui as { focusedWidgetId?: string | null };
  return ui.focusedWidgetId ?? null;
}

describe('bridgeWidgetHostFocusToStore · init sync', () => {
  test('host with no focused instance → store.focusedWidgetId stays null', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    expect(getFocus(store)).toBe(null);
    dispose();
  });

  test('host already has focused instance → pushed on attach', () => {
    const store = mkStore();
    const host = mkHost();
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'pre-attach');
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    expect(getFocus(store)).toBe('w1');
    dispose();
  });

  test('store already matches host → no mutation on attach', () => {
    const store = mkStore();
    const host = mkHost();
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'pre');
    store.setState((s) => ({ ui: { ...s.ui, focusedWidgetId: 'w1' } }));

    let writes = 0;
    store.subscribe(
      (s) => (s.ui as { focusedWidgetId?: string | null }).focusedWidgetId,
      () => { writes++; },
    );
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    expect(writes).toBe(0);
    dispose();
  });
});

describe('bridgeWidgetHostFocusToStore · forward sync', () => {
  test('focus(id) after attach → store mirrors', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'forward');
    expect(getFocus(store)).toBe('w1');
    dispose();
  });

  test('blur(id) after attach → store gets null', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'focus');
    host.blur('w1', 'blur');
    expect(getFocus(store)).toBe(null);
    dispose();
  });

  test('focus transition · store follows prev → next', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'a' });
    host.spawn({ type: 'fake', id: 'b' });
    host.focus('a', 'first');
    expect(getFocus(store)).toBe('a');
    host.focus('b', 'switch');
    expect(getFocus(store)).toBe('b');
    dispose();
  });

  test('disposeById cascade → store gets null via cascade event', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'focus');
    host.disposeById('w1', 'cleanup');
    expect(getFocus(store)).toBe(null);
    dispose();
  });
});

describe('bridgeWidgetHostFocusToStore · dispose', () => {
  test('dispose stops forward propagation', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'w1' });
    host.focus('w1', 'before');
    expect(getFocus(store)).toBe('w1');
    dispose();
    host.spawn({ type: 'fake', id: 'w2' });
    host.focus('w2', 'after');
    expect(getFocus(store)).toBe('w1'); // frozen post-dispose
  });

  test('dispose is idempotent', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('bridgeWidgetHostFocusToStore · equality short-circuit', () => {
  test('store already matches incoming event → no store write', () => {
    const store = mkStore();
    const host = mkHost();
    const dispose = bridgeWidgetHostFocusToStore(store, host);
    host.spawn({ type: 'fake', id: 'w1' });

    let writes = 0;
    store.subscribe(
      (s) => (s.ui as { focusedWidgetId?: string | null }).focusedWidgetId,
      () => { writes++; },
    );
    // Pre-set store to match what host is about to publish.
    store.setState((s) => ({ ui: { ...s.ui, focusedWidgetId: 'w1' } }));
    const writesAfterPreset = writes;

    host.focus('w1', 'redundant');
    expect(writes).toBe(writesAfterPreset); // no new write from bridge
    dispose();
  });
});
