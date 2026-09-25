import { describe, expect, test } from 'bun:test';

import { createLayout } from '../src/layout/host.js';
import type { Layout } from '../src/layout/types.js';
import { mountScenarioIntoWidget } from '../src/tool-runtime/scenario-widget-mount.js';
import { dialogWidget, widget } from '../src/ui/declarative/index.js';

describe('scenario-widget-mount', () => {
  test('replaces a widget in the active plugin layout', () => {
    let dashboardModals = [] as const;
    let pluginLayout: Layout | null = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: 'plugin-widget', width: 'flex' }] },
    ]);
    const disposed: string[] = [];
    const spawnCalls: Array<Record<string, unknown>> = [];

    const result = mountScenarioIntoWidget(
      [{ type: 'markdown', character: 'Replacement', config: { text: 'replacement' } }],
      'plugin-widget',
      {
        spawnWidget: (opts) => {
          spawnCalls.push(opts);
          return { id: 'new-widget' };
        },
        disposeWidget: (id) => { disposed.push(id); },
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals as []; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => [],
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(pluginLayout?.rows[0]!.cells[0]!.widgetInstanceId).toBe('new-widget');
    expect(disposed).toEqual(['plugin-widget']);
    expect(spawnCalls).toEqual([{
      type: 'markdown',
      character: 'Replacement',
      config: { text: 'replacement' },
      meta: {
        declarativeSpec: {
          type: 'markdown',
          character: 'Replacement',
          config: { text: 'replacement' },
        },
      },
    }]);
  });

  test('delegates modal-hosted widget replacement through modal mount', () => {
    let dashboardModals = [{ id: 'm1', widgetInstanceId: 'modal-widget', position: 'center' as const }];
    let pluginLayout: Layout | null = null;

    const spawnCalls: Array<Record<string, unknown>> = [];
    const result = mountScenarioIntoWidget(
      [{ type: 'markdown', config: { text: 'replacement' } }],
      'modal-widget',
      {
        spawnWidget: (opts) => {
          spawnCalls.push(opts);
          return { id: 'new-modal-widget' };
        },
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = [...modals]; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => [],
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(dashboardModals[0]!.widgetInstanceId).toBe('new-modal-widget');
    expect(spawnCalls).toEqual([{
      type: 'markdown',
      config: { text: 'replacement' },
      meta: {
        declarativeSpec: {
          type: 'markdown',
          config: { text: 'replacement' },
        },
      },
    }]);
  });

  test('runtime spawn uses chrome title as character fallback', () => {
    let dashboardModals = [] as const;
    let pluginLayout: Layout | null = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: 'plugin-widget', width: 'flex' }] },
    ]);
    const spawnCalls: Array<Record<string, unknown>> = [];

    const result = mountScenarioIntoWidget(
      [{
        type: 'markdown',
        chrome: { title: 'Spec Title' },
        config: { text: 'replacement' },
      }],
      'plugin-widget',
      {
        spawnWidget: (opts) => {
          spawnCalls.push(opts);
          return { id: 'new-widget' };
        },
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals as []; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => [],
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(spawnCalls[0]?.character).toBe('Spec Title');
  });

  test('rejects dashboard-managed base widgets', () => {
    let dashboardModals = [] as const;
    let pluginLayout: Layout | null = null;

    const result = mountScenarioIntoWidget(
      [{ type: 'markdown', config: { text: 'replacement' } }],
      'wd-log',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals as []; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => ['wd-log', 'wd-browser'],
      },
    );

    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/dashboard-managed/);
  });

  test('accepts builder-authored scenarios directly', () => {
    let dashboardModals = [] as const;
    let pluginLayout: Layout | null = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: 'plugin-widget', width: 'flex' }] },
    ]);
    const spawnCalls: Array<Record<string, unknown>> = [];

    const result = mountScenarioIntoWidget(
      [dialogWidget('dialog', 'Approve patch?').setBody('Ship it').setButtons(['Approve'])],
      'plugin-widget',
      {
        spawnWidget: (opts) => {
          spawnCalls.push(opts);
          return { id: 'new-widget' };
        },
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals as []; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => [],
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(spawnCalls[0]).toMatchObject({
      type: 'dialog',
      character: 'Approve patch?',
    });
  });

  test('rejects nested builder-authored children for widget targets', () => {
    let dashboardModals = [] as const;
    let pluginLayout: Layout | null = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: 'plugin-widget', width: 'flex' }] },
    ]);

    const result = mountScenarioIntoWidget(
      [widget('dialog').withChild(widget('list'))],
      'plugin-widget',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals as []; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
        getDashboardManagedWidgetIds: () => [],
      },
    );

    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/nested scenario children/);
  });
});
