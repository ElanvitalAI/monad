// ── IUL Bundle 5T Phase 3 — GetUIState ZTier ordering tests ──

import { describe, expect, test } from 'bun:test';
import {
  dispatchGetUIState,
  createSurfaceRegistry,
} from '../src/surface/index.js';

describe('GetUIState · ZTier ordering (Phase Z)', () => {
  test('visible surfaces sorted by ZTier band first', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    // insert in reverse order
    reg.register({ addr: { kind: 'modal', modalId: 'o' }, kindTag: 'tooltip', tier: 'overlay', now: () => t++ });
    reg.register({ addr: { kind: 'popover', popoverId: 'p' }, kindTag: 'pp', tier: 'popover', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'm' }, kindTag: 'dialog', tier: 'modal', now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'w' }, kindTag: 'fake', tier: 'vw', now: () => t++ });
    reg.register({ addr: { kind: 'inline', inlineId: 'i' }, kindTag: 'il', tier: 'inline', now: () => t++ });
    reg.register({ addr: { kind: 'bg', bgId: 'b' }, kindTag: 'bg', tier: 'bg', now: () => t++ });

    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces.map(s => s.tier)).toEqual(
      ['bg', 'inline', 'vw', 'modal', 'popover', 'overlay'],
    );
    // z indices still dense 0..5
    expect(out.surfaces.map(s => s.z)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('MODAL_TIER rich label tier coerces to ZTier band', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'tt' }, kindTag: 'x', tier: 'tooltip', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'pu' }, kindTag: 'x', tier: 'popup', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'di' }, kindTag: 'x', tier: 'dialog', now: () => t++ });

    const out = dispatchGetUIState({}, { registry: reg });
    const order = out.surfaces.map(s => (s.addr as { modalId: string }).modalId);
    // dialog(modal rank 3) → popup(popover rank 4) → tooltip(overlay rank 5)
    expect(order).toEqual(['di', 'pu', 'tt']);
  });

  test('query tier = ZTier band matches descriptors rolling up to it', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'dialog', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'picker', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'c' }, kindTag: 'x', tier: 'popup', now: () => t++ });
    // query by ZTier band 'modal' → dialog + picker match, popup doesn't
    const out = dispatchGetUIState({ tier: 'modal' }, { registry: reg });
    expect(out.surfaces.map(s => (s.addr as { modalId: string }).modalId)).toEqual(['a', 'b']);
  });

  test('query tier = rich label requires exact match (not rollup)', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'dialog', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'picker', now: () => t++ });
    // Both roll up to 'modal' but query is specific 'picker' → only 'b'
    const out = dispatchGetUIState({ tier: 'picker' }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]!.addr).toMatchObject({ modalId: 'b' });
  });

  test('missing tier falls into modal band (median)', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'n' }, kindTag: 'x', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'bg' }, kindTag: 'x', tier: 'bg', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'ov' }, kindTag: 'x', tier: 'overlay', now: () => t++ });
    const order = dispatchGetUIState({}, { registry: reg }).surfaces
      .map(s => (s.addr as { modalId: string }).modalId);
    expect(order).toEqual(['bg', 'n', 'ov']);
  });

  test('includeHidden path preserves zHint+registeredAt sort (no ZTier)', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'overlay', visible: false, now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'bg', visible: false, now: () => t++ });
    // With includeHidden: entries are sorted by zHint+registeredAt (not ZTier)
    const out = dispatchGetUIState({ includeHidden: true }, { registry: reg });
    expect(out.surfaces.map(s => (s.addr as { modalId: string }).modalId)).toEqual(['a', 'b']);
  });

  test('kind filter combined with tier band filter', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', tier: 'dialog', now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'w' }, kindTag: 'fake', tier: 'vw', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', tier: 'popup', now: () => t++ });
    // query kind='modal' + tier='modal' band → only 'a' (dialog)
    const out = dispatchGetUIState({ kind: 'modal', tier: 'modal' }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]!.addr).toMatchObject({ modalId: 'a' });
  });
});
