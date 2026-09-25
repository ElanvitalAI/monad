// IDX-2b — modal-adapter context-key lifecycle integration.
//
// Verifies the VSCode SuggestWidget pattern:
//   modal visible ⟺ contextKey.get() === true
//
// Tests cover: tier → key mapping, atomic on mount, atomic on dispose
// (via both handle.dispose and surface.dispose), modalTopTier behavior,
// backward compat when spec.tier is omitted.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  interactionClassForModalTier,
  mountViewAsModalSurface,
  MODAL_TIER_CONTEXT_KEY,
  type ModalTierTag,
} from '../src/ui/modal-adapter.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';
import { __resetDashboardContextKeysForTests } from '../src/dashboard/context/keys.js';

function makeView(): SelectView<string> {
  return new SelectView<string>({
    options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    onSubmit: () => {},
  });
}

beforeEach(() => { __resetDashboardContextKeysForTests(); });
afterEach(() => { __resetDashboardContextKeysForTests(); });

describe('MODAL_TIER_CONTEXT_KEY mapping', () => {
  test('expected tiers map to expected keys', () => {
    // IDX-F4 — collapsed onto canonical 8-tier ModalTier (was the
    // pre-F4 IDX-2b 8-value union with picker/popup/vw-picker/
    // dialog/approval/terminal/plan-exit/system-alert).
    expect(MODAL_TIER_CONTEXT_KEY.picker).toBe('pickerOpen');
    expect(MODAL_TIER_CONTEXT_KEY.popup).toBe('popupOpen');
    expect(MODAL_TIER_CONTEXT_KEY.vw).toBe('popupOpen');
    expect(MODAL_TIER_CONTEXT_KEY.dialog).toBe('dialogOpen');
    expect(MODAL_TIER_CONTEXT_KEY.terminal).toBe('terminalModalActive');
    expect(MODAL_TIER_CONTEXT_KEY.menu).toBe('popupOpen');
    expect(MODAL_TIER_CONTEXT_KEY.execution).toBeNull();
    expect(MODAL_TIER_CONTEXT_KEY.tooltip).toBeNull();
  });
});

describe('interactionClassForModalTier mapping', () => {
  test('vw tier maps to workspace', () => {
    expect(interactionClassForModalTier('vw')).toBe('workspace');
  });

  test('execution and tooltip tiers map to embedded-overlay', () => {
    expect(interactionClassForModalTier('execution')).toBe('embedded-overlay');
    expect(interactionClassForModalTier('tooltip')).toBe('embedded-overlay');
  });

  test('dialog/popup/menu/picker/terminal tiers map to blocking-modal', () => {
    expect(interactionClassForModalTier('dialog')).toBe('blocking-modal');
    expect(interactionClassForModalTier('popup')).toBe('blocking-modal');
    expect(interactionClassForModalTier('menu')).toBe('blocking-modal');
    expect(interactionClassForModalTier('picker')).toBe('blocking-modal');
    expect(interactionClassForModalTier('terminal')).toBe('blocking-modal');
  });
});

