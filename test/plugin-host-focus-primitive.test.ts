// Phase F-3b — `HostHooks.focusManager?` wiring lets ctx.focus
// bypass the DisplayHandle wrappers and hit the FocusManager
// primitive directly. Narrow test: invoke the private
// `buildHostContext()` path directly so we don't need to boot a
// full plugin fixture (existing plugin-host.test.ts covers the
// activation path separately).

import { describe, expect, test } from 'bun:test';
import { PluginHost } from '../src/plugins/core/host.js';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/types.js';

function makeHost(opts: { withFocusManager: boolean }): {
  host: PluginHost;
  coordinator: DisplayCoordinator;
} {
  const coordinator = new DisplayCoordinator({ frameMs: 16 });
  const host = new PluginHost({
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    display: coordinator.handle('plugin:host'),
    ...(opts.withFocusManager ? { focusManager: coordinator.focusManagerAPI() } : {}),
    focusPane: () => {},
  });
  return { host, coordinator };
}

// `buildHostContext` is private; reach in for unit testing the
// focus API shape without spinning up a full plugin activation.
// The integration path (plugin → ctx.focus.set → coord) is already
// covered by test/plugin-host.test.ts (51 cases · unchanged).
function buildHostCtx(host: PluginHost): { focus: { current(): SurfaceId | null; set(t: SurfaceId): void; cycle(scope?: string, dir?: 1 | -1): SurfaceId | null } } {
  return (host as unknown as { buildHostContext(): { focus: { current(): SurfaceId | null; set(t: SurfaceId): void; cycle(scope?: string, dir?: 1 | -1): SurfaceId | null } } }).buildHostContext();
}

describe('F-3b — ctx.focus uses FocusManager primitive when wired', () => {
  test('current() returns primitive.active().id', () => {
    const { host, coordinator } = makeHost({ withFocusManager: true });
    const fm = coordinator.focusManagerAPI();
    fm.register({
      id: 'node:x' as SurfaceId,
      scope: 'dashboard',
      focusable: true,
      priority: 10,
      owner: 'dashboard',
    });
    fm.setFocus('node:x' as SurfaceId, 'test');

    const ctx = buildHostCtx(host);
    expect(ctx.focus.current()).toBe('node:x');
  });

  test('set(target) calls primitive.setFocus with plugin:set reason', () => {
    const { host, coordinator } = makeHost({ withFocusManager: true });
    const fm = coordinator.focusManagerAPI();
    fm.register({
      id: 'node:y' as SurfaceId,
      scope: 'dashboard',
      focusable: true,
      priority: 10,
      owner: 'dashboard',
    });

    let observedReason: string | null = null;
    fm.on('focused', (ev) => { observedReason = ev.reason; });

    const ctx = buildHostCtx(host);
    ctx.focus.set('node:y' as SurfaceId);

    expect(fm.active()?.id).toBe('node:y');
    expect(observedReason).toBe('plugin:set');
  });

  test('cycle(scope, dir) calls primitive.cycle with plugin:cycle reason', () => {
    const { host, coordinator } = makeHost({ withFocusManager: true });
    const fm = coordinator.focusManagerAPI();
    fm.register({ id: 'a' as SurfaceId, scope: 'dashboard', focusable: true, priority: 10, owner: 'dashboard' });
    fm.register({ id: 'b' as SurfaceId, scope: 'dashboard', focusable: true, priority: 20, owner: 'dashboard' });
    fm.setFocus('a' as SurfaceId, 'setup');

    let observedReason: string | null = null;
    fm.on('cycled', (ev) => { observedReason = ev.reason; });

    const ctx = buildHostCtx(host);
    const result = ctx.focus.cycle('dashboard', 1);

    // Cycle emitted from the primitive with the expected reason
    // (only asserts the primitive path was actually taken).
    expect(observedReason).toBe('plugin:cycle');
    // Result is a valid id from the pool.
    expect(result === 'a' || result === 'b').toBe(true);
  });

  test('cycle with omitted scope defaults to "dashboard"', () => {
    const { host, coordinator } = makeHost({ withFocusManager: true });
    const fm = coordinator.focusManagerAPI();
    fm.register({ id: 'd1' as SurfaceId, scope: 'dashboard', focusable: true, priority: 10, owner: 'dashboard' });
    fm.register({ id: 'd2' as SurfaceId, scope: 'dashboard', focusable: true, priority: 20, owner: 'dashboard' });
    fm.setFocus('d1' as SurfaceId, 'setup');

    const ctx = buildHostCtx(host);
    const result = ctx.focus.cycle(undefined, 1);
    expect(result === 'd1' || result === 'd2').toBe(true);
  });
});

describe('F-3b — fallback when focusManager omitted', () => {
  test('current() falls back to display.currentFocus', () => {
    const { host, coordinator } = makeHost({ withFocusManager: false });
    const handle = coordinator.handle('plugin:host');
    handle.registerFocus({
      id: 'legacy:a' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });
    handle.focus('legacy:a' as SurfaceId);

    const ctx = buildHostCtx(host);
    expect(ctx.focus.current()).toBe('legacy:a');
  });

  test('set() falls back to display.focus', () => {
    const { host, coordinator } = makeHost({ withFocusManager: false });
    const handle = coordinator.handle('plugin:host');
    handle.registerFocus({
      id: 'legacy:b' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });

    const ctx = buildHostCtx(host);
    ctx.focus.set('legacy:b' as SurfaceId);

    // display.focus → publish → coord.setFocus → primitive (via
    // F-3a-init mirror). Primitive ends up active on the target.
    expect(coordinator.focusManagerAPI().active()?.id).toBe('legacy:b');
  });
});
