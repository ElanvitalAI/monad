import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  clampModalBoundsToViewport,
  isModalSurface,
  modalBlocksBackground,
  modalParticipatesInViewMode,
  renderModalStack,
  shiftModalBounds,
  topBlockingForegroundModalSurface,
  topModalCursor,
  topModalSurface,
  topWorkspaceSurface,
  type ModalSurface,
} from '../src/display/modal-stack.js';
import type { CursorState } from '../src/display/cursor-state.js';

function modal(
  id: string,
  paintBody: string,
  opts: {
    cursor?: CursorState | null;
    bounds?: ModalSurface['bounds'];
    onKey?: ModalSurface['onKey'];
    onMouse?: ModalSurface['onMouse'];
  } = {},
): ModalSurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 0,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 10, height: 1 },
    render: () => [],            // unused — modals render via paint()
    paint: () => paintBody,
    cursor: opts.cursor !== undefined ? () => opts.cursor ?? null : undefined,
    onKey: opts.onKey,
    onMouse: opts.onMouse,
  };
}

function harness() {
  const overlays: string[] = [];
  const cursors: string[] = [];
  const renders: number[] = [];
  const scheduled: Array<() => void> = [];
  const c = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    onRender: () => { renders.push(Date.now()); },
    writeOverlay: (s) => overlays.push(s),
    writeCursor: (s) => cursors.push(s),
  });
  /** Drain pending scheduled flushes — shift to consume so the
   *  array doesn't accumulate stale wrappers from prior frames
   *  that would re-flush against the latest state. */
  function flush() {
    while (scheduled.length > 0) {
      const fn = scheduled.shift()!;
      fn();
    }
  }
  return { c, overlays, cursors, renders, scheduled, flush };
}

describe('isModalSurface', () => {
  test('narrows a kind:modal + paint surface', () => {
    expect(isModalSurface(modal('a', 'X'))).toBe(true);
  });

  test('rejects kind:pane / non-paint surfaces', () => {
    expect(isModalSurface({
      id: 'p', kind: 'pane', owner: 'dashboard', focus: 'owns', priority: 0, render: () => [],
    } as any)).toBe(false);
  });
});

