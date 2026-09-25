import type { PluginHost } from '../../plugins/core/host.js';
import type { DashboardPaneState } from '../../plugins/core/types.js';

export interface DashboardPaneHostToolOps {
  state(): DashboardPaneState;
  activePaneIds(): readonly string[];
  close(pane: string): boolean;
  open(pane: string): boolean;
  openModal(pane: string): void;
  modals(): unknown;
  setOmitOrder(panes: readonly string[]): DashboardPaneState;
}

export function registerDashboardPaneHostTools(
  pluginHost: PluginHost,
  ops: DashboardPaneHostToolOps,
): void {
  pluginHost.registerHostTool({
    name: 'pane_getState',
    description: 'Return active dashboard pane state: visible, hidden, user-closed, omitted reason, closeability, primary pane, active view, and focused pane.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => ops.state(),
  });
  pluginHost.registerHostTool({
    name: 'pane_close',
    description: 'Close a closeable pane in the active dashboard view. Primary panes cannot be closed.',
    parameters: {
      type: 'object',
      properties: {
        pane: { type: 'string', description: 'Pane id from pane_getState' },
      },
      required: ['pane'],
    },
    handler: async (args) => {
      const pane = typeof args.pane === 'string' ? args.pane : 'input';
      const closed = ops.close(pane);
      if (!closed) throw new Error(`pane "${String(args.pane)}" is not closeable in the active view`);
      return ops.state();
    },
  });
  pluginHost.registerHostTool({
    name: 'pane_open',
    description: 'Reopen a pane in the active dashboard view when it was user-closed.',
    parameters: {
      type: 'object',
      properties: {
        pane: { type: 'string', description: 'Pane id from pane_getState' },
      },
      required: ['pane'],
    },
    handler: async (args) => {
      const pane = typeof args.pane === 'string' ? args.pane : 'input';
      const opened = ops.open(pane);
      if (!opened) throw new Error(`pane "${String(args.pane)}" is not part of the active view`);
      return ops.state();
    },
  });
  pluginHost.registerHostTool({
    name: 'pane_openModal',
    description: 'Open a dashboard pane as a modal snapshot. Useful when a pane is omitted on a small window.',
    parameters: {
      type: 'object',
      properties: {
        pane: { type: 'string', description: 'Pane id from pane_getState' },
      },
      required: ['pane'],
    },
    handler: async (args) => {
      const pane = typeof args.pane === 'string' ? args.pane : 'input';
      if (pane === 'input' || !ops.activePaneIds().includes(pane)) {
        throw new Error(`pane "${String(args.pane)}" is not part of the active view`);
      }
      ops.openModal(pane);
      return { opened: true, pane, modals: ops.modals() };
    },
  });
  pluginHost.registerHostTool({
    name: 'pane_setOmitOrder',
    description: 'Set the active dashboard view omit order at runtime. Use view_saveConfig afterwards if the change should persist.',
    parameters: {
      type: 'object',
      properties: {
        panes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pane ids from pane_getState, ordered from first omitted to last omitted.',
        },
      },
      required: ['panes'],
    },
    handler: async (args) => {
      if (!Array.isArray(args.panes)) throw new Error('panes must be an array of pane ids');
      return ops.setOmitOrder(args.panes.map(String));
    },
  });
}
