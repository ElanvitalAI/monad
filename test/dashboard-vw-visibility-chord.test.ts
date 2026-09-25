import { describe, expect, test } from 'bun:test';

import {
  createVisibilityChordHandler,
  nextVisibility,
  type VisibilityChordCurrentWindow,
} from '../src/dashboard/windowing/visibility-chord.js';
import {
  createVisualStateStore,
  type PaneVisualStateStore,
} from '../src/panes/visual-state.js';

// ─── Fakes ────────────────────────────────────────────────────────

interface ToastCall { title: string; lines: string[]; }

function collectToast(): { calls: ToastCall[]; showToast: (t: string, l: string[]) => void } {
  const calls: ToastCall[] = [];
  return { calls, showToast: (title, lines) => { calls.push({ title, lines: [...lines] }); } };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('nextVisibility', () => {
  test('visible → hidden', () => { expect(nextVisibility('visible')).toBe('hidden'); });
  test('hidden → visible', () => { expect(nextVisibility('hidden')).toBe('visible'); });
  test('dormant → visible', () => { expect(nextVisibility('dormant')).toBe('visible'); });
  test('llm-only → visible', () => { expect(nextVisibility('llm-only')).toBe('visible'); });
});

describe('createVisibilityChordHandler — no foreground window', () => {
  test('emits toast "no foreground window" and does not touch the store', () => {
    const store = createVisualStateStore();
    const toast = collectToast();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => null,
      store,
      showToast: toast.showToast,
    });
    handler();
    expect(toast.calls).toEqual([{ title: 'visibility', lines: ['no foreground window'] }]);
    expect(store.keys()).toEqual([]);
  });

  test('does not throw when showToast is omitted (optional dep)', () => {
    const store = createVisualStateStore();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => null,
      store,
    });
    expect(() => handler()).not.toThrow();
  });
});

describe('createVisibilityChordHandler — toggle from default', () => {
  test('default (visible) → hidden', () => {
    const store = createVisualStateStore();
    const toast = collectToast();
    const win: VisibilityChordCurrentWindow = { id: 3, focused: 'pane-A' };
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => win,
      store,
      showToast: toast.showToast,
    });
    handler();
    const after = store.snapshot({ windowId: '3', paneId: 'pane-A' });
    expect(after.visibility).toBe('hidden');
    expect(toast.calls).toEqual([{ title: 'visibility', lines: ['pane-A → hidden'] }]);
  });

  test('round-trip: hidden → visible → hidden', () => {
    const store = createVisualStateStore();
    const win: VisibilityChordCurrentWindow = { id: 7, focused: 'pane-B' };
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => win,
      store,
    });
    handler();
    expect(store.snapshot({ windowId: '7', paneId: 'pane-B' }).visibility).toBe('hidden');
    handler();
    expect(store.snapshot({ windowId: '7', paneId: 'pane-B' }).visibility).toBe('visible');
    handler();
    expect(store.snapshot({ windowId: '7', paneId: 'pane-B' }).visibility).toBe('hidden');
  });
});

describe('createVisibilityChordHandler — non-default prior states', () => {
  test('dormant → visible', () => {
    const store = createVisualStateStore();
    const ref = { windowId: '4', paneId: 'p' };
    store.setState(ref, { visibility: 'dormant' });
    const toast = collectToast();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 4, focused: 'p' }),
      store,
      showToast: toast.showToast,
    });
    handler();
    expect(store.snapshot(ref).visibility).toBe('visible');
    expect(toast.calls).toEqual([{ title: 'visibility', lines: ['p → visible'] }]);
  });

  test('llm-only → visible', () => {
    const store = createVisualStateStore();
    const ref = { windowId: '2', paneId: 'q' };
    store.setState(ref, { visibility: 'llm-only' });
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 2, focused: 'q' }),
      store,
    });
    handler();
    expect(store.snapshot(ref).visibility).toBe('visible');
  });
});

describe('createVisibilityChordHandler — illegal transition rejection', () => {
  test('zoomed + visible → toggle to hidden is rejected · toast tagged (rejected)', () => {
    const store = createVisualStateStore();
    const ref = { windowId: '5', paneId: 'z' };
    store.setState(ref, { placement: 'zoomed' });
    expect(store.snapshot(ref).placement).toBe('zoomed');
    const toast = collectToast();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 5, focused: 'z' }),
      store,
      showToast: toast.showToast,
    });
    handler();
    // Illegal: zoomed + hidden — store rejects, visibility stays visible.
    expect(store.snapshot(ref).visibility).toBe('visible');
    expect(toast.calls).toEqual([{ title: 'visibility', lines: ['z → hidden (rejected)'] }]);
  });
});

describe('createVisibilityChordHandler — PaneRef key stringification', () => {
  test('numeric window.id is stringified when forming the store ref', () => {
    const store = createVisualStateStore();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 42, focused: 'num-pane' }),
      store,
    });
    handler();
    // Store key uses windowId string; accessing via numeric windowId
    // (not stringified) would return DEFAULT and confuse the consumer.
    const asStr = store.snapshot({ windowId: '42', paneId: 'num-pane' });
    expect(asStr.visibility).toBe('hidden');
  });

  test('string window.id is preserved', () => {
    const store = createVisualStateStore();
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 'w-slug', focused: 'p' }),
      store,
    });
    handler();
    expect(store.snapshot({ windowId: 'w-slug', paneId: 'p' }).visibility).toBe('hidden');
  });
});

describe('createVisibilityChordHandler — store mock surface', () => {
  test('only snapshot + setState are required (readonly Pick)', () => {
    // Compile-level guarantee via TypeScript that we don't reach for
    // forget/subscribe/keys. This test validates the runtime behavior
    // with a minimal store stub exposing only the two methods.
    let snapshotCalls = 0;
    let setStateCalls = 0;
    const minimalStore: Pick<PaneVisualStateStore, 'snapshot' | 'setState'> = {
      snapshot: () => { snapshotCalls++; return { focus: 'unfocused', visibility: 'visible', placement: 'grid', focusPolicy: 'normal' }; },
      setState: () => { setStateCalls++; return true; },
    };
    const handler = createVisibilityChordHandler({
      getCurrentWindow: () => ({ id: 1, focused: 'p' }),
      store: minimalStore,
    });
    handler();
    expect(snapshotCalls).toBe(1);
    expect(setStateCalls).toBe(1);
  });
});
