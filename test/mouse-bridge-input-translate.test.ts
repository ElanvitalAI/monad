// DS-3a preflight · display → input-core HitTarget translation
// for the `{kind:'input', inputId}` variant
// (PLAN-hittarget-input-kind-extension.md §3.3).
//
// Unlike `modal-body` / `modal-button` which downgrade to 'unknown'
// because input-core has no modal peer (DS-2a §9 separate gap),
// `input` is an EXACT translation: both display and input-core
// unions carry identical {kind, inputId} shape.

import { describe, expect, test } from 'bun:test';
import {
  translateHitTarget,
  buildMouseInputEventFromDisplay,
} from '../src/input-core/mouse-bridge.js';
import type { DisplayMouseEvent, HitTarget as DisplayHitTarget } from '../src/display/types.js';

describe('translateHitTarget · input kind', () => {
  test('display input → input-core input · exact · no downgradeReason', () => {
    const src: DisplayHitTarget = { kind: 'input', inputId: 'chat-main' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'input', inputId: 'chat-main' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });

  test('custom inputId round-trips verbatim', () => {
    const src: DisplayHitTarget = { kind: 'input', inputId: 'search-bar' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'input', inputId: 'search-bar' });
    expect(r.exact).toBe(true);
  });

  test('empty inputId does not crash · passes through', () => {
    const src: DisplayHitTarget = { kind: 'input', inputId: '' };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'input', inputId: '' });
    expect(r.exact).toBe(true);
  });
});

describe('buildMouseInputEventFromDisplay · input kind', () => {
  test('constructs MouseInputEvent with exact input target', () => {
    const display: DisplayMouseEvent = {
      type: 'drag',
      row: 30,
      col: 12,
      hitTarget: { kind: 'input', inputId: 'chat-main' },
    };
    const ev = buildMouseInputEventFromDisplay(display);
    expect(ev.kind).toBe('mouse');
    expect(ev.type).toBe('drag');
    expect(ev.row).toBe(30);
    expect(ev.col).toBe(12);
    expect(ev.target).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('modifier opts propagate alongside input target', () => {
    const display: DisplayMouseEvent = {
      type: 'click',
      row: 30,
      col: 12,
      hitTarget: { kind: 'input', inputId: 'chat-main' },
    };
    const ev = buildMouseInputEventFromDisplay(display, { shift: true, ctrl: true });
    expect(ev.shift).toBe(true);
    expect(ev.ctrl).toBe(true);
    expect(ev.target).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('release on input translates cleanly (drag-session DS-2a wire path)', () => {
    const display: DisplayMouseEvent = {
      type: 'release',
      row: 30,
      col: 12,
      hitTarget: { kind: 'input', inputId: 'chat-main' },
    };
    const ev = buildMouseInputEventFromDisplay(display);
    expect(ev.type).toBe('release');
    expect(ev.target).toEqual({ kind: 'input', inputId: 'chat-main' });
  });
});

describe('backward compat · other kinds unaffected', () => {
  test('pane-body still exact translates', () => {
    const r = translateHitTarget({ kind: 'pane-body', paneId: 'browser' });
    expect(r.target).toEqual({ kind: 'pane-body', paneId: 'browser' });
    expect(r.exact).toBe(true);
  });

  test('modal-body · exact translate (α.2 closed DS-2a §9 gap)', () => {
    const r = translateHitTarget({
      kind: 'modal-body',
      modalId: 'modal::test' as never,  // SurfaceId brand not needed for assertion
    });
    expect(r.target).toEqual({ kind: 'modal-body', modalId: 'modal::test' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });

  test('undefined input → unknown (legacy behavior)', () => {
    const r = translateHitTarget(undefined);
    expect(r.target).toEqual({ kind: 'unknown' });
    expect(r.exact).toBe(false);
  });
});
