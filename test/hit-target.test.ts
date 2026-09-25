import { describe, expect, test } from 'bun:test';

import type { HitTarget } from '../src/display/types.js';
import {
  applyModalIdToRefinement,
  classifyStatusBarHit,
  hitTargetLabel,
  isModalHit,
  isPaneHit,
  isPillHit,
  isVwHit,
  modalBodyHit,
  modalButtonHit,
  refineHitFromPayload,
} from '../src/display/hit-target.js';
import type { PillBound } from '../src/status/pills.js';

// IDX-F5a — the classifier is the only behavioral entry in this
// landing; the other 8 kinds become producers in F5b-c. These tests
// lock down the shape so downstream phases have a stable contract.

const pills: PillBound[] = [
  { name: 'workingDir', startCol: 0, endCol: 10 },
  { name: 'model', startCol: 12, endCol: 25 },
  { name: 'mode', startCol: 27, endCol: 32 },
];

describe('classifyStatusBarHit', () => {
  test('returns pill hit when col lands inside a pill span', () => {
    // col=3 → col0=2, inside workingDir (0..10)
    const t = classifyStatusBarHit(pills, 10, 10, 3);
    expect(t).toEqual({ kind: 'pill', name: 'workingDir' });
  });

  test('distinguishes adjacent pills by column', () => {
    const a = classifyStatusBarHit(pills, 10, 10, 13); // col0=12 → model
    const b = classifyStatusBarHit(pills, 10, 10, 28); // col0=27 → mode
    expect(a).toEqual({ kind: 'pill', name: 'model' });
    expect(b).toEqual({ kind: 'pill', name: 'mode' });
  });

  test('returns status-bar hit for status row clicks outside every pill', () => {
    // col=12 → col0=11, gap between workingDir (ends at 10) and model (starts at 12)
    const t = classifyStatusBarHit(pills, 10, 10, 12);
    expect(t).toEqual({ kind: 'status-bar' });
  });

  test('accepts statusRow - 1 tolerance (visual top edge)', () => {
    const t = classifyStatusBarHit(pills, 10, 9, 3);
    expect(t).toEqual({ kind: 'pill', name: 'workingDir' });
  });

  test('rejects rows below the status row', () => {
    const t = classifyStatusBarHit(pills, 10, 11, 3);
    expect(t).toBeNull();
  });

  test('rejects rows two or more above the status row', () => {
    const t = classifyStatusBarHit(pills, 10, 8, 3);
    expect(t).toBeNull();
  });

  test('returns null when statusRow is null (zone absent this frame)', () => {
    const t = classifyStatusBarHit(pills, null, 10, 3);
    expect(t).toBeNull();
  });

  test('returns status-bar when pill list is empty but row matches', () => {
    const t = classifyStatusBarHit([], 10, 10, 3);
    expect(t).toEqual({ kind: 'status-bar' });
  });

  test('handles the endCol exclusive boundary', () => {
    // workingDir ends at 10 (exclusive) → col=10 → col0=9 is IN pill,
    // col=11 → col0=10 is NOT in pill (gap before model).
    const in1 = classifyStatusBarHit(pills, 10, 10, 10);
    const out1 = classifyStatusBarHit(pills, 10, 10, 11);
    expect(in1).toEqual({ kind: 'pill', name: 'workingDir' });
    expect(out1).toEqual({ kind: 'status-bar' });
  });
});

describe('type guards', () => {
  const pillHit: HitTarget = { kind: 'pill', name: 'model' };
  const paneTitleHit: HitTarget = { kind: 'pane-title', paneId: 'chat' };
  const paneBodyHit: HitTarget = { kind: 'pane-body', paneId: 'preview' };
  const navHit: HitTarget = { kind: 'pane-nav-tab', paneId: 'chat' };
  const modalBody: HitTarget = { kind: 'modal-body', modalId: 'm1' };
  const modalTitle: HitTarget = { kind: 'modal-title', modalId: 'm1' };
  const modalBtn: HitTarget = { kind: 'modal-button', modalId: 'm1', buttonId: 'ok' };
  const vwTitle: HitTarget = { kind: 'vw-pane-title', windowId: 'w1', paneId: 'p1' };
  const vwBody: HitTarget = { kind: 'vw-pane-body', windowId: 'w1', paneId: 'p1' };
  const statusBar: HitTarget = { kind: 'status-bar' };

  test('isPillHit narrows to pill', () => {
    expect(isPillHit(pillHit)).toBe(true);
    expect(isPillHit(paneTitleHit)).toBe(false);
    expect(isPillHit(undefined)).toBe(false);
    expect(isPillHit(null)).toBe(false);
  });

  test('isModalHit covers body + title + button', () => {
    expect(isModalHit(modalBody)).toBe(true);
    expect(isModalHit(modalTitle)).toBe(true);
    expect(isModalHit(modalBtn)).toBe(true);
    expect(isModalHit(pillHit)).toBe(false);
    expect(isModalHit(paneBodyHit)).toBe(false);
  });

  test('isPaneHit covers nav + title + body only', () => {
    expect(isPaneHit(navHit)).toBe(true);
    expect(isPaneHit(paneTitleHit)).toBe(true);
    expect(isPaneHit(paneBodyHit)).toBe(true);
    expect(isPaneHit(vwTitle)).toBe(false);
    expect(isPaneHit(pillHit)).toBe(false);
  });

  test('isVwHit covers vw kinds only', () => {
    expect(isVwHit(vwTitle)).toBe(true);
    expect(isVwHit(vwBody)).toBe(true);
    expect(isVwHit(paneTitleHit)).toBe(false);
    expect(isVwHit(statusBar)).toBe(false);
  });
});

