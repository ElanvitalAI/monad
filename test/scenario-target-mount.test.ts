import { describe, expect, test } from 'bun:test';

import { createLayout } from '../src/layout/host.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  isRunScenarioMountTargetKind,
  mountScenarioIntoTarget,
  RUN_SCENARIO_MOUNT_TARGET_KINDS,
  unsupportedRunScenarioTargetError,
} from '../src/tool-runtime/scenario-target-mount.js';
import { logWidget } from '../src/ui/declarative/index.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';

function makeDeps() {
  const registry = new WindowRegistry({
    addressBook: createAddressBook(),
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  registry.spawn({
    title: 'target',
    initialContent: { kind: 'markdown', text: 'seed' },
  });

  let dashboardModals = [{ id: 'picker', widgetInstanceId: 'old-widget', position: 'center' as const }];
  let pluginLayout = createLayout(
    [{ height: 'flex', cells: [{ widgetInstanceId: 'plugin-widget', width: 'flex' }] }],
    [],
  );

  return {
    registry,
    createPaneContent,
    spawnWidget: () => ({ id: 'new-widget' }),
    disposeWidget: () => {},
    getDashboardModals: () => dashboardModals,
    setDashboardModals: (modals: readonly typeof dashboardModals[number][]) => { dashboardModals = [...modals]; },
    getPluginLayout: () => pluginLayout,
    setPluginLayout: (layout: typeof pluginLayout) => { pluginLayout = layout; },
    getDashboardManagedWidgetIds: () => ['wd-log'],
  };
}

describe('scenario-target-mount', () => {
  test('mount target kind roster is explicit and closed', () => {
    expect(RUN_SCENARIO_MOUNT_TARGET_KINDS).toEqual([
      'window',
      'pane',
      'modal',
      'widget',
    ]);
    expect(isRunScenarioMountTargetKind('window')).toBe(true);
    expect(isRunScenarioMountTargetKind('widget')).toBe(true);
    expect(isRunScenarioMountTargetKind('input')).toBe(false);
    expect(isRunScenarioMountTargetKind('popover')).toBe(false);
  });

  test('input/popover/inline/bg targets stay explicit unsupported with stable reasons', () => {
    expect(unsupportedRunScenarioTargetError({ kind: 'input', inputId: 'chat-main' })).toMatch(/not a mount container/);
    expect(unsupportedRunScenarioTargetError({ kind: 'popover', popoverId: 'pill' })).toMatch(/transient/);
    expect(unsupportedRunScenarioTargetError({ kind: 'inline', inlineId: 'runner' })).toMatch(/one-line inline surface/);
    expect(unsupportedRunScenarioTargetError({ kind: 'bg', bgId: 'job-1' })).toMatch(/background\/session surface/);
  });

  test('pane target validates windowId before dispatch', () => {
    const deps = makeDeps();
    const result = mountScenarioIntoTarget(
      [{ type: 'markdown', config: { text: 'hello' } }],
      { kind: 'pane', ref: { windowId: 'NaN', paneId: 'pane-1' } },
      deps,
    );
    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/not a valid VW id/);
  });

  test('non-mount target kind returns shared unsupported error from the dispatcher', () => {
    const deps = makeDeps();
    const result = mountScenarioIntoTarget(
      [{ type: 'markdown', config: { text: 'hello' } }],
      { kind: 'popover', popoverId: 'pp-1' },
      deps,
    );
    expect(result).toEqual({
      mounted: false,
      error: 'RunScenario: target kind "popover" is transient and not a scenario mount destination',
    });
  });

  test('window target accepts a builder-authored scenario', () => {
    const deps = makeDeps();
    const windowId = deps.registry.list()[0]!.id;
    const result = mountScenarioIntoTarget(
      [logWidget('Telemetry').setLines(['> ready'])],
      { kind: 'window', windowId },
      deps,
    );
    expect(result).toEqual({ mounted: true });
  });
});
