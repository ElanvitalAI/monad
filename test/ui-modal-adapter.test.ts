import { describe, expect, test } from 'bun:test';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { Dialog } from '../src/ui/widgets/dialog.js';
import { stripAnsi } from '../src/tui.js';
import type { DisplayMouseEvent, KeyEvent } from '../src/display/types.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

describe('LC12 mountViewAsModalSurface', () => {
  test('paint() renders the view framed at the declared bounds', () => {
    const view = new SelectView<string>({
      title: 'Test',
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 3, col: 10, width: 20, height: 6 },
      view,
    });
    const out = h.surface.paint();
    expect(stripAnsi(out)).toContain('Alpha');
    expect(stripAnsi(out)).toContain('Beta');
    // should cursor-move to (3, 10) — contains CSI 3;10H somewhere
    expect(out).toMatch(/\x1b\[3;10H/);
  });

  test('handleKey forwards events and reports consumption', () => {
    let picked: string | null = null;
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      onSubmit: v => { picked = v as string; },
    });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view,
    });
    expect(h.handleKey(key('down'))).toBe('consumed');
    expect(h.handleKey(key('enter'))).toBe('consumed');
    expect(picked).toBe('b');
  });

  test('surface.onKey is wired to handleKey by default', () => {
    // Regression: several callers (mouse-action-recipes, slash-launcher,
    // status-bar-popups, vw-*-modals, ask-user-question, plan-exit)
    // forgot to manually patch `handle.surface.onKey = handle.handleKey`
    // after mounting. Without onKey, coordinator.routeKey would see
    // `!surface.onKey` and fall through, so the user would find their
    // modal visible but dead to all keys (except cursor-move keys that
    // leaked through other paths). The adapter now sets onKey at
    // mount time so this is no longer a per-caller responsibility.
    let picked: string | null = null;
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      onSubmit: v => { picked = v as string; },
    });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view,
    });
    expect(typeof h.surface.onKey).toBe('function');
    // Invoking surface.onKey directly (like coordinator.routeKey would)
    // must produce the same result as handleKey.
    expect(h.surface.onKey!(key('down'))).toBe('consumed');
    expect(h.surface.onKey!(key('enter'))).toBe('consumed');
    expect(picked).toBe('b');
  });

  test('surface.onKey returns passthrough after dispose', () => {
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
    });
    h.dispose();
    expect(h.surface.onKey!(key('enter'))).toBe('passthrough');
  });

  test('dispose blanks subsequent paints and blocks keys', () => {
    let cleanups = 0;
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
      onDispose: () => { cleanups++; },
    });
    expect(h.surface.paint()).not.toBe('');
    h.dispose();
    expect(h.isDisposed()).toBe(true);
    expect(h.surface.paint()).toBe('');
    expect(h.handleKey(key('enter'))).toBe('passthrough');
    expect(cleanups).toBe(1);
  });

  test('isModalSurface recognizes the produced surface', async () => {
    const { isModalSurface } = await import('../src/display/modal-stack.js');
    const view = new SelectView<string>({ options: [{ value: 'a', label: 'A' }], onSubmit: () => {} });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
    });
    expect(isModalSurface(h.surface)).toBe(true);
  });

  test('default priority is 250', () => {
    const view = new SelectView<string>({ options: [{ value: 'a', label: 'A' }], onSubmit: () => {} });
    const h = mountViewAsModalSurface({
      id: 'x',
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
    });
    expect(h.surface.priority).toBe(250);
  });

  test('Dialog mounts cleanly and cancels via Esc', () => {
    let cancelled = false;
    const dialog = new Dialog<'yes' | 'no'>({
      title: 'Really?',
      buttons: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
      onSubmit: () => {},
      onCancel: () => { cancelled = true; },
    });
    const h = mountViewAsModalSurface({
      id: 'd',
      bounds: { row: 2, col: 2, width: 30, height: 4 },
      view: dialog,
    });
    expect(h.handleKey(key('escape'))).toBe('consumed');
    expect(cancelled).toBe(true);
  });

  test('title rail click is classified as modal-title and consumed', () => {
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'title-hit',
      bounds: { row: 2, col: 2, width: 24, height: 5 },
      view,
      chromeControls: { closeButton: true },
    });
    h.surface.paint();
    const ev: DisplayMouseEvent = { type: 'click', row: 2, col: 8 };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: 'title-hit' });
  });

  test('title rail drag is classified as modal-title and consumed', () => {
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'title-drag',
      bounds: { row: 2, col: 2, width: 24, height: 5 },
      view,
      chromeControls: { closeButton: true },
    });
    h.surface.paint();
    const ev: DisplayMouseEvent = { type: 'drag', row: 2, col: 8 };
    expect(h.handleMouse(ev)).toBe('consumed');
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: 'title-drag' });
  });
});
