import { createLayout } from '../layout/host.js';
import { renderLayout } from '../layout/render.js';
import type { ThemeTokens } from '../theme/tokens.js';

export interface DashboardLogRenderRuntimeDeps {
  syncLogWidgetState: () => void;
  widgetHost: any;
  theme: () => ThemeTokens;
}

export interface DashboardLogRenderRuntime {
  render(height: number, width: number, topRow: number, focused: boolean): string[];
}

export function createDashboardLogRenderRuntime(
  deps: DashboardLogRenderRuntimeDeps,
): DashboardLogRenderRuntime {
  return {
    render(height, width, topRow, focused) {
      deps.syncLogWidgetState();
      const logOnly = createLayout([
        { height: 'flex', cells: [{ widgetInstanceId: 'wd-log', width: 'flex' }] },
      ]);
      return renderLayout(logOnly, deps.widgetHost, {
        width,
        height,
        topRow,
        focusedInstanceId: focused ? 'wd-log' : null,
        theme: deps.theme(),
      });
    },
  };
}
