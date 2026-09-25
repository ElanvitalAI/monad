// ── IUL Bundle 3 Phase 3 — dashboard wiring integration test ──
//
// Validates the end-to-end loop activated by the dashboard boot
// wiring. Without depending on showDashboard (TTY-bound), this
// test reproduces the wiring with the exact same calls dashboard.ts
// makes, then exercises modal push/pop and widget spawn/dispose.
//
// Confirms:
//   * `composeIdentityHooks` + DisplayCoordinator → ModalIdentityRegistry
//     → wireModalSurfaceAdapter → SurfaceRegistry.{kind:'modal'} entry
//   * widget-host onMount/onDispose → wireWidgetSurfaceAdapter →
//     SurfaceRegistry.{kind:'widget'} entry
//   * Both adapters dispose cleanly (registry stays valid).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { composeIdentityHooks } from '../src/display/modal-identity-wiring.js';
import {
  createModalIdentityRegistry,
  __setGlobalModalIdentityRegistry,
} from '../src/display/modal-identity.js';
import {
  createSurfaceRegistry,
  __setGlobalSurfaceRegistry,
  wireModalSurfaceAdapter,
  wireWidgetSurfaceAdapter,
} from '../src/surface/index.js';
import { WidgetHost } from '../src/widgets/host.js';
import type { DisplaySurface } from '../src/display/types.js';
import type { WidgetDef } from '../src/widgets/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeModal(id: string, tier?: string): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 100,
    bounds: { row: 1, col: 1, width: 10, height: 5 },
    paint: () => '',
    ...(tier !== undefined ? { tier: tier as never } : {}),
    render: () => [],
  } satisfies DisplaySurface as ModalSurface;
}

const fakeWidget: WidgetDef = {
  type: 'fake', description: 'integration test widget',
  initialState: () => ({}), render: () => [],
};

describe('IUL Bundle 3 dashboard wiring — end-to-end', () => {
  let prevModalReg: ReturnType<typeof __setGlobalModalIdentityRegistry>;
  let prevSurfaceReg: ReturnType<typeof __setGlobalSurfaceRegistry>;

  beforeEach(() => {
    prevModalReg = __setGlobalModalIdentityRegistry(createModalIdentityRegistry());
    prevSurfaceReg = __setGlobalSurfaceRegistry(createSurfaceRegistry());
  });

  afterEach(() => {
    __setGlobalModalIdentityRegistry(prevModalReg);
    __setGlobalSurfaceRegistry(prevSurfaceReg);
  });

  test('modal pushed via DisplayCoordinator lands as SurfaceRegistry entry', () => {
    const identityHooks = composeIdentityHooks();
    const coord = new DisplayCoordinator({ hooks: identityHooks });
    wireModalSurfaceAdapter();   // uses globals (just-swapped fresh ones)

    const modalSurface = makeModal('chat-search-modal', 'picker');
    coord.pushModal(modalSurface);

    const surfaceReg = (require('../src/surface/registry.js')
      .getSurfaceRegistry)() as ReturnType<typeof createSurfaceRegistry>;
    const modalEntries = surfaceReg.listByKind('modal');
    expect(modalEntries).toHaveLength(1);
    expect(modalEntries[0]!.kindTag).toBe('picker');
    expect(modalEntries[0]!.surfaceId).toBe('chat-search-modal');
    expect(modalEntries[0]!.tier).toBe('picker');
  });

  test('popping the modal removes its registry entry', () => {
    const identityHooks = composeIdentityHooks();
    const coord = new DisplayCoordinator({ hooks: identityHooks });
    wireModalSurfaceAdapter();

    const modalSurface = makeModal('dialog-1', 'dialog');
    coord.pushModal(modalSurface);
    coord.popModal('dialog-1');

    const surfaceReg = (require('../src/surface/registry.js')
      .getSurfaceRegistry)() as ReturnType<typeof createSurfaceRegistry>;
    expect(surfaceReg.listByKind('modal')).toHaveLength(0);
  });

  test('widget spawn via WidgetHost lands as SurfaceRegistry entry', () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register(fakeWidget, 'builtin');
    wireWidgetSurfaceAdapter({ widgetHost });

    widgetHost.spawn({ type: 'fake', id: 'sparkline-1' });

    const surfaceReg = (require('../src/surface/registry.js')
      .getSurfaceRegistry)() as ReturnType<typeof createSurfaceRegistry>;
    const widgets = surfaceReg.listByKind('widget');
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.kindTag).toBe('fake');
    expect(widgets[0]!.surfaceId).toBe('sparkline-1');
    expect(widgets[0]!.title).toBe('fake(sparkline-1)');
  });

  test('disposing the widget removes its registry entry', () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register(fakeWidget, 'builtin');
    wireWidgetSurfaceAdapter({ widgetHost });

    widgetHost.spawn({ type: 'fake', id: 'a' });
    widgetHost.dispose('a');

    const surfaceReg = (require('../src/surface/registry.js')
      .getSurfaceRegistry)() as ReturnType<typeof createSurfaceRegistry>;
    expect(surfaceReg.listByKind('widget')).toHaveLength(0);
  });

  test('full mixed scene: 1 modal + 2 widgets coexist in registry', () => {
    const identityHooks = composeIdentityHooks();
    const coord = new DisplayCoordinator({ hooks: identityHooks });
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register(fakeWidget, 'builtin');
    wireModalSurfaceAdapter();
    wireWidgetSurfaceAdapter({ widgetHost });

    coord.pushModal(makeModal('m-1', 'dialog'));
    widgetHost.spawn({ type: 'fake', id: 'w-1' });
    widgetHost.spawn({ type: 'fake', id: 'w-2' });

    const surfaceReg = (require('../src/surface/registry.js')
      .getSurfaceRegistry)() as ReturnType<typeof createSurfaceRegistry>;
    expect(surfaceReg.list()).toHaveLength(3);
    expect(surfaceReg.listByKind('modal')).toHaveLength(1);
    expect(surfaceReg.listByKind('widget')).toHaveLength(2);
  });
});
