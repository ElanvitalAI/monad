export interface DashboardEagerToolInit {
  label: string;
  run: () => void | Promise<void>;
}

export interface DashboardEagerToolBootDeps {
  initializers: DashboardEagerToolInit[];
  debugLog: (scope: string, area: string, details: { message: string }) => void;
}

export async function bootDashboardEagerTools(
  deps: DashboardEagerToolBootDeps,
): Promise<void> {
  for (const init of deps.initializers) {
    try {
      await init.run();
    } catch (err) {
      deps.debugLog(`${init.label}.init.fail`, 'dashboard-boot', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
