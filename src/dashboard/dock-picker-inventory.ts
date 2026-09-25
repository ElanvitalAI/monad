import type { PaneWindowPreset } from '../mouse-action-recipes.js';

export interface DashboardDockWindowSeed {
  pane: string;
  label: string;
}

export interface DashboardVirtualWindowSeed {
  id: number;
  title: string;
}

export interface DashboardVirtualWindowEntry {
  id: number;
  label: string;
  active?: boolean;
}

export function buildDashboardDockWindowTargets(
  seeds: DashboardDockWindowSeed[],
): PaneWindowPreset[] {
  return seeds.map((seed) => ({
    id: seed.pane,
    label: seed.label,
    description: `Open ${seed.label} in a popup window`,
  }));
}

export function buildDashboardVirtualWindowEntries(
  windows: DashboardVirtualWindowSeed[],
  currentWindowId: number | null,
): DashboardVirtualWindowEntry[] {
  return windows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((window) => ({
      id: window.id,
      label: window.title.trim() ? window.title : `VW#${window.id}`,
      active: currentWindowId === window.id,
    }));
}
