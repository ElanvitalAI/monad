import type { HostHooks } from '../plugins/core/host.js';
import type { PaneFocus } from '../workspace-types.js';

export interface DashboardPluginPaneRuntimeDeps {
  paneStateSnapshot: NonNullable<NonNullable<HostHooks['panes']>['state']>;
  activePaneIds: () => readonly PaneFocus[];
  closeDashboardPane: (pane: PaneFocus) => boolean;
  openDashboardPane: (pane: PaneFocus) => boolean;
  openDashboardPaneModal: (pane: PaneFocus) => void;
  setDashboardPaneOmitOrder: (panes: readonly string[]) => ReturnType<NonNullable<NonNullable<HostHooks['panes']>['state']>>;
}

export function createDashboardPluginPaneRuntime(
  deps: DashboardPluginPaneRuntimeDeps,
): NonNullable<HostHooks['panes']> {
  return {
    state: () => deps.paneStateSnapshot(),
    close: (pane) => deps.closeDashboardPane(pane as PaneFocus),
    open: (pane) => deps.openDashboardPane(pane as PaneFocus),
    openModal: (pane) => {
      const id = pane as PaneFocus;
      if (id === 'input' || !deps.activePaneIds().includes(id)) return false;
      deps.openDashboardPaneModal(id);
      return true;
    },
    setOmitOrder: (panes) => deps.setDashboardPaneOmitOrder(panes),
  };
}
