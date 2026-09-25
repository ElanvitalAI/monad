import type { DisplayCoordinator } from '../display/coordinator.js';
import type { DisplayEventBus } from '../display/events.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { TerminalSessionRegistry } from '../terminal/session-registry.js';
import type { TerminalRegistry } from '../terminal-matrix/index.js';

export interface DashboardTerminalRuntimeBootDeps {
  display: DisplayCoordinator;
  displayEvents: DisplayEventBus;
  initElementObservability: () => void;
  initDashboardTerminalSessions: (
    coordinator: DisplayCoordinator,
    eventBus?: DisplayEventBus,
  ) => TerminalSessionRegistry;
  createTerminalRegistry: (deps: { sessionRegistry: TerminalSessionRegistry; termSize: () => { cols: number; rows: number } }) => TerminalRegistry;
  initTerminalMatrix: (registry: TerminalRegistry) => TerminalRegistry;
  createBroadcastBus: (registry: TerminalRegistry) => unknown;
  getChannelBus: () => unknown;
  wirePersistence: (registry: TerminalSessionRegistry) => void;
  initDashboardApprovers: (deps: {
    coordinator: DisplayCoordinator;
    termSize: () => { cols: number; rows: number };
    getTheme: () => ThemeTokens | null | undefined;
  }) => void;
  termSize: () => { cols: number; rows: number };
  getTheme: () => ThemeTokens | null | undefined;
}

export interface DashboardTerminalRuntimeBootResult {
  sessionRegistry: TerminalSessionRegistry;
  terminalMatrix: TerminalRegistry;
  broadcastBus: unknown;
  channelBus: unknown;
}

export function bootDashboardTerminalRuntime(
  deps: DashboardTerminalRuntimeBootDeps,
): DashboardTerminalRuntimeBootResult {
  deps.initElementObservability();
  const sessionRegistry = deps.initDashboardTerminalSessions(deps.display, deps.displayEvents);
  const terminalMatrix = deps.initTerminalMatrix(deps.createTerminalRegistry({
    sessionRegistry,
    termSize: deps.termSize,
  }));
  const broadcastBus = deps.createBroadcastBus(terminalMatrix);
  const channelBus = deps.getChannelBus();
  deps.wirePersistence(sessionRegistry);
  deps.initDashboardApprovers({
    coordinator: deps.display,
    termSize: deps.termSize,
    getTheme: deps.getTheme,
  });
  return {
    sessionRegistry,
    terminalMatrix,
    broadcastBus,
    channelBus,
  };
}
