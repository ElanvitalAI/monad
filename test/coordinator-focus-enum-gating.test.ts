import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator, type DisplaySurface } from '../src/display/index.js';
import type { Action } from '../src/plugins/core/types.js';

/**
 * Q3 (substrate Occam, 2026-05-03) — `DisplaySurface.focus` enum
 * collapses the legacy `focusable` + `keyParticipating` two-bool pair:
 *   • focus: 'owns'         = focus.active eligible AND key routing
 *   • focus: 'participates' = key routing without focus.active steal
 *   • focus: 'none'         = passive paint, no key delivery
 *
 * These tests verify that the coordinator's `topFocusedSurface('modal')`
 * consults `surface.focus` so a paint-only picker (focus:'participates')
 * can still receive keys, while a purely decorative overlay
 * (focus:'none') remains transparent.
 */

function modalSurface(
  id: string,
  opts: Partial<DisplaySurface>,
  onKey?: (ev: unknown) => Action | 'consumed' | 'passthrough',
): DisplaySurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: opts.focus ?? 'owns',
    priority: opts.priority ?? 100,
    render: () => [],
    ...opts,
    onKey,
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  return new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* noop */ },
  });
}

describe('focus enum gating in topFocusedSurface', () => {
  test("focus:'owns' — receives routeKey (default behaviour)", async () => {
    const c = harness();
    let keyReceived: string | null = null;
    const dlg = modalSurface('dialog:ask', { focus: 'owns' }, (ev) => {
      keyReceived = (ev as { name: string }).name;
      return 'consumed';
    });
    c.pushModal(dlg);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'a', ctrl: false, shift: false });
    expect(res).toBe('consumed');
    expect(keyReceived).toBe('a');
  });

  test("focus:'none' — routing skips (legacy paint-only overlay)", async () => {
    const c = harness();
    let keyReceived: string | null = null;
    const picker = modalSurface(
      'chat:slash-picker:x',
      { focus: 'none' },
      (ev) => { keyReceived = (ev as { name: string }).name; return 'consumed'; },
    );
    c.pushModal(picker);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'b', ctrl: false, shift: false });
    expect(res).toBe('passthrough');
    expect(keyReceived).toBeNull();
  });

  test("focus:'participates' — picker receives keys without owning focus", async () => {
    // Q3 contract: paint-only picker opts into routing via
    // focus:'participates' so coordinator.routeKey delivers keys
    // without making the picker focus-eligible (which would steal
    // focus.active from the underlying pane:input).
    const c = harness();
    let keyReceived: string | null = null;
    const picker = modalSurface(
      'chat:slash-picker:y',
      { focus: 'participates' },
      (ev) => { keyReceived = (ev as { name: string }).name; return 'consumed'; },
    );
    c.pushModal(picker);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'up', ctrl: false, shift: false });
    expect(res).toBe('consumed');
    expect(keyReceived).toBe('up');
  });

  test("picker underneath focus:'owns' modal — dialog wins; picker remains on stack", async () => {
    const c = harness();
    let pickerCalled = 0;
    let dialogCalled = 0;
    const picker = modalSurface(
      'chat:slash-picker:z',
      { focus: 'participates' },
      () => { pickerCalled++; return 'consumed'; },
    );
    const dialog = modalSurface('dialog:ask', { focus: 'owns' }, () => {
      dialogCalled++;
      return 'consumed';
    });
    c.pushModal(picker);
    c.pushModal(dialog);
    const res = await c.tryRouteKeyToTopModalAsync({ name: 'enter', ctrl: false, shift: false });
    expect(res).toBe('consumed');
    expect(dialogCalled).toBe(1);
    expect(pickerCalled).toBe(0);
  });
});
