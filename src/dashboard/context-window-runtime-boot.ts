import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { ContextDeps } from '../skills/tools/context.js';

/** The window-registry snapshot shape the `context.*` runtime expects.
 *  Derived from the authoritative `ContextDeps` contract so it can never
 *  drift from what `setContextRuntimeDeps` actually consumes. */
export type DashboardContextWindowRegistrySnapshot = NonNullable<
  ReturnType<NonNullable<ContextDeps['getWindowRegistry']>>
>;

export function createDashboardWindowRegistrySnapshot(
  registry: WindowRegistry,
): DashboardContextWindowRegistrySnapshot {
  return {
    list: () => registry.list().map((window) => ({
      id: window.id,
      title: window.title,
      listPanes: () => window.listPanes().map((pane) => ({
        id: pane.id,
        content: { kind: pane.content.kind, title: pane.content.title },
      })),
      focused: window.focused,
    })),
    current: () => registry.current() ?? null,
  };
}

// Surface-unification v2.2 V2.2-5 (2026-05-11) — `getScheduledJobs` slot
// retired together with the dashboard scheduler view + `context.jobs.list`
// LLM tool. Workflows now own scheduled work end-to-end.

export interface DashboardContextWindowRuntimeBootDeps {
  setControlRuntimeDeps: (deps: {
    getWindowRegistry: () => WindowRegistry;
  }) => void;
  setContextRuntimeDeps: (deps: ContextDeps) => void;
  registry: WindowRegistry;
  cwd: string;
  getTerminalSessions: () => Array<{ id: string; title: string; state: string }>;
}

export function bootDashboardContextWindowRuntime(
  deps: DashboardContextWindowRuntimeBootDeps,
): void {
  deps.setControlRuntimeDeps({
    getWindowRegistry: () => deps.registry,
  });
  deps.setContextRuntimeDeps({
    cwd: deps.cwd,
    getWindowRegistry: () => createDashboardWindowRegistrySnapshot(deps.registry),
    getTerminalSessions: deps.getTerminalSessions,
  });
}
