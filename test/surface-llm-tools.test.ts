// ── IUL Bundle 4T Phase 1 — Phase L subset tool tests ──
//
// GetUIState / DescribeSurface / ObserveSurface — all read-only
// against an injected SurfaceRegistry + ModalIdentityRegistry +
// (mock) widget-host. Hermetic — no globals, no real dashboard.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  buildGetUIStateTool,
  buildDescribeSurfaceTool,
  buildObserveSurfaceTool,
  dispatchGetUIState,
  dispatchDescribeSurface,
  dispatchObserveSurface,
  createSurfaceRegistry,
  type SurfaceRegistry,
  type SurfaceUIWidgetHost,
} from '../src/surface/index.js';
import {
  createModalIdentityRegistry,
  type ModalIdentityRegistry,
} from '../src/display/modal-identity.js';

function fakeWidgetHost(
  insts: Array<{ id: string; type: string; character: string; state: unknown; description?: string }>,
): SurfaceUIWidgetHost {
  return {
    get(id) {
      const i = insts.find(x => x.id === id);
      return i ? { id: i.id, type: i.type, character: i.character, state: i.state } : null;
    },
    defFor(id) {
      const i = insts.find(x => x.id === id);
      return i ? { type: i.type, description: i.description ?? '' } : null;
    },
    listInstanceIds() {
      return insts.map(i => i.id);
    },
  };
}

// ── tool spec smoke ─────────────────────────────────────────────

describe('Phase L · tool spec shape', () => {
  test('all three tools build a valid LLMToolSpec', () => {
    const a = buildGetUIStateTool();
    const b = buildDescribeSurfaceTool();
    const c = buildObserveSurfaceTool();
    for (const spec of [a, b, c]) {
      expect(typeof spec.name).toBe('string');
      expect(spec.name.length).toBeGreaterThan(0);
      expect(typeof spec.description).toBe('string');
      expect(spec.parameters).toBeDefined();
      expect((spec.parameters as Record<string, unknown>).type).toBe('object');
    }
    expect(a.name).toBe('GetUIState');
    expect(b.name).toBe('DescribeSurface');
    expect(c.name).toBe('ObserveSurface');
  });
});

// ── GetUIState ──────────────────────────────────────────────────

describe('GetUIState · z-order + filter', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => { reg = createSurfaceRegistry(); });

  test('returns visible surfaces only by default', () => {
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog', visible: true,  now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'm2' }, kindTag: 'dialog', visible: false, now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'w1' }, kindTag: 'fake', now: () => t++ });
    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces).toHaveLength(2);
    expect(out.surfaces.every(s => s.visible)).toBe(true);
  });

  test('includeHidden=true brings hidden back', () => {
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog', visible: false, now: () => t++ });
    const out = dispatchGetUIState({ includeHidden: true }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
  });

  test('kind filter narrows by addr.kind', () => {
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'dialog', now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'b' }, kindTag: 'fake', now: () => t++ });
    reg.register({ addr: { kind: 'widget', widgetId: 'c' }, kindTag: 'fake', now: () => t++ });
    const out = dispatchGetUIState({ kind: 'widget' }, { registry: reg });
    expect(out.surfaces).toHaveLength(2);
    expect(out.surfaces.every(s => s.addr.kind === 'widget')).toBe(true);
  });

  test('tier filter narrows by tier hint', () => {
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'dialog', tier: 'dialog', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'picker', tier: 'picker', now: () => t++ });
    const out = dispatchGetUIState({ tier: 'picker' }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]!.tier).toBe('picker');
  });

  test('z is dense + ascending; tied zHint resolves by registeredAt', () => {
    let t = 1000;
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x', now: () => t++ });
    reg.register({ addr: { kind: 'modal', modalId: 'c' }, kindTag: 'x', zHint: 5, now: () => t++ });
    const out = dispatchGetUIState({}, { registry: reg });
    expect(out.surfaces.map(s => s.z)).toEqual([0, 1, 2]);
    // 'c' has zHint:5 → comes last
    expect(out.surfaces[2]!.addr).toMatchObject({ kind: 'modal', modalId: 'c' });
    // a then b by registeredAt
    expect(out.surfaces[0]!.addr).toMatchObject({ kind: 'modal', modalId: 'a' });
    expect(out.surfaces[1]!.addr).toMatchObject({ kind: 'modal', modalId: 'b' });
  });
});

// ── DescribeSurface ─────────────────────────────────────────────

