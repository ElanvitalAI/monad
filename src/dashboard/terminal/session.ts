// Dashboard-level singleton TerminalSessionRegistry + glue.
//
// Kept in its own module so P8's registry stays test-only while the
// dashboard can reach a shared instance without passing it through
// deep closure arguments. Initialization is deferred — dashboard.ts
// calls `initDashboardTerminalSessions(coordinator, eventBus)` once
// at startup; subsequent getters return the primed singleton.

import { TerminalSessionRegistry } from '../../terminal/session-registry.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import type { DisplayEventBus } from '../../display/events.js';

let registry: TerminalSessionRegistry | null = null;

export function initDashboardTerminalSessions(
  coordinator: DisplayCoordinator,
  eventBus?: DisplayEventBus,
): TerminalSessionRegistry {
  registry = new TerminalSessionRegistry({ coordinator, eventBus });
  return registry;
}

export function getDashboardTerminalSessions(): TerminalSessionRegistry {
  if (!registry) {
    throw new Error(
      'dashboard terminal session registry not initialized — call initDashboardTerminalSessions first',
    );
  }
  return registry;
}

/** Test-only reset so unit tests don't leak state between cases. */
export function _resetDashboardTerminalSessionsForTesting(): void {
  registry = null;
}
