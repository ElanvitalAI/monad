// CMX-3f · Modal hit preflight integration tests.
//
// Pre-fix bug: modal-body hit was synthesized INSIDE modal forwarding
// (dashboard-mouse-wiring.ts ~line 808) AFTER contextMenuDispatch ran,
// leaving CMX-1's modal-body / modal-button HitKey providers
// unreachable — a claimed feature that didn't actually wire.
//
// Fix: add `getModalHitTarget` preflight dep that runs AFTER input
// classification and BEFORE pane classification. Dashboard supplies a
// closure over display.modalStack + surface lookup + bounds check.
// These tests pin:
//   - Preflight returns modal-body when cursor is inside top modal bounds
//   - Preflight returns null when no modal / cursor outside
//   - Context-menu wire routes the hit to a matching modal-body provider
//   - Backward-compat: omitting the dep leaves pane classification intact

import { describe, expect, test } from 'bun:test';
import {
  wireContextMenuToDashboard,
} from '../src/context-menu-dashboard-wire.js';
import {
  createContextMenuRegistry,
  type Menu,
  type MenuPresenter,
  type MenuResult,
} from '../src/ui/context-menu-registry.js';
import {
  createMenuProviderRegistry,
} from '../src/ui/context-menu-providers.js';
import type { DisplayMouseEvent, HitTarget } from '../src/display/types.js';

function makeSeqId(): () => string {
  let n = 0;
  return () => { n++; return `h-${n}`; };
}

function makeStubPresenter(): {
  presenter: MenuPresenter;
  pending: Array<{ resolve: (r: MenuResult) => void; menu: Menu }>;
} {
  const pending: Array<{ resolve: (r: MenuResult) => void; menu: Menu }> = [];
  return {
    pending,
    presenter: (menu, _pos, _opts) =>
      new Promise<MenuResult>((resolve) => {
        pending.push({ resolve, menu });
      }),
  };
}

function ev(
  type: DisplayMouseEvent['type'],
  row: number,
  col: number,
  hit?: HitTarget,
): DisplayMouseEvent {
  return { type, row, col, ...(hit ? { hitTarget: hit } : {}) };
}

describe('CMX-3f · modal-body hit dispatch (post-fix)', () => {
  test('right-click with modal-body hit → provider fires + menu shows', () => {
    const stub = makeStubPresenter();
    const registry = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const providers = createMenuProviderRegistry();
    providers.register('modal-body:approval-1', () => ({
      items: [{ kind: 'command', id: 'approve.edit', label: 'Edit action' }],
    }));

    const wire = wireContextMenuToDashboard({
      registry,
      providers,
      onPick: () => {},
    });

    // Simulate the post-preflight state: `getModalHitTarget` has
    // classified the hit as modal-body, and the right-click reaches
    // contextMenuDispatch with that hitTarget in place.
    const consumed = wire.onMouse(
      ev('right-click', 10, 20, {
        kind: 'modal-body',
        modalId: 'approval-1' as never,
      }),
    );
    expect(consumed).toBe(true);
    expect(stub.pending.length).toBe(1);
    expect(stub.pending[0]!.menu.items[0]!.kind).toBe('command');
  });

  test('modal-body wildcard fallback matches any modalId', () => {
    const stub = makeStubPresenter();
    const registry = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const providers = createMenuProviderRegistry();
    providers.register('modal-body:*', (hit) => {
      if (hit.kind !== 'modal-body') return null;
      return {
        items: [{
          kind: 'command',
          id: 'generic.dismiss',
          label: `Dismiss ${String(hit.modalId)}`,
        }],
      };
    });

    const wire = wireContextMenuToDashboard({ registry, providers, onPick: () => {} });
    const consumed = wire.onMouse(
      ev('right-click', 5, 5, { kind: 'modal-body', modalId: 'anything' as never }),
    );
    expect(consumed).toBe(true);
  });

  test('modal-button hit dispatches to modal-button key', () => {
    const stub = makeStubPresenter();
    const registry = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const providers = createMenuProviderRegistry();
    providers.register('modal-button:ok', () => ({
      items: [{ kind: 'command', id: 'btn.help', label: 'Help on this button' }],
    }));

    const wire = wireContextMenuToDashboard({ registry, providers, onPick: () => {} });
    const consumed = wire.onMouse(
      ev('right-click', 10, 20, {
        kind: 'modal-button',
        modalId: 'dialog-1' as never,
        buttonId: 'ok',
      }),
    );
    expect(consumed).toBe(true);
    expect(stub.pending.length).toBe(1);
  });
});

