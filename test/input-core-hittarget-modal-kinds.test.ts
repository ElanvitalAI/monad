// ── Option α.2 · HitTarget modal-body / modal-button input-core mirror ──
//
// Prior to α.2 `translateHitTarget` downgraded `modal-body` and
// `modal-button` to `{kind:'unknown'}` with a `downgradeReason`.
// Matcher grammar collapsed to `click:unknown` · binding tables
// could not scope to a specific modal. α.2 restored exact
// translation + extended the input-core HitTarget union (11 kinds).
//
// Pins the new grammar + publisher behaviour + stale-leak across
// modal → non-modal transitions. Mirrors the test shape of
// `test/event-matcher-input-kind.test.ts` (DS-3a preflight).

import { describe, expect, test } from 'bun:test';
import {
  toMatcher,
  matcherCascade,
  keyEvent as _keyEvent,
  type MouseInputEvent,
  type HitTarget as InputCoreHitTarget,
} from '../src/input-core/event.js';
import {
  translateHitTarget,
  buildMouseInputEventFromDisplay,
} from '../src/input-core/mouse-bridge.js';
import {
  publishMouseTargetToContextKeys,
  createContextKeyService,
} from '../src/input-core/index.js';
import type { DisplayMouseEvent, HitTarget as DisplayHitTarget, SurfaceId } from '../src/display/types.js';

// ── Fixtures ──────────────────────────────────────────────

const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

function mouseEv(
  type: MouseInputEvent['type'],
  target: InputCoreHitTarget,
  modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
): MouseInputEvent {
  return {
    kind: 'mouse',
    type,
    row: 10,
    col: 5,
    target,
    ...(modifiers.shift ? { shift: true } : {}),
    ...(modifiers.ctrl ? { ctrl: true } : {}),
    ...(modifiers.alt ? { alt: true } : {}),
  };
}

// ── §1 translate exact (modal-body / modal-button) ───────

