import { describe, expect, test } from 'bun:test';
import { createDisplayEventBus, DisplayCoordinator, type DisplayEvent, type DisplayRenderRequest, type DisplaySurface } from '../src/display/index.js';
import type { Action } from '../src/plugins/core/types.js';

function surface(
  id: string,
  owner: DisplaySurface['owner'] = 'dashboard',
  opts: Partial<DisplaySurface> = {},
): DisplaySurface {
  return {
    id,
    owner,
    kind: 'pane',
    focus: 'owns',
    priority: 0,
    render: () => [],
    ...opts,
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  const renders: DisplayRenderRequest[] = [];
  const mounted: string[] = [];
  const disposed: string[] = [];
  const focus: Array<{ prev: string | null; next: string; reason?: string }> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => {
      scheduled.push(fn);
      return 0 as any;
    },
    onRender: (request) => {
      renders.push({ dirty: new Set(request.dirty), force: request.force });
    },
    hooks: {
      onSurfaceMounted: (s) => mounted.push(s.id),
      onSurfaceDisposed: (s) => disposed.push(s.id),
      onFocusChanged: (prev, next, reason) => focus.push({ prev, next, reason }),
    },
  });
  return { coordinator, scheduled, renders, mounted, disposed, focus };
}

describe('DisplayCoordinator', () => {
  test('coalesces multiple render requests into one scheduled flush', () => {
    const h = harness();

    h.coordinator.publish({ type: 'requestRender', region: 'pane:log' });
    h.coordinator.publish({ type: 'requestRender', region: 'pane:scratch' });

    expect(h.scheduled).toHaveLength(1);
    h.scheduled[0]!();
    expect(h.renders).toHaveLength(1);
    expect(h.renders[0]!.dirty).toEqual(new Set(['pane:log', 'pane:scratch']));
  });

  test('force render flag survives coalescing', () => {
    const h = harness();

    h.coordinator.publish({ type: 'requestRender', region: 'pane:log' });
    h.coordinator.publish({ type: 'requestRender', force: true });
    h.scheduled[0]!();

    expect(h.renders[0]!.force).toBe(true);
    expect(h.renders[0]!.dirty).toContain('all');
  });

  test('mounts, snapshots, and disposes surfaces', () => {
    const h = harness();

    h.coordinator.publish({ type: 'upsertSurface', surface: surface('pane:scratch') });
    expect(h.mounted).toEqual(['pane:scratch']);
    expect(h.coordinator.surface('pane:scratch')?.id).toBe('pane:scratch');

    h.coordinator.publish({ type: 'closeSurface', id: 'pane:scratch' });
    expect(h.disposed).toEqual(['pane:scratch']);
    expect(h.coordinator.surface('pane:scratch')).toBeNull();
  });

  test('focus changes dirty old and new focus plus status/dock', () => {
    const h = harness();

    h.coordinator.publish({ type: 'setFocus', target: 'pane:browser', reason: 'init' });
    h.coordinator.publish({ type: 'setFocus', target: 'pane:scratch', reason: 'tab' });
    h.scheduled[0]!();

    expect(h.coordinator.currentFocus()).toBe('pane:scratch');
    expect(h.focus).toEqual([
      { prev: null, next: 'pane:browser', reason: 'init' },
      { prev: 'pane:browser', next: 'pane:scratch', reason: 'tab' },
    ]);
    expect(h.renders[0]!.dirty).toEqual(new Set([
      'pane:browser',
      'status',
      'dock',
      'pane:scratch',
    ]));
  });

  test('display handles scope commands by owner', () => {
    const h = harness();
    const handle = h.coordinator.handle('plugin:demo');

    handle.publish({ type: 'upsertSurface', surface: surface('widget:demo-main', 'plugin:demo') });
    handle.focus('widget:demo-main');
    handle.requestRender({ region: 'widget:demo-main' });
    h.scheduled[0]!();

    const snap = h.coordinator.snapshot();
    expect(handle.owner).toBe('plugin:demo');
    expect(snap.surfaces.get('widget:demo-main')?.owner).toBe('plugin:demo');
    expect(snap.focus.active).toBe('widget:demo-main');
    expect(h.renders).toHaveLength(1);
  });

  test('scratch command stores immutable scratch state', () => {
    const h = harness();
    const lines = ['a', 'b'];

    h.coordinator.publish({
      type: 'setScratch',
      source: 'agent-batch:1',
      mode: 'agents',
      title: 'Agents',
      lines,
    });
    lines.push('mutated');

    const scratch = h.coordinator.scratchState();
    expect(scratch?.source).toBe('agent-batch:1');
    expect(scratch?.mode).toBe('agents');
    expect(scratch?.lines).toEqual(['a', 'b']);
    expect(h.scheduled).toHaveLength(1);
  });

  test('patchWidget and appendLog are collected until flush', () => {
    const h = harness();

    h.coordinator.publish({ type: 'patchWidget', id: 'w1', patch: { text: 'hello' } });
    h.coordinator.publish({ type: 'appendLog', line: 'line 1' });

    let snap = h.coordinator.snapshot();
    expect(snap.pendingWidgetPatches).toEqual([{ id: 'w1', patch: { text: 'hello' } }]);
    expect(snap.pendingLogLines).toEqual(['line 1']);

    h.scheduled[0]!();
    snap = h.coordinator.snapshot();
    expect(snap.pendingWidgetPatches).toEqual([]);
    expect(snap.pendingLogLines).toEqual([]);
  });

  test('upsertSurface registers default focus nodes and cycleFocus follows order', () => {
    const h = harness();
    h.coordinator.publish({ type: 'upsertSurface', surface: surface('pane:log', 'dashboard', { priority: 2 }) });
    h.coordinator.publish({ type: 'upsertSurface', surface: surface('pane:browser', 'dashboard', { priority: 1 }) });

    expect(h.coordinator.cycleFocus('dashboard')).toBe('pane:browser');
    expect(h.coordinator.currentFocus()).toBe('pane:browser');
    expect(h.coordinator.cycleFocus('dashboard')).toBe('pane:log');
  });

  test('scoped handle can register focus nodes and key bindings', () => {
    const h = harness();
    const handle = h.coordinator.handle('plugin:demo');
    const focusReg = handle.registerFocus({
      id: 'widget:demo',
      focusable: true,
      scope: 'plugin',
      order: 10,
    });
    const keyReg = handle.registerKey({
      key: 'C-r',
      scope: 'plugin:demo',
      command: 'demo.refresh',
      priority: 5,
    });

    handle.focus('widget:demo');
    expect(h.coordinator.routeKey({ name: 'r', ctrl: true })).toMatchObject({
      type: 'command',
      command: 'demo.refresh',
    });

    keyReg.dispose();
    expect(h.coordinator.routeKey({ name: 'r', ctrl: true }).type).toBe('passthrough');
    focusReg.dispose();
    expect(h.coordinator.snapshot().focusNodes.has('widget:demo')).toBe(false);
  });

  test('routeKey prioritizes modal surface before active focused surface', () => {
    const h = harness();
    const action = (label: string): Action => ({ type: 'submit', text: label });

    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('pane:main', 'dashboard', {
        onKey: () => action('main'),
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'pane:main' });
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:picker', 'dashboard', {
        kind: 'modal',
        priority: 100,
        onKey: () => action('modal'),
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'modal:picker' });

    expect(h.coordinator.routeKey({ name: 'enter' })).toEqual({
      type: 'action',
      surfaceId: 'modal:picker',
      action: action('modal'),
    });
  });

  test('routeKey returns focused surface action before keybinding command', () => {
    const h = harness();
    const action: Action = { type: 'refresh', pane: 'log' };
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('pane:log', 'dashboard', { onKey: () => action }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'pane:log' });
    h.coordinator.registerKeyBinding({
      id: 'global-r',
      key: 'r',
      scope: 'global',
      command: 'global.refresh',
      priority: 100,
    });

    expect(h.coordinator.routeKey({ name: 'r' })).toEqual({
      type: 'action',
      surfaceId: 'pane:log',
      action,
    });
  });

  test('routeKey returns consumed when surface.onKey returns the literal "consumed"', () => {
    const h = harness();
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:picker', 'dashboard', {
        kind: 'modal',
        priority: 100,
        onKey: () => 'consumed' as const,
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'modal:picker' });

    expect(h.coordinator.routeKey({ name: 'j' })).toEqual({
      type: 'consumed',
      surfaceId: 'modal:picker',
    });
  });

  test('routeKey falls through when surface.onKey returns "passthrough"', () => {
    const h = harness();
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:picker', 'dashboard', {
        kind: 'modal',
        priority: 100,
        onKey: () => 'passthrough' as const,
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'modal:picker' });
    h.coordinator.registerKeyBinding({
      id: 'global-k',
      key: 'k',
      scope: 'global',
      command: 'global.kk',
      priority: 10,
    });

    expect(h.coordinator.routeKey({ name: 'k' })).toMatchObject({
      type: 'command',
      command: 'global.kk',
    });
  });

  test('routeKey still recognizes Action returns (backwards compat)', () => {
    const h = harness();
    const action: Action = { type: 'submit', text: 'from-surface' };
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('pane:main', 'dashboard', { onKey: () => action }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'pane:main' });

    expect(h.coordinator.routeKey({ name: 'enter' })).toEqual({
      type: 'action',
      surfaceId: 'pane:main',
      action,
    });
  });

  test("topFocusedSurface skips focus:'none' — keys reach focus:'owns' modal underneath", () => {
    // Regression: chat slash/arg/@ pickers are pushed with
    // focus:'none'/'participates' (paint-only, keys flow through
    // chat-picker-state in chat.ts readKey loop). Before the skip,
    // coordinator.routeKey would stop at the picker (top of stack),
    // call routeSurfaceKey (null because picker has no onKey), and
    // return passthrough — so a focus:'owns' modal below (e.g.
    // model-pill popup) never received keys. With the skip, the
    // picker is transparent to routeKey and the underlying owns
    // modal gets its keys.
    const h = harness();
    let modalSawKey = false;
    // Focus-owning modal at bottom of stack.
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:pill', 'dashboard', {
        kind: 'modal',
        priority: 100,
        focus: 'owns',
        onKey: () => { modalSawKey = true; return 'consumed' as const; },
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'modal:pill' });
    // Paint-only picker on top of stack (same scope).
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:slash-picker', 'dashboard', {
        kind: 'modal',
        priority: 90,
        focus: 'none',
        // No onKey — chat.ts's readKey loop handles these via picker.dispatch.
      }),
    });
    h.coordinator.publish({ type: 'pushModal', id: 'modal:slash-picker' });

    const result = h.coordinator.routeKey({ name: 'enter' });
    expect(result).toEqual({ type: 'consumed', surfaceId: 'modal:pill' });
    expect(modalSawKey).toBe(true);
  });

  test("tryRouteKeyToTopModalAsync — returns consumed for focus:'owns' modal", async () => {
    const h = harness();
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:pill', 'dashboard', {
        kind: 'modal',
        priority: 100,
        focus: 'owns',
        onKey: () => 'consumed' as const,
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'modal:pill' });

    expect(await h.coordinator.tryRouteKeyToTopModalAsync({ name: 'enter' })).toBe('consumed');
  });

  test('tryRouteKeyToTopModalAsync — returns passthrough when no modal on stack', async () => {
    const h = harness();
    // Focused pane with onKey, but no modal pushed.
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('pane:main', 'dashboard', {
        onKey: () => 'consumed' as const,
      }),
    });
    h.coordinator.publish({ type: 'setFocus', target: 'pane:main' });

    // Must not route to non-modal surface — tryRouteKeyToTopModalAsync
    // is strictly "top modal only", so typing letters in input mode
    // doesn't accidentally trigger pane actions.
    expect(await h.coordinator.tryRouteKeyToTopModalAsync({ name: 'a' })).toBe('passthrough');
  });

  test("tryRouteKeyToTopModalAsync — passthrough when only focus:'none' picker on stack", async () => {
    // Chat picker (focus:'none' or 'participates' without onKey)
    // shouldn't block typing in input mode. tryRouteKeyToTopModalAsync
    // uses topFocusedSurface which skips focus:'none' — so the
    // caller (textInput onPreKey) can fall through to picker.dispatch
    // + character insertion.
    const h = harness();
    h.coordinator.publish({
      type: 'upsertSurface',
      surface: surface('modal:slash-picker', 'dashboard', {
        kind: 'modal',
        priority: 90,
        focus: 'none',
      }),
    });
    h.coordinator.publish({ type: 'pushModal', id: 'modal:slash-picker' });

    expect(await h.coordinator.tryRouteKeyToTopModalAsync({ name: 'a' })).toBe('passthrough');
  });

  test('syncExternalFocus projects legacy focus without scheduling a frame', () => {
    const h = harness();
    h.coordinator.publish({ type: 'upsertSurface', surface: surface('pane:browser') });
    h.scheduled.length = 0;

    h.coordinator.syncExternalFocus('pane:browser', 'dashboard-projection');

    expect(h.coordinator.currentFocus()).toBe('pane:browser');
    expect(h.scheduled).toHaveLength(0);
    expect(h.focus).toContainEqual({
      prev: null,
      next: 'pane:browser',
      reason: 'dashboard-projection',
    });
  });

  test('event bus receives lifecycle, focus, and render events', () => {
    const events: DisplayEvent[] = [];
    const bus = createDisplayEventBus();
    bus.subscribe('*', event => events.push(event));
    const h = harness();
    const coordinator = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => {
        h.scheduled.push(fn);
        return 0 as any;
      },
      eventBus: bus,
    });

    coordinator.publish({ type: 'upsertSurface', surface: surface('pane:events') });
    coordinator.publish({ type: 'setFocus', target: 'pane:events', reason: 'test' });
    h.scheduled[0]!();
    coordinator.publish({ type: 'closeSurface', id: 'pane:events' });

    expect(events.map(e => e.type)).toContain('surface:mounted');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'focus:change',
      previous: null,
      next: 'pane:events',
      reason: 'test',
    }));
    expect(events.map(e => e.type)).toContain('render:before');
    expect(events.map(e => e.type)).toContain('render:after');
    expect(events.map(e => e.type)).toContain('surface:disposed');
  });
});

