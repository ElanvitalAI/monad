import { registerDisplayControlRuntimes } from '../tool-runtime/display-control-runtimes.js';
import { registerLayoutRuntimes } from '../tool-runtime/layout-runtimes.js';
import type { ArtifactStore } from '../artifact/index.js';
import type { DisplayCoordinator } from '../display/coordinator.js';
import type { DisplayMouseEvent, HitTarget } from '../display/types.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { ContextMenuRegistry } from '../ui/context-menu-registry.js';
import type { MenuProviderRegistry } from '../ui/context-menu-providers.js';

export interface DashboardLayoutDisplayRuntimeRegistrationDeps {
  windowRegistry: WindowRegistry;
  artifactStore: ArtifactStore;
  coordinator: DisplayCoordinator;
  mouseDispatch: (ev: DisplayMouseEvent) => boolean;
  menuProviderRegistry: MenuProviderRegistry;
  contextMenuRegistry: ContextMenuRegistry;
  tooltipResolver: (target: HitTarget) => string | null;
  registerLayout?: typeof registerLayoutRuntimes;
  registerDisplayControl?: typeof registerDisplayControlRuntimes;
}

export function registerDashboardLayoutDisplayRuntimes(
  deps: DashboardLayoutDisplayRuntimeRegistrationDeps,
): void {
  (deps.registerLayout ?? registerLayoutRuntimes)(
    deps.windowRegistry,
    { artifactStore: deps.artifactStore },
  );
  (deps.registerDisplayControl ?? registerDisplayControlRuntimes)({
    coordinator: deps.coordinator,
    mouseDispatch: deps.mouseDispatch,
    menuProviderRegistry: deps.menuProviderRegistry,
    contextMenuRegistry: deps.contextMenuRegistry,
    tooltipResolver: deps.tooltipResolver,
  });
}
