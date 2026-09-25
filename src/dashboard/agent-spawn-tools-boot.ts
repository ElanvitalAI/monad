import type { WindowRegistry } from '../virtual-windows/window-registry.js';

export interface DashboardAgentSpawnToolsBootDeps {
  registry: WindowRegistry;
  initSpawnCodingAgentInVW: (registry: WindowRegistry) => void;
  initSpawnEmbodiedAgentInVW: (registry: WindowRegistry) => void;
}

export function bootDashboardAgentSpawnTools(
  deps: DashboardAgentSpawnToolsBootDeps,
): void {
  deps.initSpawnCodingAgentInVW(deps.registry);
  deps.initSpawnEmbodiedAgentInVW(deps.registry);
}
