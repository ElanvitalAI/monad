import type { DashboardSimulationScenario } from './sim-shell-runtime.js';

export interface DashboardSimSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardSimSlashRuntime {
  usageLines(): string[];
  listLines(scenarios: readonly DashboardSimulationScenario[]): string[];
  openedLine(windowId: number): string;
  openedWebLine(path: string): string;
  runHeading(id: string): string;
  unknownScenarioLine(target: string): string;
}

export function createDashboardSimSlashRuntime(
  deps: DashboardSimSlashRuntimeDeps,
): DashboardSimSlashRuntime {
  return {
    usageLines: () => [
      '',
      deps.accent('❯ /sim'),
      deps.muted('  /sim open              Open the simulator VW shell'),
      deps.muted('  /sim web               Open the local quick-test web cockpit'),
      deps.muted('  /sim list              List available simulator scenarios'),
      deps.muted('  /sim run <scenario>    Run one simulator scenario directly'),
      deps.muted('  examples: picture | video-stop | cdp-status | cdp-smoke | cdp-stop'),
    ],
    listLines: (scenarios) => [
      deps.accent('❯ /sim list'),
      ...scenarios.map((scenario) =>
        deps.muted(`  ${scenario.id.padEnd(24)} ${scenario.family.padEnd(11)} ${scenario.label}`),
      ),
    ],
    openedLine: (windowId) => deps.muted(`  opened simulator shell in win:${windowId}`),
    openedWebLine: (path) => deps.muted(`  opened local simulator web cockpit: ${path}`),
    runHeading: (id) => deps.accent(`❯ /sim run ${id}`),
    unknownScenarioLine: (target) =>
      deps.warning(`  unknown simulator scenario: ${target}`),
  };
}
