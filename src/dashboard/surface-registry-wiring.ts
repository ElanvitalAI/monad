import type { SurfaceRegistry, WireWindowSurfacesHandle } from '../surface/index.js';
import {
  wireModalSurfaceAdapter,
  wireWidgetSurfaceAdapter,
  wireWindowSurfaces,
} from '../surface/index.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { WidgetHost } from '../widgets/host.js';

export interface DashboardSurfaceRegistryWiringDeps {
  surfaceRegistry: SurfaceRegistry;
  widgetHost: WidgetHost;
  windowRegistry: WindowRegistry;
  wireModal?: typeof wireModalSurfaceAdapter;
  wireWidget?: typeof wireWidgetSurfaceAdapter;
  wireWindows?: typeof wireWindowSurfaces;
}

export interface DashboardSurfaceRegistryWiringResult {
  windowHandle?: WireWindowSurfacesHandle;
}

export function wireDashboardSurfaceRegistry(
  deps: DashboardSurfaceRegistryWiringDeps,
): DashboardSurfaceRegistryWiringResult {
  (deps.wireModal ?? wireModalSurfaceAdapter)({ registry: deps.surfaceRegistry });
  (deps.wireWidget ?? wireWidgetSurfaceAdapter)({
    registry: deps.surfaceRegistry,
    widgetHost: deps.widgetHost,
  });
  const windowHandle = (deps.wireWindows ?? wireWindowSurfaces)({
    windowRegistry: deps.windowRegistry,
    surfaceRegistry: deps.surfaceRegistry,
  });
  return { windowHandle };
}
