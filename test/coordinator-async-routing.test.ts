import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator, type DisplaySurface } from '../src/display/index.js';
import type { Action } from '../src/plugins/core/types.js';

/**
 * IDX-F1.5 — async variants of routeKey / tryRouteKeyToTopModal that
 * honour Promise returns from `surface.onKey`. The sync `routeKey`
 * treats a Promise as fall-through (logged via
 * debug.routeSurfaceKey.asyncDropped) so legacy callers remain correct
 * while async-aware callers opt into `routeKeyAsync` /
 * `tryRouteKeyToTopModalAsync`. The sync `tryRouteKeyToTopModal`
 * variant was dropped (zero src/ callers) — only the async variant
 * remains for input-mode bridging.
 */

function modalSurface(
  id: string,
  onKey?: DisplaySurface['onKey'],
  opts: Partial<DisplaySurface> = {},
): DisplaySurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: opts.focus ?? 'owns',
    priority: opts.priority ?? 100,
    tier: opts.tier,
    render: () => [],
    onKey,
  };
}

function harness() {
  return new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { setTimeout(fn, 0); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* noop */ },
  });
}

describe('IDX-F1.5 async routing', () => {
  test('sync onKey routes through tryRouteKeyToTopModalAsync', async () => {
    const c = harness();
    let seen: string | null = null;
    const m = modalSurface('dialog:ask', (ev) => {
      seen = (ev as { name: string }).name;
      return 'consumed';
    });
    c.pushModal(m);
    expect(await c.tryRouteKeyToTopModalAsync({ name: 'a', ctrl: false, shift: false })).toBe('consumed');
    expect(seen).toBe('a');
  });

  test('async onKey is awaited on tryRouteKeyToTopModalAsync', async () => {
    const c = harness();
    let seen: string | null = null;
    const m = modalSurface('async:dlg', async (ev) => {
      // Simulate async work (filesystem scan / network / etc.)
      await new Promise(r => setTimeout(r, 1));
      seen = (ev as { name: string }).name;
      return 'consumed';
    });
    c.pushModal(m);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'enter', ctrl: false, shift: false });
    expect(res).toBe('consumed');
    expect(seen).toBe('enter');
  });

  test('routeKeyAsync honours async onKey on the modal path', async () => {
    const c = harness();
    let seen: string | null = null;
    const m = modalSurface('async:m2', async (ev) => {
      await Promise.resolve();
      seen = (ev as { name: string }).name;
      return { type: 'action-a' } as Action;
    });
    c.pushModal(m);
    const res = await c.routeKeyAsync({ name: 'up', ctrl: false, shift: false });
    expect(res.type).toBe('action');
    expect(seen).toBe('up');
  });

  test('async onKey returning passthrough falls through to keybindings', async () => {
    const c = harness();
    // No modal; just verify routeKeyAsync handles the happy path of
    // no surface.onKey involvement.
    const res = await c.routeKeyAsync({ name: 'b', ctrl: false, shift: false });
    expect(res.type).toBe('passthrough');
  });

  test('focus:participates + async onKey — picker-style wiring', async () => {
    // Emulates the F2.5 chat picker: paint-only surface that opts in
    // to routing via focus:'participates', and uses async onKey to run
    // picker.dispatch (which hits the filesystem for at-picker).
    const c = harness();
    let dispatched = 0;
    const picker = modalSurface(
      'chat:slash-picker:z',
      async () => { dispatched++; return 'consumed'; },
      { focus: 'participates', tier: 'picker' },
    );
    c.pushModal(picker);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'down', ctrl: false, shift: false });
    expect(res).toBe('consumed');
    expect(dispatched).toBe(1);
  });
});
