// IDX-F4 — ModalTier const-object + TIER_ORDER + tiersCompatible
// helper. Verifies the layering invariants that the
// ELANOUS_BOUNDARY_CHECK assertion enforces in coordinator.pushModal.

import { describe, test, expect } from 'bun:test';
import {
  MODAL_TIER,
  TIER_ORDER,
  tierRank,
  tiersCompatible,
  type ModalTier,
} from '../src/display/types.js';

describe('MODAL_TIER const-object', () => {
  test('exposes the canonical 8 tiers', () => {
    expect(Object.keys(MODAL_TIER).sort()).toEqual([
      'dialog', 'execution', 'menu', 'picker',
      'popup', 'terminal', 'tooltip', 'vw',
    ]);
  });

  test('every value matches its key (const-object idiom)', () => {
    for (const [key, value] of Object.entries(MODAL_TIER)) {
      expect(value).toBe(key);
    }
  });
});

describe('TIER_ORDER', () => {
  test('contains every ModalTier exactly once', () => {
    const sortedOrder = [...TIER_ORDER].sort();
    const sortedKeys = Object.keys(MODAL_TIER).sort();
    expect(sortedOrder).toEqual(sortedKeys);
    expect(TIER_ORDER.length).toBe(8);
  });

  test('layers from base (vw) to top (tooltip)', () => {
    expect(TIER_ORDER[0]).toBe('vw');
    expect(TIER_ORDER[TIER_ORDER.length - 1]).toBe('tooltip');
  });

  test('execution sits below interactive modals', () => {
    expect(tierRank('execution')).toBeLessThan(tierRank('terminal'));
    expect(tierRank('execution')).toBeLessThan(tierRank('dialog'));
  });

  test('picker sits above menu (picker overlays a context menu)', () => {
    expect(tierRank('picker')).toBeGreaterThan(tierRank('menu'));
  });
});

describe('tierRank', () => {
  test('returns the index for known tiers', () => {
    expect(tierRank('vw')).toBe(0);
    expect(tierRank('execution')).toBe(1);
    expect(tierRank('terminal')).toBe(2);
    expect(tierRank('tooltip')).toBe(TIER_ORDER.length - 1);
  });

  test('returns -1 for unknown tier values (defensive)', () => {
    expect(tierRank('unknown' as ModalTier)).toBe(-1);
  });
});

describe('tiersCompatible', () => {
  test('empty stack (top=undefined) accepts any tier', () => {
    expect(tiersCompatible(undefined, 'vw')).toBe(true);
    expect(tiersCompatible(undefined, 'dialog')).toBe(true);
    expect(tiersCompatible(undefined, 'tooltip')).toBe(true);
  });

  test('same tier on top is legal (e.g. nested menus)', () => {
    expect(tiersCompatible('menu', 'menu')).toBe(true);
    expect(tiersCompatible('dialog', 'dialog')).toBe(true);
  });

  test('higher tier on top is legal', () => {
    expect(tiersCompatible('vw', 'dialog')).toBe(true);
    expect(tiersCompatible('execution', 'popup')).toBe(true);
    expect(tiersCompatible('dialog', 'tooltip')).toBe(true);
  });

  test('lower tier on top is a violation', () => {
    expect(tiersCompatible('dialog', 'vw')).toBe(false);
    expect(tiersCompatible('popup', 'execution')).toBe(false);
    expect(tiersCompatible('tooltip', 'picker')).toBe(false);
  });

  test('unknown tier on either side skips the check (defensive)', () => {
    // tierRank=-1 on the unknown side → check returns true so the
    // boundary assertion never fires for tiers we don't know about.
    expect(tiersCompatible('unknown' as ModalTier, 'dialog')).toBe(true);
    expect(tiersCompatible('dialog', 'unknown' as ModalTier)).toBe(true);
  });
});