describe('renderModalStack — pure helper', () => {
  test('empty stack → empty string', () => {
    expect(renderModalStack({ surfaces: new Map(), focusStack: [] })).toBe('');
  });

  test('single modal → its paint output', () => {
    const m = modal('one', '<one>');
    const surfaces = new Map([[m.id, m]]);
    expect(renderModalStack({ surfaces, focusStack: ['one'] })).toBe('<one>');
  });

  test('multiple modals → bottom→top order, top last', () => {
    const a = modal('a', 'A');
    const b = modal('b', 'B');
    const surfaces = new Map([[a.id, a], [b.id, b]]);
    // Stack: a then b → b is top, paint last.
    expect(renderModalStack({ surfaces, focusStack: ['a', 'b'] })).toBe('AB');
  });

  test('non-modal surfaces in stack are skipped', () => {
    const m = modal('m', 'M');
    const pane = { id: 'p', kind: 'pane' as const, owner: 'dashboard' as const, focus: 'owns', priority: 0, render: () => [] };
    const surfaces = new Map<string, any>([[m.id, m], ['p', pane]]);
    expect(renderModalStack({ surfaces, focusStack: ['p', 'm'] })).toBe('M');
  });

  test('paint() throw is swallowed (frame must not break)', () => {
    const broken: ModalSurface = {
      ...modal('x', 'X'),
      paint: () => { throw new Error('boom'); },
    };
    const surfaces = new Map([[broken.id, broken]]);
    expect(renderModalStack({ surfaces, focusStack: ['x'] })).toBe('');
  });

  // ── α.2 (2026-04-21 · compositor primitive track) ────────────────
  // Wayland opaque-region optimization · when a modal declares
  // `occluding: true`, modals strictly beneath it are fully covered
  // so painting them wastes work. Focus-stack iteration skips them
  // once the highest occluding index is known.

  test('occluding=true on top modal skips the one below', () => {
    const bottom = { ...modal('bottom', 'B'), paint: () => 'B' };
    let bottomPainted = 0;
    const tracked = { ...bottom, paint: () => { bottomPainted += 1; return 'B'; } };
    const top = { ...modal('top', 'T'), occluding: true };
    const surfaces = new Map<string, ModalSurface>([[tracked.id, tracked], [top.id, top]]);
    const out = renderModalStack({ surfaces, focusStack: ['bottom', 'top'] });
    expect(out).toBe('T');
    expect(bottomPainted).toBe(0);  // bottom.paint() never invoked
  });

  test('occluding=false (explicit) behaves like pre-α.2 — both paint', () => {
    const bottom = modal('bottom', 'B');
    const top = { ...modal('top', 'T'), occluding: false };
    const surfaces = new Map<string, ModalSurface>([[bottom.id, bottom], [top.id, top]]);
    expect(renderModalStack({ surfaces, focusStack: ['bottom', 'top'] })).toBe('BT');
  });

  test('occluding undefined (absent) behaves like pre-α.2 — both paint', () => {
    const bottom = modal('bottom', 'B');
    const top = modal('top', 'T');  // no occluding field
    const surfaces = new Map<string, ModalSurface>([[bottom.id, bottom], [top.id, top]]);
    expect(renderModalStack({ surfaces, focusStack: ['bottom', 'top'] })).toBe('BT');
  });

  test('middle occluder skips only bottom · top renders above', () => {
    const bottom = modal('bottom', 'B');
    const middle = { ...modal('middle', 'M'), occluding: true };
    const top = modal('top', 'T');
    let bottomPainted = 0;
    const trackedBottom = { ...bottom, paint: () => { bottomPainted += 1; return 'B'; } };
    const surfaces = new Map<string, ModalSurface>([
      [trackedBottom.id, trackedBottom], [middle.id, middle], [top.id, top],
    ]);
    // Bottom is strictly below the occluder · skipped. Middle paints
    // itself. Top paints on top of the occluder (popover-style · the
    // occluder's opaque guarantee doesn't bind modals above it).
    expect(renderModalStack({ surfaces, focusStack: ['bottom', 'middle', 'top'] })).toBe('MT');
    expect(bottomPainted).toBe(0);
  });

  test('multiple occluders · highest wins · skip everything below it', () => {
    const a = modal('a', 'A');              // bottom · skipped
    const b = { ...modal('b', 'B'), occluding: true };   // skipped (below c's occluder)
    const c = { ...modal('c', 'C'), occluding: true };   // highest occluder · paints
    const d = modal('d', 'D');              // above occluder · paints
    let aPainted = 0, bPainted = 0;
    const trackedA = { ...a, paint: () => { aPainted += 1; return 'A'; } };
    const trackedB = { ...b, paint: () => { bPainted += 1; return 'B'; } };
    const surfaces = new Map<string, ModalSurface>([
      [trackedA.id, trackedA], [trackedB.id, trackedB], [c.id, c], [d.id, d],
    ]);
    expect(renderModalStack({ surfaces, focusStack: ['a', 'b', 'c', 'd'] })).toBe('CD');
    expect(aPainted).toBe(0);
    expect(bPainted).toBe(0);
  });

  test('occluder at index 0 (bottom-most) — no modals below so nothing to skip', () => {
    const a = { ...modal('a', 'A'), occluding: true };
    const b = modal('b', 'B');
    const surfaces = new Map<string, ModalSurface>([[a.id, a], [b.id, b]]);
    // Occluder is bottom-most · no-op optimization · both paint
    // (semantically `a` is opaque but `b` is above so `b`'s pixels
    // land on `a`'s bounds wherever they overlap).
    expect(renderModalStack({ surfaces, focusStack: ['a', 'b'] })).toBe('AB');
  });

  test('non-modal surfaces below occluder are not counted as occluded', () => {
    // The `occluderIdx` tracks focus-stack index, and non-modals are
    // ignored in the paint pass anyway. Still worth pinning so a future
    // refactor that mixes surface kinds doesn't accidentally change
    // semantics.
    const m = modal('m', 'M');
    const pane = { id: 'p', kind: 'pane' as const, owner: 'dashboard' as const, focus: 'owns', priority: 0, render: () => [] };
    const occluder = { ...modal('o', 'O'), occluding: true };
    const surfaces = new Map<string, any>([[m.id, m], ['p', pane], [occluder.id, occluder]]);
    // Stack: m (paint skipped · below occluder) · p (non-modal · skipped anyway) · occluder (paint)
    expect(renderModalStack({ surfaces, focusStack: ['m', 'p', 'o'] })).toBe('O');
  });
});

