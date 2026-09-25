import { registerCaptureRuntimes } from '../tool-runtime/capture-runtimes.js';
import { registerMaterializeRuntimes } from '../tool-runtime/materialize-runtimes.js';
import { registerSurfaceUIRuntimes } from '../tool-runtime/surface-ui-runtimes.js';
import type { PaneVisualStateStore } from '../panes/visual-state.js';
import type { WidgetHost } from '../widgets/host.js';
import type { MaterializeIntentDeps } from '../../plugins/iul-shared/materialize-intent-tool.js';

export interface DashboardWidgetRuntimeRegistrationDeps {
  widgetHost: WidgetHost;
  paneVisualStateStore: PaneVisualStateStore;
  getProvider: MaterializeIntentDeps['getProvider'];
  registerSurfaceUi?: typeof registerSurfaceUIRuntimes;
  registerCapture?: typeof registerCaptureRuntimes;
  registerMaterialize?: typeof registerMaterializeRuntimes;
}

export function registerDashboardWidgetRuntimes(
  deps: DashboardWidgetRuntimeRegistrationDeps,
): void {
  (deps.registerSurfaceUi ?? registerSurfaceUIRuntimes)({
    widgetHost: deps.widgetHost,
    store: deps.paneVisualStateStore,
  });
  (deps.registerCapture ?? registerCaptureRuntimes)({
    widgetHost: deps.widgetHost,
    inspectDeps: {
      store: deps.paneVisualStateStore,
      widgetHost: deps.widgetHost,
    },
  });
  (deps.registerMaterialize ?? registerMaterializeRuntimes)({
    getProvider: deps.getProvider,
    listWidgetTypes: () => deps.widgetHost.listTypes(),
    spawnWidget: (opts) => deps.widgetHost.spawn(opts),
    defaultSkipTypes: ['iul-canvas'],
  });
}
