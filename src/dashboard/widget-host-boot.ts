import { C } from '../tui.js';
import type { PluginHost } from '../plugins/core/host.js';
import type { WidgetHost } from '../widgets/host.js';

export interface DashboardWidgetHostBootDeps {
  widgetHost: Pick<WidgetHost, 'discover'>;
  pluginHost: Pick<PluginHost, 'setWidgetHost'>;
  pushDebugLine: (line: string) => void;
}

export async function bootDashboardWidgetHost(
  deps: DashboardWidgetHostBootDeps,
): Promise<void> {
  try {
    await deps.widgetHost.discover();
  } catch (err: unknown) {
    deps.pushDebugLine(C.warning(`widget discovery failed: ${formatWidgetBootError(err)}`));
  }
  deps.pluginHost.setWidgetHost(deps.widgetHost as WidgetHost);
}

function formatWidgetBootError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