describe('topModalCursor — top-of-stack cursor claim wins', () => {
  test('null when no modals', () => {
    expect(topModalCursor({ surfaces: new Map(), focusStack: [] })).toBeNull();
  });

  test('null when no modal claims cursor', () => {
    const a = modal('a', 'A');                                           // no cursor()
    const surfaces = new Map([[a.id, a]]);
    expect(topModalCursor({ surfaces, focusStack: ['a'] })).toBeNull();
  });

  test('top modal cursor wins over lower modals', () => {
    const a = modal('a', 'A', { cursor: { row: 1, col: 1, visible: true } });
    const b = modal('b', 'B', { cursor: { row: 5, col: 5, visible: true } });
    const surfaces = new Map([[a.id, a], [b.id, b]]);
    // Stack a then b → b is top.
    expect(topModalCursor({ surfaces, focusStack: ['a', 'b'] })).toEqual({ row: 5, col: 5, visible: true });
  });

  test('falls through when top modal returns null', () => {
    const a = modal('a', 'A', { cursor: { row: 1, col: 1, visible: true } });
    const b = modal('b', 'B', { cursor: null });
    const surfaces = new Map([[a.id, a], [b.id, b]]);
    expect(topModalCursor({ surfaces, focusStack: ['a', 'b'] })).toEqual({ row: 1, col: 1, visible: true });
  });
});

describe('topModalSurface', () => {
  test('returns the top-most modal surface', () => {
    const a = modal('a', 'A');
    const b = modal('b', 'B');
    const pane = { id: 'p', kind: 'pane' as const, owner: 'dashboard' as const, focus: 'owns', priority: 0, render: () => [] };
    const surfaces = new Map<string, any>([['p', pane], [a.id, a], [b.id, b]]);
    const top = topModalSurface({
      focusStack: ['p', 'a', 'b'],
      surfaceAt: id => surfaces.get(id),
    });
    expect(top?.id).toBe('b');
  });

  test('returns null when the stack has no modal', () => {
    const pane = { id: 'p', kind: 'pane' as const, owner: 'dashboard' as const, focus: 'owns', priority: 0, render: () => [] };
    const surfaces = new Map<string, any>([['p', pane]]);
    expect(topModalSurface({
      focusStack: ['p'],
      surfaceAt: id => surfaces.get(id),
    })).toBeNull();
  });
});

describe('modal bounds helpers', () => {
  test('shiftModalBounds offsets row and col only', () => {
    expect(shiftModalBounds(
      { row: 4, col: 6, width: 20, height: 8 },
      { row: 3, col: -2 },
    )).toEqual({ row: 7, col: 4, width: 20, height: 8 });
  });

  test('clampModalBoundsToViewport keeps a fully visible modal inside viewport', () => {
    expect(clampModalBoundsToViewport(
      { row: 99, col: 99, width: 20, height: 8 },
      { rows: 24, cols: 80 },
    )).toEqual({ row: 24, col: 73, width: 20, height: 8 });
  });

  test('clampModalBoundsToViewport preserves size for oversize modal and keeps title reachable', () => {
    expect(clampModalBoundsToViewport(
      { row: -10, col: -10, width: 200, height: 99 },
      { rows: 24, cols: 80 },
    )).toEqual({ row: 1, col: -10, width: 200, height: 99 });
  });

  test('clampModalBoundsToViewport allows partial horizontal off-screen while keeping title rail visible', () => {
    expect(clampModalBoundsToViewport(
      { row: 4, col: 99, width: 40, height: 8 },
      { rows: 24, cols: 80 },
    )).toEqual({ row: 4, col: 73, width: 40, height: 8 });
  });
});

describe('DisplayCoordinator.routeKeyToSurface', () => {
  test('routes directly to a target surface and marks it dirty on consumed', () => {
    const h = harness();
    const m = modal('m', 'M', {
      onKey: (ev) => ev.name === 'j' ? 'consumed' : 'passthrough',
    });
    h.c.pushModal(m);
    const res = h.c.routeKeyToSurface(m, { name: 'j' } as any);
    expect(res.type).toBe('consumed');
    expect((res as any).surfaceId).toBe('m');
    h.flush();
    expect(h.renders.length).toBeGreaterThan(0);
  });

  test('returns passthrough when the target surface does not consume', () => {
    const h = harness();
    const m = modal('m', 'M', {
      onKey: () => 'passthrough',
    });
    h.c.pushModal(m);
    const res = h.c.routeKeyToSurface(m, { name: 'x' } as any);
    expect(res.type).toBe('passthrough');
  });
});