describe('translateHitTarget · modal-body exact translate (α.2)', () => {
  test('modal-body · basic modalId round-trip', () => {
    const src: DisplayHitTarget = { kind: 'modal-body', modalId: 'dlg-1' as SurfaceId };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-body', modalId: 'dlg-1' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });

  test('modal-body · SurfaceId brand (string cast at boundary)', () => {
    const src: DisplayHitTarget = {
      kind: 'modal-body',
      modalId: 'surface::dialog::ok-confirm' as SurfaceId,
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-body', modalId: 'surface::dialog::ok-confirm' });
    expect(r.exact).toBe(true);
  });

  test('modal-body with itemIndex extra field · only modalId survives', () => {
    const src = {
      kind: 'modal-body',
      modalId: 'dlg-2' as SurfaceId,
      itemIndex: 3,
    } as DisplayHitTarget;
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-body', modalId: 'dlg-2' });
    expect(r.exact).toBe(true);
  });

  test('modal-button · modalId + buttonId round-trip', () => {
    const src: DisplayHitTarget = {
      kind: 'modal-button',
      modalId: 'dlg-1' as SurfaceId,
      buttonId: 'ok',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-button', modalId: 'dlg-1', buttonId: 'ok' });
    expect(r.exact).toBe(true);
    expect(r.downgradeReason).toBeUndefined();
  });

  test('modal-button · empty buttonId preserved · no crash', () => {
    const src: DisplayHitTarget = {
      kind: 'modal-button',
      modalId: 'dlg-err' as SurfaceId,
      buttonId: '',
    };
    const r = translateHitTarget(src);
    expect(r.target).toEqual({ kind: 'modal-button', modalId: 'dlg-err', buttonId: '' });
    expect(r.exact).toBe(true);
  });
});

// ── §2 buildMouseInputEventFromDisplay · envelope ────────

describe('buildMouseInputEventFromDisplay · modal kinds (α.2)', () => {
  test('modal-body · MouseInputEvent target mirrored · row/col/modifiers intact', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({
        type: 'click',
        row: 15,
        col: 42,
        hitTarget: { kind: 'modal-body', modalId: 'dlg-42' as SurfaceId },
      }),
      { ctrl: true, shift: true },
    );
    expect(ev.target).toEqual({ kind: 'modal-body', modalId: 'dlg-42' });
    expect(ev.row).toBe(15);
    expect(ev.col).toBe(42);
    expect(ev.ctrl).toBe(true);
    expect(ev.shift).toBe(true);
  });

  test('modal-button · right-click target mirrored', () => {
    const ev = buildMouseInputEventFromDisplay(
      dsp({
        type: 'right-click',
        hitTarget: { kind: 'modal-button', modalId: 'dlg-1' as SurfaceId, buttonId: 'cancel' },
      }),
    );
    expect(ev.type).toBe('right-click');
    expect(ev.target).toEqual({ kind: 'modal-button', modalId: 'dlg-1', buttonId: 'cancel' });
  });
});

// ── §3 Matcher grammar (cascade · α.2 new specificity) ───

describe('toMatcher · modal kinds (α.2)', () => {
  test('click:modal-body.<modalId>', () => {
    const ev = mouseEv('click', { kind: 'modal-body', modalId: 'dlg-1' });
    expect(toMatcher(ev)).toBe('click:modal-body.dlg-1');
  });

  test('click:modal-button.<modalId>:<buttonId>', () => {
    const ev = mouseEv('click', {
      kind: 'modal-button', modalId: 'dlg-1', buttonId: 'ok',
    });
    expect(toMatcher(ev)).toBe('click:modal-button.dlg-1:ok');
  });

  test('modifiers decorate modal matchers', () => {
    const ev = mouseEv(
      'right-click',
      { kind: 'modal-button', modalId: 'dlg-1', buttonId: 'approve' },
      { ctrl: true, shift: true },
    );
    expect(toMatcher(ev)).toBe('ctrl+shift+right-click:modal-button.dlg-1:approve');
  });
});

describe('matcherCascade · modal kinds (α.2)', () => {
  test('modal-body cascades to generic kind', () => {
    const ev = mouseEv('click', { kind: 'modal-body', modalId: 'dlg-1' });
    expect(matcherCascade(ev)).toEqual(['click:modal-body.dlg-1', 'click:modal-body']);
  });

  test('modal-button cascades to generic kind', () => {
    const ev = mouseEv('click', {
      kind: 'modal-button', modalId: 'dlg-1', buttonId: 'ok',
    });
    expect(matcherCascade(ev)).toEqual(['click:modal-button.dlg-1:ok', 'click:modal-button']);
  });

  test('generic `click:modal-body` matches regardless of modalId (declarative binding)', () => {
    const a = matcherCascade(mouseEv('click', { kind: 'modal-body', modalId: 'dlg-1' }));
    const b = matcherCascade(mouseEv('click', { kind: 'modal-body', modalId: 'dlg-other' }));
    expect(a[1]).toBe('click:modal-body');
    expect(b[1]).toBe('click:modal-body');
  });
});

// ── §4 Publisher · hitTargetKind projects modal kinds ────

describe('publishMouseTargetToContextKeys · modal kinds (α.2)', () => {
  test('modal-body → hitTargetKind=modal-body · pane/widget/input stay null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'modal-body', modalId: 'dlg-1' as SurfaceId },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('modal-body');
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });

  test('modal-button → hitTargetKind=modal-button', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'modal-button', modalId: 'dlg-1' as SurfaceId, buttonId: 'ok' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('modal-button');
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });

  test('modal-body → pill · transition without stale inputId/paneId leak', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'modal-body', modalId: 'dlg-1' as SurfaceId },
      })),
      cks,
    );
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pill', name: 'model' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetKind).toBe('pill');
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });
});

// ── §5 Exhaustive switch (targetDetail · compile-time pin) ─

describe('targetDetail · exhaustive switch (α.2)', () => {
  test('modal-body produces modalId detail for matcher', () => {
    const ev = mouseEv('click', { kind: 'modal-body', modalId: 'dlg-α' });
    // toMatcher delegates to targetDetail — verify detail value
    // indirectly via matcher substring.
    expect(toMatcher(ev)).toContain('.dlg-α');
  });

  test('modal-button detail joins modalId:buttonId', () => {
    const ev = mouseEv('click', {
      kind: 'modal-button', modalId: 'dlg-α', buttonId: 'accept',
    });
    expect(toMatcher(ev)).toContain('.dlg-α:accept');
  });
});