describe('DescribeSurface · per-kind branching', () => {
  test('addr missing → found=false note', () => {
    const out = dispatchDescribeSurface({});
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/addr missing/);
  });

  test('modal kind reads ModalIdentityRegistry metadata', () => {
    const reg = createSurfaceRegistry();
    const id = createModalIdentityRegistry();
    const ident = id.allocate({ kind: 'chat-search', surfaceId: 'csm' });
    id.notifyPush(ident, 'csm', 'picker');
    reg.register({ addr: { kind: 'modal', modalId: ident.modalId }, kindTag: 'chat-search', tier: 'picker', surfaceId: 'csm', title: 'Chat Search' });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'modal', modalId: ident.modalId } },
      { registry: reg, identity: id },
    );
    expect(out.found).toBe(true);
    expect(out.kindTag).toBe('chat-search');
    expect(out.tier).toBe('picker');
    expect(out.title).toBe('Chat Search');
    expect(out.detail).toMatchObject({ modalId: ident.modalId, chainDepth: 0 });
  });

  test('modal promote chain depth reflected', () => {
    const reg = createSurfaceRegistry();
    const id = createModalIdentityRegistry();
    const a = id.allocate({ kind: 'modal' });
    const b = id.promote(a, { kind: 'popover' });
    const c = id.promote(b, { kind: 'modal' });
    reg.register({ addr: { kind: 'modal', modalId: c.modalId }, kindTag: 'modal' });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'modal', modalId: c.modalId } },
      { registry: reg, identity: id },
    );
    expect(out.detail).toMatchObject({ chainDepth: 2 });
  });

  test('widget kind reads READ-ONLY widget-host snapshot', () => {
    const reg = createSurfaceRegistry();
    const wh = fakeWidgetHost([
      { id: 'spark-1', type: 'sparkline', character: 'Spark', state: { values: [1,2,3,4,5,6,7,8,9,10] }, description: 'small line chart' },
    ]);
    reg.register({ addr: { kind: 'widget', widgetId: 'spark-1' }, kindTag: 'sparkline', tier: 'vw', title: 'sparkline(spark-1)' });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'spark-1' } },
      { registry: reg, widgetHost: wh },
    );
    expect(out.found).toBe(true);
    expect(out.kindTag).toBe('sparkline');
    expect(out.detail).toMatchObject({
      instanceId: 'spark-1',
      type: 'sparkline',
      character: 'Spark',
      description: 'small line chart',
    });
    expect((out.detail as { statePreview: { values: string } }).statePreview.values).toBe('[Array(10)]');
  });

  test('widget kind without widget-host degrades to passthrough', () => {
    const reg = createSurfaceRegistry();
    reg.register({ addr: { kind: 'widget', widgetId: 'x' }, kindTag: 'fake' });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'x' } },
      { registry: reg },
    );
    expect(out.found).toBe(true);
    expect(out.note).toMatch(/widget-host not wired/);
    expect(out.kindTag).toBe('fake');
  });

  test('widget kind unknown id is found=false', () => {
    const reg = createSurfaceRegistry();
    const wh = fakeWidgetHost([]);
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'ghost' } },
      { registry: reg, widgetHost: wh },
    );
    expect(out.found).toBe(false);
  });

  test('popover/inline/bg → registry passthrough', () => {
    const reg = createSurfaceRegistry();
    reg.register({ addr: { kind: 'popover', popoverId: 'pp' }, kindTag: 'popup', title: 'tooltip' });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'popover', popoverId: 'pp' } },
      { registry: reg },
    );
    expect(out.found).toBe(true);
    expect(out.kindTag).toBe('popup');
  });
});

// ── ObserveSurface ──────────────────────────────────────────────

describe('ObserveSurface · time-window subscription', () => {
  test('collects events arriving during the window', async () => {
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void, _ms: number) => { timerCb = cb; return 1; };
    const promise = dispatchObserveSurface(
      { durationMs: 100 },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'modal', modalId: 'mid' }, kindTag: 'dialog' });
    reg.unregister({ kind: 'modal', modalId: 'mid' });
    timerCb?.();
    const out = await promise;
    expect(out.events.map(e => e.kind)).toEqual(['register', 'unregister']);
    expect(out.windowMs).toBe(100);
    expect(out.truncated).toBe(false);
  });

  test('addr filter narrows to single surface', async () => {
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void) => { timerCb = cb; return 1; };
    const promise = dispatchObserveSurface(
      { durationMs: 50, addr: { kind: 'modal', modalId: 'tracked' } },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'modal', modalId: 'tracked' }, kindTag: 'x' });
    reg.register({ addr: { kind: 'modal', modalId: 'other' }, kindTag: 'x' });
    timerCb?.();
    const out = await promise;
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.addr).toMatchObject({ kind: 'modal', modalId: 'tracked' });
  });

  test('kind filter narrows by SurfaceAddress.kind', async () => {
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void) => { timerCb = cb; return 1; };
    const promise = dispatchObserveSurface(
      { durationMs: 50, kind: 'widget' },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'widget', widgetId: 'a' }, kindTag: 'fake' });
    reg.register({ addr: { kind: 'modal', modalId: 'm' }, kindTag: 'd' });
    timerCb?.();
    const out = await promise;
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.addr.kind).toBe('widget');
  });

  test('clamps durationMs to MAX 60000', async () => {
    const reg = createSurfaceRegistry();
    let captured = 0;
    const setTimer = (cb: () => void, ms: number) => { captured = ms; cb(); return 1; };
    const out = await dispatchObserveSurface(
      { durationMs: 999_999 },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(captured).toBe(60_000);
    expect(out.windowMs).toBe(60_000);
  });

  test('maxEvents truncates + sets truncated=true', async () => {
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void) => { timerCb = cb; return 1; };
    const promise = dispatchObserveSurface(
      { durationMs: 50, maxEvents: 2 },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'modal', modalId: 'a' }, kindTag: 'x' });
    reg.register({ addr: { kind: 'modal', modalId: 'b' }, kindTag: 'x' });
    reg.register({ addr: { kind: 'modal', modalId: 'c' }, kindTag: 'x' });
    timerCb?.();
    const out = await promise;
    expect(out.events).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });
});