describe('topBlockingForegroundModalSurface', () => {
  test('returns the top-most blocking foreground modal', () => {
    const bottom = {
      ...modal('bottom', 'B'),
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'foreground' as const,
    };
    const top = {
      ...modal('top', 'T'),
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'foreground' as const,
    };
    const surfaces = new Map<string, ModalSurface>([[bottom.id, bottom], [top.id, top]]);
    const found = topBlockingForegroundModalSurface({
      focusStack: ['bottom', 'top'],
      surfaceAt: id => surfaces.get(id),
    });
    expect(found?.id).toBe('top');
  });

  test('skips companion popups and returns null when only companion is blocking', () => {
    const companion = {
      ...modal('scratch', 'S'),
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'companion' as const,
    };
    const surfaces = new Map<string, ModalSurface>([[companion.id, companion]]);
    expect(topBlockingForegroundModalSurface({
      focusStack: ['scratch'],
      surfaceAt: id => surfaces.get(id),
    })).toBeNull();
  });

  test('skips workspace-class virtual windows even when they reuse modal primitives', () => {
    const vw = {
      ...modal('vw', 'V'),
      tier: 'vw' as const,
      hostChromeProfile: 'hud-status-input-dock' as const,
      interactionClass: 'workspace' as const,
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'foreground' as const,
    };
    const surfaces = new Map<string, ModalSurface>([[vw.id, vw]]);
    expect(topBlockingForegroundModalSurface({
      focusStack: ['vw'],
      surfaceAt: id => surfaces.get(id),
    })).toBeNull();
  });

  test('returns null when no blocking foreground modal exists', () => {
    const popup = {
      ...modal('popup', 'P'),
      backgroundInteractionPolicy: 'allow' as const,
      windowRole: 'foreground' as const,
    };
    const surfaces = new Map<string, ModalSurface>([[popup.id, popup]]);
    expect(topBlockingForegroundModalSurface({
      focusStack: ['popup'],
      surfaceAt: id => surfaces.get(id),
    })).toBeNull();
  });
});

describe('topWorkspaceSurface', () => {
  test('returns the top-most workspace even when a blocking popup is above it', () => {
    const workspace = {
      ...modal('vw', 'V'),
      tier: 'vw' as const,
      interactionClass: 'workspace' as const,
      hostChromeProfile: 'hud-status-input-dock' as const,
    };
    const popup = {
      ...modal('popup', 'P'),
      interactionClass: 'blocking-modal' as const,
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'foreground' as const,
    };
    const surfaces = new Map<string, ModalSurface>([
      [workspace.id, workspace],
      [popup.id, popup],
    ]);
    expect(topWorkspaceSurface({
      focusStack: ['vw', 'popup'],
      surfaceAt: id => surfaces.get(id),
    })?.id).toBe('vw');
  });

  test('returns null when no workspace surface exists on the stack', () => {
    const popup = {
      ...modal('popup', 'P'),
      interactionClass: 'blocking-modal' as const,
      backgroundInteractionPolicy: 'block' as const,
      windowRole: 'foreground' as const,
    };
    const surfaces = new Map<string, ModalSurface>([[popup.id, popup]]);
    expect(topWorkspaceSurface({
      focusStack: ['popup'],
      surfaceAt: id => surfaces.get(id),
    })).toBeNull();
  });
});

describe('modalParticipatesInViewMode', () => {
  test('blocking foreground modal participates', () => {
    expect(modalParticipatesInViewMode({
      ...modal('popup', 'P'),
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
    })).toBe(true);
  });

  test('workspace-class virtual window does not participate as a blocking modal view', () => {
    expect(modalParticipatesInViewMode({
      ...modal('vw', 'V'),
      tier: 'vw',
      hostChromeProfile: 'hud-status-input-dock',
      interactionClass: 'workspace',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
    })).toBe(false);
  });
});

describe('modalBlocksBackground', () => {
  test('blocking modal reports true', () => {
    expect(modalBlocksBackground({
      ...modal('popup', 'P'),
      interactionClass: 'blocking-modal',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
    })).toBe(true);
  });

  test('workspace modal reports false even if legacy primitive fields look blocking', () => {
    expect(modalBlocksBackground({
      ...modal('vw', 'V'),
      tier: 'vw',
      interactionClass: 'workspace',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
      hostChromeProfile: 'hud-status-input-dock',
    })).toBe(false);
  });

  test('embedded overlay reports false', () => {
    expect(modalBlocksBackground({
      ...modal('companion', 'C'),
      interactionClass: 'embedded-overlay',
      backgroundInteractionPolicy: 'allow',
      windowRole: 'companion',
    })).toBe(false);
  });
});

