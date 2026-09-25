export interface DashboardAgentsSlashRuntimeDeps {
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardAgentsSlashRuntime {
  viewOpenedLine(): string;
  viewUnavailableLine(): string;
  popupLine(opened: boolean): string;
  popupPromotedLine(): string;
  popupUsageLine(): string;
  usageLine(): string;
}

export function createDashboardAgentsSlashRuntime(
  deps: DashboardAgentsSlashRuntimeDeps,
): DashboardAgentsSlashRuntime {
  return {
    viewOpenedLine: () => deps.muted('  agents view opened'),
    viewUnavailableLine: () => deps.warning('  agents view is unavailable'),
    popupLine: (opened) => deps.muted(`  agents companion popup ${opened ? 'opened' : 'closed'}`),
    popupPromotedLine: () => deps.muted('  agents companion promoted to agents view'),
    popupUsageLine: () => deps.warning('  usage: /agents popup [open|close|toggle|promote]'),
    usageLine: () => deps.warning('  Usage: /agents open|popup [open|close|toggle|promote]'),
  };
}
