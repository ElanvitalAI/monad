// VW-U2 — Alt+N/P/1..9/0 fast-switch binding tests.
//
// Hermetic: construct a real DisplayCoordinator + WindowRegistry and
// verify that registerVwFastSwitchBindings wires the 12 bindings and
// that routeKey dispatches to registry.next/previous/switchTo or the
// provided openPicker callback. Also verifies the `when` guard hides
// the digit/next/prev bindings when there's only one window.

import { describe, expect, test } from 'bun:test';
import { registerVwFastSwitchBindings } from '../src/dashboard/windowing/fast-switch.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { KeyEvent } from '../src/display/types.js';
import {
  createVisualStateStore,
  type PaneVisualStateStore,
} from '../src/panes/visual-state.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';

function setup(opts: { store?: PaneVisualStateStore; enableWindowSwitchKeys?: boolean } = {}) {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    // Wide bounds so multi-pane split tests (B-7-δ) don't trip the
    // layout's minCols guard when we create 3+ panes.
    defaultBounds: () => ({ row: 1, col: 1, width: 200, height: 40 }),
  });
  let pickerCalls = 0;
  const dispose = registerVwFastSwitchBindings({
    display: coord,
    registry: reg,
    openPicker: () => { pickerCalls++; },
    enableWindowSwitchKeys: opts.enableWindowSwitchKeys,
    store: opts.store,
  });
  return {
    coord, reg,
    get pickerCalls() { return pickerCalls; },
    dispose,
  };
}

function alt(name: string): KeyEvent {
  return { name, alt: true };
}

function route(coord: DisplayCoordinator, ev: KeyEvent) {
  // Invoke the route + execute the handler if the result says so.
  const res = coord.routeKey(ev);
  if (res.type === 'handler') res.invoke();
  return res;
}

describe('VW-U2 registerVwFastSwitchBindings — Alt+N/P/1..9/0', () => {
  test('Alt+0 opens the picker regardless of window count', () => {
    const ctx = setup();
    const res = route(ctx.coord, alt('0'));
    expect(res.type).toBe('handler');
    expect(ctx.pickerCalls).toBe(1);
  });

  test('disabled window-switch keys omit Alt+N/P/digits but preserve the picker and pane cycle', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store, enableWindowSwitchKeys: false });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 2);
    expect(route(ctx.coord, alt('n')).type).toBe('passthrough');
    expect(route(ctx.coord, alt('1')).type).toBe('passthrough');
    expect(route(ctx.coord, alt('0')).type).toBe('handler');
    expect(ctx.pickerCalls).toBe(1);
    expect(route(ctx.coord, alt('o')).type).toBe('handler');
    expect(window.focused).toBe(paneIds[0]!);
  });

  test('Alt+N is guarded when only one window exists', () => {
    const ctx = setup();
    ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    // Only one window — the binding.when() guard returns false so routeKey
    // should NOT consider it a handler match.
    const res = route(ctx.coord, alt('n'));
    expect(res.type).toBe('passthrough');
  });

  test('Alt+N cycles to the next window when there are ≥2', () => {
    const ctx = setup();
    const a = ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = ctx.reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    // After spawn b, current = b. Alt+N cycles next → wrap to a.
    expect(ctx.reg.current()).toBe(b);
    const res = route(ctx.coord, alt('n'));
    expect(res.type).toBe('handler');
    expect(ctx.reg.current()).toBe(a);
  });

  test('Alt+P cycles to the previous window', () => {
    const ctx = setup();
    ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = ctx.reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    // Current = b. Alt+P wraps to a.
    route(ctx.coord, alt('p'));
    expect(ctx.reg.current()).not.toBe(b);
  });

  test('Alt+2 switches directly to the 2nd window by id-sorted order', () => {
    const ctx = setup();
    ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = ctx.reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    ctx.reg.spawn({ title: 'c', initialContent: { kind: 'markdown', text: 'c' } });
    // Start on c (latest). Alt+2 → sort by id, pick 2nd → b.
    const res = route(ctx.coord, alt('2'));
    expect(res.type).toBe('handler');
    expect(ctx.reg.current()).toBe(b);
  });

  test('Alt+5 is a no-op when there are fewer than 5 windows', () => {
    const ctx = setup();
    const a = ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    ctx.reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    route(ctx.coord, alt('5'));
    // current stays on b (latest); no crash, no switch.
    expect(ctx.reg.current()?.title).toBe('b');
    // Going back to a via Alt+1 still works.
    route(ctx.coord, alt('1'));
    expect(ctx.reg.current()).toBe(a);
  });

  test('dispose removes all bindings', () => {
    const ctx = setup();
    ctx.reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    ctx.reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    ctx.dispose();
    const res = route(ctx.coord, alt('n'));
    expect(res.type).toBe('passthrough');
  });
});

