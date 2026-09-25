// ── IUL Bundle 4T Phase 2 — S·b rest integration ──
//
// Validates that popover + inline + bg surface entries coexist in
// the SurfaceRegistry along with modal + widget (Bundle 1+2+3 wired).
// LLM-side `GetUIState` filters partition them correctly.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  createSurfaceRegistry,
  __setGlobalSurfaceRegistry,
  registerPopoverSurface,
  registerInlineSurface,
  registerBackgroundHandle,
  bindInlineSurfaceToRegistry,
  bindBackgroundSurfaceToRegistry,
  dispatchGetUIState,
  type InlineSurfaceLike,
  type BackgroundSurfaceLike,
} from '../src/surface/index.js';

describe('S·b rest adapters · integration with Phase L GetUIState', () => {
  let prev: ReturnType<typeof __setGlobalSurfaceRegistry>;
  beforeEach(() => {
    prev = __setGlobalSurfaceRegistry(createSurfaceRegistry());
  });
  afterEach(() => { __setGlobalSurfaceRegistry(prev); });

  test('all 6 surface kinds coexist in a single GetUIState call', () => {
    const reg = createSurfaceRegistry();
    // pre-populate one of each kind
    reg.register({ addr: { kind: 'pane', ref: { windowId: 'w', paneId: 'p' } }, kindTag: 'terminal' });
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog' });
    reg.register({ addr: { kind: 'widget', widgetId: 'sp-1' }, kindTag: 'sparkline' });
    registerPopoverSurface({ registry: reg, popoverId: 'pp', kindTag: 'tooltip' });
    registerInlineSurface({ registry: reg, inlineId: 'il', title: 'sh:ls' });
    registerBackgroundHandle({ registry: reg, bgId: 'bg', title: 'npm watch' });

    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces).toHaveLength(6);
    const kinds = new Set(out.surfaces.map(s => s.addr.kind));
    expect(kinds).toEqual(new Set(['pane', 'modal', 'widget', 'popover', 'inline', 'bg']));
  });

  test('kind filter narrows GetUIState to single S·b rest kind', () => {
    const reg = createSurfaceRegistry();
    registerInlineSurface({ registry: reg, inlineId: 'il-1' });
    registerInlineSurface({ registry: reg, inlineId: 'il-2' });
    registerBackgroundHandle({ registry: reg, bgId: 'bg-1' });
    registerPopoverSurface({ registry: reg, popoverId: 'pp-1' });

    const inlineOnly = dispatchGetUIState({ kind: 'inline' }, { registry: reg });
    expect(inlineOnly.surfaces).toHaveLength(2);

    const bgOnly = dispatchGetUIState({ kind: 'bg' }, { registry: reg });
    expect(bgOnly.surfaces).toHaveLength(1);

    const popOnly = dispatchGetUIState({ kind: 'popover' }, { registry: reg });
    expect(popOnly.surfaces).toHaveLength(1);
  });

  test('bind dispose removes the bg/inline entries; GetUIState reflects', () => {
    const reg = createSurfaceRegistry();
    const inline: InlineSurfaceLike = { latest: () => null, detach: () => {} };
    const bg: BackgroundSurfaceLike = {
      latest: () => ({ entries: [{ id: 'bg1', status: 'running' }] }),
      detach: () => {},
    };
    const ih = bindInlineSurfaceToRegistry(inline, { registry: reg, inlineId: 'i' });
    const bh = bindBackgroundSurfaceToRegistry(bg, { registry: reg });
    bh.syncNow();
    expect(dispatchGetUIState({}, { registry: reg }).surfaces).toHaveLength(2);
    ih.dispose();
    bh.dispose();
    expect(dispatchGetUIState({}, { registry: reg }).surfaces).toHaveLength(0);
  });

  test('z-order across S·b rest is dense + ascending by registeredAt', () => {
    const reg = createSurfaceRegistry();
    let t = 1000;
    registerPopoverSurface({ registry: reg, popoverId: 'p',  /* now isn't on opts; simulate via clock seq */ });
    registerInlineSurface({ registry: reg, inlineId: 'i' });
    registerBackgroundHandle({ registry: reg, bgId: 'b' });
    void t;
    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces.map(s => s.z)).toEqual([0, 1, 2]);
  });

  test('hidden bg entry (status:completed) excluded from default GetUIState', () => {
    const reg = createSurfaceRegistry();
    const bg: BackgroundSurfaceLike = {
      latest: () => ({
        entries: [
          { id: 'live', status: 'running' },
          { id: 'done', status: 'completed' },
        ],
      }),
      detach: () => {},
    };
    const handle = bindBackgroundSurfaceToRegistry(bg, { registry: reg });
    handle.syncNow();
    const visible = dispatchGetUIState({}, { registry: reg });
    expect(visible.surfaces).toHaveLength(1);
    expect(visible.surfaces[0]!.addr).toMatchObject({ kind: 'bg', bgId: 'live' });
    const all = dispatchGetUIState({ includeHidden: true }, { registry: reg });
    expect(all.surfaces).toHaveLength(2);
  });

  test('popover registration preserves anchor info via stateHash', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({
      registry: reg,
      popoverId: 'tt-x',
      anchorId: 'pill-mode',
      kindTag: 'tooltip',
    });
    expect(reg.get({ kind: 'popover', popoverId: 'tt-x' })!.stateHash).toBe('anchor:pill-mode');
  });

  test('multi-kind mixed scene: 2 modal + 3 widget + 2 inline + 1 bg + 1 popover = 9', () => {
    const reg = createSurfaceRegistry();
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog' });
    reg.register({ addr: { kind: 'modal', modalId: 'm2' }, kindTag: 'picker' });
    reg.register({ addr: { kind: 'widget', widgetId: 'w1' }, kindTag: 'fake' });
    reg.register({ addr: { kind: 'widget', widgetId: 'w2' }, kindTag: 'fake' });
    reg.register({ addr: { kind: 'widget', widgetId: 'w3' }, kindTag: 'fake' });
    registerInlineSurface({ registry: reg, inlineId: 'i1' });
    registerInlineSurface({ registry: reg, inlineId: 'i2' });
    registerBackgroundHandle({ registry: reg, bgId: 'b1' });
    registerPopoverSurface({ registry: reg, popoverId: 'p1' });

    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces).toHaveLength(9);
    expect(out.surfaces.filter(s => s.addr.kind === 'modal')).toHaveLength(2);
    expect(out.surfaces.filter(s => s.addr.kind === 'widget')).toHaveLength(3);
    expect(out.surfaces.filter(s => s.addr.kind === 'inline')).toHaveLength(2);
    expect(out.surfaces.filter(s => s.addr.kind === 'bg')).toHaveLength(1);
    expect(out.surfaces.filter(s => s.addr.kind === 'popover')).toHaveLength(1);
  });
});