describe('DisplayCoordinator — P2.2.b cursor', () => {
  function cursorHarness(opts: { capture?: boolean; bypassImmediate?: boolean } = {}) {
    const written: string[] = [];
    const scheduled: Array<() => void> = [];
    const coordinator = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      onRender: () => {},
      writeCursor: opts.capture === false ? undefined : (s) => written.push(s),
    });
    return { coordinator, written, scheduled };
  }

  test('setCursor / getCursor round-trip', () => {
    const h = cursorHarness();
    expect(h.coordinator.getCursor()).toBeNull();
    h.coordinator.setCursor({ row: 5, col: 12, visible: true });
    expect(h.coordinator.getCursor()).toEqual({ row: 5, col: 12, visible: true });
    h.coordinator.setCursor(null);
    expect(h.coordinator.getCursor()).toBeNull();
  });

  test('snapshot.cursor mirrors current state', () => {
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 3, col: 7, visible: true });
    expect(h.coordinator.snapshot().cursor).toEqual({ row: 3, col: 7, visible: true });
  });

  test('setCursor with no other dirty state emits immediately (bypass batch)', () => {
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 1, col: 1, visible: true });
    expect(h.written).toEqual(['\x1b[1;1H\x1b[?25h']);
  });

  test('setCursor with same value is a no-op (no extra write)', () => {
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 4, col: 4, visible: true });
    h.coordinator.setCursor({ row: 4, col: 4, visible: true });
    h.coordinator.setCursor({ row: 4, col: 4, visible: true });
    expect(h.written.length).toBe(1);
  });

  test('transition to null emits hide-only', () => {
    const h = cursorHarness();
    // Initial state is already null; need a transition for an emit.
    h.coordinator.setCursor({ row: 5, col: 5, visible: true });
    h.written.length = 0;
    h.coordinator.setCursor(null);
    expect(h.written).toEqual(['\x1b[?25l']);
  });

  test('setCursor with frame already scheduled defers cursor to that flush', () => {
    const h = cursorHarness();
    // Scheduled frame in flight (no immediate emit).
    h.coordinator.publish({ type: 'requestRender', region: 'pane:log' });
    h.coordinator.setCursor({ row: 9, col: 9, visible: true });
    expect(h.written).toEqual([]);
    h.scheduled.forEach(fn => fn());
    expect(h.written).toEqual(['\x1b[9;9H\x1b[?25h']);
  });

  test('cursor emits AFTER onRender + afterRender hook', () => {
    const order: string[] = [];
    const written: string[] = [];
    const scheduled: Array<() => void> = [];
    const coordinator = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      onRender: () => order.push('onRender'),
      hooks: {
        afterRender: () => order.push('afterRender'),
      },
      writeCursor: (s) => { order.push('writeCursor'); written.push(s); },
    });
    coordinator.setCursor({ row: 2, col: 2, visible: true });
    written.length = 0;
    order.length = 0;
    coordinator.publish({ type: 'requestRender', region: 'pane:log' });
    // Re-set cursor so it bumps version inside the scheduled flush
    coordinator.setCursor({ row: 3, col: 3, visible: true });
    scheduled.forEach(fn => fn());
    // Cursor should land last, after both hooks.
    expect(order.indexOf('onRender')).toBeLessThan(order.indexOf('writeCursor'));
    expect(order.indexOf('afterRender')).toBeLessThan(order.indexOf('writeCursor'));
  });

  test('flush always re-asserts cursor — row paints may have overwritten the prior position', () => {
    // Updated for P2.3.a: a real frame flush is the time when row
    // paints could have clobbered the cursor, so we re-emit even
    // when the cursor logical state is unchanged. The bypass-batch
    // path (setCursor with no scheduled frame) still de-dups.
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 1, col: 1, visible: true });
    expect(h.written.length).toBe(1);
    h.coordinator.publish({ type: 'requestRender' });
    h.scheduled.forEach(fn => fn());
    expect(h.written.length).toBe(2);   // re-emitted on flush
  });

  test('writeCursor undefined → state still tracked, no emission', () => {
    const h = cursorHarness({ capture: false });
    h.coordinator.setCursor({ row: 1, col: 1, visible: true });
    expect(h.coordinator.getCursor()).toEqual({ row: 1, col: 1, visible: true });
    expect(h.written).toEqual([]);
  });

  test('hidden cursor → null state stays distinct from absent state', () => {
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 1, col: 1, visible: false });
    expect(h.coordinator.getCursor()).toEqual({ row: 1, col: 1, visible: false });
    expect(h.written[0]).toBe('\x1b[?25l');
  });

  test('snapshot.cursor is a defensive copy — caller cannot mutate state', () => {
    const h = cursorHarness();
    h.coordinator.setCursor({ row: 1, col: 1, visible: true });
    const snap = h.coordinator.snapshot();
    if (snap.cursor) snap.cursor.row = 99;
    expect(h.coordinator.getCursor()?.row).toBe(1);
  });
});
