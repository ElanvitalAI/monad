// Phase F-3c — external callers (execution-surface + dashboard debug
// panes + dashboard setWorkingFocus sync path) now write through the
// FocusManager primitive directly instead of routing via the coord
// wrappers. This pins the primitive-direct contract so regressions
// that accidentally revert to `display.focus` / `display.registerFocus`
// / `display.syncExternalFocus` are caught immediately.

import { describe, expect, test } from 'bun:test';
import {
  DisplayCoordinator,
  createExecutionSurface,
} from '../src/display/index.js';
import type { SurfaceId } from '../src/display/types.js';

function executionHarness() {
  const coordinator = new DisplayCoordinator({ frameMs: 16 });
  return { coordinator };
}

describe('F-3c — execution-surface start() focuses via FocusManager when wired', () => {
  test('start() sets primitive active via opts.focusManager (wired)', async () => {
    const { coordinator } = executionHarness();
    const handle = createExecutionSurface(
      { id: 'exec:wired' as SurfaceId, command: '' },
      {
        display: coordinator.handle('plugin:host'),
        focusManager: coordinator.focusManagerAPI(),
        terminalFactory: () => ({
          start: () => {},
          stop: () => {},
          write: () => {},
          resize: () => {},
          render: () => '',
        }),
      },
    );

    handle.start();

    expect(coordinator.focusManagerAPI().active()?.id).toBe('exec:wired');

    handle.stop?.();
  });

  test("start() reason flows to primitive's 'focused' event as 'execution:mount'", () => {
    const { coordinator } = executionHarness();
    let observedReason: string | null = null;
    coordinator.focusManagerAPI().on('focused', (ev) => {
      if (ev.node?.id === 'exec:reason') observedReason = ev.reason;
    });

    const handle = createExecutionSurface(
      { id: 'exec:reason' as SurfaceId, command: '' },
      {
        display: coordinator.handle('plugin:host'),
        focusManager: coordinator.focusManagerAPI(),
        terminalFactory: () => ({
          start: () => {},
          stop: () => {},
          write: () => {},
          resize: () => {},
          render: () => '',
        }),
      },
    );
    handle.start();

    expect(observedReason).toBe('execution:mount');
    handle.stop?.();
  });

  test('start() falls back to display.focus() when focusManager omitted', () => {
    const { coordinator } = executionHarness();
    // No focusManager in opts → legacy path. display.focus() still
    // mirrors to primitive via F-3a-init · net result: primitive
    // ends up active. The behavioural difference is traceability:
    // the reason string differs (no 'execution:mount' tag).
    const handle = createExecutionSurface(
      { id: 'exec:legacy' as SurfaceId, command: '' },
      {
        display: coordinator.handle('plugin:host'),
        terminalFactory: () => ({
          start: () => {},
          stop: () => {},
          write: () => {},
          resize: () => {},
          render: () => '',
        }),
      },
    );
    handle.start();

    expect(coordinator.focusManagerAPI().active()?.id).toBe('exec:legacy');
    handle.stop?.();
  });

  test('spec.focus = false — skip focus transition regardless of wiring', () => {
    const { coordinator } = executionHarness();
    const handle = createExecutionSurface(
      { id: 'exec:nofocus' as SurfaceId, command: '', focus: false },
      {
        display: coordinator.handle('plugin:host'),
        focusManager: coordinator.focusManagerAPI(),
        terminalFactory: () => ({
          start: () => {},
          stop: () => {},
          write: () => {},
          resize: () => {},
          render: () => '',
        }),
      },
    );
    handle.start();

    expect(coordinator.focusManagerAPI().active()).toBeNull();
    handle.stop?.();
  });
});

describe('F-3c — dashboard-level primitive.register replaces display.registerFocus', () => {
  test('register() via primitive becomes visible in isRegistered()', () => {
    // Dashboard's debug-pane forEach loop migrated from
    // `dashboardDisplay.registerFocus({id, focusable, scope, order})`
    // to `display.focusManagerAPI().register({..., priority: order,
    // owner: 'dashboard'})`. The call surface differs (priority vs
    // order, explicit owner) but both produce a registered focus node.
    const { coordinator } = executionHarness();
    const fm = coordinator.focusManagerAPI();

    // Mirror the migrated call shape verbatim.
    fm.register({
      id: 'wd-debug-demo' as SurfaceId,
      scope: 'dashboard',
      focusable: true,
      priority: 5,
      owner: 'dashboard',
    });

    expect(fm.isRegistered('wd-debug-demo' as SurfaceId)).toBe(true);
    // Sortable via focusableInScope
    const nodes = fm.focusableInScope('dashboard');
    expect(nodes.some((n) => n.id === 'wd-debug-demo')).toBe(true);
  });
});

describe('F-3c — sync setFocus via primitive (dashboard setWorkingFocus)', () => {
  test('fm.setFocus on registered target sets coord.currentFocus via inverse mirror', () => {
    const { coordinator } = executionHarness();
    const fm = coordinator.focusManagerAPI();

    fm.register({
      id: 'pane:scratch' as SurfaceId,
      scope: 'dashboard',
      focusable: true,
      priority: 10,
      owner: 'dashboard',
    });

    fm.setFocus('pane:scratch' as SurfaceId, 'wd-sync');

    expect(coordinator.currentFocus()).toBe('pane:scratch');
  });

  test('fm.clear clears coord.currentFocus', () => {
    const { coordinator } = executionHarness();
    const fm = coordinator.focusManagerAPI();
    const h = coordinator.handle('dashboard');
    h.registerFocus({
      id: 'pane:log' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });
    h.focus('pane:log' as SurfaceId);
    expect(coordinator.currentFocus()).toBe('pane:log');

    fm.clear('view-exit');
    expect(coordinator.currentFocus()).toBeNull();
  });

  test('fm.setFocus on unregistered id — silent no-op (F-3c semantic narrowing)', () => {
    // F-3c's dashboard caller checks `fm.isRegistered(target)` before
    // calling `fm.setFocus` and falls back to `syncExternalFocus` for
    // the unregistered case (which uses _ensureRegistered). Direct
    // primitive.setFocus on unknown id returns false · no state
    // change. This pins the primitive-only semantic.
    const { coordinator } = executionHarness();
    const fm = coordinator.focusManagerAPI();

    const result = fm.setFocus('never:registered' as SurfaceId, 'probe');
    expect(result).toBe(false);
    expect(coordinator.currentFocus()).toBeNull();
  });
});
