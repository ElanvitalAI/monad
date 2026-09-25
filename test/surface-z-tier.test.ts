// ── IUL Phase Z — z-tier module tests ──

import { describe, expect, test } from 'bun:test';
import {
  Z_TIER,
  Z_TIER_ORDER,
  zTierRank,
  isZTier,
  zTiersCompatible,
  SURFACE_KIND_FAMILY_POLICY,
  surfaceKindFamilyPolicy,
  modalTierToZTier,
  defaultZTierForKind,
  compareByZSemantics,
  normalizeZOrderTier,
  coerceZTier,
  type ZTier,
} from '../src/surface/z-tier.js';

describe('ZTier · enum + order', () => {
  test('Z_TIER exposes all 6 tiers', () => {
    expect(Object.keys(Z_TIER).sort()).toEqual(
      ['bg', 'inline', 'modal', 'overlay', 'popover', 'vw'],
    );
  });

  test('Z_TIER_ORDER is bottom→top as documented', () => {
    expect([...Z_TIER_ORDER]).toEqual(
      ['bg', 'inline', 'vw', 'modal', 'popover', 'overlay'],
    );
  });

  test('zTierRank is monotonic 0..5', () => {
    const ranks = Z_TIER_ORDER.map(zTierRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('isZTier narrows valid strings + rejects others', () => {
    for (const t of Z_TIER_ORDER) expect(isZTier(t)).toBe(true);
    expect(isZTier('dialog')).toBe(false);
    expect(isZTier('')).toBe(false);
    expect(isZTier(42)).toBe(false);
  });
});

describe('ZTier · compatibility rule', () => {
  test('empty stack → any tier is OK', () => {
    expect(zTiersCompatible(undefined, 'bg')).toBe(true);
    expect(zTiersCompatible(undefined, 'overlay')).toBe(true);
  });

  test('equal tier is legal (stacking within band)', () => {
    expect(zTiersCompatible('modal', 'modal')).toBe(true);
  });

  test('higher tier on top of lower is legal', () => {
    expect(zTiersCompatible('vw', 'modal')).toBe(true);
    expect(zTiersCompatible('modal', 'popover')).toBe(true);
    expect(zTiersCompatible('popover', 'overlay')).toBe(true);
  });

  test('lower tier on top of higher is illegal', () => {
    expect(zTiersCompatible('overlay', 'popover')).toBe(false);
    expect(zTiersCompatible('modal', 'vw')).toBe(false);
    expect(zTiersCompatible('vw', 'bg')).toBe(false);
  });
});

describe('ZTier · modalTierToZTier mapping', () => {
  test('vw stays vw', () => {
    expect(modalTierToZTier('vw')).toBe('vw');
  });

  test('execution / terminal / dialog / picker → modal', () => {
    expect(modalTierToZTier('execution')).toBe('modal');
    expect(modalTierToZTier('terminal')).toBe('modal');
    expect(modalTierToZTier('dialog')).toBe('modal');
    expect(modalTierToZTier('picker')).toBe('modal');
  });

  test('popup / menu → popover', () => {
    expect(modalTierToZTier('popup')).toBe('popover');
    expect(modalTierToZTier('menu')).toBe('popover');
  });

  test('tooltip → overlay', () => {
    expect(modalTierToZTier('tooltip')).toBe('overlay');
  });

  test('unknown → modal (median fallback)', () => {
    expect(modalTierToZTier('zzz')).toBe('modal');
    expect(modalTierToZTier(undefined)).toBe('modal');
  });
});

describe('ZTier · defaultZTierForKind', () => {
  test('pane + widget → vw', () => {
    expect(defaultZTierForKind('pane')).toBe('vw');
    expect(defaultZTierForKind('widget')).toBe('vw');
  });

  test('window → vw', () => {
    expect(defaultZTierForKind('window')).toBe('vw');
  });

  test('modal → modal', () => {
    expect(defaultZTierForKind('modal')).toBe('modal');
  });

  test('popover → popover', () => {
    expect(defaultZTierForKind('popover')).toBe('popover');
  });

  test('inline → inline', () => {
    expect(defaultZTierForKind('inline')).toBe('inline');
  });

  test('bg → bg', () => {
    expect(defaultZTierForKind('bg')).toBe('bg');
  });

  test('input → inline fallback tier', () => {
    expect(defaultZTierForKind('input')).toBe('inline');
  });

  test('unknown kind → vw fallback', () => {
    expect(defaultZTierForKind('mystery')).toBe('vw');
  });
});

describe('ZTier · coerceZTier', () => {
  test('exact ZTier string passes through', () => {
    expect(coerceZTier('modal')).toBe('modal');
  });

  test('MODAL_TIER string routed through modalTierToZTier', () => {
    expect(coerceZTier('tooltip')).toBe('overlay');
    expect(coerceZTier('menu')).toBe('popover');
  });

  test('undefined → undefined (no implicit default)', () => {
    expect(coerceZTier(undefined)).toBeUndefined();
  });

  test('unknown string → modal fallback (via MODAL_TIER bridge)', () => {
    expect(coerceZTier('foo')).toBe('modal');
  });
});

describe('ZTier · shared z-order semantics helpers', () => {
  test('normalizeZOrderTier maps missing tier to modal', () => {
    expect(normalizeZOrderTier(undefined)).toBe('modal');
  });

  test('compareByZSemantics sorts by tier, then index, then insertion order', () => {
    const items = [
      { id: 'overlay-late', tier: 'overlay', index: 0, insertionOrder: 5 },
      { id: 'modal-high', tier: 'dialog', index: 8, insertionOrder: 2 },
      { id: 'modal-low-early', tier: 'modal', index: 1, insertionOrder: 0 },
      { id: 'modal-low-late', tier: 'modal', index: 1, insertionOrder: 3 },
      { id: 'bg', tier: 'bg', index: 0, insertionOrder: 4 },
    ];
    items.sort(compareByZSemantics);
    expect(items.map((i) => i.id)).toEqual([
      'bg',
      'modal-low-early',
      'modal-low-late',
      'modal-high',
      'overlay-late',
    ]);
  });
});

describe('ZTier · surface kind family policy', () => {
  test('covers every current SurfaceAddress kind', () => {
    expect(Object.keys(SURFACE_KIND_FAMILY_POLICY).sort()).toEqual([
      'bg',
      'inline',
      'input',
      'modal',
      'pane',
      'popover',
      'widget',
      'window',
    ]);
  });

  test('input is host-derived and uses inline only as fallback tier', () => {
    expect(surfaceKindFamilyPolicy('input')).toEqual({
      kind: 'input',
      family: 'host-derived-input',
      defaultTier: 'inline',
      fallbackOnly: true,
    });
  });

  test('window stays in vw band even though it is a distinct address kind', () => {
    expect(surfaceKindFamilyPolicy('window')).toEqual({
      kind: 'window',
      family: 'window-container',
      defaultTier: 'vw',
    });
  });
});