describe('mountViewAsModalSurface — context key lifecycle', () => {
  test('tier=picker sets pickerOpen=true on mount', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    expect(svc.keys.pickerOpen).toBe(true);
    expect(svc.keys.modalTopTier).toBe('picker');
    expect(h.surface.interactionClass).toBe('blocking-modal');
  });

  test('tier=popup sets popupOpen=true on mount', () => {
    const svc = createContextKeyService();
    mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      contextKeyService: svc,
    });
    expect(svc.keys.popupOpen).toBe(true);
    expect(svc.keys.pickerOpen).toBe(false);   // picker flag untouched
    expect(svc.keys.modalTopTier).toBe('popup');
  });

  test('tier=terminal sets terminalModalActive=true on mount', () => {
    const svc = createContextKeyService();
    mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'terminal',
      contextKeyService: svc,
    });
    expect(svc.keys.terminalModalActive).toBe(true);
    expect(svc.keys.modalTopTier).toBe('terminal');
  });

  test('handle.dispose clears the flag + modalTopTier', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    expect(svc.keys.pickerOpen).toBe(true);
    h.dispose();
    expect(svc.keys.pickerOpen).toBe(false);
    expect(svc.keys.modalTopTier).toBeNull();
  });

  test('surface.dispose clears the flag (coordinator path)', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    expect(svc.keys.pickerOpen).toBe(true);
    h.surface.dispose?.();
    expect(svc.keys.pickerOpen).toBe(false);
  });

  test('double dispose is idempotent', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    h.dispose();
    h.dispose();   // should not throw or re-fire
    expect(svc.keys.pickerOpen).toBe(false);
  });

  test('stacked tiers — second mount updates modalTopTier to itself', () => {
    const svc = createContextKeyService();
    mountViewAsModalSurface({
      id: 'picker1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    expect(svc.keys.modalTopTier).toBe('picker');
    mountViewAsModalSurface({
      id: 'popup1',
      bounds: { row: 2, col: 2, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      contextKeyService: svc,
    });
    expect(svc.keys.modalTopTier).toBe('popup');
    expect(svc.keys.pickerOpen).toBe(true);
    expect(svc.keys.popupOpen).toBe(true);
  });

  test('stacked tiers — disposing the TOP modal restores the previous tier flag but clears modalTopTier only when it was the top', () => {
    const svc = createContextKeyService();
    const pickerHandle = mountViewAsModalSurface({
      id: 'picker1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    const popupHandle = mountViewAsModalSurface({
      id: 'popup1',
      bounds: { row: 2, col: 2, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      contextKeyService: svc,
    });
    // popup is currently top
    expect(svc.keys.modalTopTier).toBe('popup');

    // Dismiss popup (the current top) — modalTopTier resets to null
    // in this simple IDX-2b model. Proper restore-to-previous-tier
    // is IDX-2c with stack-tracking.
    popupHandle.dispose();
    expect(svc.keys.popupOpen).toBe(false);
    expect(svc.keys.modalTopTier).toBeNull();
    // picker still tracked as open
    expect(svc.keys.pickerOpen).toBe(true);

    // Now dismiss picker while modalTopTier is already null — picker
    // flag clears; modalTopTier stays null.
    pickerHandle.dispose();
    expect(svc.keys.pickerOpen).toBe(false);
    expect(svc.keys.modalTopTier).toBeNull();
  });

  test('tier omitted → no context key side effects (backward compat)', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      contextKeyService: svc,
      // tier omitted
    });
    expect(svc.keys.pickerOpen).toBe(false);
    expect(svc.keys.popupOpen).toBe(false);
    expect(svc.keys.modalTopTier).toBeNull();
    h.dispose();
    // still no effect
    expect(svc.keys.pickerOpen).toBe(false);
  });

  test('tier=system-alert is a no-op on mapping (key is null)', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'system-alert',
      contextKeyService: svc,
    });
    // No tier flag is tracked yet for system-alert (IDX-2c introduces
    // systemAlertActive). modalTopTier also stays null because the
    // mapping resolves to null.
    expect(svc.keys.pickerOpen).toBe(false);
    expect(svc.keys.popupOpen).toBe(false);
    expect(svc.keys.dialogOpen).toBe(false);
    expect(svc.keys.terminalModalActive).toBe(false);
    h.dispose();
  });

  test('dashboard singleton used when contextKeyService omitted', async () => {
    const { getDashboardContextKeyService } = await import('../src/dashboard/context/keys.js');
    const svc = getDashboardContextKeyService();
    expect(svc.keys.pickerOpen).toBe(false);

    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      // no contextKeyService — falls back to dashboard singleton
    });
    expect(svc.keys.pickerOpen).toBe(true);
    h.dispose();
    expect(svc.keys.pickerOpen).toBe(false);
  });

  test('paint() still works after context-key side effects', () => {
    const svc = createContextKeyService();
    const h = mountViewAsModalSurface({
      id: 'm1',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'picker',
      contextKeyService: svc,
    });
    const out = h.surface.paint();
    expect(out.length).toBeGreaterThan(0);
  });

  test('all tiers tested at least once', () => {
    // Sanity — make sure MODAL_TIER_CONTEXT_KEY covers every
    // canonical ModalTier and vice versa.
    const tiers: ModalTierTag[] = [
      'picker', 'popup', 'vw', 'dialog',
      'terminal', 'menu', 'execution', 'tooltip',
    ];
    for (const t of tiers) {
      expect(t in MODAL_TIER_CONTEXT_KEY).toBe(true);
    }
    expect(Object.keys(MODAL_TIER_CONTEXT_KEY).sort()).toEqual(tiers.slice().sort());
  });
});