describe('coordinator.pushModal / popModal', () => {
  test('pushModal registers + focuses + flushes overlay', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'PAINTED'));
    h.flush();
    expect(h.c.modalStack()).toEqual(['m']);
    expect(h.overlays.join('')).toBe('PAINTED');
    expect(h.c.currentFocus()).toBe('m');
  });

  test('popModal removes the surface + force-renders the underlying frame', () => {
    const h = harness();
    const handle = h.c.pushModal(modal('m', 'X'));
    h.flush();
    expect(h.c.modalStack()).toEqual(['m']);
    const overlaysBefore = h.overlays.length;
    handle.dispose();
    h.flush();
    expect(h.c.modalStack()).toEqual([]);
    // No new overlay write for an empty modal stack (perf — empty
    // strings aren't written). Underlying onRender ran via forceNext.
    expect(h.overlays.length).toBe(overlaysBefore);
  });

  test('popModal of an unknown id is a no-op', () => {
    const h = harness();
    h.c.popModal('does-not-exist');
    h.flush();
    // No modal, no overlay write.
    expect(h.overlays.filter(s => s.length > 0)).toEqual([]);
  });

  test('LIFO order — second push lands on top, both visible bottom→top', () => {
    const h = harness();
    h.c.pushModal(modal('a', 'AAA'));
    h.flush();
    h.overlays.length = 0;
    h.c.pushModal(modal('b', 'BBB'));
    h.flush();
    expect(h.c.modalStack()).toEqual(['a', 'b']);
    // Top modal renders last in the concatenated overlay string.
    expect(h.overlays.join('')).toBe('AAABBB');
  });
});

describe('coordinator — modal cursor() overrides setCursor', () => {
  test('modal claim wins over input setCursor', () => {
    const h = harness();
    h.c.setCursor({ row: 3, col: 3, visible: true });
    h.cursors.length = 0;
    h.c.pushModal(modal('m', 'X', { cursor: { row: 9, col: 9, visible: true } }));
    h.flush();
    // Last cursor write should be modal's claim, not input's.
    expect(h.cursors[h.cursors.length - 1]).toBe('\x1b[9;9H\x1b[?25h');
  });

  test('modal returning null falls back to input cursor', () => {
    const h = harness();
    h.c.setCursor({ row: 4, col: 4, visible: true });
    h.cursors.length = 0;
    h.c.pushModal(modal('m', 'X', { cursor: null }));
    h.flush();
    expect(h.cursors[h.cursors.length - 1]).toBe('\x1b[4;4H\x1b[?25h');
  });
});

describe('coordinator — overlay write order vs cursor', () => {
  test('overlay emits BEFORE cursor on the same flush', () => {
    const order: string[] = [];
    const c = new DisplayCoordinator({
      frameMs: 16,
      schedule: (fn) => { fn(); return 0 as any; },
      onRender: () => {},
      writeOverlay: () => order.push('overlay'),
      writeCursor: () => order.push('cursor'),
    });
    c.setCursor({ row: 1, col: 1, visible: true });   // immediate (no other dirty)
    order.length = 0;
    c.pushModal(modal('m', 'X', { cursor: { row: 2, col: 2, visible: true } }));
    expect(order).toEqual(['overlay', 'cursor']);
  });
});

