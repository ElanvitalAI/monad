// ── Bundle 6T Phase C — surface-source dispatcher + screen tests ──

import { describe, expect, test } from 'bun:test';
import {
  resolveSurfaceAnsi,
  resolveScreenAnsi,
  resolvePassthroughAnsi,
  type WidgetRenderHost,
  type DisplaySurfaceResolver,
} from '../src/capture/index.js';
import { createSurfaceRegistry } from '../src/surface/index.js';
import { createModalIdentityRegistry } from '../src/display/modal-identity.js';

function fakeWidgetHost(): WidgetRenderHost {
  return {
    get: (id) => ({ id, type: 'fake', character: 'F', state: { v: 7 } }),
    defFor: (_id) => ({
      type: 'fake', description: '',
      render: (state: unknown) => [`v=${(state as { v: number }).v}`],
    } as never),
    buildContext: (_id) => ({ theme: {} } as never),
    listInstanceIds: () => ['w1'],
  };
}

function fakeResolver(paint: string): DisplaySurfaceResolver {
  return { getSurface: () => ({ paint: () => paint }) };
}

describe('surface-source · kind dispatch', () => {
  test('modal kind delegates to modal-source', () => {
    const identity = createModalIdentityRegistry();
    const id = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(id, 's1');
    return resolveSurfaceAnsi(
      { kind: 'modal', modalId: id.modalId },
      { identity, surfaceResolver: fakeResolver('MODAL-ANSI') },
    ).then(out => expect(out).toBe('MODAL-ANSI'));
  });

  test('widget kind delegates to widget-source', () => {
    return resolveSurfaceAnsi(
      { kind: 'widget', widgetId: 'w1' },
      { widgetHost: fakeWidgetHost(), dims: { cols: 20, rows: 5 } },
    ).then(out => expect(out).toBe('v=7'));
  });

  test('popover / inline / bg fall back to registry passthrough', async () => {
    const reg = createSurfaceRegistry();
    reg.register({
      addr: { kind: 'popover', popoverId: 'p1' },
      kindTag: 'tooltip', tier: 'popup', title: 'Hover',
    });
    const out = await resolveSurfaceAnsi(
      { kind: 'popover', popoverId: 'p1' },
      { registry: reg },
    );
    expect(out).toContain('[popover]');
    expect(out).toContain('tooltip');
    expect(out).toContain('title: Hover');
  });

  test('passthrough for surface not in registry', () => {
    const reg = createSurfaceRegistry();
    expect(
      resolvePassthroughAnsi({ kind: 'inline', inlineId: 'missing' }, { registry: reg }),
    ).toBe('[inline surface not in registry]');
  });
});

describe('surface-source · screen composite', () => {
  test('empty registry → "no visible surfaces"', async () => {
    const reg = createSurfaceRegistry();
    const out = await resolveScreenAnsi({ registry: reg });
    expect(out).toBe('[screen: no visible surfaces]');
  });

  test('composites surfaces in ZTier order with headers', async () => {
    const reg = createSurfaceRegistry();
    const identity = createModalIdentityRegistry();
    const mid = identity.allocate({ kind: 'dialog', surfaceId: 's1' });
    identity.notifyPush(mid, 's1');

    reg.register({
      addr: { kind: 'modal', modalId: mid.modalId },
      kindTag: 'dialog', tier: 'modal', title: 'Confirm',
    });
    reg.register({
      addr: { kind: 'popover', popoverId: 'pp' },
      kindTag: 'tooltip', tier: 'popover', title: 'Hint',
    });

    const out = await resolveScreenAnsi({
      registry: reg,
      identity,
      surfaceResolver: fakeResolver('MODAL'),
    });
    // modal (rank 3) before popover (rank 4)
    const modalIdx = out.indexOf('modal:');
    const popIdx = out.indexOf('popover:');
    expect(modalIdx).toBeGreaterThan(-1);
    expect(popIdx).toBeGreaterThan(-1);
    expect(modalIdx).toBeLessThan(popIdx);
    expect(out).toContain('MODAL');
    expect(out).toContain('tier=modal');
    expect(out).toContain('tier=popover');
  });

  test('source resolution error becomes inline marker', async () => {
    const reg = createSurfaceRegistry();
    // Register a modal that will fail to resolve (no identity known)
    reg.register({
      addr: { kind: 'modal', modalId: 'orphan' },
      kindTag: 'dialog', tier: 'modal',
    });
    const out = await resolveScreenAnsi({ registry: reg });
    expect(out).toContain('[source resolution failed');
  });
});
