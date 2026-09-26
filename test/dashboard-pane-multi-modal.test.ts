import { afterEach, describe, expect, test } from 'bun:test';
import {
  MIN_WIDE_WIDTH,
  _resetPaneMultiModalsForTesting,
  currentPaneMultiModal,
  showPaneMultiModal,
} from '../src/dashboard/modals/pane-multi.js';
import type { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import { ELANOUS_PASTEL_DEFAULT } from '../src/themes/elanous-pastel-default.js';

// Minimal DisplayCoordinator stub — the factory only needs pushModal,
// everything else is unused inside paint tests.
function makeStubCoordinator() {
  const modals: ModalSurface[] = [];
  let nextId = 1;
  const coord = {
    pushModal(surface: ModalSurface) {
      modals.push(surface);
      const idStr = `surface-${nextId++}`;
      return {
        id: idStr as any,
        dispose: () => {
          const idx = modals.indexOf(surface);
          if (idx >= 0) modals.splice(idx, 1);
        },
      };
    },
  } as unknown as DisplayCoordinator;
  return { coord, modals };
}

describe('showPaneMultiModal (Task 2 · T-2)', () => {
  afterEach(() => _resetPaneMultiModalsForTesting());

  test('2-column layout renders on wide terminals', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts', 'b.ts'] },
        { title: 'preview', lines: ['line1', 'line2'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });

    expect(modals.length).toBe(1);
    expect(handle.columnCount).toBe(2);
    const out = modals[0]!.paint!();
    expect(out).toContain('Browser + Preview');
    expect(out).toContain('browser');
    expect(out).toContain('preview');
    expect(out).toContain('a.ts');
    expect(out).toContain('line1');
  });

  test('narrow-fallback (<80 cols) collapses to single column with first pane', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'B+P',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['will-not-render'] },
      ],
      coordinator: coord,
      termCols: 50,
      termRows: 20,
    });

    expect(handle.columnCount).toBe(1);
    const out = modals[0]!.paint!();
    expect(out).toContain('browser');
    expect(out).not.toContain('will-not-render');
  });

  test('MIN_WIDE_WIDTH boundary: explicit bounds.width=80 = multi', () => {
    const { coord } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 't',
      columns: [
        { title: 'A', lines: ['x'] },
        { title: 'B', lines: ['y'] },
      ],
      coordinator: coord,
      termCols: 100,
      termRows: 24,
      // Explicit width so clamp doesn't shrink below the threshold.
      width: MIN_WIDE_WIDTH,
    });
    expect(handle.columnCount).toBe(2);
  });

  test('bounds.width=79 (1 below threshold) → fallback to single', () => {
    const { coord } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 't',
      columns: [
        { title: 'A', lines: ['x'] },
        { title: 'B', lines: ['y'] },
      ],
      coordinator: coord,
      termCols: 100,
      termRows: 24,
      width: MIN_WIDE_WIDTH - 1,
    });
    expect(handle.columnCount).toBe(1);
  });

  test('group singleton — 2nd call with same group disposes the first', () => {
    const { coord, modals } = makeStubCoordinator();
    showPaneMultiModal({
      title: 'first',
      columns: [{ title: 'a', lines: ['1'] }, { title: 'b', lines: ['2'] }],
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    showPaneMultiModal({
      title: 'second',
      columns: [{ title: 'a', lines: ['1'] }, { title: 'b', lines: ['2'] }],
      coordinator: coord,
      termCols: 140, termRows: 36,
    });
    expect(modals.length).toBe(1);
    expect(modals[0]!.paint!()).toContain('second');
  });

  test('dispose() is idempotent + clears currentPaneMultiModal', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'x',
      columns: [{ title: 'a', lines: ['1'] }],
      coordinator: coord,
      termCols: 50, termRows: 18,
    });
    expect(currentPaneMultiModal()).not.toBeNull();
    handle.dispose();
    handle.dispose();
    expect(modals.length).toBe(0);
    expect(currentPaneMultiModal()).toBeNull();
  });

  test('onDispose fires once — used by T-4 focus restore', () => {
    const { coord } = makeStubCoordinator();
    let calls = 0;
    const handle = showPaneMultiModal({
      title: 'x',
      columns: [{ title: 'a', lines: ['1'] }],
      coordinator: coord,
      termCols: 140, termRows: 36,
      onDispose: () => { calls++; },
    });
    handle.dispose();
    handle.dispose();
    expect(calls).toBe(1);
  });

  test('ttlMs>0 triggers auto-dispose via injected schedule', () => {
    const { coord } = makeStubCoordinator();
    let scheduled: (() => void) | null = null;
    let disposed = false;
    showPaneMultiModal({
      title: 'x',
      columns: [{ title: 'a', lines: ['1'] }],
      coordinator: coord,
      termCols: 140, termRows: 36,
      ttlMs: 500,
      schedule: (fn) => {
        scheduled = fn;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => { /* noop */ },
      onDispose: () => { disposed = true; },
    });
    expect(scheduled).not.toBeNull();
    scheduled!();
    expect(disposed).toBe(true);
  });

  test('chrome spec paints rounded title rail, controls, and bottom status', () => {
    const { coord, modals } = makeStubCoordinator();
    showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['line1'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: ELANOUS_PASTEL_DEFAULT,
        variant: 'rounded',
        titleAlign: 'left',
        titlePrefix: '⠿',
        titleRight: '— ✕',
        bottomStatus: 'browser · preview · live',
      },
    });

    const out = modals[0]!.paint!();
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('╭');
    expect(plain).toContain('╮');
    expect(plain).toContain('⠿ Browser + Preview');
    expect(plain).toContain('— ✕');
    expect(plain).toContain('browser · preview · live');
  });

  test('W3 — snapshot modal title control click dispatches chrome action', () => {
    const { coord, modals } = makeStubCoordinator();
    const calls: string[] = [];
    const handle = showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['line1'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: ELANOUS_PASTEL_DEFAULT,
        titleControls: [
          { id: 'model', label: '⌥' },
          { id: 'close', label: '✕' },
        ],
      },
      onChromeAction: (action) => { calls.push(action.controlId); },
    });
    const row = handle.bounds.row;
    const modelCol = handle.bounds.col + handle.bounds.width - 5;
    (modals[0] as any).onMouse({ type: 'click', row, col: modelCol });
    expect(calls).toEqual(['model']);
  });

  test('snapshot modal title rail click is classified as modal-title', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['line1'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: ELANOUS_PASTEL_DEFAULT,
        titleControls: [{ id: 'close', label: '✕' }],
      },
    });
    const ev: any = { type: 'click', row: handle.bounds.row, col: handle.bounds.col + 4 };
    expect((modals[0] as any).onMouse(ev)).toEqual({ type: 'refresh' });
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: handle.id });
  });

  test('snapshot modal title rail follows moved visual bounds', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['line1'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      chrome: {
        theme: ELANOUS_PASTEL_DEFAULT,
        titleControls: [{ id: 'close', label: '✕' }],
      },
    });
    (modals[0] as any).interactiveBounds = {
      ...(modals[0] as any).interactiveBounds,
      row: handle.bounds.row + 6,
    };
    (modals[0] as any).visualBounds = {
      ...(modals[0] as any).visualBounds,
      row: handle.bounds.row + 6,
    };
    const ev: any = { type: 'click', row: handle.bounds.row + 6, col: handle.bounds.col + 4 };
    expect((modals[0] as any).onMouse(ev)).toEqual({ type: 'refresh' });
    expect(ev.hitTarget).toEqual({ kind: 'modal-title', modalId: handle.id });
    const frame = modals[0]!.paint!();
    expect(frame).toContain(`\u001b[${handle.bounds.row + 6};${handle.bounds.col}H`);
  });

  test('W2 — snapshot modal keeps full-screen backdrop bounds but exposes centered interactiveBounds', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Browser + Preview',
      columns: [
        { title: 'browser', lines: ['a.ts'] },
        { title: 'preview', lines: ['line1'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
    });
    const surface = modals[0]!;
    expect(surface.bounds).toEqual({ row: 1, col: 1, width: 140, height: 36 });
    expect(surface.interactiveBounds).toEqual(handle.bounds);
    expect(surface.visualBounds).toEqual(handle.bounds);
    expect(surface.backdropBounds).toEqual(surface.bounds);
    expect(surface.backgroundInteractionPolicy).toBe('block');
  });

  test('W4 — snapshot modal companion role keeps centered window bounds but allows background interaction', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Debug Watcher',
      columns: [{ title: 'watch', lines: ['tick'] }],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      windowRole: 'companion',
    });
    const surface = modals[0]!;
    expect(surface.windowRole).toBe('companion');
    expect(surface.bounds).toEqual(handle.bounds);
    expect(surface.interactiveBounds).toEqual(surface.visualBounds);
    expect(surface.backdropBounds).toEqual(handle.bounds);
    expect(surface.backgroundInteractionPolicy).toBe('allow');
    expect(surface.focus).toBe('none');
    expect(surface.interactionClass).toBe('embedded-overlay');
  });

  test('W5 — snapshot modal can paint a 2x2 composite matrix', () => {
    const { coord, modals } = makeStubCoordinator();
    const handle = showPaneMultiModal({
      title: 'Quad Snapshot',
      layoutMode: '2x2',
      columns: [
        { title: 'A', lines: ['a1', 'a2'] },
        { title: 'B', lines: ['b1', 'b2'] },
        { title: 'C', lines: ['c1', 'c2'] },
        { title: 'D', lines: ['d1', 'd2'] },
      ],
      coordinator: coord,
      termCols: 140,
      termRows: 36,
      height: 14,
    });

    expect(handle.columnCount).toBe(4);
    const plain = modals[0]!.paint!().replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('a1');
    expect(plain).toContain('b1');
    expect(plain).toContain('c1');
    expect(plain).toContain('d1');
    expect(plain).toContain('┼');
  });
});