describe('coordinator — modalStack visibility', () => {
  test('only kind:modal surfaces appear in modalStack()', () => {
    const h = harness();
    h.c.pushModal(modal('m1', '1'));
    h.c.publish({
      type: 'upsertSurface',
      surface: { id: 'p', kind: 'pane', owner: 'dashboard', focus: 'owns', priority: 0, render: () => [] },
    });
    h.c.publish({ type: 'setFocus', target: 'p' });
    h.flush();
    expect(h.c.modalStack()).toEqual(['m1']);
  });

  test('focusable:false modal still lands in the stack and paints', () => {
    // Pickers (slash / arg / @) push themselves as paint-only modals
    // with focusable:false — chat-picker-state owns their keys. Before
    // this regression test, setFocus's focusable guard silently dropped
    // them from focus.stack, so renderModalStack never saw them and
    // the picker was invisible on screen.
    const h = harness();
    h.c.pushModal({ ...modal('picker', 'PICK'), focus: 'none' });
    h.flush();
    expect(h.c.modalStack()).toEqual(['picker']);
    expect(h.overlays.join('')).toBe('PICK');
    // Non-focusable must NOT claim active focus.
    expect(h.c.currentFocus()).toBeNull();
  });

  test('popModal on focusable:false scrubs stack (no stale ids after dispose)', () => {
    // Regression: closeSurface's focus-cleanup branch only ran when
    // focus.active === id. Non-focusable modals (pickers) never become
    // active, so prior to the fix their ids lingered on focus.stack
    // even after surface disposal. This caused renderModalStack to
    // look up a deleted surface every frame AND flushOverlay's V4
    // vanished-cascade to fire repeatedly — perceived as flicker.
    const h = harness();
    const handle = h.c.pushModal({ ...modal('picker', 'P'), focus: 'none' });
    h.flush();
    expect(h.c.modalStack()).toEqual(['picker']);
    handle.dispose();
    h.flush();
    expect(h.c.modalStack()).toEqual([]);
    // Pushing a fresh picker should land on a clean stack (no leak).
    h.c.pushModal({ ...modal('picker2', 'P2'), focus: 'none' });
    h.flush();
    expect(h.c.modalStack()).toEqual(['picker2']);
  });

  test('focusable:false does not hijack key routing from the focusable modal below', () => {
    const h = harness();
    let focusableGotKey = false;
    h.c.pushModal(modal('dialog', 'D', {
      onKey: () => { focusableGotKey = true; return 'consumed' as const; },
    }));
    h.c.pushModal({ ...modal('picker', 'P'), focus: 'none' });
    h.flush();
    // Picker sits on top of stack for paint, but focus.active stayed
    // on 'dialog' (non-focusable pushModal doesn't move active). When
    // routeKey runs, topFocusedSurface('modal') returns picker → null
    // (no onKey) → falls through to activeSurface lookup → dialog.onKey
    // fires. So a focusable modal below a paint-only picker still
    // receives its keys.
    const res = h.c.routeKey({ name: 'enter' } as any);
    expect(res.type).toBe('consumed');
    expect(focusableGotKey).toBe(true);
  });

  test('modal onKey consumed path marks the modal dirty and repaints it', () => {
    const h = harness();
    let cursor = 0;
    const m = modal('live', 'cursor:0', {
      onKey: (ev) => {
        if (ev.name !== 'down') return 'passthrough' as const;
        cursor += 1;
        return 'consumed' as const;
      },
    });
    m.paint = () => `cursor:${cursor}`;
    h.c.pushModal(m);
    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:0');

    const res = h.c.routeKey({ name: 'down' } as any);
    expect(res.type).toBe('consumed');
    expect(h.scheduled.length).toBeGreaterThan(0);

    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:1');
  });

  test('modal onKey action path also repaints the modal', async () => {
    const h = harness();
    let cursor = 0;
    const m = modal('live-action', 'cursor:0', {
      onKey: (ev) => {
        if (ev.name !== 'down') return { type: 'none' } as const;
        cursor += 1;
        return { type: 'refresh' } as const;
      },
    });
    m.paint = () => `cursor:${cursor}`;
    h.c.pushModal(m);
    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:0');

    const res = h.c.routeKey({ name: 'down' } as any);
    expect(res.type).toBe('action');
    expect(h.scheduled.length).toBeGreaterThan(0);

    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:1');
  });
  test('routeMouseToSurface consumed path marks the modal dirty and repaints it', () => {
    const h = harness();
    let cursor = 0;
    const m = modal('mouse-live', 'cursor:0', {
      onMouse: (ev) => {
        if (ev.type !== 'click') return { type: 'none' } as const;
        cursor += 1;
        return { type: 'refresh' } as const;
      },
    });
    m.paint = () => `cursor:${cursor}`;
    h.c.pushModal(m);
    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:0');

    const consumed = h.c.routeMouseToSurface(m, { type: 'click', row: 1, col: 1 } as any);
    expect(consumed).toBe(true);
    expect(h.scheduled.length).toBeGreaterThan(0);

    h.flush();
    expect(h.overlays.at(-1)).toContain('cursor:1');
  });
});