describe('hitTargetLabel', () => {
  test('stable kind-level label with pill name disambiguator', () => {
    expect(hitTargetLabel({ kind: 'pill', name: 'workingDir' })).toBe('pill:workingDir');
    expect(hitTargetLabel({ kind: 'pill', name: 'model' })).toBe('pill:model');
    expect(hitTargetLabel({ kind: 'pane-title', paneId: 'chat' })).toBe('pane-title');
    expect(hitTargetLabel({ kind: 'pane-body', paneId: 'preview' })).toBe('pane-body');
    expect(hitTargetLabel({ kind: 'pane-nav-tab', paneId: 'chat' })).toBe('pane-nav-tab');
    expect(hitTargetLabel({ kind: 'modal-body', modalId: 'm1' })).toBe('modal-body');
    expect(hitTargetLabel({ kind: 'modal-title', modalId: 'm1' })).toBe('modal-title');
    expect(hitTargetLabel({ kind: 'modal-button', modalId: 'm1', buttonId: 'ok' })).toBe('modal-button');
    expect(hitTargetLabel({ kind: 'vw-pane-title', windowId: 'w', paneId: 'p' })).toBe('vw-pane-title');
    expect(hitTargetLabel({ kind: 'vw-pane-body', windowId: 'w', paneId: 'p' })).toBe('vw-pane-body');
    expect(hitTargetLabel({ kind: 'status-bar' })).toBe('status-bar');
  });

  test('returns "none" for absent target', () => {
    expect(hitTargetLabel(undefined)).toBe('none');
    expect(hitTargetLabel(null)).toBe('none');
  });
});

describe('modalBodyHit / modalButtonHit constructors', () => {
  test('modalBodyHit omits itemIndex when undefined', () => {
    const t = modalBodyHit('m1');
    expect(t).toEqual({ kind: 'modal-body', modalId: 'm1' });
  });

  test('modalBodyHit carries itemIndex when supplied', () => {
    const t = modalBodyHit('m1', 3);
    expect(t).toEqual({ kind: 'modal-body', modalId: 'm1', itemIndex: 3 });
  });

  test('modalButtonHit requires buttonId', () => {
    const t = modalButtonHit('m1', 'cancel');
    expect(t).toEqual({ kind: 'modal-button', modalId: 'm1', buttonId: 'cancel' });
  });
});

// IDX-F5c — describeHit refinement reader + modalId application.
// The reader is the fallback path for widgets that register the
// conventional click payload shapes (`{kind:'row', filtIdx}` and
// `{kind:'button', buttonId}`); View.describeHit takes precedence
// when implemented.

describe('refineHitFromPayload', () => {
  test('row payload → modal-body with itemIndex', () => {
    expect(refineHitFromPayload({ kind: 'row', filtIdx: 3 }))
      .toEqual({ kind: 'modal-body', itemIndex: 3 });
  });

  test('button payload → modal-button with buttonId', () => {
    expect(refineHitFromPayload({ kind: 'button', buttonId: 'cancel' }))
      .toEqual({ kind: 'modal-button', buttonId: 'cancel' });
  });

  test('unknown payload shape returns null', () => {
    expect(refineHitFromPayload({ kind: 'other' })).toBeNull();
    expect(refineHitFromPayload({ kind: 'row' })).toBeNull(); // missing filtIdx
    expect(refineHitFromPayload({ kind: 'button' })).toBeNull(); // missing buttonId
    expect(refineHitFromPayload({ kind: 'row', filtIdx: 'bad' })).toBeNull(); // wrong type
  });

  test('null / undefined / primitive payloads return null', () => {
    expect(refineHitFromPayload(null)).toBeNull();
    expect(refineHitFromPayload(undefined)).toBeNull();
    expect(refineHitFromPayload('row')).toBeNull();
    expect(refineHitFromPayload(42)).toBeNull();
  });
});

describe('applyModalIdToRefinement', () => {
  test('merges modalId into modal-body refinement', () => {
    expect(applyModalIdToRefinement('m1', { kind: 'modal-body', itemIndex: 3 }))
      .toEqual({ kind: 'modal-body', modalId: 'm1', itemIndex: 3 });
  });

  test('modal-body without itemIndex stays without itemIndex', () => {
    expect(applyModalIdToRefinement('m1', { kind: 'modal-body' }))
      .toEqual({ kind: 'modal-body', modalId: 'm1' });
  });

  test('merges modalId into modal-button refinement', () => {
    expect(applyModalIdToRefinement('m2', { kind: 'modal-button', buttonId: 'ok' }))
      .toEqual({ kind: 'modal-button', modalId: 'm2', buttonId: 'ok' });
  });

  test('null refinement passes through as null', () => {
    expect(applyModalIdToRefinement('m1', null)).toBeNull();
  });
});
