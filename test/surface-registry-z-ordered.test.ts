// ── IUL Bundle 5T Phase 2 — listVisibleZOrdered tests ──

import { describe, expect, test } from 'bun:test';
import {
  createSurfaceRegistry,
  type SurfaceRegistry,
} from '../src/surface/index.js';

function reg(): SurfaceRegistry {
  return createSurfaceRegistry();
}

describe('SurfaceRegistry · listVisibleZOrdered', () => {
  test('orders by ZTier band — bg → inline → vw → modal → popover → overlay', () => {
    const r = reg();
    let t = 1000;
    // insert in reversed order to exercise sort
    r.register({ addr: { kind: 'modal', modalId: 'o' }, kindTag: 'tooltip', tier: 'overlay', now: () => t++ });
    r.register({ addr: { kind: 'popover', popoverId: 'p' }, kindTag: 'popup', tier: 'popover', now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'd' }, kindTag: 'dialog', tier: 'modal', now: () => t++ });
    r.register({ addr: { kind: 'widget', widgetId: 'w' }, kindTag: 'fake', tier: 'vw', now: () => t++ });
    r.register({ addr: { kind: 'inline', inlineId: 'i' }, kindTag: 'inline', tier: 'inline', now: () => t++ });
    r.register({ addr: { kind: 'bg', bgId: 'b' }, kindTag: 'bg', tier: 'bg', now: () => t++ });

    const ordered = r.listVisibleZOrdered();
    expect(ordered.map(d => d.tier)).toEqual(
      ['bg', 'inline', 'vw', 'modal', 'popover', 'overlay'],
    );
  });

  test('hidden entries are excluded', () => {
    const r = reg();
    r.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'modal', visible: true });
    r.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'modal', visible: false });
    expect(r.listVisibleZOrdered()).toHaveLength(1);
  });

  test('same tier: zHint ascending primary, registeredAt secondary', () => {
    const r = reg();
    let t = 1000;
    r.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'modal', now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'modal', zHint: 5, now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'c' }, kindTag: 'x', tier: 'modal', now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'd' }, kindTag: 'x', tier: 'modal', zHint: 5, now: () => t++ });

    const out = r.listVisibleZOrdered().map(e => (e.addr as { modalId: string }).modalId);
    // zHint=0 first (a, c by registeredAt), then zHint=5 (b, d by registeredAt)
    expect(out).toEqual(['a', 'c', 'b', 'd']);
  });

  test('MODAL_TIER rich labels route through modalTierToZTier', () => {
    const r = reg();
    let t = 1000;
    r.register({ addr: { kind: 'modal', modalId: 'tt' }, kindTag: 'x', tier: 'tooltip', now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'di' }, kindTag: 'x', tier: 'dialog',  now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'pu' }, kindTag: 'x', tier: 'popup',   now: () => t++ });

    const tiers = r.listVisibleZOrdered().map(d => (d.addr as { modalId: string }).modalId);
    // dialog → modal (rank 3), popup → popover (rank 4), tooltip → overlay (rank 5)
    expect(tiers).toEqual(['di', 'pu', 'tt']);
  });

  test('missing tier → modal band fallback (median)', () => {
    const r = reg();
    let t = 1000;
    r.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', now: () => t++ });         // no tier
    r.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'bg', now: () => t++ });
    r.register({ addr: { kind: 'modal', modalId: 'c' }, kindTag: 'x', tier: 'overlay', now: () => t++ });

    const out = r.listVisibleZOrdered().map(d => (d.addr as { modalId: string }).modalId);
    // bg (0) → modal fallback for 'a' (3) → overlay (5)
    expect(out).toEqual(['b', 'a', 'c']);
  });

  test('update visibility removes from z-ordered output', () => {
    const r = reg();
    r.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'modal' });
    expect(r.listVisibleZOrdered()).toHaveLength(1);
    r.update({ addr: { kind: 'modal', modalId: 'a' }, visible: false });
    expect(r.listVisibleZOrdered()).toHaveLength(0);
  });

  test('6-band mixed scene — 2 per band = 12 entries stable order', () => {
    const r = reg();
    let t = 1000;
    const bands: Array<{ tier: string; kind: string; key: string }> = [
      { tier: 'bg', kind: 'bg', key: 'b1' }, { tier: 'bg', kind: 'bg', key: 'b2' },
      { tier: 'inline', kind: 'inline', key: 'i1' }, { tier: 'inline', kind: 'inline', key: 'i2' },
      { tier: 'vw', kind: 'widget', key: 'w1' }, { tier: 'vw', kind: 'widget', key: 'w2' },
      { tier: 'modal', kind: 'modal', key: 'm1' }, { tier: 'modal', kind: 'modal', key: 'm2' },
      { tier: 'popover', kind: 'popover', key: 'p1' }, { tier: 'popover', kind: 'popover', key: 'p2' },
      { tier: 'overlay', kind: 'modal', key: 'o1' }, { tier: 'overlay', kind: 'modal', key: 'o2' },
    ];
    for (const b of bands) {
      const addr: never = (b.kind === 'bg' ? { kind: 'bg', bgId: b.key }
        : b.kind === 'inline' ? { kind: 'inline', inlineId: b.key }
        : b.kind === 'widget' ? { kind: 'widget', widgetId: b.key }
        : b.kind === 'popover' ? { kind: 'popover', popoverId: b.key }
        : { kind: 'modal', modalId: b.key }) as never;
      r.register({ addr, kindTag: b.kind, tier: b.tier, now: () => t++ });
    }
    const tiers = r.listVisibleZOrdered().map(d => d.tier);
    // tier bands adjacent, 2 per band
    expect(tiers).toEqual([
      'bg', 'bg', 'inline', 'inline', 'vw', 'vw',
      'modal', 'modal', 'popover', 'popover', 'overlay', 'overlay',
    ]);
  });

  test('existing list() / listVisible() unchanged (backward compat)', () => {
    const r = reg();
    r.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'modal' });
    r.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'modal', visible: false });
    expect(r.list()).toHaveLength(2);
    expect(r.listVisible()).toHaveLength(1);
    expect(r.listVisibleZOrdered()).toHaveLength(1);
  });
});