// ─── B-7-δ · intra-window Alt+o pane cycling ────────────────────────

function altShift(name: string): KeyEvent {
  return { name, alt: true, shift: true };
}

/** Spawn a window and split it n-1 times so we have n panes total.
 *  Returns the window + the ordered pane ids. Focus ends on the last
 *  split (matches VirtualWindow.splitFocused semantics). */
function spawnWithPanes(reg: WindowRegistry, n: number): {
  window: NonNullable<ReturnType<WindowRegistry['current']>>;
  paneIds: string[];
} {
  const w = reg.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'root' } });
  const ids: string[] = [...w.listPanes()].map((p) => p.id);
  for (let i = 1; i < n; i++) {
    const pane = createPaneContent({ kind: 'markdown', text: `p${i}`, title: `p${i}` });
    w.splitFocused('h', pane);
    ids.push(pane.id);
  }
  return { window: w, paneIds: ids };
}

describe('VW-U2 · B-7-δ registerVwFastSwitchBindings — Alt+o / Alt+O pane cycle', () => {
  test('single-pane window → Alt+o is a passthrough (guard blocks handler)', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    ctx.reg.spawn({ title: 'solo', initialContent: { kind: 'markdown', text: 'only' } });
    const res = route(ctx.coord, alt('o'));
    expect(res.type).toBe('passthrough');
  });

  test('no store passed → Alt+o binding is not registered', () => {
    const ctx = setup(); // no store
    const { window } = spawnWithPanes(ctx.reg, 2);
    void window;
    // handler simply wasn't registered, so routeKey reports passthrough
    const res = route(ctx.coord, alt('o'));
    expect(res.type).toBe('passthrough');
  });

  test('2-pane window · Alt+o forward → cycles to the other pane', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 2);
    const [first, second] = paneIds;
    // Focus starts on the last-split (second).
    expect(window.focused).toBe(second!);
    const res = route(ctx.coord, alt('o'));
    expect(res.type).toBe('handler');
    expect(window.focused).toBe(first!);
  });

  test('Alt+O (Shift) → cycles backward', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 3);
    const [a, , c] = paneIds;
    // Focus starts on last-split (c). Alt+O should cycle backward.
    expect(window.focused).toBe(c!);
    const res = route(ctx.coord, altShift('o'));
    expect(res.type).toBe('handler');
    // 3 panes in insertion order [a, b, c]; backward from c = b.
    expect(window.focused).toBe(paneIds[1]!);
    // Continue backward → a.
    route(ctx.coord, altShift('o'));
    expect(window.focused).toBe(a!);
  });

  test('skip-eligible pane is bypassed by Alt+o', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 3);
    const [a, b, c] = paneIds;
    // Focus starts on c. Mark b as hidden → Alt+o forward wraps to a.
    store.setState({ windowId: String(window.id), paneId: b! }, { visibility: 'hidden' });
    route(ctx.coord, alt('o')); // c → skip b → a
    expect(window.focused).toBe(a!);
  });

  test('all other panes skip-eligible → Alt+o is a silent no-op (focus unchanged)', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 3);
    const [a, b] = paneIds;
    // Hide everyone except the currently-focused last pane.
    store.setState({ windowId: String(window.id), paneId: a! }, { visibility: 'hidden' });
    store.setState({ windowId: String(window.id), paneId: b! }, { visibility: 'dormant' });
    const focusBefore = window.focused;
    const res = route(ctx.coord, alt('o'));
    // Handler fires (the when gate passed — we have >1 pane) but setFocus
    // isn't called; focus stays put.
    expect(res.type).toBe('handler');
    expect(window.focused).toBe(focusBefore);
  });

  test('Alt+o forward from first pane cycles to second (wraps naturally)', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 3);
    const [a, b] = paneIds;
    // Jump focus to the first pane explicitly.
    window.setFocus(a!);
    route(ctx.coord, alt('o'));
    expect(window.focused).toBe(b!);
  });

  test('skip eligibility reads focusPolicy=skip too, not just visibility', () => {
    const store = createVisualStateStore();
    const ctx = setup({ store });
    const { window, paneIds } = spawnWithPanes(ctx.reg, 3);
    const [a, b] = paneIds;
    // Focus starts on c. Mark b with focusPolicy=skip (visibility stays visible).
    store.setState({ windowId: String(window.id), paneId: b! }, { focusPolicy: 'skip' });
    route(ctx.coord, alt('o')); // c → skip b → a
    expect(window.focused).toBe(a!);
  });
});