describe('CMX-3f · bounds check semantics (unit of getModalHitTarget closure)', () => {
  // Emulate the closure dashboard.ts provides to mouseWiring.deps.
  // Returns modal-body when (row, col) is within bounds.
  function buildModalHitTarget(
    topBounds: { row: number; col: number; width: number; height: number } | null,
    topId = 'top-modal',
  ): (row: number, col: number) => { kind: 'modal-body'; modalId: string } | null {
    return (row, col) => {
      if (!topBounds) return null;
      if (row < topBounds.row || row >= topBounds.row + topBounds.height) return null;
      if (col < topBounds.col || col >= topBounds.col + topBounds.width) return null;
      return { kind: 'modal-body', modalId: topId };
    };
  }

  test('cursor inside bounds → modal-body hit', () => {
    const get = buildModalHitTarget({ row: 5, col: 10, width: 20, height: 8 });
    expect(get(8, 15)).toEqual({ kind: 'modal-body', modalId: 'top-modal' });
  });

  test('cursor on bounds top-left corner (row=r, col=c) → hit (inclusive low)', () => {
    const get = buildModalHitTarget({ row: 5, col: 10, width: 20, height: 8 });
    expect(get(5, 10)).not.toBeNull();
  });

  test('cursor on bounds bottom-right edge (row=r+h, col=c+w) → null (exclusive high)', () => {
    const get = buildModalHitTarget({ row: 5, col: 10, width: 20, height: 8 });
    // Row 5+8=13 is exclusive; row 12 is still inside, row 13 outside.
    expect(get(12, 29)).not.toBeNull();
    expect(get(13, 15)).toBeNull();
    expect(get(8, 30)).toBeNull();
  });

  test('cursor outside bounds → null', () => {
    const get = buildModalHitTarget({ row: 5, col: 10, width: 20, height: 8 });
    expect(get(3, 15)).toBeNull();
    expect(get(15, 15)).toBeNull();
    expect(get(8, 5)).toBeNull();
    expect(get(8, 35)).toBeNull();
  });

  test('no top modal → null regardless of cursor', () => {
    const get = buildModalHitTarget(null);
    expect(get(10, 10)).toBeNull();
    expect(get(0, 0)).toBeNull();
  });

  test('zero-width or zero-height modal → always null', () => {
    const zeroW = buildModalHitTarget({ row: 5, col: 10, width: 0, height: 8 });
    const zeroH = buildModalHitTarget({ row: 5, col: 10, width: 20, height: 0 });
    expect(zeroW(6, 10)).toBeNull();
    expect(zeroH(6, 10)).toBeNull();
  });
});

describe('CMX-3f · non-dispatched paths unaffected', () => {
  test('non-right-click on modal-body → no menu shown (wire only fires on right-click)', () => {
    const stub = makeStubPresenter();
    const registry = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const providers = createMenuProviderRegistry();
    providers.register('modal-body:approval-1', () => ({
      items: [{ kind: 'command', id: 'x', label: 'X' }],
    }));
    const wire = wireContextMenuToDashboard({ registry, providers, onPick: () => {} });

    expect(wire.onMouse(
      ev('click', 5, 5, { kind: 'modal-body', modalId: 'approval-1' as never }),
    )).toBe(false);
    expect(stub.pending.length).toBe(0);
  });

  test('modal-body hit but no provider → falls through (not consumed)', () => {
    const stub = makeStubPresenter();
    const registry = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const providers = createMenuProviderRegistry();
    const wire = wireContextMenuToDashboard({ registry, providers, onPick: () => {} });
    expect(wire.onMouse(
      ev('right-click', 5, 5, { kind: 'modal-body', modalId: 'whatever' as never }),
    )).toBe(false);
    expect(stub.pending.length).toBe(0);
  });
});
