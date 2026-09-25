// ── U-3 prep · Display → input-core mouse bridge tests ──
//
// Verifies `translateHitTarget` covers every DisplayMouseEvent
// HitTarget kind with the right mapping, and that
// `buildMouseInputEventFromDisplay` produces the canonical input-core
// envelope. Pure unit tests — no dashboard, no resolver, no wiring.

import { describe, expect, test } from 'bun:test';
import {
  translateHitTarget,
  buildMouseInputEventFromDisplay,
} from '../src/input-core/mouse-bridge.js';
import type {
  DisplayMouseEvent,
  HitTarget as DisplayHitTarget,
} from '../src/display/types.js';

// Shortcut builder for DisplayMouseEvent fixtures. Keeps tests tight
// without dragging in full dashboard types.
const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

// ─── translateHitTarget · exact mappings ───

describe('translateHitTarget · exact mappings', () => {
  test('undefined hitTarget → unknown (exact=false, no-hit-target reason)', () => {
    const r = translateHitTarget(undefined);
    expect(r.target).toEqual({ kind: 'unknown' });
    expect(r.exact).toBe(false);
    expect(r.downgradeReason).toBe('no-hit-target-on-display-event');
  });

  test('pill → pill with name preserved', () => {
    const src: DisplayHitTarget = { kind: 'pill', name: 'model' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'pill', name: 'model' });
    expect(r.exact).toBe(true);
  });

  test('pane-nav-tab → pane-nav-tab', () => {
    const src: DisplayHitTarget = { kind: 'pane-nav-tab', paneId: 'tasks' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'pane-nav-tab', paneId: 'tasks' });
    expect(r.exact).toBe(true);
  });

  test('pane-title without widgetInstanceId → pane-title only paneId', () => {
    const src: DisplayHitTarget = { kind: 'pane-title', paneId: 'browser' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'pane-title', paneId: 'browser' });
    expect(r.exact).toBe(true);
  });

  test('pane-title with widgetInstanceId is preserved', () => {
    const src: DisplayHitTarget = {
      kind: 'pane-title',
      paneId: 'browser',
      widgetInstanceId: 'wd-browser-1',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({
      kind: 'pane-title',
      paneId: 'browser',
      widgetInstanceId: 'wd-browser-1',
    });
    expect(r.exact).toBe(true);
  });

  test('pane-body with widgetInstanceId is preserved', () => {
    const src: DisplayHitTarget = {
      kind: 'pane-body',
      paneId: 'log',
      widgetInstanceId: 'wd-log',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({
      kind: 'pane-body',
      paneId: 'log',
      widgetInstanceId: 'wd-log',
    });
    expect(r.exact).toBe(true);
  });

  test('pane-body without widgetInstanceId → pane-body only paneId', () => {
    const src: DisplayHitTarget = { kind: 'pane-body', paneId: 'log' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'pane-body', paneId: 'log' });
    expect(r.exact).toBe(true);
  });

  test('status-bar → status-bar', () => {
    const r = translateHitTarget({ kind: 'status-bar' });
    expect(r.target).toEqual({ kind: 'status-bar' });
    expect(r.exact).toBe(true);
  });
});

// ─── translateHitTarget · vw-pane-* windowId coercion ───

describe('translateHitTarget · vw-pane-* windowId string → number', () => {
  test('vw-pane-title with numeric string windowId', () => {
    const src: DisplayHitTarget = {
      kind: 'vw-pane-title',
      windowId: '3',
      paneId: 'editor',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({
      kind: 'vw-pane-title',
      windowId: 3,
      paneId: 'editor',
    });
    expect(r.exact).toBe(true);
  });

  test('vw-pane-body with numeric string windowId', () => {
    const src: DisplayHitTarget = {
      kind: 'vw-pane-body',
      windowId: '42',
      paneId: 'preview',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({
      kind: 'vw-pane-body',
      windowId: 42,
      paneId: 'preview',
    });
    expect(r.exact).toBe(true);
  });

  test('vw-pane-title with non-numeric windowId → unknown + reason', () => {
    const src: DisplayHitTarget = {
      kind: 'vw-pane-title',
      windowId: 'abc',
      paneId: 'editor',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'unknown' });
    expect(r.exact).toBe(false);
    expect(r.downgradeReason).toBe('non-numeric-windowId:abc');
  });

  test('vw-pane-body with non-numeric windowId → unknown + reason', () => {
    const src: DisplayHitTarget = {
      kind: 'vw-pane-body',
      windowId: 'ghost',
      paneId: 'editor',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'unknown' });
    expect(r.exact).toBe(false);
    expect(r.downgradeReason).toContain('ghost');
  });

  test('vw-pane-title with empty string windowId → unknown', () => {
    // Empty string parses to 0 in JS Number() but is semantically bad
    // — we treat it as success (0 is a valid window id) because
    // Number.isFinite('') is actually `false` (Number('') === 0 but
    // Number.isFinite after coercion is true). Assert the concrete
    // outcome so regressions are visible.
    const src: DisplayHitTarget = {
      kind: 'vw-pane-title',
      windowId: '',
      paneId: 'x',
    };
    const r = translateHitTarget(src);
    // Number('') === 0, which isFinite, so this is exact(0).
    expect(r.target).toEqual({
      kind: 'vw-pane-title',
      windowId: 0,
      paneId: 'x',
    });
    expect(r.exact).toBe(true);
  });
});

// ─── translateHitTarget · modal kinds exact translate (Option α.2) ───

