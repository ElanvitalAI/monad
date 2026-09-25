import { describe, expect, mock, test } from 'bun:test';

import {
  DASHBOARD_SCENARIO_MANAGED_WIDGET_IDS,
  loadDashboardScenarioCatalog,
  registerDashboardScenarioRuntimes,
} from '../src/dashboard/scenario-runtime-boot.js';

describe('dashboard scenario runtime boot', () => {
  test('loadDashboardScenarioCatalog loads with last-wins duplicate policy and swallows errors', async () => {
    const loadOk = mock(async (_dir: string, opts: { onDuplicate: string }) => ({
      scenarios: new Map(),
      errors: [],
      opts,
    }));
    const loadFail = mock(async () => {
      throw new Error('missing');
    });

    const loaded = await loadDashboardScenarioCatalog('/tmp/scenarios', loadOk as never);
    const missing = await loadDashboardScenarioCatalog('/tmp/missing', loadFail as never);

    expect(loadOk).toHaveBeenCalledWith('/tmp/scenarios', { onDuplicate: 'last-wins' });
    expect(loaded).toEqual({
      scenarios: new Map(),
      errors: [],
      opts: { onDuplicate: 'last-wins' },
    });
    expect(missing).toBeUndefined();
  });

  test('registerDashboardScenarioRuntimes mounts inline widgets and swallows per-widget spawn errors', () => {
    let capturedDeps: { onMount: (widgets: readonly any[], target?: any) => { mounted: boolean; error?: string } } | null = null;
    const spawnWidget = mock((spec: { type: string }) => {
      if (spec.type === 'bad') throw new Error('bad');
      return { id: `widget:${spec.type}` };
    });

    registerDashboardScenarioRuntimes({
      scenarioCatalog: undefined,
      registry: {} as never,
      createPaneContent: mock((_spec: unknown) => ({} as never)),
      spawnWidget: spawnWidget as never,
      disposeWidget: mock((_id: string) => {}),
      getDashboardModals: () => [],
      setDashboardModals: mock((_modals: unknown[]) => {}),
      getPluginLayout: () => null,
      setPluginLayout: mock((_layout: unknown) => {}),
      registerScenario: ((deps) => { capturedDeps = deps as never; }) as never,
    });

    expect(capturedDeps).not.toBeNull();
    const result = capturedDeps!.onMount([
      { type: 'good', id: 'a', config: { x: 1 } },
      { type: 'bad' },
    ]);

    expect(result).toEqual({ mounted: true });
    expect(spawnWidget).toHaveBeenCalledWith(expect.objectContaining({
      type: 'good',
      id: 'a',
      config: { x: 1 },
    }));
    expect(spawnWidget).toHaveBeenCalledWith(expect.objectContaining({ type: 'bad' }));
  });

  test('registerDashboardScenarioRuntimes forwards target mounts with dashboard-managed widget ids', () => {
    let capturedDeps: { onMount: (widgets: readonly any[], target?: any) => { mounted: boolean; error?: string } } | null = null;
    const mountIntoTarget = mock((_widgets, _target, deps: { getDashboardManagedWidgetIds: () => readonly string[] }) => {
      return {
        mounted: true,
        managed: deps.getDashboardManagedWidgetIds(),
      };
    });

    registerDashboardScenarioRuntimes({
      scenarioCatalog: undefined,
      registry: {} as never,
      createPaneContent: mock((_spec: unknown) => ({} as never)),
      spawnWidget: mock((_spec: unknown) => {}),
      disposeWidget: mock((_id: string) => {}),
      getDashboardModals: () => [],
      setDashboardModals: mock((_modals: unknown[]) => {}),
      getPluginLayout: () => null,
      setPluginLayout: mock((_layout: unknown) => {}),
      registerScenario: ((deps) => { capturedDeps = deps as never; }) as never,
      mountIntoTarget: mountIntoTarget as never,
    });

    const result = capturedDeps!.onMount(
      [{ type: 'good' }],
      { kind: 'modal', modalId: 'm-1' },
    );

    expect(mountIntoTarget).toHaveBeenCalled();
    expect(result).toEqual({
      mounted: true,
      managed: [...DASHBOARD_SCENARIO_MANAGED_WIDGET_IDS],
    });
  });
});
