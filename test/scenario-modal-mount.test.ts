import { describe, expect, test } from 'bun:test';

import { createLayout } from '../src/layout/host.js';
import type { Layout, ModalPlacement } from '../src/layout/types.js';
import { mountScenarioIntoModal } from '../src/tool-runtime/scenario-modal-mount.js';
import { dialogWidget, type DeclarativeWidgetNode, widget } from '../src/ui/declarative/index.js';

function modal(id: string, widgetInstanceId: string): ModalPlacement {
  return { id, widgetInstanceId, position: 'center' };
}

describe('scenario-modal-mount', () => {
  test('replaces a dashboard modal widget with a single-widget scenario', () => {
    let dashboardModals: readonly ModalPlacement[] = [modal('picker', 'old-widget')];
    let pluginLayout: Layout | null = null;
    const disposed: string[] = [];

    const result = mountScenarioIntoModal(
      [{ type: 'markdown', config: { text: 'hello' } }],
      'picker',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: (id) => { disposed.push(id); },
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(dashboardModals[0]!.widgetInstanceId).toBe('new-widget');
    expect(disposed).toEqual(['old-widget']);
  });

  test('replaces a plugin layout modal widget when dashboard modal is absent', () => {
    let dashboardModals: readonly ModalPlacement[] = [];
    let pluginLayout: Layout | null = createLayout(
      [{ height: 'flex', cells: [{ widgetInstanceId: null, width: 'flex' }] }],
      [modal('plugin-modal', 'old-plugin-widget')],
    );

    const result = mountScenarioIntoModal(
      [{ type: 'list', config: { items: ['a'] } }],
      'plugin-modal',
      {
        spawnWidget: () => ({ id: 'new-plugin-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(pluginLayout?.modals[0]!.widgetInstanceId).toBe('new-plugin-widget');
  });

  test('rejects multi-widget scenarios for modal targets', () => {
    let dashboardModals: readonly ModalPlacement[] = [modal('picker', 'old-widget')];
    let pluginLayout: Layout | null = null;
    const widgets: DeclarativeWidgetNode[] = [
      { type: 'markdown', config: { text: 'a' } },
      { type: 'markdown', config: { text: 'b' } },
    ];

    const result = mountScenarioIntoModal(
      widgets,
      'picker',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
      },
    );

    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/exactly one top-level widget/);
    expect(dashboardModals[0]!.widgetInstanceId).toBe('old-widget');
  });

  test('accepts a builder-authored single widget scenario', () => {
    let dashboardModals: readonly ModalPlacement[] = [modal('picker', 'old-widget')];
    let pluginLayout: Layout | null = null;

    const result = mountScenarioIntoModal(
      [dialogWidget('dialog', 'Approve patch?').setBody('Ship it').setButtons(['Approve'])],
      'picker',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
      },
    );

    expect(result).toEqual({ mounted: true });
    expect(dashboardModals[0]!.widgetInstanceId).toBe('new-widget');
  });

  test('rejects nested builder-authored children for modal targets', () => {
    let dashboardModals: readonly ModalPlacement[] = [modal('picker', 'old-widget')];
    let pluginLayout: Layout | null = null;

    const result = mountScenarioIntoModal(
      [widget('dialog').withChild(widget('list'))],
      'picker',
      {
        spawnWidget: () => ({ id: 'new-widget' }),
        disposeWidget: () => {},
        getDashboardModals: () => dashboardModals,
        setDashboardModals: (modals) => { dashboardModals = modals; },
        getPluginLayout: () => pluginLayout,
        setPluginLayout: (layout) => { pluginLayout = layout; },
      },
    );

    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/nested scenario children/);
  });
});
