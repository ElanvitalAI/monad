import { describe, expect, mock, test } from 'bun:test';

import { createDashboardPluginPaneRuntime } from '../src/dashboard/plugin-pane-runtime.js';

describe('dashboard plugin pane runtime', () => {
  test('state/open/close/setOmitOrder delegate to dashboard pane ops', () => {
    const state = {
      activeViewId: 'main',
      viewLabel: 'Main',
      baseView: 1,
      focused: 'preview',
      compactLevel: 'desktop',
      primary: 'input',
      panes: [],
    };
    const closeDashboardPane = mock((_pane: 'preview') => true);
    const openDashboardPane = mock((_pane: 'preview') => true);
    const setDashboardPaneOmitOrder = mock((_panes: readonly string[]) => state);

    const runtime = createDashboardPluginPaneRuntime({
      paneStateSnapshot: () => state,
      activePaneIds: () => ['input', 'preview'],
      closeDashboardPane,
      openDashboardPane,
      openDashboardPaneModal: mock((_pane: 'preview') => {}),
      setDashboardPaneOmitOrder,
    });

    expect(runtime.state()).toBe(state);
    expect(runtime.close('preview')).toBe(true);
    expect(runtime.open('preview')).toBe(true);
    expect(runtime.setOmitOrder?.(['log', 'preview'])).toBe(state);
    expect(closeDashboardPane).toHaveBeenCalledWith('preview');
    expect(openDashboardPane).toHaveBeenCalledWith('preview');
    expect(setDashboardPaneOmitOrder).toHaveBeenCalledWith(['log', 'preview']);
  });

  test('openModal only opens non-input panes that belong to the active view', () => {
    const openDashboardPaneModal = mock((_pane: 'preview') => {});
    const runtime = createDashboardPluginPaneRuntime({
      paneStateSnapshot: () => ({
        activeViewId: 'main',
        viewLabel: 'Main',
        baseView: 1,
        focused: 'preview',
        compactLevel: 'desktop',
        primary: 'input',
        panes: [],
      }),
      activePaneIds: () => ['input', 'preview'],
      closeDashboardPane: mock((_pane: 'preview') => true),
      openDashboardPane: mock((_pane: 'preview') => true),
      openDashboardPaneModal,
      setDashboardPaneOmitOrder: mock((_panes: readonly string[]) => ({
        activeViewId: 'main',
        viewLabel: 'Main',
        baseView: 1,
        focused: 'preview',
        compactLevel: 'desktop',
        primary: 'input',
        panes: [],
      })),
    });

    expect(runtime.openModal('input')).toBe(false);
    expect(runtime.openModal('log')).toBe(false);
    expect(runtime.openModal('preview')).toBe(true);
    expect(openDashboardPaneModal).toHaveBeenCalledTimes(1);
    expect(openDashboardPaneModal).toHaveBeenCalledWith('preview');
  });
});