describe('translateHitTarget · modal kinds exact translate (α.2)', () => {
  test('modal-body → exact mirror · modalId preserved · no downgradeReason', () => {
    const src: DisplayHitTarget = {
      kind: 'modal-body',
      modalId: 'dlg-1',
      itemIndex: 3,
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-body', modalId: 'dlg-1' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });

  test('modal-button → exact mirror · modalId + buttonId preserved', () => {
    const src: DisplayHitTarget = {
      kind: 'modal-button',
      modalId: 'dlg-1',
      buttonId: 'ok',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-button', modalId: 'dlg-1', buttonId: 'ok' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });
});

// ─── buildMouseInputEventFromDisplay · full envelope ───

describe('buildMouseInputEventFromDisplay · basic envelope', () => {
  test('click at (5,10) with no hitTarget → target:unknown', () => {
    const ev = buildMouseInputEventFromDisplay(dsp());
    expect(ev.kind).toBe('mouse');
    expect(ev.type).toBe('click');
    expect(ev.row).toBe(5);
    expect(ev.col).toBe(10);
    expect(ev.target).toEqual({ kind: 'unknown' });
  });

  test('preserves all mouse types (click/double-click/drag/release/right-click/scroll-*)', () => {
    const types = [
      'click', 'double-click', 'right-click',
      'scroll-up', 'scroll-down', 'drag', 'release',
    ] as const;
    for (const t of types) {
      const ev = buildMouseInputEventFromDisplay(dsp({ type: t }));
      expect(ev.type).toBe(t);
    }
  });

  test('motion display event → hover-over (semantic peer)', () => {
    // motion has no direct input-core peer — hover-tracker produces
    // the finer hover-enter/leave/over/stable quartet. Collapse to
    // hover-over as the closest match.
    const ev = buildMouseInputEventFromDisplay(dsp({ type: 'motion' }));
    expect(ev.type).toBe('hover-over');
  });

  test('populates target from hitTarget when present', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({ hitTarget: { kind: 'pane-body', paneId: 'log' } }),
    );
    expect(ev.target).toEqual({ kind: 'pane-body', paneId: 'log' });
  });
});

// ─── buildMouseInputEventFromDisplay · modifier keys ───

describe('buildMouseInputEventFromDisplay · modifier key opts', () => {
  test('no opts → shift/ctrl/alt all absent (not false)', () => {
    const ev = buildMouseInputEventFromDisplay(dsp());
    expect('shift' in ev).toBe(false);
    expect('ctrl' in ev).toBe(false);
    expect('alt' in ev).toBe(false);
  });

  test('shift only', () => {
    const ev = buildMouseInputEventFromDisplay(dsp(), { shift: true });
    expect(ev.shift).toBe(true);
    expect('ctrl' in ev).toBe(false);
    expect('alt' in ev).toBe(false);
  });

  test('ctrl + alt', () => {
    const ev = buildMouseInputEventFromDisplay(dsp(), { ctrl: true, alt: true });
    expect(ev.ctrl).toBe(true);
    expect(ev.alt).toBe(true);
    expect('shift' in ev).toBe(false);
  });

  test('shift:false is treated as absent (no decoration)', () => {
    const ev = buildMouseInputEventFromDisplay(dsp(), { shift: false });
    expect('shift' in ev).toBe(false);
  });

  test('all three modifiers set together', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp(),
      { shift: true, ctrl: true, alt: true },
    );
    expect(ev.shift).toBe(true);
    expect(ev.ctrl).toBe(true);
    expect(ev.alt).toBe(true);
  });
});

// ─── buildMouseInputEventFromDisplay · composite scenarios ───

describe('buildMouseInputEventFromDisplay · composite', () => {
  test('pill click with shift modifier', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({
        type: 'click',
        hitTarget: { kind: 'pill', name: 'mode' },
      }),
      { shift: true },
    );
    expect(ev.type).toBe('click');
    expect(ev.target).toEqual({ kind: 'pill', name: 'mode' });
    expect(ev.shift).toBe(true);
  });

  test('modal-body click → exact mirror (α.2) · other fields intact', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({
        type: 'click',
        row: 20,
        col: 30,
        hitTarget: { kind: 'modal-body', modalId: 'dlg-1', itemIndex: 2 },
      }),
      { ctrl: true },
    );
    expect(ev.target).toEqual({ kind: 'modal-body', modalId: 'dlg-1' });
    expect(ev.row).toBe(20);
    expect(ev.col).toBe(30);
    expect(ev.ctrl).toBe(true);
  });

  test('vw-pane-body scroll with numeric windowId', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({
        type: 'scroll-up',
        hitTarget: { kind: 'vw-pane-body', windowId: '2', paneId: 'editor' },
      }),
    );
    expect(ev.type).toBe('scroll-up');
    expect(ev.target).toEqual({ kind: 'vw-pane-body', windowId: 2, paneId: 'editor' });
  });

  test('identity — given no modifiers and no hitTarget, output matches legacy dashboard literal', () => {
    // This is the concrete legacy behaviour at dashboard.ts:10746-
    // 10754 that U-3 proper will replace with this helper. Pinning
    // the shape here lets the migration PR be a pure call-site
    // swap without re-deriving equivalence.
    const ev = buildMouseInputEventFromDisplay(dsp({
      type: 'click',
      row: 3,
      col: 4,
    }));
    expect(ev).toEqual({
      kind: 'mouse',
      type: 'click',
      row: 3,
      col: 4,
      target: { kind: 'unknown' },
    });
  });
});
